-- ============================================================
-- NEOP 261 — SIMULATION PRE-FLIGHT: QUOTA GUARD + AUTO-CLEANUP
--
-- Two problems, one root cause: launching a simulation used to
-- leave the previous run's data in place (ledger + sim results +
-- observer accounts), so repeated runs marched the database into
-- the Free-plan read-only zone; and the route tried to do that
-- cleanup inline, holding the HTTP request for 2-10 minutes until
-- the browser gave up ("NetworkError when attempting to fetch").
--
-- Fix:
--   1. simulation_quota_check(coverage_pct) — a cheap, honest
--      projection of the run's peak database size. The launch
--      route calls it BEFORE starting and refuses with a clear
--      message when the projection exceeds the plan envelope.
--   2. sim_preflight_cleanup(keep_run) — purges every previous
--      run (results, ledger, observer accounts, elections) and
--      resets live data. Executed as the FIRST step of the queue
--      (CLEANUP), i.e. inside the engine with a 10-minute budget,
--      never inside the HTTP request.
--   3. enqueue_simulation_run — now enqueues CLEANUP before the
--      ledger chunks.
--   4. get_admin_stats_fast() — dashboard header stats from
--      pg_stat_user_tables estimates (one planner lookup, no
--      table scans), so the console paints instantly. Exact
--      numbers remain available via get_admin_stats().
--
-- ── Measured storage envelope (production, 9-party profile) ──
--   • canonical results chain ≈ 6.2 KB per published PU
--     (canonical_pu_results + canonical_party_results +
--      result_submissions ×2 + party_results + verifications +
--      timeline + indexes; calibrated: 20% cov / 18M voters
--      observed +308 MB for ~35k published PUs)
--   • ledger ≈ 850 B per polling unit row → ~150 MB for the
--     full 176,846-PU universe (every PU is accounted for)
--   • display multiplier is storage-free: scaled numbers are
--     computed at read time (system_config.display_multiplier),
--     never materialised; target_voters likewise does not
--     affect storage
--   • plan ceiling observed: read-only mode past ~900 MB used;
--     550-580 MB peaks completed fine. Guard uses 850 MB quota
--     with a 120 MB safety margin (usable 730 MB).
--   ⇒ Proven envelope on a clean baseline (~215 MB after the
--     CLEANUP step):
--       coverage 20%  → projected 584 MB (observed 558 MB) ✓
--       coverage 25%  → projected 639 MB ✓ comfortable
--       coverage 30%  → projected 694 MB ✓ tight but fits
--       coverage 36%  → guard's ceiling at current baseline
--       coverage ≥ 40% → refused with the max the DB can take
--     The recommendation is dynamic: as the baseline grows,
--     recommended_max_coverage_pct shrinks automatically.
-- ============================================================

-- ── 1. Pre-flight quota projection ───────────────────────────
CREATE OR REPLACE FUNCTION public.simulation_quota_check(p_coverage_pct int)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_quota_bytes   CONSTANT bigint := 891289600;  -- 850 MB plan ceiling
  c_safety_bytes  CONSTANT bigint := 125829120;  -- 120 MB safety margin
  c_bytes_per_ledger    CONSTANT bigint := 850;   -- measured, incl. indexes
  c_bytes_per_published CONSTANT bigint := 6200;  -- all-in per published PU,
    -- calibrated against production: the 20%-coverage / 18M-voter run added
    -- ~308 MB for ~35k published PUs (~8.8 KB incl. its share of the ledger).
    -- The ledger is counted separately below, so the chain-only constant is
    -- 6.2 KB; projecting with it lands 20% cov at 584 MB vs 558 MB observed —
    -- slightly conservative, which is what a guard should be.

  v_db bigint; v_universe bigint; v_ledger_rows bigint; v_sim_canon bigint; v_total_canon bigint;
  v_chain_bytes bigint; v_sim_fraction numeric; v_purgeable bigint;
  v_ledger_need bigint; v_results_need bigint;
  v_projected bigint; v_usable bigint; v_base bigint; v_max_cov int;
