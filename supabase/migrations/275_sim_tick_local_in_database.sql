-- 275_sim_tick_local_in_database.sql
--
-- PROBLEM
-- -------
-- The simulation queue was driven by `neop_sim_driver()` (pg_cron, every 30s),
-- which POSTs to /api/admin/simulate/tick via pg_net. That path has a hard
-- failure mode: the HTTP client aborts a wave that runs longer than the
-- timeout (~45-60s), PostgREST cancels the Postgres query, and the step is
-- left marked RUNNING with no executor. The reaper then requeues it and the
-- next claimant repeats the whole wave — an orphan/retry loop that, on a
-- busy instance, pins the queue to roughly zero net progress.
--
-- Compounding it: `claim_simulation_step()` returns NULL whenever any step
-- is RUNNING, and the stale-claim reaper lives *inside* that function. So an
-- orphaned step stopped the driver from ticking, which meant the reaper could
-- never run: a permanent stall until a human intervened.
--
-- FIX
-- ---
-- Execute the queue **inside the database**. `neop_sim_tick_local()` does the
-- whole tick — reap, retry, claim, execute (WAVE/LEDGER/INIT/CLEANUP),
-- complete, finalize — in one server-side call. There is no HTTP client to
-- time out, no Vercel cold start, and no dependency on a visitor hitting the
-- public site to advance a run. pg_cron job `neop-sim-driver` (formerly
-- `SELECT public.neop_sim_driver()`) is repointed at it.
--
-- The budget arguments keep each invocation inside the database's statement
-- timeout: `p_budget_ms` is checked between steps, so a long wave finishes
-- and the loop exits cleanly rather than being killed mid-flight.

