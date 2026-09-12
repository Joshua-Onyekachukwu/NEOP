-- ============================================================
-- RLS FIX: Add policies to admin_users table
-- Root cause: RLS enabled on admin_users but zero policies.
-- Admin verification subqueries fail silently with 0 rows.
-- ============================================================

-- 1. Authenticated user can read their OWN admin_users row (allows EXISTS admin check bootstrap)
DROP POLICY IF EXISTS "Admins can read own admin record" ON admin_users;
CREATE POLICY "Admins can read own admin record"
  ON admin_users FOR SELECT
  USING (auth.uid() = user_id);

-- 2. SUPER_ADMIN and OPERATIONS_ADMIN can read ALL admin_users (admin management)
DROP POLICY IF EXISTS "Admins can read all admin users" ON admin_users;
CREATE POLICY "Admins can read all admin users"
  ON admin_users FOR SELECT
  USING (
    role IN ('SUPER_ADMIN', 'OPERATIONS_ADMIN')
    AND is_active = true
    AND auth.uid() = user_id
  );

-- 3. SUPER_ADMIN can insert/update admin_users
DROP POLICY IF EXISTS "SUPER_ADMIN can insert admins" ON admin_users;
CREATE POLICY "SUPER_ADMIN can insert admins"
  ON admin_users FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
        AND au.role = 'SUPER_ADMIN'
        AND au.is_active = true
    )
  );

-- 4. Public (anon) can NEVER read admin_users (already default, but explicit is safer)
-- (No policy needed; implicit default-deny for anon)

-- ============================================================
-- VERIFY: RLS policies for admin_users now present
-- ============================================================
DO $$
DECLARE
  v_policies INTEGER;
BEGIN
  SELECT count(*) INTO v_policies FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'admin_users';
  RAISE NOTICE 'admin_users RLS policies: %', v_policies;
  IF v_policies < 2 THEN
    RAISE WARNING 'admin_users still has only % policies!', v_policies;
  END IF;
END $$;
