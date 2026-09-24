-- ============================================================
-- NEOP 284 — SIMULATION DISPATCH-CADENCE FIX (Run 6 evidence)
-- ============================================================
--
-- MEASURED BASELINE (Run 6, 34% coverage, 296 steps):
--   • Pure step execution:          138 s total (waves avg 0.4 s)
--   • Wall time start → publish:    ~71 min
--   • Inter-step gaps:              196 min total; median 0.0 s,
--                                   avg 13.8 s, p95/max ~99 s
--   => The bottleneck is DISPATCH (cron interval + 40 s budget cap
--      + per-invocation overhead), NOT compute. Median gap 0 s
--      proves steps chain instantly when a driver keeps claiming.
--
-- FIX (same function, same safety properties, measured change):
--   neop_sim_tick_local(p_max 2 → 24) driven by the same 60 s cron.
--   • Run 6 duty cycle:  12 ticks × ~40 s work ≈ 480 s work/min
--     window ≈ 60–80% duty — the instance already survived this.
--   • New profile:       ~10–15 s work per minute ≈ 20–25% duty
--     — LOWER instantaneous load than the status quo, 12× the
--     queue drain rate per tick. The single-flight claim gate,
--     advisory lock, reaper, and durable checkpoint queue are all
--     unchanged; steps remain idempotent.
--   • Worst case unchanged: every claim→execute→complete is
--     wrapped and checkpointed; a cold start mid-loop loses at
--     most the current step (reaper requeues it).
--
-- The knob stays a function argument: a supervised stress test can
-- run SELECT neop_sim_tick_local(48, 120000) manually; the cron
-- just calls the safe default.
-- ============================================================

-- Keep the driver cron at every minute (pg_cron interval format caps at
-- '[1-59] seconds', so 60 s is expressed as the minute wildcard) but drain
-- up to 24 steps per tick.
DO $do$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'neop-sim-driver';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_jobid,
      schedule := '* * * * *',
      command  := 'SELECT public.neop_sim_tick_local(24, 50000)');
  ELSE
    PERFORM cron.schedule('neop-sim-driver', '* * * * *',
      'SELECT public.neop_sim_tick_local(24, 50000)');
  END IF;
END
$do$;
