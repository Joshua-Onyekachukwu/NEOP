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
