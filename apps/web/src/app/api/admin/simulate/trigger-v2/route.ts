/**
 * POST /api/admin/simulate/trigger-v2
 *
 * Triggers the new Convex simulation engine v2.
 * Passes Supabase credentials to the Convex action so it can query
 * the real PU hierarchy directly.
 *
 * Fire-and-forget: returns immediately while simulation runs on Convex.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexDeployKey = process.env.CONVEX_DEPLOY_KEY || "";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;

    const body = await request.json().catch(() => ({}));
    const {
      scenario = "random",
      election_type = "PRESIDENTIAL",
      target_voters = 100_000_000,
      random_seed = Date.now(),
      batch_size = 2000,
      pu_failure_rate = 0.03,
      turnout_min = 0.3,
      turnout_max = 0.8,
      geographic_scope = "national",
      simulation_speed = 1,
    } = body;

    if (!convexUrl || !convexDeployKey) {
      return NextResponse.json(
        { error: "Convex not configured. Set NEXT_PUBLIC_CONVEX_URL and CONVEX_DEPLOY_KEY." },
        { status: 500 }
      );
    }

    console.log(
      `[trigger-v2] Admin ${auth.adminUser.email} starting: scenario=${scenario}, voters=${target_voters}, seed=${random_seed}`
    );

    // Clear old data first
    console.log("[trigger-v2] Clearing old simulation data...");
    try {
      const clearRes = await fetch(`${convexUrl}/api/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Convex ${convexDeployKey}`,
        },
        body: JSON.stringify({ path: "clearData:clearAllData", args: {} }),
        signal: AbortSignal.timeout(120_000),
      });
      if (clearRes.ok) {
        const clearData = await clearRes.json();
        console.log("[trigger-v2] Clear complete:", JSON.stringify(clearData).slice(0, 200));
      } else {
        const clearErr = await clearRes.text();
        console.log("[trigger-v2] Clear failed (continuing anyway):", clearErr.slice(0, 200));
      }
    } catch (e: any) {
      console.log("[trigger-v2] Clear error (continuing):", e.message);
    }

    // Fire simulation action (fire-and-forget)
    console.log("[trigger-v2] Firing simulation...");
    fetch(`${convexUrl}/api/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Convex ${convexDeployKey}`,
      },
      body: JSON.stringify({
        path: "simEngineV2:runSimulationV2",
        args: {
          config: {
            scenario,
            election_type,
            target_voters,
            random_seed,
            batch_size,
            pu_failure_rate,
            turnout_min,
            turnout_max,
            geographic_scope,
            simulation_speed,
          },
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          console.log("[trigger-v2] Simulation complete:", JSON.stringify(data).slice(0, 500));
        } else {
          const err = await res.text();
          console.error("[trigger-v2] Simulation failed:", err.slice(0, 500));
        }
      })
      .catch((e) => console.error("[trigger-v2] Error:", e.message));

    return NextResponse.json({
      success: true,
      message: "Simulation started. Monitor progress on admin dashboard.",
      config: {
        scenario,
        election_type,
        target_voters,
        random_seed,
        batch_size,
        pu_failure_rate,
        turnout_min,
        turnout_max,
        geographic_scope,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to start simulation" },
      { status: 500 }
    );
  }
}
