/**
 * POST /api/admin/check-auth
 * Server-side admin check — verifies Bearer token, not raw user_id.
 * Returns { isAdmin, role } if the authenticated user is an admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    // Require Bearer token — never trust a raw user_id from the client
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ isAdmin: false, error: "No token provided" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ isAdmin: false }, { status: 401 });
    }

    // Check admin_users with the VERIFIED user ID
    const { data, error } = await supabase
      .from("admin_users")
      .select("id, role")
      .eq("user_id", user.id)
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
