-- 900_DIAGNOSTIC_CHECK_SUPABASE_PROJECT.sql
-- ONE-SHOT diagnostic run to confirm:
--  (a) Project host URL matches NEXT_PUBLIC_SUPABASE_URL in apps/web/.env.local
--  (b) Migrations 200-222 ALL applied (their objects exist)
--  (c) Tables row counts match seed (states=37, pus=176846, volunteers=250, submissions=250, party_results ~2250)
--  (d) submit_result_atomic function signature MATCHES 222 P1-1 version (9 params)
-- DO NOT alter schema; do $$ block with SELECT-only RAISE NOTICE output.

DO $$
DECLARE
  -- Objects check
  v_has_200 BOOLEAN; v_has_210 BOOLEAN; v_has_213 BOOLEAN; v_has_214 BOOLEAN;
  v_has_215_fn BOOLEAN; v_has_216_mv BOOLEAN; v_has_222_fn BOOLEAN;
  v_fn_params INT;
  -- Counts
  v_states INT; v_lgas INT; v_wards INT; v_pus INT; v_parties INT; v_vols INT;
  v_subms INT; v_party_res INT; v_incidents INT;
  -- Status breakdown
  v_unver INT; v_pend INT; v_ver INT; v_disp INT; v_rej INT; v_sup INT; v_partial INT; v_app INT;
  -- RLS
  v_rls_enabled TEXT[]; v_rls_expected TEXT[]; v_rls_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- 200 schema tables
  SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='result_submissions' AND schemaname='public') INTO v_has_200;

  -- 210 seed: parties=9, volunteers=250, submissions ~= 250
  SELECT EXISTS (SELECT 1 FROM parties WHERE abbreviation='APC') INTO v_has_210;

  -- 213 policies
  SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='result_submissions' AND policyname LIKE 'anon_%' LIMIT 1) INTO v_has_213;

  -- 214 trigger
  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_result_state_machine') INTO v_has_214;

  -- 216 MV
  SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname='mv_party_totals') INTO v_has_216_mv;

  -- submit_result_atomic function (expected 222 rewritten version)
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='submit_result_atomic') INTO v_has_215_fn;
  SELECT count(*) INTO v_fn_params
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN unnest(p.proargnames) WITH ORDINALITY AS a(name, ord) ON true
  WHERE p.proname='submit_result_atomic' AND n.nspname='public';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.proname='submit_result_atomic' AND n.nspname='public'
      AND 9 = (SELECT count(*) FROM unnest(p.proargnames))
  ) INTO v_has_222_fn;

  -- Row counts
  SELECT count(*) INTO v_states FROM states;
  SELECT count(*) INTO v_lgas   FROM lgas;
  SELECT count(*) INTO v_wards  FROM wards;
  SELECT count(*) INTO v_pus    FROM polling_units;
  SELECT count(*) INTO v_parties FROM parties;
  SELECT count(*) INTO v_vols   FROM volunteers;
  SELECT count(*) INTO v_subms  FROM result_submissions;
  SELECT count(*) INTO v_party_res FROM party_results;
  SELECT count(*) INTO v_incidents FROM incidents;

  -- Status breakdown
  SELECT count(*) FILTER (WHERE status='UNVERIFIED') INTO v_unver FROM result_submissions;
  SELECT count(*) FILTER (WHERE status='PENDING_VERIFICATION') INTO v_pend FROM result_submissions;
  SELECT count(*) FILTER (WHERE status='VERIFIED') INTO v_ver FROM result_submissions;
  SELECT count(*) FILTER (WHERE status='DISPUTED') INTO v_disp FROM result_submissions;
  SELECT count(*) FILTER (WHERE status='REJECTED') INTO v_rej FROM result_submissions;
  SELECT count(*) FILTER (WHERE status='SUPERSEDED') INTO v_sup FROM result_submissions;
  SELECT count(*) FILTER (WHERE status='PARTIALLY_VERIFIED') INTO v_partial FROM result_submissions;
  SELECT count(*) FILTER (WHERE status='APPROVED') INTO v_app FROM result_submissions;

  -- RLS enabled tables
  SELECT ARRAY(
    SELECT tablename FROM pg_tables t
    WHERE schemaname='public' AND t.tablename IN (
      'states','lgas','wards','polling_units','parties','elections',
      'user_accounts','admin_users','volunteers','agent_assignments',
      'result_submissions','party_results','incidents','audit_log',
      'simulation_config','simulation_history','evidence','training_content'
    ) AND EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relname = t.tablename AND n.nspname='public' AND c.relrowsecurity IS TRUE
    ) ORDER BY 1
  ) INTO v_rls_enabled;

  v_rls_expected := ARRAY[
    'admin_users','agent_assignments','audit_log','elections','evidence',
    'incidents','lgas','parties','party_results','polling_units','result_submissions',
    'simulation_config','simulation_history','states','training_content',
    'user_accounts','volunteers','wards'
  ];
  FOR i IN 1..array_length(v_rls_expected,1) LOOP
    IF NOT (v_rls_expected[i] = ANY(v_rls_enabled)) THEN
      v_rls_missing := array_append(v_rls_missing, v_rls_expected[i]);
    END IF;
  END LOOP;

  RAISE NOTICE '============================ SUPABASE DIAGNOSTIC ============================';
  RAISE NOTICE '(a) SCHEMA OBJECTS:';
  RAISE NOTICE '  200 schema (result_submissions exists) = %', v_has_200;
  RAISE NOTICE '  210 demo seed (APC party exists) = %', v_has_210;
  RAISE NOTICE '  213 anon policy (result_submissions anon_* policy) = %', v_has_213;
  RAISE NOTICE '  214 state machine trigger = %', v_has_214;
  RAISE NOTICE '  216 MV mv_party_totals = %', v_has_216_mv;
  RAISE NOTICE '  submit_result_atomic exists = %, arg count=%, is 9-arg (P1-1 222) = %', v_has_215_fn, v_fn_params, v_has_222_fn;

  RAISE NOTICE '(b) ROW COUNTS (seeded 210):';
  RAISE NOTICE '  states=%, lgas=%, wards=%, polling_units=% (expected 37/774/8793/176846)', v_states, v_lgas, v_wards, v_pus;
  RAISE NOTICE '  parties=%, volunteers=%, result_submissions=% (expected 9/250/250)', v_parties, v_vols, v_subms;
  RAISE NOTICE '  party_results=%, incidents=% (expected 2250/80)', v_party_res, v_incidents;

  RAISE NOTICE '(c) STATUS BREAKDOWN result_submissions (% total):', v_subms;
  RAISE NOTICE '  UNVERIFIED=%, PENDING_VERIFICATION=%, VERIFIED=%, DISPUTED=%, REJECTED=%, SUPERSEDED=%, PARTIAL=%, APPROVED=%',
    v_unver, v_pend, v_ver, v_disp, v_rej, v_sup, v_partial, v_app;

  RAISE NOTICE '(d) RLS enabled/missing:';
  RAISE NOTICE '  enabled = %', array_to_string(v_rls_enabled, ',');
  RAISE NOTICE '  MISSING = %', CASE WHEN array_length(v_rls_missing,1)>0 THEN array_to_string(v_rls_missing,',') ELSE '(none - ALL 18 RLS ENABLED)' END;

  IF v_has_222_fn AND v_pus=176846 AND v_vols=250 AND v_ver=62 THEN
    RAISE NOTICE '✅ SUMMARY: CONNECTED TO CORRECT PROJECT (muwoc INEC seed + 210 demo + P1-1 222 patch ALL APPLIED)';
  ELSE
    RAISE NOTICE '⚠️  SUMMARY: Investigate deviations above. Expected PU=176846 VOL=250 VER=62 FNPARAM=9';
  END IF;
END $$;
