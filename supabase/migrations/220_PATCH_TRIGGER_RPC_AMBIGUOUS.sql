-- =================================================================
-- 220_PATCH_TRIGGER_RPC_AMBIGUOUS.sql
-- P0 HOTFIX for 2 bugs diagnosed during 218 E2E diagnostic:
--
-- BUG A (fn_result_state_transition_check): line 49 tests NEW.metadata
--   ->>'force_state_override' but result_submissions has NO metadata
--   JSONB column in 200 schema. Any UPDATE would 100% fail here.
--   Fix: Since metadata column isn't needed for election-tomorrow,
--   remove the secret bypass code entirely (per rule 39 no overbuild).
--   If a backdoor is ever needed, add it with a proper ALTER TABLE.
--
-- BUG B (submit_result_atomic): DECLARE block + RETURN TABLE both
--   declare a local column/variable named "idempotency_key". This can
--   cause PL/pgSQL "column reference 'idempotency_key' is ambiguous"
--   when an SQL statement inside refers to it without a table alias.
--   Fix: Rename p_idempotency_key parameter and all usages to
--   p_idem (no possible collision with RETURNS TABLE output column
--   names or result_submissions table columns).
-- =================================================================

-- -----------------------------------------------------------------
-- FIX A: Rebuild state machine WITHOUT NEW.metadata reference
-- -----------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_result_state_machine ON result_submissions;
DROP FUNCTION IF EXISTS fn_result_state_transition_check();

CREATE OR REPLACE FUNCTION fn_result_state_transition_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal_from TEXT[];
BEGIN
  -- (0) If status unchanged → allow.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- (1) SUPERSEDED frozen forever (immutable after superseded correction)
  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION '[state-machine] result_submission %: SUPERSEDED is IMMUTABLE (tried % → %)', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  -- (2) Legal forward transitions only (NO silent revert after verification)
  CASE OLD.status
    WHEN 'UNVERIFIED' THEN
      legal_from := ARRAY['PENDING_REVIEW','PENDING_VERIFICATION','RESULT_SUBMITTED','PARTIALLY_VERIFIED','VERIFIED','DISPUTED','REJECTED','SUPERSEDED','APPROVED'];
    WHEN 'RESULT_SUBMITTED' THEN
      legal_from := ARRAY['PENDING_REVIEW','PENDING_VERIFICATION','PARTIALLY_VERIFIED','VERIFIED','DISPUTED','REJECTED','SUPERSEDED','APPROVED'];
    WHEN 'PENDING_REVIEW' THEN
      legal_from := ARRAY['PENDING_VERIFICATION','PARTIALLY_VERIFIED','VERIFIED','DISPUTED','REJECTED','SUPERSEDED','APPROVED'];
    WHEN 'PENDING_VERIFICATION' THEN
      legal_from := ARRAY['PARTIALLY_VERIFIED','VERIFIED','DISPUTED','REJECTED','SUPERSEDED','APPROVED'];
    WHEN 'PARTIALLY_VERIFIED' THEN
      legal_from := ARRAY['VERIFIED','DISPUTED','REJECTED','SUPERSEDED','APPROVED'];
    WHEN 'VERIFIED' THEN
      -- Verified can go to: DISPUTED (complaint), SUPERSEDED (correction upload), or APPROVED (final)
      -- BUT NOT back to REJECTED/UNVERIFIED directly.
      legal_from := ARRAY['DISPUTED','SUPERSEDED','APPROVED'];
    WHEN 'DISPUTED' THEN
      legal_from := ARRAY['PENDING_VERIFICATION','VERIFIED','REJECTED','SUPERSEDED','APPROVED'];
    WHEN 'REJECTED' THEN
      -- Admin can correct-reject → SUPERSEDED or back to PENDING_VERIFICATION for resubmission
      legal_from := ARRAY['PENDING_VERIFICATION','SUPERSEDED'];
    WHEN 'APPROVED' THEN
      -- APPROVED is essentially final — only SUPERSEDED for correction
      legal_from := ARRAY['SUPERSEDED'];
    ELSE
      legal_from := ARRAY['SUPERSEDED'];
  END CASE;

  IF NOT (NEW.status = ANY(legal_from)) THEN
    RAISE EXCEPTION '[state-machine] result_submission %: ILLEGAL TRANSITION % → %  (legal → %).',
      OLD.id, OLD.status, NEW.status, array_to_string(legal_from, ',')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_result_state_machine
BEFORE UPDATE ON result_submissions
FOR EACH ROW
EXECUTE FUNCTION fn_result_state_transition_check();

-- -----------------------------------------------------------------
-- FIX B: Rebuild submit_result_atomic with renamed param to avoid
--        PL/pgSQL "idempotency_key is ambiguous" resolution
-- -----------------------------------------------------------------
DROP FUNCTION IF EXISTS submit_result_atomic(TEXT,UUID,UUID,UUID,UUID,BIGINT,BIGINT,BIGINT,JSONB,UUID[],TEXT,NUMERIC);
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
  pr JSONB;
  pid UUID;
  pv BIGINT;
BEGIN
  -- (A) Idempotency short-circuit (safe retry after timeout)
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

  -- (B) INSERT result_submissions + party_results in single implicit tx
  INSERT INTO result_submissions (
    idempotency_key, assignment_id, volunteer_id, election_id,
    polling_unit_id, valid_votes, rejected_votes, total_votes, status
  ) VALUES (
    p_idem, p_assignment_id, p_volunteer_id, p_election_id,
    p_polling_unit_id, p_valid_votes, p_rejected_votes, p_total_votes, v_status
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, status INTO v_sub_id, v_status;

  -- Concurrent race fallback: if DO NOTHING missed, re-select
  IF v_sub_id IS NULL THEN
    SELECT rs.id, rs.status INTO v_sub_id, v_status
    FROM result_submissions rs
    WHERE rs.idempotency_key = p_idem;
    v_repeat := true;
  END IF;

  -- Insert party breakdown
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

  RETURN QUERY SELECT v_sub_id, p_idem, v_status, v_repeat, v_party_count;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_result_atomic TO service_role;
REVOKE EXECUTE ON FUNCTION submit_result_atomic FROM PUBLIC, anon, authenticated;