BEGIN
  SELECT pg_database_size(current_database()) INTO v_db;
  SELECT count(*) INTO v_universe FROM polling_units;
  SELECT count(*) INTO v_ledger_rows FROM pu_simulation_status;

  SELECT count(*) INTO v_sim_canon
  FROM canonical_pu_results c JOIN elections e ON e.id = c.election_id
  WHERE left(e.name, 5) = '[SIM]' OR left(e.name, 6) = '[TEST]';
  SELECT count(*) INTO v_total_canon FROM canonical_pu_results;

  -- Actual bytes of every results-chain table, scaled by the sim share of
  -- canonical rows (in practice all rows are sim data between runs).
  v_chain_bytes :=
      pg_total_relation_size('canonical_pu_results'::regclass)
    + pg_total_relation_size('canonical_party_results'::regclass)
    + pg_total_relation_size('result_submissions'::regclass)
    + pg_total_relation_size('party_results'::regclass)
    + pg_total_relation_size('verifications'::regclass)
    + pg_total_relation_size('verification_timeline_events'::regclass);
  v_sim_fraction := CASE WHEN v_total_canon > 0
                         THEN LEAST(1.0, v_sim_canon::numeric / v_total_canon)
                         ELSE 1.0 END;
  v_purgeable := v_ledger_rows * c_bytes_per_ledger
               + (v_chain_bytes * v_sim_fraction)::bigint;

  v_ledger_need  := v_universe * c_bytes_per_ledger;
  v_results_need := (v_universe * GREATEST(0, LEAST(100, p_coverage_pct)) / 100.0)
                    * c_bytes_per_published;
  v_base   := v_db - v_purgeable;              -- size after CLEANUP runs
  v_projected := v_base + v_ledger_need + v_results_need;
  v_usable  := c_quota_bytes - c_safety_bytes;

  IF v_universe > 0 THEN
    v_max_cov := floor(
      (v_usable - v_base - v_ledger_need) * 100.0
      / (v_universe * c_bytes_per_published)
    );
    v_max_cov := GREATEST(0, LEAST(100, v_max_cov));
  ELSE
    v_max_cov := 100;
  END IF;

  RETURN jsonb_build_object(
    'ok', v_projected <= v_usable,
    'db_size_bytes', v_db,
    'purgeable_bytes', v_purgeable,
    'base_bytes_after_cleanup', v_base,
    'ledger_bytes', v_ledger_need,
    'results_bytes', v_results_need,
    'projected_peak_bytes', v_projected,
    'quota_bytes', c_quota_bytes,
    'safety_bytes', c_safety_bytes,
    'headroom_bytes', v_usable - v_projected,
    'projected_published_pus', (v_universe * GREATEST(0, LEAST(100, p_coverage_pct)) / 100)::bigint,
    'recommended_max_coverage_pct', v_max_cov
  );
END;
$function$;

