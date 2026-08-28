/**
 * POST /api/admin/check-auth
 * Server-side admin check using service role (bypasses RLS).
 * Used as fallback when client-side RLS blocks admin_users query.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const { user_id } = await request.json();
    if (!user_id) {
      return NextResponse.json({ isAdmin: false }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from("admin_users")
      .select("id, role")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return NextResponse.json({ isAdmin: false });
    }

    return NextResponse.json({ isAdmin: true, role: data.role });
  } catch {
    return NextResponse.json({ isAdmin: false }, { status: 500 });
  }
}
