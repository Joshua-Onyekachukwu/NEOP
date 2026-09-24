-- ============================================================
-- NEOP 285 — RELEASE-THEN-RUN LIFECYCLE + POST-PUBLISH AUTO-COMPACTION
-- ============================================================
--
-- Two structural gaps, both found in the Phase 3 rehearsal:
--
-- 1) THE RETENTION WALL. The quota gate correctly charges the run for the
--    dataset currently published on the live site (migration 262), which
--    caps coverage far below the plan envelope — a 509 MB published dataset
--    leaves room for ~6% coverage even though the plan could take ~50% on a
--    clean baseline. The retention is correct DURING a run (the demo must
--    not go blank), but between runs the operator's sanctioned reset
--    (data_mode → AWAITING_DATA) is exactly the moment the old dataset may
--    be released. Nothing did that: the 11:45 reset job flipped data_mode
--    and left Run 6's 500 MB fully in place, so the gate still refused.
--
--    Fix: simulation_release_published() — the explicit, guarded release
--    step for the between-runs window. It refuses outright when the system
--    is in LIVE_ELECTION mode, and belt-and-braces-verifies that the
--    election it is about to release is a [SIM]/[TEST] election (a real
--    dataset can never be released, published or not), releases the
--    active/simulation election pointers, purges every prior simulation
--    run, and clears the ledger. The launch route calls it BEFORE the gate
--    when the operator has opted into release-then-run, so gating is
--    computed against the real free baseline instead of a dataset that is
--    about to be replaced.
--
-- 2) MANUAL COMPACTION AFTER PUBLISH. Every run's wave churn leaves table
--    bloat that only VACUUM FULL returns (873 → 779 MB was done by hand
--    after Run 6). Fix: publication now schedules four bare-statement
--    pg_cron one-shots on the churn-heaviest tables (party_results,
--    canonical_party_results, verification_timeline_events,
--    result_submissions) as a queued COMPACTION step. Bare single
--    statements are mandatory: pg_cron wraps multi-statement commands in a
--    transaction block and VACUUM cannot run inside one (measured Sep 23:
--    SET + VACUUM fails, bare VACUUM succeeds).

-- ── 1. Release the published dataset (between-runs window only) ──
CREATE OR REPLACE FUNCTION public.simulation_release_published()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET lock_timeout TO '30s'
AS $function$
DECLARE
  v_mode text;
  v_released_election uuid;
  v_runs int := 0;
  v_failures int := 0;
  v_non_sim bigint := 0;
  r record;
BEGIN
  -- Best-effort statement-timeout extension (pg_cron's is enforced outside
  -- session reach, so the REAL protection below is the TRUNCATE design).
  PERFORM set_config('statement_timeout', '0', true);

  SELECT data_mode INTO v_mode FROM system_config
  WHERE id = '00000000-0000-0000-0000-000000000001';

  -- The interlock: releasing a dataset the site is still rendering is the
  -- purge-of-the-live-site defect migrations 267/269 exist to prevent —
  -- and releasing a REAL dataset would be worse. Release is legal only
  -- when the mode is not LIVE_ELECTION and the election being released is
  -- provably a simulated one.
  IF v_mode = 'LIVE_ELECTION' THEN
    RETURN jsonb_build_object('released', false,
      'reason', 'refusing: system is in LIVE_ELECTION mode');
  END IF;

  SELECT active_election_id INTO v_released_election
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_released_election IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM elections
      WHERE id = v_released_election
        AND (left(name, 5) = '[SIM]' OR left(name, 6) = '[TEST]')
    ) THEN
      RETURN jsonb_build_object('released', false,
        'reason', 'refusing: the active election is not a simulated dataset');
    END IF;
  END IF;

  -- Hard guard: never truncate when non-simulated submissions exist.
  SELECT count(*) INTO v_non_sim
  FROM result_submissions s
  WHERE s.election_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM elections e
       WHERE e.id = s.election_id
         AND (left(e.name, 5) = '[SIM]' OR left(e.name, 6) = '[TEST]'));
  IF v_non_sim > 0 THEN
    RETURN jsonb_build_object('released', false,
      'reason', 'refusing: non-simulated submissions present',
      'non_sim_submissions', v_non_sim);
  END IF;

  -- Release the pointers first (purge refuses the run backing the active
  -- election; without this the dataset would survive its own release).
  UPDATE system_config
  SET active_election_id = NULL,
      simulation_election_id = NULL,
      last_updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  -- Instant mass release. TRUNCATE returns all file space immediately and
  -- cannot be timed out by pg_cron's 120 s ceiling, unlike row-by-row
  -- DELETEs over a million rows (measured: DELETE path hit the 120 s
  -- ceiling three times and rolled back; TRUNCATE path is sub-second). The
  -- FK graph among these tables is closed (verified: nothing outside the
  -- set references them), so CASCADE stays within the simulation dataset.
  TRUNCATE pu_simulation_status;
  TRUNCATE result_submissions, canonical_pu_results, canonical_party_results,
           party_results, verifications, verification_timeline_events
    CASCADE;

  -- Hygiene pass on now-empty datasets: [SIM] elections + guarded account
  -- sweeps. With the chain tables empty, every DELETE inside the purge hits
  -- an empty set and the whole loop completes in seconds.
  FOR r IN SELECT id FROM simulation_runs WHERE status <> 'RUNNING' LOOP
    BEGIN
      PERFORM purge_simulation_run(r.id);
      v_runs := v_runs + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failures := v_failures + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'released', v_failures = 0,
    'method', 'truncate',
    'released_election', v_released_election,
    'runs_purged', v_runs,
    'purge_failures', v_failures,
    'ledger_cleared', true,
    'data_mode', v_mode
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.simulation_release_published() TO service_role;