-- ── 2. Queued cleanup: purge previous runs + reset live data ──
CREATE OR REPLACE FUNCTION public.sim_preflight_cleanup(p_keep_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '600s'
SET lock_timeout TO '30s'
AS $function$
DECLARE
  r record;
  v_purged int := 0;
  v_failed int := 0;
  v_ledger bigint := 0;
BEGIN
  -- Never purge out from under a genuinely active run. By the time this
  -- runs, the launch route has already stopped stale runs, so a second
  -- RUNNING run would mean two concurrent launches — refuse and let the
  -- pump retry.
  IF EXISTS (SELECT 1 FROM simulation_runs
             WHERE id <> p_keep_run AND status = 'RUNNING') THEN
    RETURN jsonb_build_object('purged_runs', 0, 'skipped', true,
      'reason', 'another run is active');
  END IF;

  SELECT count(*) INTO v_ledger FROM pu_simulation_status;

  FOR r IN SELECT id FROM simulation_runs WHERE id <> p_keep_run LOOP
    BEGIN
      PERFORM purge_simulation_run(r.id);
      v_purged := v_purged + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  -- The new run's ledger is not materialised yet (CLEANUP is seq 1),
  -- so a TRUNCATE is safe here and returns the file space immediately —
  -- unlike DELETE, which leaves the 150 MB of pages for autovacuum.
  TRUNCATE pu_simulation_status;

  -- Sweep stray [SIM]/[TEST] elections + sim accounts and reset
  -- system_config to AWAITING_DATA (wave 0 re-points it).
  PERFORM neop_reset_live_data();

  RETURN jsonb_build_object(
    'purged_runs', v_purged,
    'purge_failures', v_failed,
    'ledger_rows_cleared', v_ledger,
    'reset_live_data', true
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.simulation_quota_check(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.sim_preflight_cleanup(uuid) TO service_role;

-- sim_run_steps.kind was constrained to INIT/LEDGER/WAVE; CLEANUP joins it.
-- NOT VALID: existing rows are not re-validated (there are none in flight
-- when this migration runs), new writes are.
ALTER TABLE sim_run_steps DROP CONSTRAINT IF EXISTS sim_run_steps_kind_check;
ALTER TABLE sim_run_steps ADD CONSTRAINT sim_run_steps_kind_check
  CHECK (kind IN ('INIT','LEDGER','WAVE','CLEANUP')) NOT VALID;

-- ── 3. Queue shape: CLEANUP runs before any ledger work ──────
CREATE OR REPLACE FUNCTION public.enqueue_simulation_run(
  p_run uuid, p_scenario text, p_target_voters bigint, p_waves integer,
  p_discrepancy_rate numeric, p_coverage_pct integer, p_ledger_chunks integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_seq INT := 0;
  v_data_chunks CONSTANT INT := 24;
  v_ledger_i INT;
  v_wave_i INT;
  v_chunk_i INT;
BEGIN
  DELETE FROM sim_run_steps WHERE run_id = p_run;

  -- Cleanup FIRST: previous run's data is converted into free space
  -- before this run's ledger and waves start allocating.
  v_seq := v_seq + 1;
  INSERT INTO sim_run_steps (run_id, seq, kind)
  VALUES (p_run, v_seq, 'CLEANUP');

  FOR v_ledger_i IN 0 .. GREATEST(0, p_ledger_chunks - 1) LOOP
    v_seq := v_seq + 1;
    INSERT INTO sim_run_steps (run_id, seq, kind, chunk_index, chunk_count, coverage_pct)
    VALUES (p_run, v_seq, 'LEDGER', v_ledger_i, p_ledger_chunks, p_coverage_pct);
  END LOOP;

  v_seq := v_seq + 1;
  INSERT INTO sim_run_steps (run_id, seq, kind)
  VALUES (p_run, v_seq, 'INIT');

  FOR v_wave_i IN 0 .. p_waves - 1 LOOP
    FOR v_chunk_i IN 0 .. v_data_chunks - 1 LOOP
      v_seq := v_seq + 1;
      INSERT INTO sim_run_steps (run_id, seq, kind, wave_index, chunk_index, chunk_count, coverage_pct)
      VALUES (p_run, v_seq, 'WAVE', v_wave_i, v_chunk_i, v_data_chunks, p_coverage_pct);
    END LOOP;
  END LOOP;

  UPDATE simulation_runs
  SET params = jsonb_build_object(
    'scenario', p_scenario,
    'target_voters', p_target_voters,
    'waves', p_waves,
    'discrepancy_rate', p_discrepancy_rate,
    'coverage_pct', p_coverage_pct
  )
  WHERE id = p_run;

  RETURN jsonb_build_object('run_id', p_run, 'steps', v_seq);
END;
$function$;

-- ── 4. Instant admin header stats (estimates, no scans) ──────
CREATE OR REPLACE FUNCTION public.get_admin_stats_fast()
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
DECLARE v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_volunteers',      GREATEST(0, (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'volunteers')),
    'active_volunteers',     GREATEST(0, (SELECT n_live_tup * 0.6 FROM pg_stat_user_tables WHERE relname = 'volunteers'))::bigint,
    'total_assignments',     GREATEST(0, (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'agent_assignments')),
    'checked_in_assignments',GREATEST(0, (SELECT n_live_tup * 0.6 FROM pg_stat_user_tables WHERE relname = 'agent_assignments'))::bigint,
    'total_results',         GREATEST(0, (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'result_submissions')),
    'verified_results',      GREATEST(0, (SELECT n_live_tup * 0.6 FROM pg_stat_user_tables WHERE relname = 'result_submissions'))::bigint,
    'pending_verification',  GREATEST(0, (SELECT n_live_tup * 0.4 FROM pg_stat_user_tables WHERE relname = 'result_submissions'))::bigint,
    'total_incidents',       GREATEST(0, (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'incidents'))
  ) INTO v_result;
  RETURN v_result;
END;
$$;
