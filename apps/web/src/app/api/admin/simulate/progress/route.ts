/**
 * GET /api/admin/simulate/progress
 *
 * Returns live simulation progress during a running simulation:
 * - Status distribution (how many PUs in each phase)
 * - Total results created
 * - Progress percentage
 * - Scenario and elapsed time
 *
 * Auto-triggers Convex sync when simulation completes.
 * Admin-only — requires authenticated admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, isAdminSuccess } from "@/lib/admin-auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export const dynamic = "force-dynamic";

// Track whether we've already triggered sync for the current simulation
let lastSyncTriggeredAt = 0;
let lastSyncTriggeredStatus = "";

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

    // ── AUTO-SYNC: Trigger Convex sync when simulation completes ──
    let syncTriggered = false;
    let syncStatus = "not_needed";

    if (!isRunning && config.status === "COMPLETED" && convexUrl) {
      const now = Date.now();
      const alreadyTriggered =
        lastSyncTriggeredStatus === config.started_at &&
        now - lastSyncTriggeredAt < 300_000; // 5 min cooldown

      if (!alreadyTriggered) {
        // Fire sync in background (don't await — fire-and-forget)
        lastSyncTriggeredAt = now;
        lastSyncTriggeredStatus = config.started_at || "";

        syncTriggered = true;
        syncStatus = "triggered";

        console.log("[progress] Simulation completed — triggering auto-sync to Convex");

        // Fire the sync endpoint in background (with service role auth)
        fetch(`${request.nextUrl.origin}/api/admin/sync-convex/auto`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
        }).catch((e) => {
          console.error("[progress] Auto-sync trigger failed:", e.message);
        });
      } else {
        syncStatus = "already_triggered";
      }
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
      // Sync fields
      convex_sync: syncStatus,
      sync_triggered: syncTriggered,
    });
  } catch (error: any) {
    console.error("[sim-progress] Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
