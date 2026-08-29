/**
 * POST /api/admin/simulate/tick
 *
 * Executes one simulation tick via SQL function.
 * Called by admin dashboard every 5 seconds while simulation is running.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if simulation is running
    const { data: config } = await supabase
      .from("simulation_config")
      .select("status")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single();

    if (!config || config.status !== "RUNNING") {
      return NextResponse.json({ ticked: false, reason: "No active simulation" });
    }

    // Call the SQL tick function
    const { data, error } = await supabase.rpc("simulation_tick");

    if (error) {
      console.error("[tick] SQL error:", error);
      return NextResponse.json({ ticked: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[tick] Error:", error);
    return NextResponse.json({ ticked: false, error: "Internal server error" }, { status: 500 });
  }
}