CREATE OR REPLACE FUNCTION public.neop_sim_tick_local(
  p_max integer DEFAULT 6,
  p_budget_ms integer DEFAULT 75000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_start     timestamptz := clock_timestamp();
  v_step      public.sim_run_steps;
  v_processed int := 0;
  v_reaped    int := 0;
  v_run       uuid;
  v_params    jsonb;
  v_election  uuid;
  v_admin     uuid;
  v_eid       uuid;
  v_result    jsonb;
  v_err       text;
  v_open      int;
  v_pub       jsonb;
BEGIN
  -- Self-healing: requeue steps whose executor died mid-flight.
  v_reaped := public.reclaim_stale_steps(180);
  PERFORM public.retry_failed_steps(4);

  LOOP
    EXIT WHEN v_processed >= p_max;
    EXIT WHEN (EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000) >= p_budget_ms;

    SELECT * INTO v_step FROM public.claim_simulation_step(NULL);
    EXIT WHEN v_step.id IS NULL OR v_step.kind IS NULL;

    BEGIN
      SELECT r.params, r.election_id INTO v_params, v_election
        FROM public.simulation_runs r WHERE r.id = v_step.run_id;
      v_params := COALESCE(v_params, '{}'::jsonb);

      IF v_step.kind = 'WAVE' THEN
        SELECT id INTO v_admin FROM public.user_accounts WHERE email ILIKE '%admin%' LIMIT 1;
        v_result := public.neop_sim_wave(
          p_scenario         := COALESCE(v_params->>'scenario', 'landslide'),
          p_total_voters     := COALESCE((v_params->>'target_voters')::bigint, 1000000),
          p_waves            := COALESCE((v_params->>'waves')::int, 6),
          p_wave_index       := COALESCE(v_step.wave_index, 0),
          p_duration_seconds := 0,
          p_discrepancy_rate := COALESCE((v_params->>'discrepancy_rate')::numeric, 0.05),
          p_admin_user_id    := v_admin,
          p_election_id      := v_election,
          p_init_chunk       := NULL,
          p_init_chunks      := NULL,
          p_data_chunk       := COALESCE(v_step.chunk_index, 0),
          p_data_chunks      := COALESCE(v_step.chunk_count, 24),
          p_coverage_pct     := COALESCE(v_step.coverage_pct, (v_params->>'coverage_pct')::int, 50)
        );
        v_eid := NULLIF(v_result->>'sim_election_id', '')::uuid;
        IF v_eid IS NOT NULL THEN
          IF v_election IS NULL THEN
            UPDATE public.simulation_runs SET election_id = v_eid WHERE id = v_step.run_id;
          END IF;
          PERFORM public.sync_simulation_progress(v_step.run_id);
        END IF;

      ELSIF v_step.kind = 'CLEANUP' THEN
        v_result := public.sim_preflight_cleanup(v_step.run_id);

      ELSIF v_step.kind = 'LEDGER' THEN
        v_result := jsonb_build_object('inserted',
          public.materialize_ledger_hash_chunk(
            v_step.run_id, COALESCE(v_step.chunk_index, 0), COALESCE(v_step.chunk_count, 6)));
        IF COALESCE(v_step.chunk_index, 0) = COALESCE(v_step.chunk_count, 6) - 1 THEN
          UPDATE public.simulation_runs
             SET total_pus = (SELECT count(*) FROM public.pu_simulation_status WHERE run_id = v_step.run_id)
           WHERE id = v_step.run_id;
          v_result := v_result || public.assign_simulation_outcomes(
            v_step.run_id,
            p_dispute_rate      := COALESCE((v_params->>'dispute_rate')::numeric, 0.05),
            p_failed_rate       := COALESCE((v_params->>'failed_rate')::numeric, 0.015),
            p_disrupted_rate    := COALESCE((v_params->>'disrupted_rate')::numeric, 0.02),
            p_unavailable_rate  := COALESCE((v_params->>'unavailable_rate')::numeric, 0.01),
            p_max_published_pct := COALESCE((v_params->>'max_published_pct')::numeric, 0.95),
            p_coverage_pct      := COALESCE(v_step.coverage_pct, (v_params->>'coverage_pct')::int, 50));
        END IF;

      ELSE
        v_result := jsonb_build_object('noop', true);
      END IF;

      PERFORM public.complete_simulation_step(v_step.id, true, COALESCE(v_result, '{}'::jsonb));
      v_processed := v_processed + 1;

    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      PERFORM public.complete_simulation_step(v_step.id, false, jsonb_build_object('error', v_err));
      RETURN jsonb_build_object('processed', v_processed, 'reaped', v_reaped,
                                'failed_seq', v_step.seq, 'error', v_err);
    END;
  END LOOP;

  -- Queue drained? Finalize: repair the ledger, reclassify out-of-scope PUs as
  -- UNAVAILABLE, release the lock, and publish (publish refuses an empty set).
  SELECT r.id INTO v_run FROM public.simulation_runs r
   WHERE r.status = 'RUNNING' ORDER BY r.started_at DESC LIMIT 1;

  IF v_run IS NOT NULL THEN
    SELECT count(*) INTO v_open FROM public.sim_run_steps
     WHERE run_id = v_run AND status IN ('PENDING', 'RUNNING');

    IF v_open = 0 THEN
      PERFORM public.sync_simulation_progress(v_run);
      BEGIN
        PERFORM public.stop_simulation_run(v_run);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      UPDATE public.simulation_config
         SET status = 'COMPLETED', last_tick_at = now()
       WHERE id = '00000000-0000-0000-0000-000000000001';
      BEGIN
        v_pub := public.publish_simulation_run(v_run);
      EXCEPTION WHEN OTHERS THEN
        v_pub := jsonb_build_object('error', SQLERRM);
      END;
      RETURN jsonb_build_object('processed', v_processed, 'reaped', v_reaped,
                                'finalized', true, 'run', v_run, 'publish', v_pub);
    END IF;
  END IF;

  RETURN jsonb_build_object('processed', v_processed, 'reaped', v_reaped, 'finalized', false);
END;
$fn$;

-- Drive the queue from inside the database instead of over HTTP.
-- (Replaces `SELECT public.neop_sim_driver()`, which POSTs to the tick route.)
--
-- Cadence/budget must keep the duty cycle BELOW 100%: a 75 s budget on a
-- 30 s schedule ran the instance permanently inside a wave and starved the
-- public API into statement timeouts. 45 s / 40 s leaves headroom, and the
-- queue is durable and idempotent so a slower pump loses no work.
-- NOTE (278): the schedule below was later relaxed further; see 278.
SELECT cron.schedule('neop-sim-driver', '45 seconds', 'SELECT public.neop_sim_tick_local(2, 40000)');

-- Keep the hot tables' visibility maps fresh.
--
-- A stale VM turns every index-only scan into per-tuple heap fetches, which
-- is what made a `count(*)` over 176k polling units take ~40s on an otherwise
-- idle instance (measured: 7,811 buffers, all shared hits, 155,751 heap
-- fetches).
--
-- BUT the first version of this block used `threshold = 50` with
-- `scale_factor = 0.0`, which means "vacuum after 50 dead tuples" on tables
-- holding millions of rows. Autovacuum then ran essentially continuously and
-- starved the whole instance (see migration 278, which reverts it). Eager but
-- bounded is the correct shape: 5% dead tuples, never before 1000 rows.
ALTER TABLE public.polling_units          SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE public.pu_simulation_status   SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE public.party_results          SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE public.canonical_party_results SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
ALTER TABLE public.result_submissions     SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 1000);
