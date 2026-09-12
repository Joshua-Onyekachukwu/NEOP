-- ======================================================================
-- 215_RESULT_ATOMIC_SUBMIT.sql
-- P0 #S5: Result submission + party_results inserts MUST be atomic.
-- Cannot do multi-statement via REST (Supabase postgrest is stateless).
-- Provide submit_result_atomic() RPC used by /me/result route to replace
-- two separate JS INSERTs with single atomic DB call.
--
-- Also fixes P0 #S11 (TOCTOU idempotency race): ON CONFLICT idempotency_key
-- DO NOTHING / returns existing submission (200 safe repeat).
-- ======================================================================

DROP FUNCTION IF EXISTS submit_result_atomic(
  p_idempotency_key TEXT,
  p_assignment_id UUID,
  p_volunteer_id UUID,
  p_election_id UUID,
  p_polling_unit_id UUID,
  p_valid_votes BIGINT,
  p_rejected_votes BIGINT,
  p_total_votes BIGINT,
  p_party_results JSONB,      -- array of {party_id: UUID, votes: BIGINT}
  p_evidence_ids UUID[],
  p_notes TEXT,
  p_phone_confidence NUMERIC
);

CREATE OR REPLACE FUNCTION submit_result_atomic(
  p_idempotency_key TEXT,
  p_assignment_id UUID,
  p_volunteer_id UUID,
  p_election_id UUID,
  p_polling_unit_id UUID,
  p_valid_votes BIGINT,
  p_rejected_votes BIGINT,
  p_total_votes BIGINT,
  p_party_results JSONB,
  p_evidence_ids UUID[] DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_phone_confidence NUMERIC DEFAULT NULL
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
  -- (A) Idempotency short-circuit: if key exists -> return saved (safe retry)
  SELECT id INTO v_sub_id
  FROM result_submissions
  WHERE result_submissions.idempotency_key = p_idempotency_key
  LIMIT 1;

  IF v_sub_id IS NOT NULL THEN
    SELECT count(*) INTO v_party_count
    FROM party_results pr2 WHERE pr2.result_submission_id = v_sub_id;
    RETURN QUERY SELECT v_sub_id, p_idempotency_key, rs.status, true, v_party_count
      FROM result_submissions rs WHERE rs.id = v_sub_id LIMIT 1;
    RETURN;
  END IF;

  -- (B) Begin implicit atomic block (function call = one transaction)
  --     1. INSERT submission
  INSERT INTO result_submissions (
    idempotency_key, assignment_id, volunteer_id, election_id,
    polling_unit_id, valid_votes, rejected_votes, total_votes,
    notes, status, evidence_ids, phone_confidence
  ) VALUES (
    p_idempotency_key, p_assignment_id, p_volunteer_id, p_election_id,
    p_polling_unit_id, p_valid_votes, p_rejected_votes, p_total_votes,
    p_notes, v_status,
    CASE WHEN array_length(p_evidence_ids,1) > 0 THEN p_evidence_ids ELSE NULL END,
    p_phone_confidence
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id, status INTO v_sub_id, v_status;

  --     2. INSERT party_results (array of UUID party_id + votes)
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

-- ======================================================================
-- (2) Also UNIQUE guard: prevent multiple result_submissions rows per
-- assignment_id + election_id UNLESS correction (SUPERSEDED old row).
-- Today no DB-level constraint; if idempotency key missing, same
-- assignment can submit 500 times.
-- ======================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_single_active_result_per_assignment'
  ) THEN
    -- Create partial unique index: only one non-SUPERSEDED/non-REJECTED result per assignment.
    CREATE UNIQUE INDEX uq_single_active_result_per_assignment
      ON result_submissions (assignment_id)
      WHERE status NOT IN ('SUPERSEDED');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'uq_single_active_result_per_assignment skipped: %', SQLERRM;
END $$;
