-- ============================================================
-- DIAGNOSTIC: What is in the new Supabase project right now?
-- ============================================================

-- Panel 1: Row counts for core geographic tables + key tables
SELECT 'states'              AS table_name, COUNT(*)::bigint AS row_count FROM states
UNION ALL SELECT 'lgas',                COUNT(*) FROM lgas
UNION ALL SELECT 'wards',               COUNT(*) FROM wards
UNION ALL SELECT 'polling_units',       COUNT(*) FROM polling_units
UNION ALL SELECT 'elections',           COUNT(*) FROM elections
UNION ALL SELECT 'parties',             COUNT(*) FROM parties
UNION ALL SELECT 'user_accounts',       COUNT(*) FROM user_accounts
UNION ALL SELECT 'admin_users',         COUNT(*) FROM admin_users
UNION ALL SELECT 'volunteers',          COUNT(*) FROM volunteers
UNION ALL SELECT 'agent_assignments',   COUNT(*) FROM agent_assignments
UNION ALL SELECT 'result_submissions',  COUNT(*) FROM result_submissions
UNION ALL SELECT 'party_results',       COUNT(*) FROM party_results
UNION ALL SELECT 'incidents',           COUNT(*) FROM incidents
UNION ALL SELECT 'observations',        COUNT(*) FROM observations
UNION ALL SELECT 'evidence_records',    COUNT(*) FROM evidence_records
UNION ALL SELECT 'audit_log',           COUNT(*) FROM audit_log
UNION ALL SELECT 'simulation_config',   COUNT(*) FROM simulation_config
UNION ALL SELECT 'simulation_history',  COUNT(*) FROM simulation_history
ORDER BY table_name;

-- Panel 2: Sample 5 states (confirm hierarchy labels)
SELECT id, name, code FROM states ORDER BY name LIMIT 5;

-- Panel 3: RLS enabled check (18 tables - should all be true)
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('states','lgas','wards','polling_units','elections','parties',
                    'user_accounts','admin_users','volunteers','agent_assignments',
                    'result_submissions','party_results','evidence_records','incidents',
                    'observations','audit_log','simulation_config','simulation_history')
ORDER BY tablename;

-- Panel 4: Index count on public tables
SELECT COUNT(*) AS total_indexes_on_public_tables
FROM pg_indexes WHERE schemaname = 'public';

-- Panel 5: poll_unit status distribution
SELECT status, COUNT(*) AS num_pus
FROM polling_units
GROUP BY status
ORDER BY status;

-- Panel 6: Extensions check
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('postgis','uuid-ossp','pgcrypto','pg_trgm');
