-- ============================================================
-- NEOP 288 — REAL 500 MB ENVELOPE + AUDIT-CHURN RELEASE + AUDIT COMPACTION
-- ============================================================
--
-- THREE defects found in the Phase 3 rehearsal (Sep 24):
--
-- 1) WRONG CEILING. simulation_quota_check() hardcoded 891,289,600 B
--    (850 MB) as the plan ceiling. The free-plan database limit is 500 MB.
--    The gate was therefore willing to green-light a launch that would push
--    the database ~350 MB past the real limit — into read-only mode. Every
--    "coverage ≤ 33%" recommendation it printed was computed against the
--    wrong envelope.
--
--    FIX: ceiling 500 MiB (524,288,000), safety 60 MiB (62,914,560) →
--    440 MiB usable. Same signature, so PostgREST callers are unaffected.
--
-- 2) UNBUDGETED AUDIT CHURN. Every published polling unit writes an
--    audit_log RESULT_PUBLISHED row. Measured: 275,203 rows / 107 MB — 36%
--    of the entire 299 MB post-release baseline — and NOTHING ever trimmed
--    them. The simulation_release_published() lifecycle (migration 285)
--    released the result chain but left the audit trail behind, so the
--    churn accumulated run over run. This is exactly the "uncontrolled
--    growth" the rehearsal brief forbids.
--
--    FIX: release now trims RESULT_PUBLISHED/CANONICAL_RESULT audit rows
--    scoped strictly to [SIM]/[TEST] elections. A real election's audit
--    trail can never be touched — release already refuses LIVE_ELECTION.
--
-- 3) COMPACTION MISSED THE BIGGEST CHURN TABLE. The post-publication
--    VACUUM FULL one-shots (migration 285/287) covered the result chain
--    but not audit_log — 107 MB of the largest single reclaimable block.
--
--    FIX: audit_log joins the staggered compaction set (5 one-shots now).
-- ============================================================

-- ── 1. The real 500 MB envelope ─────────────────────────────
CREATE OR REPLACE FUNCTION public.simulation_quota_check(p_coverage_pct integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_quota_bytes  CONSTANT bigint := 524288000;  -- 500 MiB free-plan database limit
  c_safety_bytes CONSTANT bigint := 62914560;   -- 60 MiB safety margin
  c_bytes_per_ledger    CONSTANT bigint := 850;  -- measured, incl. indexes
  c_bytes_per_published CONSTANT bigint := 6200; -- all-in per published PU (chain only; ledger counted separately)

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
  -- audit_log is included because RESULT_PUBLISHED churn lives there too.
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
  v_base      := v_db - v_purgeable;   -- expected size after the CLEANUP step
  v_projected := v_base + v_ledger_need + v_results_need;
  v_usable    := c_quota_bytes - c_safety_bytes;

  IF v_universe > 0 THEN
    v_max_cov := floor((v_usable - v_base - v_ledger_need) * 100.0
                       / (v_universe * c_bytes_per_published));
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

-- ── 2. Release also trims simulation audit churn ────────────
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
  v_audit_trimmed int := 0;
  r record;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  SELECT data_mode INTO v_mode FROM system_config
  WHERE id = '00000000-0000-0000-0000-000000000001';

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

  -- Release the pointers first.
  UPDATE system_config
  SET active_election_id = NULL,
      simulation_election_id = NULL,
      last_updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  -- Audit churn (migration 288): one RESULT_PUBLISHED row per published PU,
  -- 275k rows / 107 MB and previously never trimmed. Scope strictly to
  -- simulated elections by the metadata election_id — a real election's
  -- audit trail is structurally out of reach (release already refuses
  -- LIVE_ELECTION above). Must run BEFORE the purge loop deletes the
  -- [SIM] elections, or the join target is gone.
  DELETE FROM public.audit_log a
   WHERE a.action = 'RESULT_PUBLISHED'
     AND a.resource_type = 'CANONICAL_RESULT'
     AND a.metadata ? 'election_id'
     AND EXISTS (
       SELECT 1 FROM public.elections e
        WHERE e.id = NULLIF(a.metadata->>'election_id', '')::uuid
          AND (left(e.name, 5) = '[SIM]' OR left(e.name, 6) = '[TEST]'));
  GET DIAGNOSTICS v_audit_trimmed = ROW_COUNT;

  -- Instant mass release (TRUNCATE returns file space immediately).
  TRUNCATE pu_simulation_status;
  TRUNCATE result_submissions, canonical_pu_results, canonical_party_results,
           party_results, verifications, verification_timeline_events
    CASCADE;

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
    'audit_rows_trimmed', v_audit_trimmed,
    'ledger_cleared', true,
    'data_mode', v_mode
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.simulation_release_published() TO service_role;

-- ── 3. audit_log joins the staggered compaction set ─────────
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
    'VACUUM (FULL, ANALYZE) public.result_submissions',
    'VACUUM (FULL, ANALYZE) public.audit_log'
  ];
  v_names text[] := ARRAY[
    'vac-pr', 'vac-cpr', 'vac-vte', 'vac-rs', 'vac-al'
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
    'fire_to_utc',   to_char((now() + make_interval(mins => v_base + 12)) AT TIME ZONE 'UTC', 'HH24:MI'),
    'stagger_minutes', 3);
END;
$function$;
