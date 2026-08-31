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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Verify admin auth
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin role
    const { data: adminUser } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (!adminUser) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    // Get status distribution from polling_units
    const { data: statusRows } = await supabase
      .from("polling_units")
      .select("status");

    const statusDistribution: Record<string, number> = {};
    if (statusRows) {
      for (const row of statusRows) {
        const s = row.status || "NOT_STARTED";
        statusDistribution[s] = (statusDistribution[s] || 0) + 1;
      }
    }

    // Get result counts
    const { count: totalResults } = await supabase
      .from("result_submissions")
      .select("*", { count: "exact", head: true });

    const { count: verifiedResults } = await supabase
      .from("result_submissions")
      .select("*", { count: "exact", head: true })
      .eq("status", "VERIFIED");

    // Get total votes
    const { data: voteSum } = await supabase
      .from("result_submissions")
      .select("total_votes");

    let totalVotes = 0;
    if (voteSum) {
      for (const row of voteSum) {
        totalVotes += row.total_votes || 0;
      }
    }

    // Calculate progress
    const expectedResults = 188042;
    const progressPercent = Math.min(100, Math.round(((totalResults || 0) / expectedResults) * 100));

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
      scenario: config.scenario || "random",
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
