-- =================================================================
-- 218_E2E_DIAGNOSTIC_ROLLBACK.sql v3 (post 220 patch)
-- Diagnostic-only: idempotency + state machine + aggregation integrity.
-- Rolls BACK at end. No schema/data changes.
-- =================================================================

DO $$
DECLARE
  v_election_id UUID;
  v_pu_id UUID;
  v_assignment_id UUID;
  v_volunteer_id UUID;
  v_party1 UUID;
  v_party2 UUID;
  v_party3 UUID;
  v_idem TEXT := gen_random_uuid()::TEXT;
  v_submission_id UUID;
  v_status_out TEXT;
  v_is_repeat BOOLEAN;
  v_party_row_count BIGINT;
  v_count_before INT;
  v_count_after INT;
  v_party_count_before INT;
  v_party_count_after INT;
  v_exception_msg TEXT := '';
BEGIN
  RAISE NOTICE '============================';
  RAISE NOTICE 'NEOP E2E ROLLBACK DIAGNOSTIC v3';
  RAISE NOTICE '============================';

  SELECT id INTO v_election_id FROM elections ORDER BY id LIMIT 1;
  SELECT id INTO v_pu_id FROM polling_units OFFSET 20 LIMIT 1;
  SELECT id INTO v_volunteer_id FROM volunteers WHERE status = 'ACTIVE' LIMIT 1;
  SELECT id INTO v_party1 FROM parties OFFSET 0 LIMIT 1;
  SELECT id INTO v_party2 FROM parties OFFSET 1 LIMIT 1;
  SELECT id INTO v_party3 FROM parties OFFSET 2 LIMIT 1;

  IF v_election_id IS NULL OR v_pu_id IS NULL OR v_volunteer_id IS NULL THEN
    RAISE EXCEPTION 'MISSING SEED DATA: election/pu/volunteer not found (run 210 demo seed)';
  END IF;
  RAISE NOTICE '[SETUP] election=% pu=% volunteer=%', v_election_id, v_pu_id, v_volunteer_id;

  INSERT INTO agent_assignments (volunteer_id, polling_unit_id, election_id, status)
  VALUES (v_volunteer_id, v_pu_id, v_election_id, 'CHECKED_IN')
  RETURNING id INTO v_assignment_id;
  RAISE NOTICE '[SETUP] assignment CHECKED_IN: %', v_assignment_id;

  SELECT COUNT(*) INTO v_count_before FROM result_submissions;
  SELECT COUNT(*) INTO v_party_count_before FROM party_results;
  RAISE NOTICE '[TEST-A] BEFORE submissions=%, party_results=%', v_count_before, v_party_count_before;

  -- CALL 1: first submit
  SELECT f.out_submission_id, f.out_status, f.out_is_repeat, f.out_party_rows
  INTO v_submission_id, v_status_out, v_is_repeat, v_party_row_count
  FROM submit_result_atomic(
    v_idem,                    -- 1  p_idem TEXT
    v_assignment_id,           -- 2  p_assignment_id UUID
    v_volunteer_id,            -- 3  p_volunteer_id UUID
    v_election_id,             -- 4  p_election_id UUID
    v_pu_id,                   -- 5  p_polling_unit_id UUID
    100::BIGINT,               -- 6  p_valid_votes BIGINT
    5::BIGINT,                 -- 7  p_rejected_votes BIGINT
    105::BIGINT,               -- 8  p_total_votes BIGINT
    jsonb_build_array(         -- 9  p_party_results JSONB
      jsonb_build_object('party_id', v_party1, 'votes', 40),
      jsonb_build_object('party_id', v_party2, 'votes', 35),
      jsonb_build_object('party_id', v_party3, 'votes', 25)
    )::JSONB
  ) f;

  RAISE NOTICE '[TEST-A CALL-1 NEW] submission_id=% status=% is_repeat=% party_rows=%',
    v_submission_id, v_status_out, v_is_repeat, v_party_row_count;
  IF v_is_repeat IS NOT FALSE THEN RAISE EXCEPTION 'EXPECTED is_repeat=false GOT %', v_is_repeat; END IF;
  IF v_party_row_count <> 3 THEN RAISE EXCEPTION 'EXPECTED party_rows=3 GOT %', v_party_row_count; END IF;
  IF v_status_out <> 'UNVERIFIED' THEN RAISE EXCEPTION 'EXPECTED status=UNVERIFIED GOT %', v_status_out; END IF;

  -- CALL 2: repeat same idem → short-circuit
  DECLARE
    v_sub2 UUID; v_stat2 TEXT; v_rep2 BOOLEAN; v_prc2 BIGINT;
  BEGIN
    SELECT f.out_submission_id, f.out_status, f.out_is_repeat, f.out_party_rows
    INTO v_sub2, v_stat2, v_rep2, v_prc2
    FROM submit_result_atomic(
      v_idem, v_assignment_id, v_volunteer_id, v_election_id, v_pu_id,
      999::BIGINT, 999::BIGINT, 9999::BIGINT, '[]'::JSONB
    ) f;
    RAISE NOTICE '[TEST-A CALL-2 IDEM] submission_id=% is_repeat=%', v_sub2, v_rep2;
    IF v_rep2 IS NOT TRUE THEN RAISE EXCEPTION 'EXPECTED is_repeat=true GOT %', v_rep2; END IF;
    IF v_sub2 <> v_submission_id THEN RAISE EXCEPTION 'EXPECTED same submission_id, got %', v_sub2; END IF;
  END;

  SELECT COUNT(*) INTO v_count_after FROM result_submissions;
  SELECT COUNT(*) INTO v_party_count_after FROM party_results;
  RAISE NOTICE '[TEST-A AFTER] submissions=%, party_results=% delta_s=%, delta_p=%',
    v_count_after, v_party_count_after,
    (v_count_after - v_count_before), (v_party_count_after - v_party_count_before);
  IF (v_count_after - v_count_before) <> 1 THEN
    RAISE EXCEPTION 'IDEM FAIL: submissions delta expected=1 got=%', (v_count_after - v_count_before);
  END IF;
  IF (v_party_count_after - v_party_count_before) <> 3 THEN
    RAISE EXCEPTION 'IDEM FAIL: party_results delta expected=3 got=%', (v_party_count_after - v_party_count_before);
  END IF;
  RAISE NOTICE '[TEST-A ★ PASS] Atomic submit + idempotency short-circuit: exactly 1 submission + 3 party rows.';

  RAISE NOTICE '---';
  RAISE NOTICE '[TEST-B] State machine illegal-transition guard';

  UPDATE result_submissions SET status = 'PENDING_VERIFICATION' WHERE id = v_submission_id;
  RAISE NOTICE '[TEST-B-1 OK] UNVERIFIED → PENDING_VERIFICATION';

  UPDATE result_submissions SET status = 'VERIFIED' WHERE id = v_submission_id;
  RAISE NOTICE '[TEST-B-2 OK] PENDING_VERIFICATION → VERIFIED';

  v_exception_msg := '';
  BEGIN
    UPDATE result_submissions SET status = 'REJECTED' WHERE id = v_submission_id;
  EXCEPTION WHEN OTHERS THEN
    v_exception_msg := SQLERRM;
  END;
  IF v_exception_msg = '' THEN RAISE EXCEPTION 'BLOCK FAIL: VERIFIED→REJECTED should RAISE but did not'; END IF;
  RAISE NOTICE '[TEST-B-3 ★ PASS] VERIFIED → REJECTED BLOCKED: %', left(v_exception_msg, 120);

  UPDATE result_submissions SET status = 'APPROVED' WHERE id = v_submission_id;
  v_exception_msg := '';
  BEGIN
    UPDATE result_submissions SET status = 'UNVERIFIED' WHERE id = v_submission_id;
  EXCEPTION WHEN OTHERS THEN
    v_exception_msg := SQLERRM;
  END;
  IF v_exception_msg = '' THEN RAISE EXCEPTION 'BLOCK FAIL: APPROVED→UNVERIFIED should RAISE but did not'; END IF;
  RAISE NOTICE '[TEST-B-4 ★ PASS] APPROVED → UNVERIFIED BLOCKED: %', left(v_exception_msg, 120);

  -- Aggregation integrity check
  DECLARE v_sum1 BIGINT; v_sum2 BIGINT;
  BEGIN
    SELECT COALESCE(SUM(pr.votes),0) INTO v_sum1
    FROM party_results pr WHERE pr.result_submission_id = v_submission_id;
    SELECT rs.valid_votes INTO STRICT v_sum2
    FROM result_submissions rs WHERE rs.id = v_submission_id;
    IF v_sum1 <> v_sum2 THEN
      RAISE EXCEPTION 'AGGREGATION MISMATCH: SUM(party_results)=% vs valid_votes=%', v_sum1, v_sum2;
    END IF;
    RAISE NOTICE '[TEST-C ★ PASS] SUM(party_results.votes)=% = valid_votes=%', v_sum1, v_sum2;
  END;

  RAISE NOTICE '============================================';
  RAISE NOTICE 'ALL ASSERTIONS PASSED → ROLLBACK (no side effects)';
  RAISE NOTICE '============================================';
  RAISE EXCEPTION 'PASSED_ALL_TESTS -- intentional rollback, nothing persisted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'PASSED_ALL_TESTS%' THEN
    RAISE NOTICE '%', SQLERRM;
  ELSE
    RAISE EXCEPTION '%', SQLERRM;
  END IF;
END $$;
