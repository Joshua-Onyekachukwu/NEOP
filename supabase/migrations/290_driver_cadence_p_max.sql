-- ============================================================
-- NEOP 290 — DRIVER CADENCE: LET THE BUDGET BE THE BOUND, NOT p_max
-- ============================================================
--
-- EVIDENCE (Run 8, 2026-09-24, run 4a2687d0, 297 steps):
--   • Per-step cost measured from sim_run_steps: WAVE avg 0.13 s (max
--     20.45 s — a step held by a competing HTTP driver), LEDGER avg 3.39 s.
--     Total step compute for the WHOLE run is ~50 s.
--   • Yet wall time was ~20 min, because job 53 was
--     neop_sim_tick_local(24, 50000): p_max hard-capped each one-minute
--     tick at 24 steps, so the fastest possible run was 297/24 ≈ 12.4 min
--     and any contention pushed it past that.
--   • Run 7 (pre-fix) was 101 min for the same 297 steps — the migration 287
--     wait-and-retry removed the early-exit, and this removes the p_max cap.
--
-- The tick already stops on EITHER p_max OR the wall-clock budget
-- (p_budget_ms, default 50 000). The budget is the correct throttle: it
-- bounds slow steps (a 3 s LEDGER chunk) without punishing fast ones (a
-- 0.13 s WAVE chunk). p_max was doing the budget's job and starving the
-- common case.
--
-- Change: p_max 24 → 60. A tick of fast WAVE steps now completes in ~8 s
-- inside the same 50 s budget; a tick of slow steps is still cut off by the
-- budget exactly as before. No other invariant is touched — the
-- single-flight claim, the advisory-lock guard and the finalize/publish
-- path are all unchanged.
--
-- Pairing change (apps/web): the public-stats HTTP self-pump interval was
-- raised 60 s → 600 s. It is a backstop for runtimes with no in-database
-- cron; leaving it at 1 min per warm instance made it a SECOND driver
-- racing the same claim, which is what produced the 20.45 s held steps.
-- ============================================================

DO $mig$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'neop-sim-driver';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(
      job_id  := v_jobid,
      command := 'SELECT public.neop_sim_tick_local(60, 50000)'
    );
  END IF;
END
$mig$;
