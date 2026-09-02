/**
 * POST /api/admin/simulate/trigger
 *
 * Simulation trigger — runs via Supabase SQL function.
 *
 * Does:
 * 1. Verify Bearer token
 * 2. Call Supabase run_sim_upgraded() function
 * 3. Return immediately
 *
 * The Supabase function processes all PUs in a single transaction.
 * Admin dashboard polls progress endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scenario = body.scenario || "landslide";
    const totalVoters = body.total_voters || 20_000_000;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[trigger] Starting simulation: scenario=${scenario}, voters=${totalVoters}`);

    // Call the Supabase SQL function (fire-and-forget)
    Promise.resolve(supabase.rpc("run_sim_upgraded", {
      p_scenario: scenario,
      p_total_voters: totalVoters,
    })).then(({ data, error }) => {
      if (error) {
        console.error("[trigger] Simulation failed:", error.message);
      } else {
        console.log("[trigger] Simulation complete:", JSON.stringify(data).slice(0, 500));
      }
    }).catch((e: any) => console.error("[trigger] Error:", e.message));

    return NextResponse.json({
      success: true,
      message: "Simulation started via Supabase",
      engine: "supabase",
    });
  } catch (error: any) {
    console.error("[trigger] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to start simulation" },
      { status: 500 }
    );
  }
}
