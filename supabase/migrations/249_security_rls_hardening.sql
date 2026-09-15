-- ============================================================
-- NEOP 249 — SECURITY RLS HARDENING
--
-- Fix critical vulnerability: the admin_all_canonical RLS policy
-- on canonical_pu_results used a qual that did NOT reference
-- auth.uid(), meaning ANY authenticated user could INSERT/UPDATE/
-- DELETE canonical results. This policy is dropped and replaced
-- by the correct canonical_pu_admin_all policy that properly
-- checks auth.uid() against admin_users.
--
-- Also removes redundant/duplicate policies that were left behind
-- by earlier migration attempts.
-- ============================================================

-- 1. Drop the broken policy (qual did not check auth.uid())
DROP POLICY IF EXISTS admin_all_canonical ON canonical_pu_results;

-- 2. Drop redundant duplicate policies on canonical_party_results
DROP POLICY IF EXISTS canonical_party_admin_only ON canonical_party_results;
DROP POLICY IF EXISTS canonical_party_anon_select ON canonical_party_results;

-- 3. Drop redundant duplicate policy on canonical_pu_results
DROP POLICY IF EXISTS canonical_pu_anon_select ON canonical_pu_results;

-- Verify remaining policies are correct:
-- canonical_pu_admin_all:   qual = au.user_id = auth.uid() AND au.is_active = true ✓
-- anon_read_canonical:      qual = status = 'PUBLISHED' ✓
-- canonical_pu_volunteer_select: qual = volunteer owns source submission ✓
-- admin_state_scoped_policy: qual = admin user + state scope ✓
--
-- canonical_party_admin_all: qual = au.user_id = auth.uid() AND au.is_active = true ✓
-- anon_read_canonical_party: qual = canonical result is PUBLISHED ✓
