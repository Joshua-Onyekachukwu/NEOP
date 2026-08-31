/**
 * POST /api/admin/simulate/trigger
 *
 * Ultra-lean simulation trigger — minimal work, fast response.
 * Designed to complete within Vercel Hobby's 10-second timeout.
 *
 * Does only:
 * 1. Verify Bearer token (fast)
 * 2. Set simulation_config to RUNNING
 * 3. Fire Supabase RPC (no await)
 * 4. Return immediately
 *
 * The SQL function runs entirely inside Postgres.
 * Admin dashboard polls /api/admin/simulate/progress for updates.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scenario = body.scenario || "random";
    const electionType = body.election_type || "PRESIDENTIAL";
    const totalVoters = body.total_voters || 100_000_000;
    const duration = body.duration_minutes || 5;

    // Quick auth check — just verify the token is valid
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify JWT is valid
    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Set status to RUNNING immediately
    const { error: updateError } = await supabase
      .from("simulation_config")
      .update({
        status: "RUNNING",
        election_type: electionType,
        started_at: new Date().toISOString(),
        last_tick_at: new Date().toISOString(),
        total_results_submitted: 0,
      })
      .eq("id", "00000000-0000-0000-0000-000000000001");

    if (updateError) {
      console.error("[trigger] Config update error:", updateError);
    }

    // Fire the SQL function — don't await, let it run in Postgres
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
        p_duration_minutes: duration,
        p_total_voters: totalVoters,
        p_election_type: electionType,
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          console.log("[trigger] Simulation complete:", JSON.stringify(data).slice(0, 300));
        } else {
          const err = await res.text();
          console.error("[trigger] Simulation failed:", err.slice(0, 300));
          // Reset status on failure
          await supabase
            .from("simulation_config")
            .update({ status: "COMPLETED", total_results_submitted: 0 })
            .eq("id", "00000000-0000-0000-0000-000000000001");
        }
      })
      .catch((e) => console.error("[trigger] Background error:", e.message));

    // Return immediately — under 1 second
    return NextResponse.json({
      success: true,
      message: "Simulation started in background. Monitor progress on admin dashboard.",
      scenario,
      election_type: electionType,
      total_voters: totalVoters,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to start" },
      { status: 500 }
    );
  }
}
