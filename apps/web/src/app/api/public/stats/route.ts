/**
 * GET /api/public/stats
 * Calls a single SQL function for all dashboard data.
 * Falls back to client-side queries if RPC is not available.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

// In-memory cache
let cachedStats: any = null;
let cacheTime = 0;
const CACHE_TTL = 10_000;

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    if (cachedStats && now - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedStats);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try fast SQL function first
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_fast_stats");

    if (!rpcError && rpcData) {
      cachedStats = rpcData;
      cacheTime = now;
      return NextResponse.json(rpcData);
    }

    // Fallback: efficient query set
    const [totalPU, submittedRes, verifiedRes, activeRes, incidentRes, statusCounts] =
      await Promise.all([
        supabase.from("polling_units").select("*", { count: "exact", head: true }),
        // Count all result_submissions (this is the real "covered" count)
        supabase.from("result_submissions").select("*", { count: "exact", head: true }),
        supabase.from("result_submissions").select("*", { count: "exact", head: true }).eq("status", "VERIFIED"),
        supabase.from("agent_assignments").select("*", { count: "exact", head: true }).eq("status", "CHECKED_IN"),
        supabase.from("incidents").select("*", { count: "exact", head: true }),
        // Status distribution for simulation indicator
        supabase.from("result_submissions").select("status"),
      ]);

    // Build status counts
    const statusDist: Record<string, number> = {};
    for (const r of statusCounts.data || []) {
      statusDist[r.status] = (statusDist[r.status] || 0) + 1;
    }

    const INEC_TOTAL = totalPU.count || 188042;
    const totalCount = INEC_TOTAL;
    const coveredCount = submittedRes.count || 0;
    const verifiedCount = verifiedRes.count || 0;

    // Build state breakdown from status_counts data (group by state)
    let stateBreakdown: any[] = [];
    if (coveredCount > 0 && coveredCount <= 50000) {
      // For smaller datasets, fetch with joins
      const { data: withPU } = await supabase
        .from("result_submissions")
        .select(`status, polling_units ( states ( name ) )`)
        .limit(50000);
      const stateMap: Record<string, Record<string, number>> = {};
      for (const r of withPU || []) {
        const stateName = (r.polling_units as any)?.states?.name || "Unknown";
        if (!stateMap[stateName]) stateMap[stateName] = {};
        stateMap[stateName][r.status] = (stateMap[stateName][r.status] || 0) + 1;
      }
      stateBreakdown = Object.entries(stateMap).map(([name, statuses]) => ({
        state_name: name,
        state_id: name,
        name,
        total_pus: Object.values(statuses).reduce((s, v) => s + v, 0),
        verified: statuses["VERIFIED"] || 0,
        submitted: statuses["RESULT_SUBMITTED"] || 0,
        disputed: statuses["DISPUTED"] || 0,
        disrupted: statuses["DISRUPTED"] || 0,
        statuses,
      })).sort((a, b) => b.total_pus - a.total_pus);
    }

    const result = {
      inec_total_polling_units: INEC_TOTAL,
      total_polling_units: totalCount,
      covered_polling_units: coveredCount,
      verified_polling_units: verifiedCount,
      active_observers: activeRes.count || 0,
      total_incidents: incidentRes.count || 0,
      incident_counts: {} as Record<string, number>,
      status_distribution: statusDist,
      state_breakdown: stateBreakdown,
      coverage_percent:
        totalCount > 0
          ? Number(((coveredCount / totalCount) * 100).toFixed(1))
          : 0,
      verification_percent:
        totalCount > 0
          ? Number(((verifiedCount / totalCount) * 100).toFixed(1))
          : 0,
      last_updated: new Date().toISOString(),
      disclaimer:
        "These are independently collected field observations and are not official INEC election results.",
    };

    cachedStats = result;
    cacheTime = now;

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in public stats API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
