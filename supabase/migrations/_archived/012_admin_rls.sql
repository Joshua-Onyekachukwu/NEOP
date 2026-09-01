-- Allow authenticated users to check if they are admin
-- This is safe because they can only read their OWN record (matched by user_id = auth.uid())
CREATE POLICY "admin_users_self_read" ON admin_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Allow service_role full access (for admin management)
CREATE POLICY "admin_users_service_all" ON admin_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
