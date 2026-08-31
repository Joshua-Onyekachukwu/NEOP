-- CLEANUP: Remove simulation artifacts that exceeded DB size limit
-- These 1.1M rows of fake data are eating the database:
--   190K simulation user_accounts (sim-N@test.ng)
--   190K simulation volunteers
--   188K agent_assignments (all simulation)
--   188K result_submissions (simulation)
--   376K party_results (simulation)
--   audit_log entries
--
-- PRESERVED: polling_units, states, lgas, wards, parties, elections, config

-- 1. Delete party_results (referenced by result_submissions)
DELETE FROM party_results WHERE true;

-- 2. Delete result_submissions
DELETE FROM result_submissions WHERE true;

-- 3. Delete agent_assignments
DELETE FROM agent_assignments WHERE true;

-- 4. Delete incidents
DELETE FROM incidents WHERE true;

-- 5. Delete audit_log
DELETE FROM audit_log WHERE true;

-- 6. Delete simulation volunteers (linked to simulation users)
DELETE FROM volunteers WHERE user_id IN (
  SELECT id FROM user_accounts WHERE auth_provider = 'simulation'
);

-- 7. Delete simulation user accounts
DELETE FROM user_accounts WHERE auth_provider = 'simulation';

-- 8. Reset simulation config
UPDATE simulation_config SET
  status = 'IDLE',
  total_results_submitted = 0,
  total_incidents_submitted = 0,
  total_assignments_created = 0,
  started_at = NULL,
  last_tick_at = NULL
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 9. Reset polling unit statuses
UPDATE polling_units SET status = 'NOT_STARTED' WHERE true;
