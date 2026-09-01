-- ============================================================
-- MIGRATION 007: Drop volunteer assignment unique constraint
-- for simulation support
-- 
-- RUN THIS IN: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

-- This allows the same volunteer to be assigned to multiple polling units
-- Essential for simulation where we need 188K+ assignments
ALTER TABLE agent_assignments 
  DROP CONSTRAINT IF EXISTS agent_assignments_volunteer_id_election_id_key;

-- Verify it's gone
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'agent_assignments'::regclass 
  AND contype = 'u';
