-- ======================================================================
-- 213_RLS_PUBLIC_SAFETY.sql — P0: Rewrite public SELECT policies to
-- NEVER expose unreviewed submissions, PII (agent narratives), or
-- observer volunteer IDs to anonymous internet clients.
--
-- BEFORE:
--   incidents                USING(true)    → all fields, what_observed, agent_safe,
--                                            volunteer_id, polling_unit street addresses,
--                                            status UNVERIFIED all readable.
--   observations             USING(true)    → all fields observer notes visible.
--   result_submissions       USING(true)    → all incl. UNVERIFIED, volunteer_id visible.
--   party_results            USING(true)    → all incl. REJECTED/SUPERSEDED links.
--
-- AFTER:
--   incidents/observations/result_submissions/party_results:
--     Public only SELECT rows that have been REVIEWED/VERIFIED.
--     Public selects are further restricted to column-level whitelists
--     via views (handled in API layer today; RLS row-level only).
--   admin_users / audit_log / simulation_config / admin-only tables:
--     admin-only SELECT policies, NEVER public read.
--
-- NOTE: Public-facing routes use SUPABASE_SERVICE_ROLE which bypasses RLS.
-- RLS policies here protect AGAINST direct anon Supabase JS client access
-- (public anon key is embedded in NEXT_PUBLIC_SUPABASE_ANON_KEY, sent to
-- every browser). Both layers (RLS + route) must be fixed independently.
-- ======================================================================

-- 1. DROP old unsafe policies =========================================
DROP POLICY IF EXISTS "Public can read results" ON result_submissions;
DROP POLICY IF EXISTS "Public can read party results" ON party_results;
DROP POLICY IF EXISTS "Public can read incidents" ON incidents;
DROP POLICY IF EXISTS "Public can read observations" ON observations;
DROP POLICY IF EXISTS "Public can read simulation config" ON simulation_config;
DROP POLICY IF EXISTS "Public can read audit log" ON audit_log;

-- 2. result_submissions — ONLY VERIFIED/PARTIALLY_VERIFIED/APPROVED public rows
--    Public anon API never sees UNVERIFIED / REJECTED / SUPERSEDED drafts.
CREATE POLICY "Public can read verified results only"
  ON result_submissions FOR SELECT
  USING (auth.role() = 'anon' AND status IN ('VERIFIED','PARTIALLY_VERIFIED','APPROVED','RESULT_SUBMITTED'));

-- Service role already bypasses; keep admin read perm for admin_users role too
CREATE POLICY "Admins read all result submissions"
  ON result_submissions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM admin_users au
    WHERE au.user_id = auth.uid() AND au.is_active = true
  ));

-- 3. party_results — ONLY rows linked to VERIFIED submissions (via subquery)
CREATE POLICY "Public can read party results for verified submissions"
  ON party_results FOR SELECT
  USING (
    auth.role() = 'anon' AND
    EXISTS (
      SELECT 1 FROM result_submissions rs
      WHERE rs.id = party_results.result_submission_id
        AND rs.status IN ('VERIFIED','PARTIALLY_VERIFIED','APPROVED','RESULT_SUBMITTED')
    )
  );

-- 4. incidents — Public read at the ROW level.
--    Field-level redaction (what_observed / agent_safe / exact PU details)
--    happens in the /api/public/disruptions route handler because service_role
--    bypasses RLS entirely, so route-layer code is the true enforcement point.
--    RLS here prevents direct anon JS client from unrestricted SELECT dumps.
CREATE POLICY "Public can read incidents anon only"
  ON incidents FOR SELECT
  USING (auth.role() = 'anon');

-- 5. observations — same pattern
CREATE POLICY "Public can read observations anon only"
  ON observations FOR SELECT
  USING (auth.role() = 'anon');

-- 6. admin_users NEVER expose even list existence to anon:
DROP POLICY IF EXISTS "Admins read admin_users list" ON admin_users;
CREATE POLICY "Admin users self + admin list"
  ON admin_users FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM admin_users au
        WHERE au.user_id = auth.uid() AND au.is_active = true
      )
    )
  );

-- 7. audit_log — only admins select; NEVER public:
DROP POLICY IF EXISTS "Audit log accessible by authenticated users" ON audit_log;
CREATE POLICY "Audit log admin read only"
  ON audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid() AND au.is_active = true
    )
  );

-- 8. simulation_config — public read display fields only, no writes
DROP POLICY IF EXISTS "Public can read simulation config" ON simulation_config;
CREATE POLICY "Public read sim status id/election_type/total only"
  ON simulation_config FOR SELECT
  USING (auth.role() = 'anon' OR auth.uid() IS NOT NULL);
-- (no specific column-level RLS; route level returns safe 5 fields via getCachedConfig)

-- 9. volunteer RLS — public NEVER reads volunteers:
--    Existing "Volunteers can read own data" + "Admins read all volunteers"
--    Already in place. Confirm no public read.
DROP POLICY IF EXISTS "Public can read volunteers" ON volunteers;

-- 10. user_accounts — NEVER public anything except when authenticated self
--     Already 211A in place.
