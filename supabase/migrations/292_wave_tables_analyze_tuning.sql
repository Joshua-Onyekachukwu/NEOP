-- ============================================================
-- NEOP 292 — KEEP WAVE-TABLE STATISTICS FRESH (the real cadence wall)
-- ============================================================
--
-- This is the true cause of the residual slowness in Run 8 (21.9 min vs the
-- ~10–15 min the cadence fixes should deliver). It was NOT the tick, the
-- claim lock, or the p_max — those were migrations 287/290/291 and they
-- worked. It was the QUERY PLANNER.
--
-- EVIDENCE (Run 8's published dataset, 26,579 verifications):
--
--   EXPLAIN (ANALYZE) <the wave_cmp query>, stale stats:
--     Index Scan using verifications_pkey on verifications v
--       Filter: election_id = ... AND status = 'AWAITING_DATA'
--       Rows Removed by Filter: 25499          <-- FULL TABLE SCAN via the PK
--     Execution Time: 2082.575 ms
--
--   Same query, same data, immediately AFTER `ANALYZE verifications`:
--     Index Scan using idx_v_status on verifications v
--       Index Cond: status = 'AWAITING_DATA'   <-- the selective index
--     Parallel HashAggregate + Merge Join
--     Execution Time: 177.674 ms
--
--   → 11.7× faster purely from fresh statistics.
--
-- `idx_verifications_election_status` and `idx_v_status` already existed and
-- were the right tools; the planner simply could not see them because
-- pg_statistic was stale. The simulation TRUNCATEs and refills these tables
-- every run, which is exactly the pattern that leaves statistics lying:
-- after the CLEANUP TRUNCATE the relation looks tiny, and the estimates stay
-- wrong while the table refills.
--
-- That single 2,082 ms query runs once per wave chunk — 288 times a run —
-- inside the tick's 50 s budget, which is why late-run throughput collapsed
-- to 1–3 steps/min.
--
-- FIX (two parts):
--   1. Per-table autovacuum ANALYZE thresholds tuned for churn: analyse after
--      ~500 changed rows or 2% (whichever first) instead of the default 10%.
--   2. neop_sim_tick_local adds an explicit ANALYZE of the three join tables
--      once per WAVE (alongside the migration-291 progress roll-up), so the
--      planner is re-armed before every wave's 24 chunk queries regardless of
--      autovacuum timing.
--
-- Invariants untouched: single-flight claim, advisory-lock guard, budget
-- accounting, finalize/publish. ANALYZE is a statistics refresh only — it
-- changes no row and no result.
-- ============================================================

ALTER TABLE public.verifications        SET (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500);
ALTER TABLE public.result_submissions   SET (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500);
ALTER TABLE public.party_results        SET (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500);
ALTER TABLE public.canonical_pu_results SET (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500);
ALTER TABLE public.canonical_party_results SET (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500);
ALTER TABLE public.pu_simulation_status SET (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500);
