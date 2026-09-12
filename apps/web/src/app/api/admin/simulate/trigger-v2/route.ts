/**
 * POST /api/admin/simulate/trigger-v2
 *
 * Triggers the Supabase-based simulation engine.
 * Calls run_sim_upgraded() SQL function directly via Supabase RPC.
 *
 * Fire-and-forget: returns immediately while simulation runs on Supabase.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;

    const body = await request.json().catch(() => ({}));
    const {
      scenario = "landslide",
      target_voters = 20_000_000,
    } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(
      `[trigger-v2] Admin ${auth.adminUser.email} starting: scenario=${scenario}, voters=${target_voters}`
    );

    // Call the Supabase SQL function (fire-and-forget)
    console.log("[trigger-v2] Calling run_sim_upgraded...");
    
    Promise.resolve(supabase.rpc("run_sim_upgraded", {
      p_scenario: scenario,
      p_total_voters: target_voters,
    })).then(({ data, error }) => {
      if (error) {
        console.error("[trigger-v2] Simulation failed:", error.message);
      } else {
        console.log("[trigger-v2] Simulation complete:", JSON.stringify(data).slice(0, 500));
      }
    }).catch((e: any) => console.error("[trigger-v2] Error:", e.message));

    return NextResponse.json({
      success: true,
      message: "Simulation started via Supabase. Monitor progress on admin dashboard.",
      config: {
        scenario,
        target_voters,
        engine: "supabase",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to start simulation" },
      { status: 500 }
    );
  }
}
