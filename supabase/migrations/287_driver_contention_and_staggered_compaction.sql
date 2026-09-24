-- ============================================================
-- NEOP 287 — DRIVER CONTENTION FIX + STAGGERED COMPACTION
-- ============================================================
--
-- EVIDENCE (Run 7, 297 steps, published 22:00 UTC):
--   • Waves avg 1.0 s, tick budget 50 s, p_max 24 — yet steady-state
--     throughput was 3–4 steps/min (101 min wall for 5.4 min of work).
--   • pg_stat_statements: neop_sim_tick_local() called with NO args 751×
--     and the HTTP tick path (dashboard poller, public-stats self-pump,
--     trigger-v2 pumper) holds steps RUNNING in JS for 20–100 s each.
--   • claim_simulation_step() is intentionally single-flight: it returns
--     NULL whenever ANY step is RUNNING. neop_sim_tick_local treated that
--     NULL as "queue drained" and EXITED THE WHOLE TICK — losing every
--     race against the HTTP executor. Result: 24-slot budget used ~4×.
--
-- FIX A: on a NULL claim, distinguish "drained" (no PENDING work → exit,
--        finalize) from "contended" (PENDING exists, executor mid-step →
--        wait 0.5 s and re-claim within this tick's budget).
--
-- EVIDENCE (compaction one-shots, Run 7 publish):
--   • All 4 bare VACUUM FULL one-shots fired in the SAME minute (22:02).
--     party_results (202 MB) and verification_timeline_events made it;
--     canonical_party_results and result_submissions were killed by the
--     pg_cron 120 s statement timeout (they contended for I/O with the
--     two vacuums running concurrently).
--
-- FIX B: stagger each vacuum 3 minutes apart (i-th fires at delay + (i-1)*3).
-- ============================================================

-- ── FIX B: staggered compaction ─────────────────────────────
CREATE OR REPLACE FUNCTION public.sim_schedule_compaction(p_run uuid, p_delay_minutes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_base int := GREATEST(1, p_delay_minutes);
  v_specs constant text[] := ARRAY[
    'VACUUM (FULL, ANALYZE) public.party_results',
    'VACUUM (FULL, ANALYZE) public.canonical_party_results',
    'VACUUM (FULL, ANALYZE) public.verification_timeline_events',
    'VACUUM (FULL, ANALYZE) public.result_submissions'
  ];
  v_names text[] := ARRAY[
    'vac-pr', 'vac-cpr', 'vac-vte', 'vac-rs'
  ];
  v_scheduled int := 0;
  i int;
  v_fire timestamptz;
BEGIN
  FOR i IN 1 .. array_length(v_specs, 1) LOOP
    v_fire := now() + make_interval(mins => v_base + (i - 1) * 3);
    PERFORM cron.schedule(
      v_names[i] || '-' || left(p_run::text, 8),
      to_char(v_fire AT TIME ZONE 'UTC', 'MI HH24 DD MM *'),
      v_specs[i]
    );
    v_scheduled := v_scheduled + 1;
  END LOOP;
  RETURN jsonb_build_object('run', p_run, 'jobs_scheduled', v_scheduled,
    'fire_from_utc', to_char((now() + make_interval(mins => v_base)) AT TIME ZONE 'UTC', 'HH24:MI'),
    'fire_to_utc',   to_char((now() + make_interval(mins => v_base + 9)) AT TIME ZONE 'UTC', 'HH24:MI'),
    'stagger_minutes', 3);
END;
$function$;

-- ── FIX A: wait-and-retry under claim contention ────────────
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
  -- Reap stale steps (RUNNING for > 10 min): mark failed so the queue moves.
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
        -- Contended: the HTTP tick path (dashboard poller, public-stats
        -- self-pump, trigger-v2 pumper) is mid-step. Wait briefly and
        -- re-claim within this tick's budget instead of exiting after
        -- the first claim win (which capped the driver at ~4 steps/min).
        v_contended := v_contended + 1;
        PERFORM pg_sleep(0.5);
        CONTINUE;
      END IF;
      -- Queue genuinely drained → fall through to the finalize check.
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
          PERFORM public.sync_simulation_progress(v_step.run_id);
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
