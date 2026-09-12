-- ====================================================================
-- ORDER 5/4 (RUN AFTER 223→224→225→226)
-- PRODUCTION HARDENING UPGRADES FOR FINAL WORK.MD §51 + 8 UPGRADES
-- Creates: transparency_hash + proof chain on canonical_pu_results;
--          admin_users.state_id FK states; pg_cron enable (PRO tier);
--          state-scoped admin RLS policy; dead-letter 10-min schedule call
-- ====================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== UPG5: TRANSPARENCY HASH + PROOF CHAIN =========================
ALTER TABLE canonical_pu_results ADD COLUMN IF NOT EXISTS transparency_hash TEXT;
ALTER TABLE canonical_pu_results ADD COLUMN IF NOT EXISTS published_proof_chain JSONB DEFAULT '[]'::JSONB;
COMMENT ON COLUMN canonical_pu_results.transparency_hash IS 'SHA-256 hex of deterministic canonicalization for third-party tamper audit.';
COMMENT ON COLUMN canonical_pu_results.published_proof_chain IS 'JSONB array of {prev_hash, hash, type, actor, ts} proving the publish/supersede lineage.';
CREATE INDEX IF NOT EXISTS idx_canonical_transparency_hash ON canonical_pu_results(transparency_hash);

-- ===== UPG7: STATE-SCOPED ADMIN ======================================
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS state_id UUID REFERENCES states(id) ON DELETE SET NULL;
COMMENT ON COLUMN admin_users.state_id IS 'If set, admin is state-scoped; NULL = global admin.';

-- ===== UPG2: PG_CRON REAPER ENABLE (PRO TIER) =======================
-- NOTE on FREE tier Supabase disables pg_cron extension. If CREATE EXTENSION
-- fails, use Vercel cron.json fallback at apps/web/vercel.json instead.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available on this tier — falling back to Vercel cron.json hourly fallback route /api/admin/cron/dead-letter-reaper-hourly';
  END;
END $$;

-- state-scoped RLS policy supplement for admin users
DO $$
BEGIN
  DROP POLICY IF EXISTS admin_state_scoped_policy ON canonical_pu_results;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
CREATE POLICY admin_state_scoped_policy ON canonical_pu_results
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
        AND (au.state_id IS NULL
          OR au.state_id = (SELECT p.state_id FROM polling_units p WHERE p.id = canonical_pu_results.polling_unit_id))
    )
  );

-- ===== UPG2: PG_CRON SCHEDULE 10-MIN DEAD-LETTER REAPER (PRO ONLY) ===
-- If pg_cron installed, call this manually:
-- SELECT cron.schedule('dead-letter-reaper-10min','*/10 * * * *',$$SELECT process_dead_letter_retry(50)$$);
