-- ============================================================
-- NEOP DISK-FULL RECOVERY (run in the Supabase Dashboard SQL Editor)
--
-- The Free plan enters read-only mode when database size exceeds
-- 500 MB (we hit 933 MB during the 20M simulation). This script
-- deletes ONLY simulation debris, shrinking the database far below
-- the quota so read-only mode lifts automatically.
--
-- Safe: every DELETE is scoped to '[SIM]'/'[TEST]' elections or
-- 'sim_obs_%' accounts. The ~250 real demo submissions, real users,
-- and all reference data are untouched.
--
-- Steps:
--   1. Run Block A (read-write session).            -> deletes debris
--   2. Run Block B (size check).                    -> should be < 500 MB
--   3. Read-only mode lifts automatically once
--      size < 500 MB; VACUUM FULL in Block C is
--      optional file-space reclaim (supabase).
-- ============================================================

-- ------------------------------------------------------------
-- BLOCK A — delete simulation debris (read-write session)
-- ------------------------------------------------------------
SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE;

CREATE TEMP TABLE _sim_elec_ids ON COMMIT DROP AS
  SELECT id FROM elections
  WHERE left(name, 5) = '[SIM]' OR left(name, 6) = '[TEST]';

-- verifications.canonical_result_id is a NO ACTION FK: NULL it first
UPDATE verifications SET canonical_result_id = NULL
WHERE election_id IN (SELECT id FROM _sim_elec_ids);

-- canonical results first (children of elections)
DELETE FROM canonical_party_results
WHERE canonical_result_id IN (
  SELECT id FROM canonical_pu_results WHERE election_id IN (SELECT id FROM _sim_elec_ids));

DELETE FROM canonical_pu_results WHERE election_id IN (SELECT id FROM _sim_elec_ids);

-- verifications + timeline (MUST come before submissions:
-- verifications.submission_id_1/2 are NO ACTION FKs)
DELETE FROM verification_timeline_events
WHERE verification_id IN (SELECT id FROM verifications WHERE election_id IN (SELECT id FROM _sim_elec_ids));

DELETE FROM verifications WHERE election_id IN (SELECT id FROM _sim_elec_ids);

-- submissions (party_results CASCADE; verifications already gone)
DELETE FROM result_submissions WHERE election_id IN (SELECT id FROM _sim_elec_ids);

-- assignments + observers (scoped to sim accounts)
DELETE FROM agent_assignments
WHERE election_id IN (SELECT id FROM _sim_elec_ids)
   OR volunteer_id IN (SELECT id FROM volunteers WHERE user_id IN (
        SELECT id FROM user_accounts WHERE email LIKE 'sim_obs_%'));

DELETE FROM volunteers WHERE user_id IN (
  SELECT id FROM user_accounts WHERE email LIKE 'sim_obs_%');

DELETE FROM user_accounts WHERE email LIKE 'sim_obs_%';

-- incidents attached to sim elections, if any
DELETE FROM incidents WHERE election_id IN (SELECT id FROM _sim_elec_ids);

-- sim elections themselves + any leftover [TEST] elections
DELETE FROM elections WHERE id IN (SELECT id FROM _sim_elec_ids);

-- point the site back at the live dataset
UPDATE system_config
SET data_mode = 'AWAITING_DATA',
    active_election_id = NULL,
    simulation_election_id = NULL,
    last_updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE simulation_config
SET status = 'IDLE', last_tick_at = NOW(), updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001';

-- ------------------------------------------------------------
-- BLOCK B — verify size (run after Block A)
-- ------------------------------------------------------------
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
-- Expect well below 500 MB -> read-only mode lifts automatically.

-- ------------------------------------------------------------
-- BLOCK C — optional: reclaim file space (run once unlocked)
-- ------------------------------------------------------------
-- VACUUM FULL agent_assignments;
-- VACUUM FULL party_results;
-- VACUUM FULL user_accounts;
-- VACUUM FULL volunteers;
-- VACUUM FULL canonical_party_results;
-- VACUUM FULL verification_timeline_events;
-- VACUUM FULL result_submissions;
-- VACUUM FULL canonical_pu_results;
-- VACUUM FULL verifications;
-- VACUUM (analyze);  -- plain vacuum + analyze at the end
