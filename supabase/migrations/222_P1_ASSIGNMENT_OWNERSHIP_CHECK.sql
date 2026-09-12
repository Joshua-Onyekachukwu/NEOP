-- ======================================================================
-- 222_P1_ASSIGNMENT_OWNERSHIP_CHECK.sql
-- P1-1: Enforce per-assignment RLS at DB RPC level (belt-and-suspenders).
--
-- WHY: submit_result_atomic() is REVOKEd from PUBLIC/anon/authenticated;
-- only service_role may EXECUTE (per 215/219/220).  But the route uses
-- SUPABASE_SERVICE_ROLE_KEY bypasses all RLS on the tables.  If the RPC never
-- volunteer_id / assignment status are only checked in Next.js layer only, so a
-- compromised route / leaked service_role key would let volunteer X submit
-- for volunteer Y's assignment and bypass CHECKED_IN status.
-- Fix: add 2 DB-level ASSERTIONS inside the RPC BEFORE the INSERT.
-- These assertions are atomic: if fail => 422 exception raised -> ROLLBACK.
-- ======================================================================

DROP FUNCTION IF EXISTS submit_result_atomic(
  p_idem TEXT,
  p_assignment_id UUID,
  p_volunteer_id UUID,
  p_election_id UUID,
  p_polling_unit_id UUID,
  p_valid_votes BIGINT,
  p_rejected_votes BIGINT,
  p_total_votes BIGINT,
  p_party_results JSONB
);

CREATE OR REPLACE FUNCTION submit_result_atomic(
  p_idem               TEXT,
  p_assignment_id      UUID,
  p_volunteer_id       UUID,
  p_election_id        UUID,
  p_polling_unit_id    UUID,
  p_valid_votes       BIGINT,
  p_rejected_votes    BIGINT,
  p_total_votes        BIGINT,
  p_party_results      JSONB
)
RETURNS TABLE (
  out_submission_id UUID,
  out_idempotency   TEXT,
  out_status        TEXT,
  out_is_repeat     BOOLEAN,
  out_party_rows    BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_sub_id UUID;
  v_repeat BOOLEAN := false;
  v_party_count BIGINT := 0;
  v_status TEXT := 'UNVERIFIED';
  v_a_vol UUID;
  v_a_st  TEXT;
  v_a_pu  UUID;
  v_a_el  UUID;
  pr JSONB;
  pid UUID;
  pv BIGINT;
BEGIN
  -- ------------------------------------------------------------------
  -- P1-1 ASSERT #1: assignment MUST exist.
  -- ASSERT #2: assignment.volunteer_id == p_volunteer_id (ownership).
  -- ASSERT #3: assignment.status == CHECKED_IN.
  -- ASSERT #4: assignment.polling_unit_id == p_polling_unit_id.
  -- ASSERT #5: assignment.election_id == p_election_id.
  -- All 5 happen BEFORE any write in a single transaction.
  -- ------------------------------------------------------------------
  SELECT aa.volunteer_id, aa.status, aa.polling_unit_id, aa.election_id
    INTO v_a_vol, v_a_st, v_a_pu, v_a_el
  FROM agent_assignments aa
  WHERE aa.id = p_assignment_id
  LIMIT 1;

  IF v_a_vol IS NULL THEN
    RAISE EXCEPTION 'NEOP_E404: assignment_id % not found', p_assignment_id
      USING ERRCODE = 'P1001';
  END IF;

  IF v_a_vol <> p_volunteer_id THEN
    RAISE EXCEPTION 'NEOP_E403: assignment % owned by volunteer %, not %',
      p_assignment_id, v_a_vol, p_volunteer_id
      USING ERRCODE = 'P1002';
  END IF;

  IF v_a_st <> 'CHECKED_IN' THEN
    RAISE EXCEPTION 'NEOP_E400: assignment % status is % (required CHECKED_IN)',
      p_assignment_id, v_a_st
      USING ERRCODE = 'P1003';
  END IF;

  IF v_a_pu IS DISTINCT FROM p_polling_unit_id THEN
    RAISE EXCEPTION 'NEOP_E400: assignment.polling_unit_id % != submitted.polling_unit_id % mismatch',
      v_a_pu, p_polling_unit_id
      USING ERRCODE = 'P1004';
  END IF;

  IF v_a_el IS DISTINCT FROM p_election_id THEN
    RAISE EXCEPTION 'NEOP_E400: assignment.election_id % != submitted.election_id % mismatch',
      v_a_el, p_election_id
      USING ERRCODE = 'P1005';
  END IF;

  -- (A) Idempotency short-circuit: if key exists -> return saved (safe retry)
  SELECT id INTO v_sub_id
  FROM result_submissions rs
  WHERE rs.idempotency_key = p_idem
  LIMIT 1;

  IF v_sub_id IS NOT NULL THEN
    SELECT count(*) INTO v_party_count
    FROM party_results pr2 WHERE pr2.result_submission_id = v_sub_id;
    RETURN QUERY
      SELECT rs.id, rs.idempotency_key, rs.status, TRUE::BOOLEAN, v_party_count
      FROM result_submissions rs WHERE rs.id = v_sub_id LIMIT 1;
    RETURN;
  END IF;

  -- (B) Implicit atomic block
  INSERT INTO result_submissions (
    idempotency_key, assignment_id, volunteer_id, election_id,
    polling_unit_id, valid_votes, rejected_votes, total_votes, status
  ) VALUES (
    p_idem, p_assignment_id, p_volunteer_id, p_election_id,
    p_polling_unit_id, p_valid_votes, p_rejected_votes, p_total_votes, v_status
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id, status INTO v_sub_id, v_status;

  -- (C) FOR EACH element in JSONB array: insert one row party_results.
  -- Manual incremental v_party_count instead of GET DIAGNOSTICS because ROW_COUNT (last stmt only, not cumulative per 221.
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
      v_party_count := v_party_count + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_sub_id, p_idem, v_status, v_repeat, v_party_count;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_result_atomic TO service_role;
REVOKE EXECUTE ON FUNCTION submit_result_atomic FROM PUBLIC, anon, authenticated;

-- ======================================================================
-- Also tighten uq_single_active_result_per_assignment if not exist (215 did it already; idempotent).
-- ======================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_single_active_result_per_assignment'
  ) THEN
    CREATE UNIQUE INDEX uq_single_active_result_per_assignment
      ON result_submissions (assignment_id)
      WHERE status NOT IN ('SUPERSEDED');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'uq_single_active_result_per_assignment skipped: %', SQLERRM;
END $$;
