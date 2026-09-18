-- ============================================================
-- NEOP 266 — PUBLISH: ATOMIC SWITCH DECOUPLED FROM CLEANUP
--
-- Observed failure: publish_simulation_run purged every
-- superseded simulation run inside the same transaction as the
-- pointer switch. Purging deletes hundreds of thousands of rows
-- (submissions, canonical results, ledger), which exceeds the
-- ~60s PostgREST gateway cap; the whole transaction rolls back
-- and the dataset switch NEVER happens ("upstream request
-- timeout" on every publish attempt).
--
-- Fix (integrity-preserving):
--   • publish_simulation_run now does ONLY the fast, atomic work:
--       pointer switch + run marked PUBLISHED + superseded runs
--       marked ARCHIVED (migration 265 allows the status).
--   • purge_superseded_simulation_runs() is a separate, idempotent,
--     exception-guarded cleanup that archives→purges any run whose
--     election is NOT the currently active one. It can be called
--     any time afterwards (engine finalize, tick, admin) and is
--     safe to retry: it never touches the active election.
--
-- Ordering guarantee: switch first (fast, must succeed), cleanup
-- second (slow, may be retried). Storage reclamation is therefore
-- eventually consistent, but the public dataset is never at risk.
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_simulation_run(p_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_election uuid;
  v_status   text;
  v_canon    bigint;
  v_previous uuid;
  v_mult     numeric := 1;
  v_archived int := 0;
BEGIN
  SELECT election_id, status INTO v_election, v_status
  FROM simulation_runs WHERE id = p_run;

  IF v_election IS NULL THEN
    RETURN jsonb_build_object('published', false, 'reason', 'run has no election yet');
  END IF;

  BEGIN
    SELECT COALESCE((params->>'display_multiplier')::numeric, 1) INTO v_mult
    FROM simulation_runs WHERE id = p_run;
  EXCEPTION WHEN OTHERS THEN v_mult := 1; END;

  -- Empty-dataset gate (unchanged): never publish an empty election.
  SELECT count(*) INTO v_canon FROM canonical_pu_results WHERE election_id = v_election;
  IF v_canon = 0 THEN
    RETURN jsonb_build_object('published', false, 'reason', 'no canonical results to publish', 'canonical_rows', 0);
  END IF;

  SELECT simulation_election_id INTO v_previous
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  -- ---- THE ATOMIC SWITCH (fast: 2 small writes) ----
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

  -- Mark superseded runs for later cleanup — NO heavy deletes here.
  -- (Rows are only purged by purge_superseded_simulation_runs().)
  IF v_previous IS NOT NULL AND v_previous <> v_election THEN
    WITH archived AS (
      UPDATE simulation_runs
      SET status = 'ARCHIVED'
      WHERE election_id = v_previous
        AND id <> p_run
        AND status IN ('COMPLETED', 'PUBLISHED', 'STOPPED', 'FAILED', 'CANCELLED')
      RETURNING 1
    )
    SELECT count(*) INTO v_archived FROM archived;
  END IF;

  RETURN jsonb_build_object(
    'published', true,
    'election_id', v_election,
    'canonical_rows', v_canon,
    'superseded_archived', v_archived,
    'previous_election_id', v_previous,
    'cleanup_deferred', v_archived > 0
  );
END;
$function$;

-- Idempotent, retry-safe cleanup: purges every run whose election is
-- NOT the currently active one. Skips RUNNING/QUEUED/CREATED runs so
-- a concurrently-executing batch can never be destroyed mid-flight.
CREATE OR REPLACE FUNCTION public.purge_superseded_simulation_runs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active uuid;
  r record;
  v_purged int := 0;
  v_failed int := 0;
  v_freed  text;
BEGIN
  SELECT active_election_id INTO v_active
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  FOR r IN
    SELECT id FROM simulation_runs
    WHERE (election_id IS NULL OR election_id <> COALESCE(v_active, '00000000-0000-0000-0000-000000000000'::uuid))
      AND status IN ('ARCHIVED', 'COMPLETED', 'STOPPED', 'FAILED', 'CANCELLED', 'PUBLISHED')
  LOOP
    BEGIN
      PERFORM purge_simulation_run(r.id);
      v_purged := v_purged + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  SELECT pg_size_pretty(pg_database_size(current_database())) INTO v_freed;
  RETURN jsonb_build_object('purged', v_purged, 'failed', v_failed, 'db_size', v_freed);
END;
$function$;
