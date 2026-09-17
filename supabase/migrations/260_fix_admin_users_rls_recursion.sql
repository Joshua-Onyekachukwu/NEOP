-- ============================================================
-- NEOP 260 — ADMIN LOGIN WAS BROKEN BY RLS INFINITE RECURSION
--
-- Symptom: an admin could authenticate with a correct password and then be
-- thrown straight back to /admin/login. POST /auth/v1/token returned 200 and
-- /api/admin/check-auth said isAdmin: true, yet the dashboard bounced.
--
-- Cause: two policies on admin_users evaluated their own predicate by
-- selecting FROM admin_users, so PostgreSQL aborted every such read with
--   42P17: infinite recursion detected in policy for relation "admin_users"
--
--   "Admin users self + admin list" (SELECT):
--     user_id = auth.uid() OR EXISTS (SELECT 1 FROM admin_users au ...)
--   "SUPER_ADMIN can insert admins" (INSERT):
--     WITH CHECK (EXISTS (SELECT 1 FROM admin_users au ...))
--
-- The dashboard's gate reads admin_users from the BROWSER, so the error
-- surfaced as a null result -> `if (!adminCheck.data) router.push("/admin/login")`.
--
-- Fix: ask a SECURITY DEFINER function instead. Such a function runs as its
-- owner (the table owner, exempt from RLS), so it reads admin_users without
-- re-entering the policy that called it. Intent is unchanged: a signed-in
-- user may read their own row, and any active admin may read the list.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_active_admin(p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE user_id = p_user AND is_active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin(p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE user_id = p_user AND is_active = true AND role = 'SUPER_ADMIN'
  );
$function$;

COMMENT ON FUNCTION public.is_active_admin(uuid) IS
  'RLS-safe check for an active admin; SECURITY DEFINER so admin_users policies can use it without recursion.';
COMMENT ON FUNCTION public.is_super_admin(uuid) IS
  'RLS-safe check for an active SUPER_ADMIN; SECURITY DEFINER so admin_users policies can use it without recursion.';

-- Replace the recursive policies (the two safe auth.uid() = user_id policies
-- are subsumed by the new SELECT policy).
DROP POLICY IF EXISTS "Admin users self + admin list" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can read all admin users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can read own admin record" ON public.admin_users;
DROP POLICY IF EXISTS "SUPER_ADMIN can insert admins" ON public.admin_users;

CREATE POLICY "admin_users_select_self_or_active_admin"
  ON public.admin_users
  FOR SELECT
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND (user_id = auth.uid() OR public.is_active_admin())
  );

CREATE POLICY "admin_users_insert_super_admin"
  ON public.admin_users
  FOR INSERT
  TO public
  WITH CHECK (public.is_super_admin());
