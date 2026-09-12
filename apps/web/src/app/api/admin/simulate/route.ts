/**
 * POST /api/admin/simulate
 *
 * Starts the election simulation via SQL function.
 * Uses fire-and-forget: kicks off the SQL function in the background,
 * returns immediately so Vercel's timeout doesn't kill it.
 * The SQL function runs entirely inside Postgres (not on Vercel).
 *
 * Body: {
 *   scenario?: "landslide" | "close" | "sweep" | "random",
 *   duration_minutes?: number,
 *   total_voters?: number,
 *   election_type?: "PRESIDENTIAL" | "GOVERNORSHIP",
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, adminUser } = auth;

    const body = await request.json().catch(() => ({}));
    const {
      scenario: scenarioKey,
      duration_minutes,
      total_voters,
      election_type,
    } = body;

    // Check if simulation is already running
    const { data: config } = await supabase
      .from("simulation_config")
      .select("status")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single();

    if (config?.status === "RUNNING") {
      return NextResponse.json(
        { error: "Simulation already running. Wait for it to complete." },
        { status: 409 }
      );
    }

    console.log(
      `[sim] Admin ${adminUser.email} starting simulation: scenario=${scenarioKey || "random"}, voters=${total_voters || 100_000_000}, type=${election_type || "PRESIDENTIAL"}`
    );

    // Set status to RUNNING immediately so the UI shows the progress bar
    await supabase
      .from("simulation_config")
      .update({
        status: "RUNNING",
        started_at: new Date().toISOString(),
        last_tick_at: new Date().toISOString(),
        total_results_submitted: 0,
      })
      .eq("id", "00000000-0000-0000-0000-000000000001");

    // Fire-and-forget: start the SQL function in the background
    // The function runs entirely inside Postgres, not on Vercel
    // We use a simple HTTP call to Supabase's REST API to kick it off
    const rpcUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/run_fast_simulation`;
    const rpcBody = {
      p_scenario: scenarioKey || "random",
      p_duration_minutes: duration_minutes || 5,
      p_total_voters: total_voters || 100_000_000,
      p_election_type: election_type || "PRESIDENTIAL",
    };

    // Don't await — fire and forget
    fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
      },
      body: JSON.stringify(rpcBody),
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          console.log("[sim] Simulation complete:", JSON.stringify(data).slice(0, 500));
        } else {
          const err = await res.text();
          console.error("[sim] Simulation failed:", err);
          // Reset status on failure
          await supabase
            .from("simulation_config")
            .update({ status: "COMPLETED" })
            .eq("id", "00000000-0000-0000-0000-000000000001");
        }
      })
      .catch((e) => {
        console.error("[sim] Background simulation error:", e);
      });

    // Return immediately — the simulation runs in the background
    return NextResponse.json({
      success: true,
      message: "Simulation started. Check the admin dashboard for progress.",
      scenario: scenarioKey || "random",
      election_type: election_type || "PRESIDENTIAL",
      total_voters: total_voters || 100_000_000,
    });
  } catch (error: any) {
    console.error("[sim] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to start simulation" },
      { status: 500 }
    );
  }
}
