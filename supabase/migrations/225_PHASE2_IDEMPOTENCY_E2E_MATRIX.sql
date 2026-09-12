CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP FUNCTION IF EXISTS run_idempotency_matrix_simulation();
CREATE OR REPLACE FUNCTION run_idempotency_matrix_simulation()
RETURNS TABLE(scenario TEXT, passed BOOLEAN, detail TEXT) AS $$
DECLARE
  v_test_pu UUID;
  v_test_elec UUID;
  v_vol UUID;
  v_assign UUID;
  v_test_party1 UUID;
  v_test_party2 UUID;
  v_test_user UUID;
  v_test_admin UUID;
  v_result_1 UUID;
  v_result_2 UUID;
  v_idem_key TEXT;
  v_out_id UUID;
  v_out_idem TEXT;
  v_out_status TEXT;
  v_out_repeat BOOLEAN;
  v_out_party_rows BIGINT;
  v_out_cid UUID;
  v_out_cstatus TEXT;
  v_out_sup INT;
  v_out_party_cnt INT;
  v_sum1 BIGINT;
  v_sum2 BIGINT;
  v_original_votes INT;
  v_actual_votes INT;
  v_err TEXT;
BEGIN
  v_test_user := '00000000-0000-0000-0000-000000000099';

  SELECT id INTO v_test_elec FROM elections LIMIT 1;
  IF v_test_elec IS NULL THEN
    INSERT INTO elections (id, name, type, status, is_active)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Test Election', 'PRESIDENTIAL', 'ACTIVE', true)
    RETURNING id INTO v_test_elec;
  END IF;

  SELECT id INTO v_test_pu FROM polling_units LIMIT 1;
  IF v_test_pu IS NULL THEN
    SELECT id INTO v_test_pu FROM states LIMIT 1;
    IF v_test_pu IS NULL THEN
      INSERT INTO states (id, name, code) VALUES ('00000000-0000-0000-0000-000000000001', 'Test State', 'TS') RETURNING id INTO v_test_pu;
    END IF;
    SELECT id INTO v_test_pu FROM lgas LIMIT 1;
    IF v_test_pu IS NULL THEN
      INSERT INTO lgas (id, state_id, name, code) VALUES ('00000000-0000-0000-0000-000000000002', (SELECT id FROM states LIMIT 1), 'Test LGA', 'TL') RETURNING id INTO v_test_pu;
    END IF;
    SELECT id INTO v_test_pu FROM wards LIMIT 1;
    IF v_test_pu IS NULL THEN
      INSERT INTO wards (id, lga_id, name, code) VALUES ('00000000-0000-0000-0000-000000000003', (SELECT id FROM lgas LIMIT 1), 'Test Ward', 'TW') RETURNING id INTO v_test_pu;
    END IF;
    INSERT INTO polling_units (id, official_code, name, state_id, lga_id, ward_id)
    VALUES ('00000000-0000-0000-0000-000000000010', 'TEST-PU-001', 'Test PU', (SELECT id FROM states LIMIT 1), (SELECT id FROM lgas LIMIT 1), (SELECT id FROM wards LIMIT 1))
    RETURNING id INTO v_test_pu;
  END IF;

  SELECT id INTO v_test_party1 FROM parties LIMIT 1;
  IF v_test_party1 IS NULL THEN
    INSERT INTO parties (id, official_name, abbreviation, color)
    VALUES ('00000000-0000-0000-0000-000000000004', 'Party A', 'PA', '#FF0000')
    RETURNING id INTO v_test_party1;
  END IF;
  SELECT id INTO v_test_party2 FROM parties OFFSET 1 LIMIT 1;
  IF v_test_party2 IS NULL THEN
    INSERT INTO parties (id, official_name, abbreviation, color)
    VALUES ('00000000-0000-0000-0000-000000000005', 'Party B', 'PB', '#0000FF')
    RETURNING id INTO v_test_party2;
  END IF;

  SELECT id INTO v_vol FROM volunteers LIMIT 1;
  IF v_vol IS NULL THEN
    INSERT INTO user_accounts (id, email, full_name)
    VALUES (v_test_user, 'test@neop.local', 'Test User')
    ON CONFLICT DO NOTHING;
    INSERT INTO volunteers (id, user_id, status)
    VALUES ('00000000-0000-0000-0000-000000000011', v_test_user, 'VERIFIED')
    RETURNING id INTO v_vol;
  END IF;

  SELECT id INTO v_assign FROM agent_assignments LIMIT 1;
  IF v_assign IS NULL THEN
    INSERT INTO agent_assignments (id, volunteer_id, polling_unit_id, election_id, status, observer_number)
    VALUES ('00000000-0000-0000-0000-000000000012', v_vol, v_test_pu, v_test_elec, 'CHECKED_IN', 1)
    RETURNING id INTO v_assign;
  END IF;

  SELECT id INTO v_test_admin FROM admin_users LIMIT 1;
  IF v_test_admin IS NULL THEN
    INSERT INTO admin_users (id, user_id, role, is_active)
    VALUES ('00000000-0000-0000-0000-000000000013', v_test_user, 'SUPER_ADMIN', true)
    RETURNING id INTO v_test_admin;
  END IF;

  v_idem_key := 'IDEM-S1-' || v_assign::TEXT;
  BEGIN
    DELETE FROM result_submissions WHERE idempotency_key = v_idem_key;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      v_idem_key, v_assign, v_vol, v_test_elec, v_test_pu,
      100, 10, 110,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 60),
        jsonb_build_object('party_id', v_test_party2, 'votes', 40)
      )
    );
    v_result_1 := v_out_id;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      v_idem_key, v_assign, v_vol, v_test_elec, v_test_pu,
      999, 99, 9999,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 999),
        jsonb_build_object('party_id', v_test_party2, 'votes', 999)
      )
    );
    v_result_2 := v_out_id;

    IF v_result_1 = v_result_2 AND v_out_repeat = true THEN
      scenario := 'S1_DOUBLE_SUBMIT_IDEM';
      passed := true;
      detail := 'Same submission id on repeat: ' || v_result_1::TEXT;
    ELSE
      scenario := 'S1_DOUBLE_SUBMIT_IDEM';
      passed := false;
      detail := 'MISMATCH: id1=' || v_result_1::TEXT || ' id2=' || v_result_2::TEXT || ' repeat=' || v_out_repeat::TEXT;
    END IF;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S1_DOUBLE_SUBMIT_IDEM';
    passed := false;
    detail := 'EXCEPTION: ' || v_err;
    RETURN NEXT;
  END;

  v_idem_key := 'IDEM-S2-' || v_assign::TEXT;
  BEGIN
    DELETE FROM result_submissions WHERE idempotency_key = v_idem_key;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      v_idem_key, v_assign, v_vol, v_test_elec, v_test_pu,
      100, 10, 110,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 60),
        jsonb_build_object('party_id', v_test_party2, 'votes', 40)
      )
    );
    v_result_1 := v_out_id;

    UPDATE result_submissions SET status = 'VERIFIED' WHERE id = v_result_1;
    UPDATE result_submissions SET status = 'REJECTED' WHERE id = v_result_1;

    scenario := 'S2_VERIFIED_TO_REJECTED';
    passed := false;
    detail := 'EXPECTED RAISE BUT SUCCEEDED: id=' || v_result_1::TEXT;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S2_VERIFIED_TO_REJECTED';
    passed := true;
    detail := 'Correctly raised: ' || v_err;
    RETURN NEXT;
  END;

  BEGIN
    DELETE FROM canonical_pu_results WHERE election_id = v_test_elec AND polling_unit_id = v_test_pu;

    SELECT * INTO v_out_cid, v_out_cstatus, v_out_sup, v_out_party_cnt
    FROM publish_canonical_result(
      v_test_elec, v_test_pu, 'PUBLISHED',
      100, 10, 110,
      v_result_1, NULL,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 60),
        jsonb_build_object('party_id', v_test_party2, 'votes', 40)
      ),
      v_test_admin
    );

    SELECT * INTO v_out_cid, v_out_cstatus, v_out_sup, v_out_party_cnt
    FROM publish_canonical_result(
      v_test_elec, v_test_pu, 'PUBLISHED',
      105, 5, 110,
      v_result_1, NULL,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 63),
        jsonb_build_object('party_id', v_test_party2, 'votes', 42)
      ),
      v_test_admin
    );

    IF v_out_sup >= 1 AND v_out_party_cnt = 2 THEN
      scenario := 'S3_PUBLISH_CANONICAL_TWICE';
      passed := true;
      detail := 'Superseded count=' || v_out_sup || ', parties=' || v_out_party_cnt;
    ELSE
      scenario := 'S3_PUBLISH_CANONICAL_TWICE';
      passed := false;
      detail := 'EXPECTED sup>=1+parties=2. Got sup=' || v_out_sup || ', parties=' || v_out_party_cnt;
    END IF;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S3_PUBLISH_CANONICAL_TWICE';
    passed := false;
    detail := 'EXCEPTION: ' || v_err;
    RETURN NEXT;
  END;

  BEGIN
    DELETE FROM canonical_pu_results WHERE election_id = v_test_elec AND polling_unit_id = v_test_pu;

    INSERT INTO canonical_pu_results (
      election_id, polling_unit_id, status,
      valid_votes, rejected_votes, total_votes,
      published_by, published_at
    ) VALUES (
      v_test_elec, v_test_pu, 'PUBLISHED',
      100, 10, 110, v_test_admin, NOW()
    );

    INSERT INTO canonical_pu_results (
      election_id, polling_unit_id, status,
      valid_votes, rejected_votes, total_votes,
      published_by, published_at
    ) VALUES (
      v_test_elec, v_test_pu, 'PUBLISHED',
      100, 10, 110, v_test_admin, NOW()
    );

    scenario := 'S4_EXCLUDE_CONSTRAINT_2_PUBLISHED';
    passed := false;
    detail := 'EXPECTED RAISE BUT SUCCEEDED: uq_canonical_exclude failed';
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S4_EXCLUDE_CONSTRAINT_2_PUBLISHED';
    passed := true;
    detail := 'Correctly raised: ' || v_err;
    RETURN NEXT;
  END;

  BEGIN
    DELETE FROM result_submissions WHERE idempotency_key IN ('IDEM-S5-A', 'IDEM-S5-B');
    DELETE FROM canonical_pu_results WHERE election_id = v_test_elec AND polling_unit_id = v_test_pu;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      'IDEM-S5-A', v_assign, v_vol, v_test_elec, v_test_pu,
      200, 20, 220,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 120),
        jsonb_build_object('party_id', v_test_party2, 'votes', 80)
      )
    );
    v_result_1 := v_out_id;

    SELECT COALESCE(SUM(votes), 0)::BIGINT INTO v_sum1
    FROM party_results WHERE result_submission_id = v_result_1;

    SELECT COALESCE(SUM(cpr.votes), 0)::BIGINT INTO v_sum2
    FROM canonical_party_results cpr
    JOIN canonical_pu_results cr ON cr.id = cpr.canonical_result_id
    WHERE cr.election_id = v_test_elec AND cr.polling_unit_id = v_test_pu;

    IF v_sum1 = 200 THEN
      scenario := 'S5_SUM_PARTY_MATCH_VALID';
      passed := true;
      detail := 'party_results SUM=' || v_sum1 || ' === valid_votes=200, canonical_SUM=' || v_sum2;
    ELSE
      scenario := 'S5_SUM_PARTY_MATCH_VALID';
      passed := false;
      detail := 'SUM(party_results.votes)=' || v_sum1 || ' !== valid_votes=200';
    END IF;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S5_SUM_PARTY_MATCH_VALID';
    passed := false;
    detail := 'EXCEPTION: ' || v_err;
    RETURN NEXT;
  END;

  BEGIN
    v_idem_key := 'IDEM-S6-AI-' || v_assign::TEXT;
    DELETE FROM result_submissions WHERE idempotency_key = v_idem_key;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      v_idem_key, v_assign, v_vol, v_test_elec, v_test_pu,
      500, 50, 550,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 300),
        jsonb_build_object('party_id', v_test_party2, 'votes', 200)
      )
    );
    v_result_1 := v_out_id;

    SELECT votes INTO v_original_votes
    FROM party_results WHERE result_submission_id = v_result_1 AND party_id = v_test_party1;

    v_original_votes := COALESCE(v_original_votes, 0);

    DELETE FROM verifications WHERE submission_id_1 = v_result_1;
    INSERT INTO verifications (
      election_id, polling_unit_id, submission_id_1, status,
      nvidia_ocr, nvidia_aggregate, final_decision
    ) VALUES (
      v_test_elec, v_test_pu, v_result_1, 'MATCH',
      jsonb_build_object('party_' || v_test_party1, 99999),
      jsonb_build_object('parties', jsonb_build_array()),
      'MATCH'
    );

    SELECT votes INTO v_actual_votes
    FROM party_results WHERE result_submission_id = v_result_1 AND party_id = v_test_party1;

    IF v_actual_votes = v_original_votes AND v_actual_votes = 300 THEN
      scenario := 'S6_AI_NEVER_ALTERS_ORIGINAL';
      passed := true;
      detail := 'Original party1 votes=' || v_original_votes || ', post-verification=' || v_actual_votes;
    ELSE
      scenario := 'S6_AI_NEVER_ALTERS_ORIGINAL';
      passed := false;
      detail := 'MUTATION DETECTED: original=' || v_original_votes || ' post=' || v_actual_votes;
    END IF;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S6_AI_NEVER_ALTERS_ORIGINAL';
    passed := false;
    detail := 'EXCEPTION: ' || v_err;
    RETURN NEXT;
  END;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION run_idempotency_matrix_simulation TO service_role;
REVOKE EXECUTE ON FUNCTION run_idempotency_matrix_simulation FROM PUBLIC, anon, authenticated;
