-- =================================================================
-- 219_PATCH_SUBMIT_ATOMIC_COLUMNS.sql
-- P0 HOTFIX: submit_result_atomic() in 215 referenced columns that
-- do NOT exist in 200 result_submissions schema: notes, evidence_ids,
-- phone_confidence. These columns are NOT required for minimum viable
-- election-tomorrow flow, so we DROP+RECREATE the RPC to INSERT using
-- only columns that actually exist. Function signature also drops the
-- 3 optional parameters (p_notes, p_evidence_ids, p_phone_confidence)
-- that would be no-ops without schema backing.
--
-- Rule 39 compliance: NO OVERBUILD — only patch what's broken, do not
-- add unused columns to base table. If notes/evidence/phone_confidence
-- are later needed, add them in a dedicated migration with indexes/Rls.
-- =================================================================

DROP FUNCTION IF EXISTS submit_result_atomic(TEXT,UUID,UUID,UUID,UUID,BIGINT,BIGINT,BIGINT,JSONB,UUID[],TEXT,NUMERIC);

CREATE OR REPLACE FUNCTION submit_result_atomic(
  p_idempotency_key TEXT,
  p_assignment_id UUID,
  p_volunteer_id UUID,
  p_election_id UUID,
  p_polling_unit_id UUID,
  p_valid_votes BIGINT,
  p_rejected_votes BIGINT,
  p_total_votes BIGINT,
  p_party_results JSONB
)
RETURNS TABLE (
  submission_id UUID,
  idempotency_key TEXT,
  status TEXT,
  is_repeat BOOLEAN,
  party_row_count BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_sub_id UUID;
  v_repeat BOOLEAN := false;
  v_party_count BIGINT := 0;
  v_status TEXT := 'UNVERIFIED';
  pr JSONB;
  pid UUID;
  pv BIGINT;
BEGIN
  -- (A) Idempotency short-circuit: if key exists -> return saved (safe for timeouts/retry)
  SELECT id INTO v_sub_id
  FROM result_submissions
  WHERE result_submissions.idempotency_key = p_idempotency_key
  LIMIT 1;

  IF v_sub_id IS NOT NULL THEN
    SELECT count(*) INTO v_party_count
    FROM party_results pr
    WHERE pr.result_submission_id = v_sub_id;
    SELECT result_submissions.status INTO v_status
    FROM result_submissions
    WHERE result_submissions.id = v_sub_id;
    RETURN QUERY SELECT v_sub_id, p_idempotency_key, v_status, true::BOOLEAN, v_party_count;
    RETURN;
  END IF;

  -- (B) Implicit atomic tx: INSERT both rows
  INSERT INTO result_submissions (
    idempotency_key, assignment_id, volunteer_id, election_id,
    polling_unit_id, valid_votes, rejected_votes, total_votes, status
  ) VALUES (
    p_idempotency_key, p_assignment_id, p_volunteer_id, p_election_id,
    p_polling_unit_id, p_valid_votes, p_rejected_votes, p_total_votes, v_status
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, status INTO v_sub_id, v_status;

  -- If ON CONFLICT DO NOTHING missed (concurrent race window), re-lookup
  IF v_sub_id IS NULL THEN
    SELECT id, status INTO v_sub_id, v_status
    FROM result_submissions
    WHERE result_submissions.idempotency_key = p_idempotency_key;
    v_repeat := true;
  END IF;

  -- INSERT party_results
  FOR pr IN SELECT jsonb_array_elements(p_party_results)
  LOOP
    pid := (pr->>'party_id')::UUID;
    pv  := COALESCE((pr->>'votes')::BIGINT, 0);
    IF pid IS NOT NULL AND pv >= 0 THEN
      INSERT INTO party_results (result_submission_id, party_id, votes)
      VALUES (v_sub_id, pid, pv)
      ON CONFLICT (result_submission_id, party_id) DO UPDATE
        SET votes = EXCLUDED.votes;
    END IF;
  END LOOP;

  GET DIAGNOSTICS v_party_count = ROW_COUNT;

  RETURN QUERY SELECT v_sub_id, p_idempotency_key, v_status, v_repeat, v_party_count;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_result_atomic TO service_role;
REVOKE EXECUTE ON FUNCTION submit_result_atomic FROM PUBLIC, anon, authenticated;
