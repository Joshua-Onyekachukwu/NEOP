-- RLS 16-TEST - includes failure names in the exception for debugging
DO $$
DECLARE
  v_agentA UUID := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_agentB UUID := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_admin  UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_volA UUID; v_volB UUID;
  v BIGINT;
  t_pass INTEGER := 0;
  t_fail INTEGER := 0;
  t_details TEXT := '';
BEGIN
  SELECT id INTO v_volA FROM volunteers WHERE user_id = v_agentA LIMIT 1;
  SELECT id INTO v_volB FROM volunteers WHERE user_id = v_agentB LIMIT 1;
  t_details := t_details || 'DEBUG volA='||coalesce(v_volA::TEXT,'NULL')||' volB='||coalesce(v_volB::TEXT,'NULL')||'; ';

  -- Diagnostic: test current setting mechanism
  PERFORM set_config('request.jwt.claim.sub', v_agentA::TEXT, true);
  DECLARE v_setting TEXT; v_authuid UUID;
  BEGIN
    BEGIN
      v_setting := current_setting('request.jwt.claim.sub', true);
    EXCEPTION WHEN OTHERS THEN v_setting := 'ERROR_' || SQLERRM; END;
    BEGIN
      v_authuid := auth.uid();
    EXCEPTION WHEN OTHERS THEN v_authuid := NULL; END;
    t_details := t_details || 'DIAG: setting='||coalesce(v_setting,'NULL')||' auth.uid()='||coalesce(v_authuid::TEXT,'NULL')||'; ';
  END;
  RESET request.jwt.claim.sub;

  -- A: ANON
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v FROM states;
  IF v=37 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(A1 states='||v||'); '; END IF;
  SELECT count(*) INTO v FROM parties;
  IF v=9 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(A2 parties='||v||'); '; END IF;
  SELECT count(*) INTO v FROM polling_units;
  IF v>=176846 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(A3 pus='||v||'); '; END IF;
  SELECT count(*) INTO v FROM volunteers;
  IF v=0 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(A4 vols='||v||'); '; END IF;

  -- B: AGENT A
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_agentA::TEXT, true);
  SELECT count(*) INTO v FROM volunteers;
  IF v=1 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(B1 vols='||v||'); '; END IF;
  DECLARE v_exp BIGINT;
  BEGIN SELECT count(*) INTO v_exp FROM agent_assignments WHERE volunteer_id = v_volA;
  SELECT count(*) INTO v FROM agent_assignments;
  IF v=v_exp THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(B2 exp='||v_exp||' seen='||v||'); '; END IF; END;
  SELECT count(*) INTO v FROM user_accounts;
  IF v=1 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(B3 ua='||v||'); '; END IF;
  SELECT count(*) INTO v FROM incidents i JOIN volunteers v2 ON v2.id=i.volunteer_id WHERE v2.user_id = v_agentB;
  IF v=0 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(B4 cross='||v||'); '; END IF;

  -- C: AGENT B
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_agentB::TEXT, true);
  SELECT count(*) INTO v FROM volunteers;
  IF v=1 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(C1 vols='||v||'); '; END IF;
  SELECT count(*) INTO v FROM incidents i JOIN volunteers v2 ON v2.id=i.volunteer_id WHERE v2.user_id = v_agentA;
  IF v=0 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(C2 cross='||v||'); '; END IF;
  DECLARE v_exp2 BIGINT;
  BEGIN SELECT count(*) INTO v_exp2 FROM agent_assignments WHERE volunteer_id = v_volB;
  SELECT count(*) INTO v FROM agent_assignments;
  IF v=v_exp2 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(C3 exp='||v_exp2||' seen='||v||'); '; END IF; END;
  SELECT count(*) INTO v FROM result_submissions;
  IF v>=250 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(C4 subs='||v||'); '; END IF;

  -- D: ADMIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::TEXT, true);
  SELECT count(*) INTO v FROM volunteers;
  IF v=250 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(D1 vols='||v||'); '; END IF;
  SELECT count(*) INTO v FROM agent_assignments;
  IF v=500 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(D2 asgn='||v||'); '; END IF;
  SELECT count(*) INTO v FROM audit_log;
  IF v>=1 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(D3 audit='||v||'); '; END IF;
  SELECT count(*) INTO v FROM incidents;
  IF v=80 THEN t_pass:=t_pass+1; ELSE t_fail:=t_fail+1; t_details:=t_details||'FAIL(D4 inc='||v||'); '; END IF;

  RESET ROLE;
  RESET request.jwt.claim.sub;

  t_details := t_details || ' PASS=' || t_pass || ' FAIL=' || t_fail || ' TOTAL=16';

  IF t_fail > 0 THEN
    RAISE EXCEPTION 'RLS FAIL: %', t_details;
  ELSE
    RAISE NOTICE 'ALL RLS TESTS PASSED %', t_details;
  END IF;
END $$;

-- RLS count verify
DO $$ DECLARE
  v_rls INTEGER; v_expected INTEGER := 18;
BEGIN
  SELECT count(DISTINCT c.relname) INTO v_rls
    FROM pg_class c
    JOIN pg_tables t ON t.tablename = c.relname AND t.schemaname = 'public'
   WHERE c.relrowsecurity = true AND t.tablename NOT IN ('schema_migrations');
  IF v_rls < v_expected THEN
    RAISE EXCEPTION 'RLS tables count=% expected %', v_rls, v_expected;
  ELSE
    RAISE NOTICE 'RLS tables: % / %', v_rls, v_expected;
  END IF;
END $$;
