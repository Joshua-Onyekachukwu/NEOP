/**
 * PUT /api/admin/config
 * Updates the election type in simulation_config.
 * Admin-only endpoint — requires authenticated admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, isAdminSuccess } from "@/lib/admin-auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    // Verify admin auth
    const auth = await requireAdmin(request);
    if (!isAdminSuccess(auth)) return auth.error;

    const body = await request.json();
    const { election_type } = body;

    if (!election_type || !["PRESIDENTIAL", "GOVERNORSHIP"].includes(election_type)) {
      return NextResponse.json(
        { error: "Invalid election_type. Must be PRESIDENTIAL or GOVERNORSHIP" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update existing config or create new
    const { data: existing } = await supabase
      .from("simulation_config")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      await supabase
        .from("simulation_config")
        .update({ election_type, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase.from("simulation_config").insert({ election_type });
    }

    return NextResponse.json({ success: true, election_type });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