-- ── 2. COMPACTION joins the step kinds ──
ALTER TABLE sim_run_steps DROP CONSTRAINT IF EXISTS sim_run_steps_kind_check;
ALTER TABLE sim_run_steps ADD CONSTRAINT sim_run_steps_kind_check
  CHECK (kind IN ('INIT','LEDGER','WAVE','CLEANUP','COMPACTION')) NOT VALID;

-- ── 3. Bare-statement one-shot scheduler ──
-- One function per statement is the point: pg_cron runs the command string
-- verbatim, and VACUUM refuses to run inside a transaction block.
CREATE OR REPLACE FUNCTION public.sim_schedule_compaction(p_run uuid, p_delay_minutes int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_when timestamptz := now() + make_interval(mins => GREATEST(1, p_delay_minutes));
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
BEGIN
  FOR i IN 1 .. array_length(v_specs, 1) LOOP
    PERFORM cron.schedule(
      v_names[i] || '-' || left(p_run::text, 8),
      to_char(v_when AT TIME ZONE 'UTC', 'MI HH24 DD MM *'),
      v_specs[i]
    );
    v_scheduled := v_scheduled + 1;
  END LOOP;
  RETURN jsonb_build_object('run', p_run, 'jobs_scheduled', v_scheduled,
    'fire_at_utc', to_char(v_when AT TIME ZONE 'UTC', 'HH24:MI'));
END;
$function$;
GRANT EXECUTE ON FUNCTION public.sim_schedule_compaction(uuid, int) TO service_role;
-- ── 4. Enqueue: COMPACTION sentinel closes every run ──
-- The engine executes it by calling sim_schedule_compaction; the actual
-- vacuum one-shots fire a minute later outside any transaction.
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

  -- Auto-compaction sentinel: post-publication, the finalizer schedules the
  -- bare-statement VACUUM FULL one-shots (migration 285) — no manual 873→779
  -- MB cleanup, ever again.
  v_seq := v_seq + 1;
  INSERT INTO sim_run_steps (run_id, seq, kind)
  VALUES (p_run, v_seq, 'COMPACTION');

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

-- ── 6. Driver support: neop_sim_tick_local executes COMPACTION ──
-- Applied as a follow-up migration (sim_tick_local_compaction_step). Without
-- the COMPACTION branch, the driver's ELSE arm completes the step as a noop
-- and the one-shots are never scheduled. The branch is identical to the
-- HTTP engine's executeCompactionStep:
--
--     ELSIF v_step.kind = 'COMPACTION' THEN
--       v_result := public.sim_schedule_compaction(v_step.run_id, 2);
--
-- See supabase/migrations for the full updated function body.
