-- ============================================================
-- NEOP 262 — PUBLISH-ON-SUCCESS: PERSIST THE LAST COMPLETED SIMULATION
--
-- Problem this fixes (product requirement §2/§3/§45-47):
--   Starting a new simulation used to destroy the dataset the public site
--   was rendering. `sim_preflight_cleanup` purged EVERY run but the new one
--   and truncated the whole ledger, and the engine flipped
--   system_config.active_election_id to the new (still empty) election on the
--   first wave. So the demo went blank the moment an admin pressed Run, and
--   stayed blank if the batch failed.
--
-- New contract:
--   • A run's results are PRIVATE until it passes validation.
--   • The currently published dataset keeps rendering, untouched, for the
--     whole duration of the new batch.
--   • A batch that completes successfully calls publish_simulation_run(),
--     which switches the public dataset atomically and only then reclaims
--     the superseded batch's storage.
--   • A batch that fails changes nothing public.
--
-- Storage cost: the published dataset (canonical rows + its ledger, which is
-- the coverage source) is RETAINED during a run, so two datasets coexist
-- briefly. simulation_quota_check() must be told about the retained
-- footprint — see simulation_retained_bytes() below and the launch route,
-- which adds it to the projection. This is the trade-off accepted for
-- persistence: lower max coverage per batch, no blank site.
-- ============================================================

-- ── 1. How much is the currently published dataset holding? ────
-- The launch route adds this to simulation_quota_check()'s projection, so
-- the guard refuses a coverage that cannot coexist with what is published.
CREATE OR REPLACE FUNCTION public.simulation_retained_bytes()
RETURNS bigint
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_bytes_per_ledger    CONSTANT bigint := 850;
  c_bytes_per_published CONSTANT bigint := 6200;
  v_election uuid;
  v_canon bigint;
  v_ledger bigint;
BEGIN
  SELECT simulation_election_id INTO v_election
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_election IS NULL THEN
    RETURN 0;  -- nothing published yet: first run starts from a clean slate
  END IF;

  SELECT count(*) INTO v_canon FROM canonical_pu_results WHERE election_id = v_election;
  SELECT count(*) INTO v_ledger FROM pu_simulation_status;

  RETURN (v_canon * c_bytes_per_published) + (v_ledger * c_bytes_per_ledger);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.simulation_retained_bytes() TO service_role;

-- ── 2. Keep the PUBLISHED run alive during pre-flight cleanup ───
-- Was: purge every run except p_keep_run + TRUNCATE the entire ledger.
-- Now: also keep the run whose election is currently published, because it
-- is what the public site is serving right now.
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
  v_published_run uuid;
  v_published_election uuid;
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

  -- The dataset the public site is currently rendering. Its canonical rows
  -- AND its ledger stay: the ledger is the source of the published coverage
  -- and status counts, so truncating it would blank the live site.
  SELECT simulation_election_id INTO v_published_election
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_published_election IS NOT NULL THEN
    SELECT id INTO v_published_run
    FROM simulation_runs
    WHERE election_id = v_published_election
      AND status IN ('COMPLETED', 'PUBLISHED')
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- Purge every other run — superseded batches, stopped runs, failures.
  FOR r IN SELECT id FROM simulation_runs
           WHERE id <> p_keep_run
             AND id IS DISTINCT FROM v_published_run
  LOOP
    BEGIN
      PERFORM purge_simulation_run(r.id);
      v_purged := v_purged + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  -- Reclaim the ledger rows of purged runs only. The published run's ledger
  -- is load-bearing (coverage + status counts) and must survive.
  DELETE FROM pu_simulation_status
  WHERE run_id IS DISTINCT FROM p_keep_run
    AND run_id IS DISTINCT FROM v_published_run;

  RETURN jsonb_build_object(
    'purged_runs', v_purged,
    'purge_failed', v_failed,
    'retained_published_run', v_published_run,
    'retained_published_election', v_published_election
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sim_preflight_cleanup(uuid) TO service_role;

-- ── 3. The atomic switch (called only on successful completion) ──
-- Validation gate: a run may only be published if it actually produced
-- canonical results. A failed or empty batch can never replace the live
-- dataset — this is the single guarantee the demo depends on.
CREATE OR REPLACE FUNCTION public.publish_simulation_run(p_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_election uuid;
  v_status text;
  v_canon bigint;
  v_previous uuid;
  v_superseded int := 0;
  v_mult numeric := 1;
  r record;
BEGIN
  SELECT election_id, status INTO v_election, v_status
  FROM simulation_runs WHERE id = p_run;

  -- Display multiplier travels with the batch now that the pointer is no
  -- longer flipped at launch (it used to be written on the first wave).
  -- Defensive: params is free-form jsonb, so a bad value falls back to 1.
  BEGIN
    SELECT COALESCE((params->>'display_multiplier')::numeric, 1) INTO v_mult
    FROM simulation_runs WHERE id = p_run;
  EXCEPTION WHEN OTHERS THEN
    v_mult := 1;
  END;

  IF v_election IS NULL THEN
    RETURN jsonb_build_object('published', false, 'reason', 'run has no election yet');
  END IF;

  SELECT count(*) INTO v_canon FROM canonical_pu_results WHERE election_id = v_election;

  -- The validation gate. No results => nothing to publish.
  IF v_canon = 0 THEN
    RETURN jsonb_build_object('published', false, 'reason', 'no canonical results to publish',
                              'canonical_rows', 0);
  END IF;

  SELECT simulation_election_id INTO v_previous
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  -- Atomic switch: one statement, one row, so no surface can ever observe a
  -- half-switched dataset (old coverage + new votes).
  UPDATE system_config
  SET data_mode = 'SIMULATED',
      active_election_id = v_election,
      simulation_election_id = v_election,
      display_multiplier = CASE WHEN v_mult > 0 THEN v_mult ELSE display_multiplier END,
      last_updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  UPDATE simulation_runs
  SET status = 'PUBLISHED', completed_at = COALESCE(completed_at, now())
  WHERE id = p_run;

  -- Only now — after the switch is committed — reclaim the superseded
  -- batch's storage. A failure here leaves the new dataset published.
  IF v_previous IS NOT NULL AND v_previous <> v_election THEN
    FOR r IN SELECT id FROM simulation_runs
             WHERE election_id = v_previous AND id <> p_run
    LOOP
      BEGIN
        PERFORM purge_simulation_run(r.id);
        v_superseded := v_superseded + 1;
      EXCEPTION WHEN OTHERS THEN
        NULL;  -- storage cleanup is best-effort; publication already happened
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'published', true,
    'election_id', v_election,
    'canonical_rows', v_canon,
    'superseded_purged', v_superseded,
    'previous_election_id', v_previous
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.publish_simulation_run(uuid) TO service_role;

-- ── 4. simulation_runs.status must accept PUBLISHED ────────────
-- Additive and NOT VALID so no existing row is re-checked or rejected.
DO $$
BEGIN
  ALTER TABLE simulation_runs DROP CONSTRAINT IF EXISTS simulation_runs_status_check;
  ALTER TABLE simulation_runs ADD CONSTRAINT simulation_runs_status_check
    CHECK (status IN ('CREATED','QUEUED','RUNNING','COMPLETED','PUBLISHED',
                      'FAILED','STOPPED','CANCELLED'))
    NOT VALID;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'status constraint not altered: %', SQLERRM;
END $$;
