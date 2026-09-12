-- Diagnostic: RLS matrix - output results to a selectable temp result (no EXCEPTION)
DROP TABLE IF EXISTS _rls_diag_results;
CREATE TEMP TABLE _rls_diag_results (name TEXT, result TEXT, actual BIGINT, expected TEXT);

DO $$
DECLARE
  v_agentA UUID := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_agentB UUID := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_admin  UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_volA UUID; v_volB UUID;
  v BIGINT;
BEGIN
  SELECT id INTO v_volA FROM volunteers WHERE user_id = v_agentA LIMIT 1;
  SELECT id INTO v_volB FROM volunteers WHERE user_id = v_agentB LIMIT 1;

  -- ==================== A: ANON ====================
  SET LOCAL ROLE anon;

  SELECT count(*) INTO v FROM states;
  INSERT INTO _rls_diag_results VALUES ('A1.anon_states', CASE WHEN v=37 THEN 'PASS' ELSE 'FAIL' END, v, '=37');

  SELECT count(*) INTO v FROM parties;
  INSERT INTO _rls_diag_results VALUES ('A2.anon_parties', CASE WHEN v=9 THEN 'PASS' ELSE 'FAIL' END, v, '=9');

  SELECT count(*) INTO v FROM polling_units;
  INSERT INTO _rls_diag_results VALUES ('A3.anon_PUs', CASE WHEN v>=176846 THEN 'PASS' ELSE 'FAIL' END, v, '>=176846');

  SELECT count(*) INTO v FROM volunteers;
  INSERT INTO _rls_diag_results VALUES ('A4.anon_vols_should_be_0', CASE WHEN v=0 THEN 'PASS' ELSE 'FAIL' END, v, '=0');

  -- ==================== B: AGENT A ====================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_agentA::TEXT, true);

  SELECT count(*) INTO v FROM volunteers;
  INSERT INTO _rls_diag_results VALUES ('B1.agentA_1_vol', CASE WHEN v=1 THEN 'PASS' ELSE 'FAIL' END, v, '=1');

  DECLARE v_exp BIGINT;
  BEGIN SELECT count(*) INTO v_exp FROM agent_assignments WHERE volunteer_id = v_volA;
  SELECT count(*) INTO v FROM agent_assignments;
  INSERT INTO _rls_diag_results VALUES ('B2.agentA_own_assignments', CASE WHEN v=v_exp THEN 'PASS' ELSE 'FAIL' END, v, '='||v_exp); END;

  SELECT count(*) INTO v FROM user_accounts;
  INSERT INTO _rls_diag_results VALUES ('B3.agentA_1_user_account', CASE WHEN v=1 THEN 'PASS' ELSE 'FAIL' END, v, '=1');

  SELECT count(*) INTO v FROM incidents i
   JOIN volunteers v2 ON v2.id = i.volunteer_id
   WHERE v2.user_id = v_agentB;
  INSERT INTO _rls_diag_results VALUES ('B4.agentA_cannot_see_B_incidents', CASE WHEN v=0 THEN 'PASS' ELSE 'FAIL' END, v, '=0');

  -- ==================== C: AGENT B ====================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_agentB::TEXT, true);

  SELECT count(*) INTO v FROM volunteers;
  INSERT INTO _rls_diag_results VALUES ('C1.agentB_1_vol', CASE WHEN v=1 THEN 'PASS' ELSE 'FAIL' END, v, '=1');

  SELECT count(*) INTO v FROM incidents i
   JOIN volunteers v2 ON v2.id = i.volunteer_id
   WHERE v2.user_id = v_agentA;
  INSERT INTO _rls_diag_results VALUES ('C2.agentB_cannot_see_A_incidents', CASE WHEN v=0 THEN 'PASS' ELSE 'FAIL' END, v, '=0');

  DECLARE v_exp2 BIGINT;
  BEGIN SELECT count(*) INTO v_exp2 FROM agent_assignments WHERE volunteer_id = v_volB;
  SELECT count(*) INTO v FROM agent_assignments;
  INSERT INTO _rls_diag_results VALUES ('C3.agentB_own_assignments', CASE WHEN v=v_exp2 THEN 'PASS' ELSE 'FAIL' END, v, '='||v_exp2); END;

  SELECT count(*) INTO v FROM result_submissions;
  INSERT INTO _rls_diag_results VALUES ('C4.agentB_sees_public_subs', CASE WHEN v>=250 THEN 'PASS' ELSE 'FAIL' END, v, '>=250');

  -- ==================== D: ADMIN ====================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::TEXT, true);

  SELECT count(*) INTO v FROM volunteers;
  INSERT INTO _rls_diag_results VALUES ('D1.admin_all_vols', CASE WHEN v=250 THEN 'PASS' ELSE 'FAIL' END, v, '=250');

  SELECT count(*) INTO v FROM agent_assignments;
  INSERT INTO _rls_diag_results VALUES ('D2.admin_all_assignments', CASE WHEN v=500 THEN 'PASS' ELSE 'FAIL' END, v, '=500');

  SELECT count(*) INTO v FROM audit_log;
  INSERT INTO _rls_diag_results VALUES ('D3.admin_sees_audit', CASE WHEN v>=1 THEN 'PASS' ELSE 'FAIL' END, v, '>=1');

  SELECT count(*) INTO v FROM incidents;
  INSERT INTO _rls_diag_results VALUES ('D4.admin_all_incidents', CASE WHEN v=80 THEN 'PASS' ELSE 'FAIL' END, v, '=80');

  RESET ROLE;
  RESET request.jwt.claim.sub;
END $$;

SELECT * FROM _rls_diag_results;

SELECT count(*) FILTER (WHERE result='PASS') AS passed,
       count(*) FILTER (WHERE result='FAIL') AS failed,
       count(*) AS total
FROM _rls_diag_results;
