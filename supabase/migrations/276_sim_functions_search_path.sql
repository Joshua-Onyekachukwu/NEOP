-- Migration 276 — Pin search_path on the sim engine function family
--
-- Incident (Run 5, Sep 21 2026): the in-database sim driver executed
-- neop_sim_wave with `SET search_path = public`, so the engine's calls to
-- uuid_generate_v5() (uuid-ossp, installed in the `extensions` schema)
-- failed instantly with "function uuid_generate_v5(uuid, text) does not
-- exist". The HTTP path (PostgREST) worked because PostgREST's session
-- search_path includes `extensions`.
--
-- Fix: pin `search_path = public, extensions` on every function in the sim
-- engine family, making them self-contained regardless of caller.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'neop_sim_wave', 'neop_sim_tick_local',
        'materialize_ledger_hash_chunk', 'sim_preflight_cleanup',
        'assign_simulation_outcomes', 'sync_simulation_progress',
        'publish_simulation_run', 'stop_simulation_run',
        'complete_simulation_step', 'claim_simulation_step',
        'reclaim_stale_steps', 'retry_failed_steps',
        'publish_canonical_result', 'purge_simulation_run'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.fn);
  END LOOP;
END $$;
