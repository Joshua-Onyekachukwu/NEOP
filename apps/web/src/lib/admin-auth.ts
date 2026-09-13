/**
 * Server-side admin authentication helper.
 * Verifies the Bearer token AND checks the admin_users table.
 *
 * Usage in any admin API route:
 *   const authResult = await requireAdmin(request);
 *   if (authResult.error) return authResult.error;  // already a NextResponse with 401/403
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface AdminAuthSuccess {
  userId: string;
  adminRole: string;
}

export interface AdminAuthFailure {
  error: NextResponse;
}

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure;

export function isAdminSuccess(result: AdminAuthResult): result is AdminAuthSuccess {
  return "userId" in result;
}

/** Full admin user data returned by requireAdminWithDetails(). */
export interface AdminUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Verify that the request has a valid Bearer token and the user is an active admin.
 * Returns either { userId, adminRole } or { error: NextResponse }.
 */
export async function requireAdmin(request: NextRequest): Promise<AdminAuthResult> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.substring(7);
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Verify the JWT token
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // Check admin_users table
  const { data: adminUser } = await supabase
    .from("admin_users")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!adminUser) {
    return { error: NextResponse.json({ error: "Not authorized as admin" }, { status: 403 }) };
  }

  return { userId: user.id, adminRole: adminUser.role };
}

// ── requireAdminWithDetails ────────────────────────────────

interface AdminDetailsSuccess {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  admin_user: AdminUser;
  state_id: string | null;
  global: boolean;
}

interface AdminDetailsFailure {
  error: NextResponse;
}

export type AdminDetailsResult = AdminDetailsSuccess | AdminDetailsFailure;

export function isAdminDetailsSuccess(result: AdminDetailsResult): result is AdminDetailsSuccess {
  return "supabase" in result;
}

/**
 * Like requireAdmin(), but also returns the Supabase client and the full admin
 * record (id, email, role) plus state-scoping fields.
 *
 * Returns { supabase, admin_user, state_id, global } or { error: NextResponse }.
 *   - state_id: au.state_id from admin_users (null => global admin)
 *   - global: true iff state_id IS NULL (can see all data)
 */
export async function requireAdminWithDetails(request: NextRequest): Promise<AdminDetailsResult> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.substring(7);
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Verify the JWT token
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // Check admin_users table — return id, role, state_id, created_at + updated_at
  // (last_login_at is not a live column; updated_at is the freshest available marker)
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id, role, state_id, created_at, updated_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!adminRow) {
    return { error: NextResponse.json({ error: "Not authorized as admin" }, { status: 403 }) };
  }

  const row: any = adminRow;
  const sid: string | null = row.state_id ?? null;

  return {
    supabase,
    admin_user: {
      id: row.id,
      email: user.email ?? "",
      role: row.role,
    },
    state_id: sid,
    global: sid === null,
  } as AdminDetailsSuccess;
}
