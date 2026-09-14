-- ============================================================
-- NEOP — POST-SIMULATION DATABASE HEALTH CHECK (read-only)
--
-- Run this in the Supabase SQL editor AFTER a simulation run stops.
-- It only REPORTS. It never rewrites tables, never takes locks beyond
-- brief shared reads, and never runs VACUUM FULL.
--
-- Policy (docs/ARCHITECTURE_RUNBOOK.md addendum):
--   - Autovacuum handles routine tuple cleanup (verified active: the
--     canonical tables were autovacuumed dozens of times on a single
--     simulation day).
--   - VACUUM FULL is reserved for a demonstrated need (dead-tuple ratio
--     high AND table bloat reclaiming real disk) and must run only in a
--     maintenance window while ingestion is stopped, because it takes an
--     ACCESS EXCLUSIVE lock. Never schedule it unconditionally.
--   - Plain VACUUM (or letting autovacuum work) is the default action.
--
-- Decision guide:
--   dead_pct < 15%          -> nothing to do; autovacuum is on top of it
--   dead_pct 15-40%         -> run plain VACUUM <table>; during idle window
--   dead_pct > 40% AND      -> consider VACUUM FULL <table> ONLY in a
--   bloat matters             maintenance window with the simulation
--                             stopped and ingestion quiesced
-- ============================================================

-- 1) Simulation processes still running? (anything here means WAIT)
SELECT pid, state, now() - query_start AS running_for, left(query, 80) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
  AND query ILIKE '%simulation%'
  AND pid <> pg_backend_pid();

-- 2) Dead tuples and size per table (the decision input)
SELECT relname,
       n_live_tup,
       n_dead_tup,
       ROUND(n_dead_tup * 100.0 / GREATEST(n_live_tup + n_dead_tup, 1), 1) AS dead_pct,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       last_autovacuum,
       autovacuum_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 15;

-- 3) Simulation debris check: rows scoped to '[SIM]'/'[TEST]' elections.
--    Cleanup of finished-run debris is a DELETE concern (see
--    supabase/RECOVERY_DISK_FULL.sql), never a vacuum shortcut.
SELECT e.name AS election, count(*) AS canonical_rows
FROM canonical_pu_results c
JOIN elections e ON e.id = c.election_id
WHERE e.name LIKE '[SIM]%' OR e.name LIKE '[TEST]%'
GROUP BY e.name;

-- 4) Overall database size vs the plan quota
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
