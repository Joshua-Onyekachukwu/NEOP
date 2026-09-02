-- ============================================================
-- Fix Google OAuth: Auto-create user_accounts + Admin setup
-- ============================================================
-- Problem: When users sign in via Google, Supabase creates an auth user
-- but there's no trigger to create the corresponding user_accounts record.
-- This causes the auth callback to fail when checking admin_users.
-- ============================================================

-- 1. Create trigger function to auto-create user_accounts on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_accounts (id, email, full_name, avatar_url, auth_provider)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
    COALESCE(NEW.raw_user_meta_data->>'provider', 'google')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create trigger on auth.users (runs when a user signs up)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 3. Also handle existing users who signed up but don't have user_accounts
-- Run this once to backfill
INSERT INTO public.user_accounts (id, email, full_name, avatar_url, auth_provider)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', ''),
  COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture', ''),
  COALESCE(au.raw_user_meta_data->>'provider', 'google')
FROM auth.users au
LEFT JOIN public.user_accounts ua ON ua.id = au.id
WHERE ua.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 4. Helper function: Add admin by email (run after user signs in)
-- Usage: SELECT add_admin_by_email('onyekachukwujoshua39@gmail.com');
CREATE OR REPLACE FUNCTION public.add_admin_by_email(admin_email TEXT)
RETURNS TEXT AS $$
DECLARE
  v_user_id UUID;
  v_exists BOOLEAN;
BEGIN
  -- Find the user in user_accounts
  SELECT id INTO v_user_id 
  FROM public.user_accounts 
  WHERE email = admin_email;
  
  IF v_user_id IS NULL THEN
    RETURN 'ERROR: User ' || admin_email || ' has not signed in yet. They must sign in with Google first.';
  END IF;
  
  -- Check if already admin
  SELECT EXISTS(
    SELECT 1 FROM public.admin_users 
    WHERE user_id = v_user_id AND is_active = true
  ) INTO v_exists;
  
  IF v_exists THEN
    RETURN 'OK: ' || admin_email || ' is already an admin.';
  END IF;
  
  -- Add as admin
  INSERT INTO public.admin_users (id, user_id, role, is_active)
  VALUES (gen_random_uuid(), v_user_id, 'SUPER_ADMIN', true);
  
  RETURN 'OK: ' || admin_email || ' added as SUPER_ADMIN.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Grant execute permission
GRANT EXECUTE ON FUNCTION public.add_admin_by_email(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_admin_by_email(TEXT) TO authenticated;
