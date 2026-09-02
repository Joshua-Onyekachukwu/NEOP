/**
 * GET /api/admin/audit
 * List audit trail entries for admin oversight
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, isAdminSuccess } from "@/lib/admin-auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!isAdminSuccess(auth)) return auth.error;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
    const action = searchParams.get("action");

    let query = supabase
      .from("audit_log")
      .select("id, actor_id, actor_type, action, resource_type, resource_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (action) {
      query = query.eq("action", action);
    }

    const { data: logs, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ logs: logs || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
