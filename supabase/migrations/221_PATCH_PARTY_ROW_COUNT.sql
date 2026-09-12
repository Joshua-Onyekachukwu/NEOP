-- =================================================================
-- 221_PATCH_PARTY_ROW_COUNT.sql
-- P0 HOTFIX: submit_result_atomic out_party_rows was always reporting
-- only the LAST INSERT (row_count=1) in the FOR jsonb_array_elements
-- loop because GET DIAGNOSTICS ROW_COUNT only returns the count from
-- the very last SQL statement, NOT the cumulative total across the
-- 3 INSERTs in the loop.
-- Fix: use a manual counter that increments on every loop iteration
-- where we successfully INSERT (or DO UPDATE) at least one party row.
-- =================================================================

DROP FUNCTION IF EXISTS submit_result_atomic(TEXT,UUID,UUID,UUID,UUID,BIGINT,BIGINT,BIGINT,JSONB);

CREATE OR REPLACE FUNCTION submit_result_atomic(
  p_idem            TEXT,
  p_assignment_id   UUID,
  p_volunteer_id    UUID,
  p_election_id     UUID,
  p_polling_unit_id UUID,
  p_valid_votes     BIGINT,
  p_rejected_votes  BIGINT,
  p_total_votes     BIGINT,
  p_party_results   JSONB
)
RETURNS TABLE (
  out_submission_id  UUID,
  out_idempotency    TEXT,
  out_status         TEXT,
  out_is_repeat      BOOLEAN,
  out_party_rows     BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_sub_id UUID;
  v_repeat BOOLEAN := false;
  v_party_count BIGINT := 0;
  v_status TEXT := 'UNVERIFIED';
  v_rows_affected BIGINT;
  pr JSONB;
  pid UUID;
  pv BIGINT;
BEGIN
  -- (A) Idempotency short-circuit
  SELECT id INTO v_sub_id
  FROM result_submissions rs
  WHERE rs.idempotency_key = p_idem
  LIMIT 1;

  IF v_sub_id IS NOT NULL THEN
    SELECT count(*) INTO v_party_count
    FROM party_results pr
    WHERE pr.result_submission_id = v_sub_id;
    SELECT rs.status INTO v_status
    FROM result_submissions rs
    WHERE rs.id = v_sub_id;
    RETURN QUERY SELECT v_sub_id, p_idem, v_status, true::BOOLEAN, v_party_count;
    RETURN;
  END IF;

  -- (B) INSERT result submission
  INSERT INTO result_submissions (
    idempotency_key, assignment_id, volunteer_id, election_id,
    polling_unit_id, valid_votes, rejected_votes, total_votes, status
  ) VALUES (
    p_idem, p_assignment_id, p_volunteer_id, p_election_id,
    p_polling_unit_id, p_valid_votes, p_rejected_votes, p_total_votes, v_status
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, status INTO v_sub_id, v_status;

  -- Concurrent race fallback
  IF v_sub_id IS NULL THEN
    SELECT rs.id, rs.status INTO v_sub_id, v_status
    FROM result_submissions rs
    WHERE rs.idempotency_key = p_idem;
    v_repeat := true;
  END IF;

  -- (C) INSERT party rows with manual counter (cumulative across loop)
  v_party_count := 0;
  FOR pr IN SELECT jsonb_array_elements(p_party_results)
  LOOP
    pid := (pr->>'party_id')::UUID;
    pv  := COALESCE((pr->>'votes')::BIGINT, 0);
    IF pid IS NOT NULL AND pv >= 0 THEN
      INSERT INTO party_results (result_submission_id, party_id, votes)
      VALUES (v_sub_id, pid, pv)
      ON CONFLICT (result_submission_id, party_id) DO UPDATE
        SET votes = EXCLUDED.votes;
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_party_count := v_party_count + GREATEST(v_rows_affected, 0);
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_sub_id, p_idem, v_status, v_repeat, v_party_count;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_result_atomic TO service_role;
REVOKE EXECUTE ON FUNCTION submit_result_atomic FROM PUBLIC, anon, authenticated;
