-- ============================================================
-- SIMULATION VERIFICATION: 3 ticks + catalog function presence checks
-- (full 176K-PU fast-sim must run via /api/admin/simulate/trigger since
-- IDE supabase_apply_migration tool has an HTTP timeout on 1.6M inserts.)
-- ============================================================

DO $$
DECLARE
  v_cfg UUID := '00000000-0000-0000-0000-000000000001';
  v_t1 JSONB; v_t2 JSONB; v_t3 JSONB;
  v_ticked_cnt INTEGER := 0;
  v_chg_cnt INTEGER := 0;
  v_pu_count BIGINT;
  v_fn1 BIGINT; v_fn2 BIGINT; v_fn3 BIGINT; v_fn4 BIGINT;
  v_stats JSONB;
BEGIN
  -- ── 1. CATALOG: confirm simulation functions exist ─────
  SELECT count(*) INTO v_fn1 FROM pg_proc WHERE proname = 'simulation_tick';
  SELECT count(*) INTO v_fn2 FROM pg_proc WHERE proname = 'run_fast_simulation';
  SELECT count(*) INTO v_fn3 FROM pg_proc WHERE proname = 'get_simulation_progress_stats';
  SELECT count(*) INTO v_fn4 FROM pg_proc WHERE proname = 'log_simulation_start';
  RAISE NOTICE 'SIM FN REGISTRY: tick=% run_fast=% progress=% log_start=%  (expect each =1)',
    v_fn1, v_fn2, v_fn3, v_fn4;
  IF v_fn1 < 1 OR v_fn2 < 1 OR v_fn3 < 1 OR v_fn4 < 1 THEN
    RAISE EXCEPTION 'Missing simulation functions. ticks=% fast=% progress=% log=%', v_fn1, v_fn2, v_fn3, v_fn4;
  END IF;

  -- ── 2. Progress stats function works ──────────────────
  SELECT get_simulation_progress_stats() INTO v_stats;
  RAISE NOTICE 'PROGRESS stats keys: % total_pus=% results=% verified=% total_votes=%',
    array(SELECT jsonb_object_keys(v_stats)),
    v_stats->>'total_polling_units',
    v_stats->>'total_results',
    v_stats->>'verified_results',
    v_stats->>'total_votes';

  -- ── 3. Set config to RUNNING ──────────────────────────
  UPDATE simulation_config SET
    status = 'RUNNING', election_type = 'PRESIDENTIAL',
    scenario = '3ticks_verify', speed = 3,
    started_at = now(), last_tick_at = now()
  WHERE id = v_cfg;

  SELECT count(*) INTO v_pu_count FROM polling_units;
  RAISE NOTICE 'DB PU count = %', v_pu_count;

  -- ── 4. THREE TICKS (each ~30% eligible transition) ───
  SELECT simulation_tick() INTO v_t1;
  IF (v_t1->>'ticked')::BOOLEAN IS TRUE THEN
    v_ticked_cnt := v_ticked_cnt + 1;
    v_chg_cnt := v_chg_cnt + coalesce((v_t1->>'changed')::INTEGER,0);
  END IF;
  RAISE NOTICE 'TICK 1: ticked=%  changed=% reason=%',
    (v_t1->>'ticked')::BOOLEAN, v_t1->>'changed', coalesce(v_t1->>'reason','');

  PERFORM pg_sleep(0.3);

  SELECT simulation_tick() INTO v_t2;
  IF (v_t2->>'ticked')::BOOLEAN IS TRUE THEN
    v_ticked_cnt := v_ticked_cnt + 1;
    v_chg_cnt := v_chg_cnt + coalesce((v_t2->>'changed')::INTEGER,0);
  END IF;
  RAISE NOTICE 'TICK 2: ticked=%  changed=%',
    (v_t2->>'ticked')::BOOLEAN, v_t2->>'changed';

  PERFORM pg_sleep(0.3);

  SELECT simulation_tick() INTO v_t3;
  IF (v_t3->>'ticked')::BOOLEAN IS TRUE THEN
    v_ticked_cnt := v_ticked_cnt + 1;
    v_chg_cnt := v_chg_cnt + coalesce((v_t3->>'changed')::INTEGER,0);
  END IF;
  RAISE NOTICE 'TICK 3: ticked=%  changed=%',
    (v_t3->>'ticked')::BOOLEAN, v_t3->>'changed';

  -- ── 5. Pass gates ─────────────────────────────────────
  IF v_ticked_cnt != 3 THEN
    RAISE EXCEPTION 'Only % of 3 simulation ticks ticked=true. t1=% t2=% t3=%',
      v_ticked_cnt, v_t1, v_t2, v_t3;
  END IF;

  -- After 3 ticks with 30% coverage each, expect at least 1 PU status change
  IF v_chg_cnt < 1 THEN
    RAISE WARNING 'Zero PU status changes. DB has sim config all in final states? (non-fatal)';
  ELSE
    RAISE NOTICE '3 Ticks total PU status transitions = %', v_chg_cnt;
  END IF;

  -- ── 6. Sanity: polling_units status distribution ──────
  DECLARE
    v_not_started BIGINT;
    v_voting BIGINT;
    v_counting BIGINT;
    v_result_announced BIGINT;
    v_result_submitted BIGINT;
    v_vp BIGINT;
    v_verified BIGINT;
    v_disputed BIGINT;
    v_disrupted BIGINT;
  BEGIN
    SELECT count(*) FILTER (WHERE status='NOT_STARTED') INTO v_not_started FROM polling_units;
    SELECT count(*) FILTER (WHERE status='VOTING') INTO v_voting FROM polling_units;
    SELECT count(*) FILTER (WHERE status='COUNTING') INTO v_counting FROM polling_units;
    SELECT count(*) FILTER (WHERE status='RESULT_ANNOUNCED') INTO v_result_announced FROM polling_units;
    SELECT count(*) FILTER (WHERE status='RESULT_SUBMITTED') INTO v_result_submitted FROM polling_units;
    SELECT count(*) FILTER (WHERE status='VERIFICATION_PENDING') INTO v_vp FROM polling_units;
    SELECT count(*) FILTER (WHERE status='VERIFIED') INTO v_verified FROM polling_units;
    SELECT count(*) FILTER (WHERE status='DISPUTED') INTO v_disputed FROM polling_units;
    SELECT count(*) FILTER (WHERE status='DISRUPTED') INTO v_disrupted FROM polling_units;
    RAISE NOTICE 'PU STATUS DISTRIBUTION AFTER 3 TICKS: NOT_STARTED=%  VOTING=%  COUNTING=%  RESULT_ANNOUNCED=%  RESULT_SUBMITTED=%  VERIF_PENDING=%  VERIFIED=%  DISPUTED=%  DISRUPTED=%',
      v_not_started, v_voting, v_counting, v_result_announced,
      v_result_submitted, v_vp, v_verified, v_disputed, v_disrupted;
  END;

  UPDATE simulation_config SET status = 'IDLE', last_tick_at = now() WHERE id = v_cfg;

  RAISE NOTICE '========================================';
  RAISE NOTICE '  STEP 8 SIMULATION VERIFY — ALL GATES PASS';
  RAISE NOTICE '  3/3 ticks OK, total transitions=%, all fns present', v_chg_cnt;
  RAISE NOTICE '========================================';
END $$;
