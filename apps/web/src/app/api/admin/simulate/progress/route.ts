/**
 * GET /api/admin/simulate/progress
 *
 * Returns live simulation progress during a running simulation:
 * - Status distribution (how many PUs in each phase)
 * - Total results created
 * - Progress percentage
 * - Scenario and elapsed time
 *
 * Admin-only — requires authenticated admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, isAdminSuccess } from "@/lib/admin-auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!isAdminSuccess(auth)) return auth.error;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get simulation config
    const { data: config } = await supabase
      .from("simulation_config")
      .select("*")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single();

    if (!config) {
      return NextResponse.json({ error: "No simulation config found" }, { status: 404 });
    }

    const isRunning = config.status === "RUNNING";

    // Read progress from Supabase RPC
    let totalResults = 0;
    let verifiedResults = 0;
    let totalVotes = 0;
    let totalPUCount = 176846;
    let progressPercent = 0;
    let statusDistribution: Record<string, number> = {};

    const { data: progressStats } = await supabase.rpc("get_simulation_progress_stats");
    if (progressStats) {
      statusDistribution = progressStats.status_distribution || {};
      totalResults = progressStats.total_results || 0;
      verifiedResults = progressStats.verified_results || 0;
      totalVotes = progressStats.total_votes || 0;
      totalPUCount = progressStats.total_polling_units || 176846;
      progressPercent = Math.min(100, Math.round((totalResults / totalPUCount) * 100));
    }

    // Calculate elapsed time
    let elapsedSeconds = 0;
    if (config.started_at) {
      elapsedSeconds = Math.floor(
        (Date.now() - new Date(config.started_at).getTime()) / 1000
      );
    }

    return NextResponse.json({
      is_running: isRunning,
      status: config.status,
      scenario: config.scenario || "landslide",
      election_type: config.election_type || "PRESIDENTIAL",
      progress_percent: progressPercent,
      total_results: totalResults || 0,
      verified_results: verifiedResults || 0,
      total_votes: totalVotes,
      elapsed_seconds: elapsedSeconds,
      status_distribution: statusDistribution,
      started_at: config.started_at,
      last_tick_at: config.last_tick_at,
    });
  } catch (error: any) {
    console.error("[sim-progress] Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
