-- STEP 3: Full Schema Integrity Check
-- (Intentional RAISE EXCEPTION with full report)
DO $$
DECLARE
  v_rls_on       INT;
  v_rls_total    INT;
  v_total_idx    INT;
  v_geo_idx      INT;
  v_ext_postgis  TEXT;
  v_ext_uuid     TEXT;
  v_ext_pgcrypto TEXT;
  v_states       BIGINT; v_lgas BIGINT; v_wards BIGINT; v_pus BIGINT;
  v_fn_simtick   INT; v_fn_fastsim INT; v_fn_statebr  INT;
  v_trg_audit    INT; v_trg_updat INT;
  r              RECORD;
  msg            TEXT;
BEGIN
  SELECT COUNT(*) INTO v_rls_on  FROM pg_tables WHERE schemaname='public' AND rowsecurity=true AND tablename IN ('states','lgas','wards','polling_units','elections','parties','user_accounts','admin_users','volunteers','agent_assignments','result_submissions','party_results','evidence_records','incidents','observations','audit_log','simulation_config','simulation_history');
  v_rls_total := 18;

  SELECT COUNT(*) INTO v_total_idx FROM pg_indexes WHERE schemaname='public';
  SELECT COUNT(*) INTO v_geo_idx   FROM pg_indexes WHERE schemaname='public' AND indexname IN ('idx_polling_units_state','idx_polling_units_lga','idx_polling_units_ward','idx_polling_units_code','idx_wards_lga','idx_lgas_state');

  SELECT extversion INTO v_ext_postgis  FROM pg_extension WHERE extname='postgis';
  SELECT extversion INTO v_ext_uuid     FROM pg_extension WHERE extname='uuid-ossp';
  SELECT extversion INTO v_ext_pgcrypto FROM pg_extension WHERE extname='pgcrypto';

  SELECT COUNT(*) INTO v_states FROM states;
  SELECT COUNT(*) INTO v_lgas   FROM lgas;
  SELECT COUNT(*) INTO v_wards  FROM wards;
  SELECT COUNT(*) INTO v_pus    FROM polling_units;

  SELECT COUNT(*) INTO v_fn_simtick  FROM pg_proc WHERE proname IN ('simulation_tick');
  SELECT COUNT(*) INTO v_fn_fastsim  FROM pg_proc WHERE proname IN ('run_fast_simulation');
  SELECT COUNT(*) INTO v_fn_statebr  FROM pg_proc WHERE proname IN ('state_breakdown_rpc');
  SELECT COUNT(*) INTO v_trg_audit   FROM pg_trigger WHERE tgname='trg_prevent_audit_update';
  SELECT COUNT(*)::INT/18 INTO v_trg_updat FROM pg_trigger WHERE tgname LIKE 'trg_set_updated_at_%';

  msg := 'SCHEMA_REPORT: '
      || 'RLS=' || v_rls_on || '/' || v_rls_total || ' (expect 18/18). '
      || 'TotalIndexes=' || v_total_idx || ' (expect 60+). '
      || 'Geo6Indexes=' || v_geo_idx || '/6. '
      || 'Extensions: postgis=' || COALESCE(v_ext_postgis,'MISSING')
      || ', uuid-ossp=' || COALESCE(v_ext_uuid,'MISSING')
      || ', pgcrypto=' || COALESCE(v_ext_pgcrypto,'MISSING') || '. '
      || 'Rows: states=' || v_states || ' lgas=' || v_lgas || ' wards=' || v_wards || ' pus=' || v_pus || '. '
      || 'Funcs: sim_tick=' || v_fn_simtick || '/1, fast_sim=' || v_fn_fastsim || '/1, state_br_rpc=' || v_fn_statebr || '/1. '
      || 'Triggers: audit_appendonly=' || v_trg_audit || '/1, updated_at=' || v_trg_updat || '/18 (rounded integer div). ';

  IF v_rls_on <> 18 OR v_geo_idx <> 6 OR v_pus <> 176846 OR v_states <> 37 OR v_lgas <> 774
     OR v_fn_simtick <> 1 OR v_fn_fastsim <> 1 OR v_trg_audit <> 1 THEN
     msg := msg || ' ❌ FAILS integrity check (see above values).';
  ELSE
     msg := msg || ' ✅ ALL SCHEMA CHECKS PASS.';
  END IF;
  RAISE EXCEPTION '%', msg;
END $$;
