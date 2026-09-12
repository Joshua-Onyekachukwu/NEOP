/**
 * GET /api/admin/volunteers
 * List all volunteers with user info for admin management
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

    const { data: volunteers, error } = await supabase
      .from("volunteers")
      .select(`
        id, status, phone, verification_status, training_status,
        training_completed_at, created_at,
        user_accounts ( id, email, full_name, avatar_url ),
        states ( name ),
        lgas ( name )
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ volunteers: volunteers || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
