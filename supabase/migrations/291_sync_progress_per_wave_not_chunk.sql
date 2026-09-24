-- ============================================================
-- NEOP 291 — SYNC PROGRESS PER WAVE, NOT PER CHUNK
-- ============================================================
--
-- EVIDENCE (Run 8, 2026-09-24, run 4a2687d0):
--   • Steps 1–240 flew (many WAVE chunks completing in <0.01 s).
--   • Then throughput collapsed to ~1–3 steps/min: each one-minute tick
--     burned its full 50 s budget on a SINGLE step.
--   • pg_stat_activity mid-tick showed the tick parked in its per-step
--     bookkeeping, not in the wave math.
--
-- CAUSE: neop_sim_tick_local() called sync_simulation_progress(run) after
-- EVERY wave chunk — 288 calls per run (12 waves × 24 chunks). That function
-- is not cheap: it runs two UPDATE … FROM canonical_pu_results joins over
-- pu_simulation_status (up to 176,846 rows) plus two aggregate scans of the
-- same table. Measured cost grows with the dataset, so the early run is fast
-- and the late run is dominated entirely by bookkeeping. It is also
-- REDUNDANT: the counts it publishes are per-RUN roll-ups; nothing consumes
-- them at chunk granularity.
--
-- FIX: sync only on the final chunk of each wave (chunk_index =
-- chunk_count - 1) — 12 calls per run instead of 288, a 24× reduction, with
-- progress still refreshed once per user-visible wave. The finalize path
-- (queue drained) and the pre-publish path both still call it, so the
-- published counters remain exact.
--
-- Everything else in the tick is unchanged: the single-flight
-- claim_simulation_step() call, the migration-287 wait-and-retry on
-- contention, the advisory-lock guard, and the finalize/publish sequence.
-- ============================================================

CREATE OR REPLACE FUNCTION public.neop_sim_tick_local(p_max integer DEFAULT 4, p_budget_ms integer DEFAULT 30000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  v_step record;
  v_run uuid;
  v_params jsonb;
  v_election uuid;
  v_result jsonb;
  v_pub jsonb;
  v_err text;
  v_open bigint;
  v_admin uuid;
  v_eid uuid;
  v_processed int := 0;
  v_reaped int := 0;
  v_contended int := 0;
  v_start timestamptz := clock_timestamp();
BEGIN
  UPDATE public.sim_run_steps
     SET status = 'FAILED',
         result = jsonb_build_object('error', 'reaped: RUNNING exceeded 10 min'),
         finished_at = now()
   WHERE status = 'RUNNING'
     AND claimed_at < now() - interval '10 minutes'
     AND run_id IN (SELECT id FROM public.simulation_runs WHERE status = 'RUNNING');
  GET DIAGNOSTICS v_reaped = ROW_COUNT;

  LOOP
    EXIT WHEN v_processed >= p_max;
    EXIT WHEN (EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000) >= p_budget_ms;

    SELECT * INTO v_step FROM public.claim_simulation_step(NULL);
    IF v_step.id IS NULL OR v_step.kind IS NULL THEN
      IF EXISTS (
        SELECT 1
          FROM public.sim_run_steps s
          JOIN public.simulation_runs r ON r.id = s.run_id
         WHERE r.status = 'RUNNING'
           AND s.status = 'PENDING'
      ) THEN
        v_contended := v_contended + 1;
        PERFORM pg_sleep(0.5);
        CONTINUE;
      END IF;
      EXIT;
    END IF;

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
          -- Migration 291: roll up progress once per WAVE, not once per chunk.
          -- sync_simulation_progress() is a ~176k-row two-join UPDATE; calling
          -- it 288×/run (24 chunks × 12 waves) consumed the entire tick budget
          -- and collapsed the driver to ~1 step/min late in the run.
          IF COALESCE(v_step.chunk_index, 0) >= COALESCE(v_step.chunk_count, 24) - 1 THEN
            PERFORM public.sync_simulation_progress(v_step.run_id);
          END IF;
        END IF;

      ELSIF v_step.kind = 'CLEANUP' THEN
        v_result := public.sim_preflight_cleanup(v_step.run_id);

      ELSIF v_step.kind = 'COMPACTION' THEN
        v_result := public.sim_schedule_compaction(v_step.run_id, 2);

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
                                'contended', v_contended,
                                'failed_seq', v_step.seq, 'error', v_err);
    END;
  END LOOP;

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
                                'contended', v_contended,
                                'finalized', true, 'run', v_run, 'publish', v_pub);
    END IF;
  END IF;

  RETURN jsonb_build_object('processed', v_processed, 'reaped', v_reaped,
                            'contended', v_contended, 'finalized', false);
END;
$function$;
