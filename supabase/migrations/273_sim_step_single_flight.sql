-- Migration 273 — Simulation step claim: single-flight + stale-claim reaper
--
-- Incident (Run 5, Sep 20 2026): the public stats route's opportunistic pump
-- (tick?max=10, once/min per warm serverless instance) plus cron plus the
-- dashboard poller produced ~10 concurrent wave steps. Each wave is a heavy
-- transaction; in parallel they thrashed the free-tier DB and throughput
-- collapsed from ~14s/step to <1 step / 8 min.
--
-- Fix: the claim function now enforces SINGLE-FLIGHT — at most one step of a
-- run may be RUNNING at any instant, regardless of how many drivers tick.
-- Steps are idempotent and durably checkpointed, so serial execution costs
-- nothing but wall time. A stale-claim reaper (30 min) requeues orphaned
-- RUNNING steps (cold-start deaths, gateway timeouts) so the queue can never
-- wedge permanently.

CREATE OR REPLACE FUNCTION public.claim_simulation_step(p_run uuid DEFAULT NULL)
RETURNS public.sim_run_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_run  uuid := p_run;
  v_step public.sim_run_steps;
BEGIN
  IF v_run IS NULL THEN
    SELECT id INTO v_run
    FROM simulation_runs
    WHERE status = 'RUNNING'
    ORDER BY started_at DESC
    LIMIT 1;
    IF v_run IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Serialize claimers. pg_try_advisory_xact_lock (non-blocking): if another
  -- tick holds the lock, this one exits immediately instead of queueing a
  -- session. With a blocking lock, a 59s cron interval + a >59s tick caused
  -- sessions to stack until the connection pool saturated the free-tier DB —
  -- every other query (including the public summary RPCs) then timed out and
  -- the live site served zeros. (Run 5, Sep 21 2026.)

  IF NOT pg_try_advisory_xact_lock(hashtext(v_run::text)::bigint) THEN
    RETURN NULL;
  END IF;

  -- Reaper: requeue steps whose executor died mid-flight (cold start, 60s
  -- gateway timeout, deploy, or the public stats-pump's 50s fetch abort
  -- killing an in-flight wave). 3 min ≈ 3× the longest legitimate step
  -- (~22s waves, 60s statement cap) and every step is idempotent, so a
  -- requeue cannot double-publish — but a longer window would let one
  -- orphan block the single-flight gate for its whole duration.
  UPDATE sim_run_steps
  SET status = 'PENDING', claimed_at = NULL
  WHERE run_id = v_run
    AND status = 'RUNNING'
    AND claimed_at < NOW() - INTERVAL '3 minutes';

  -- Single-flight gate: if any step of the run is RUNNING, another executor
  -- owns the queue right now — hand back empty instead of claiming in
  -- parallel and thrashing the DB.
  IF EXISTS (SELECT 1 FROM sim_run_steps WHERE run_id = v_run AND status = 'RUNNING') THEN
    RETURN NULL;
  END IF;

  -- Claim exactly one PENDING step.
  UPDATE sim_run_steps
  SET status = 'RUNNING', attempts = attempts + 1, claimed_at = NOW(), result = NULL
  WHERE id = (
    SELECT id FROM sim_run_steps
    WHERE run_id = v_run AND status = 'PENDING'
    ORDER BY seq
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_step;

  RETURN v_step;
END;
$fn$;
