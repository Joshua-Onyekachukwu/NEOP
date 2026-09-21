-- Migration 274: neop_sim_driver — reap stale claims BEFORE the single-flight guard
--
-- Bug: the driver skipped all work while any step was status='RUNNING', but the
-- stale-claim reaper only lived inside claim_simulation_step() — which is only
-- reachable via the tick endpoint the driver itself calls. An orphaned RUNNING
-- step (executor died mid-wave: Vercel redeploy, HTTP client abort, cold start)
-- therefore wedged the queue forever: driver skips → reaper never runs → orphan
-- stays RUNNING. Observed 2026-09-21: queue stalled 40+ minutes on seq 108.
--
-- Fix: reap claims older than 4 minutes (max legitimate wave ≈ 60s) before the
-- guard. Steps are idempotent, so requeueing is safe.

CREATE OR REPLACE FUNCTION public.neop_sim_driver()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
DECLARE
  v_site   text;
  v_secret text;
  v_run    uuid;
BEGIN
  -- Reap stale claims FIRST: an orphaned RUNNING step must not wedge the
  -- driver (the reaper used to live only inside claim_simulation_step,
  -- which the driver never reached while a step showed RUNNING -- deadlock).
  UPDATE sim_run_steps
     SET status = 'PENDING', attempts = 0, claimed_at = NULL
   WHERE status = 'RUNNING'
     AND claimed_at < now() - interval '4 minutes';

  -- Single-flight guard: skip if any step is already RUNNING.
  IF EXISTS (
    SELECT 1 FROM sim_run_steps WHERE status = 'RUNNING'
  ) THEN
    RETURN;
  END IF;

  -- Only fire when a run needs work.
  SELECT id INTO v_run FROM simulation_runs WHERE status = 'RUNNING' LIMIT 1;
  IF v_run IS NULL THEN
    RETURN;
  END IF;

  SELECT site_url, cron_secret INTO v_site, v_secret
  FROM sim_driver_config WHERE id = 1;
  IF v_site IS NULL OR v_secret IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    v_site || '/api/admin/simulate/tick?max=8',
    '{}'::jsonb,
    NULL,
    jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    45000
  );
END
$function$;
