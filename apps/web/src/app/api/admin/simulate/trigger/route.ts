/**
 * POST /api/admin/simulate/trigger
 *
 * Simulation trigger — runs via Convex for dev/simulation phase.
 *
 * Does:
 * 1. Verify Bearer token
 * 2. Fire Convex runSimulation action (fire-and-forget)
 * 3. Return immediately
 *
 * The Convex action processes all PUs in batches and updates
 * sim_config progress. Admin dashboard polls progress endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexDeployKey = process.env.CONVEX_DEPLOY_KEY || "";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scenario = body.scenario || "random";
    const electionType = body.election_type || "PRESIDENTIAL";
    const totalVoters = body.total_voters || 100_000_000;

    // Quick auth check
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log(`[trigger] Admin ${user.email} starting simulation: scenario=${scenario}, type=${electionType}`);

    // Set Supabase status to RUNNING (for backward compat)
    await supabase
      .from("simulation_config")
      .update({
        status: "RUNNING",
        election_type: electionType,
        started_at: new Date().toISOString(),
        last_tick_at: new Date().toISOString(),
        total_results_submitted: 0,
      })
      .eq("id", "00000000-0000-0000-0000-000000000001");

    // Fire Convex simulation — don't await, let it run in background
    if (convexUrl && convexDeployKey) {
      console.log("[trigger] Firing Convex simulation...");
      fetch(`${convexUrl}/api/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${convexDeployKey}`,
        },
        body: JSON.stringify({
          path: "runSimulation:runSimulation",
          args: { scenario, electionType, totalVoters },
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            console.log("[trigger] Convex simulation complete:", JSON.stringify(data).slice(0, 300));
          } else {
            const err = await res.text();
            console.error("[trigger] Convex simulation failed:", err.slice(0, 300));
          }
        })
        .catch((e) => console.error("[trigger] Convex error:", e.message));
    } else {
      // Fallback: use Supabase SQL function if Convex not configured
      console.log("[trigger] Convex not configured, falling back to Supabase SQL");
      const rpcUrl = `${supabaseUrl}/rest/v1/rpc/run_fast_simulation`;
      fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          p_scenario: scenario,
          p_duration_minutes: 5,
          p_total_voters: totalVoters,
          p_election_type: electionType,
        }),
      }).catch((e) => console.error("[trigger] SQL fallback error:", e.message));
    }

    // Return immediately
    return NextResponse.json({
      success: true,
      message: "Simulation started. Monitor progress on admin dashboard.",
      scenario,
      election_type: electionType,
      total_voters: totalVoters,
      engine: convexUrl ? "convex" : "supabase",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to start" },
      { status: 500 }
    );
  }
}
