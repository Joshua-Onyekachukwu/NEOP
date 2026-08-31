/**
 * GET /api/public/stats
 * Calls a single SQL function for all dashboard data.
 * Falls back to client-side queries if RPC is not available.
 * Always enriches with state_breakdown if RPC didn't include it.
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

/**
 * Build state breakdown by querying result_submissions with state joins.
 * Uses batched pagination to handle large datasets without timeout.
 */
async function fetchStateBreakdown(supabase: any): Promise<any[]> {
  const stateMap: Record<string, Record<string, number>> = {};

  // Use a raw SQL approach via RPC if available, otherwise paginate
  // For 188K rows with joins, we batch in groups of 5000
  let offset = 0;
  const pageSize = 5000;
  const maxRows = 200000;
  const startTime = Date.now();
  const maxTime = 20000; // 20s max

  while (offset < maxRows && Date.now() - startTime < maxTime) {
    const { data, error } = await supabase
      .from("result_submissions")
      .select("status, polling_units ( states ( name ) )")
      .range(offset, offset + pageSize - 1);

    if (error || !data || data.length === 0) break;

    for (const r of data) {
      const stateName = (r.polling_units as any)?.states?.name || "Unknown";
      if (!stateMap[stateName]) stateMap[stateName] = {};
      stateMap[stateName][r.status] = (stateMap[stateName][r.status] || 0) + 1;
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return Object.entries(stateMap)
    .map(([name, statuses]) => ({
      state_name: name,
      state_id: name,
      name,
      total_pus: Object.values(statuses).reduce((s, v) => s + v, 0),
      verified: statuses["VERIFIED"] || 0,
      submitted: statuses["RESULT_SUBMITTED"] || 0,
      disputed: statuses["DISPUTED"] || 0,
      disrupted: statuses["DISRUPTED"] || 0,
      statuses,
    }))
    .sort((a, b) => b.total_pus - a.total_pus);
}

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
      // If RPC didn't include state_breakdown, fetch it separately
      if (!rpcData.state_breakdown || rpcData.state_breakdown.length === 0) {
        if ((rpcData.covered_polling_units || 0) > 0) {
          try {
            rpcData.state_breakdown = await fetchStateBreakdown(supabase);
          } catch {
            rpcData.state_breakdown = [];
          }
        } else {
          rpcData.state_breakdown = [];
        }
      }
      cachedStats = rpcData;
      cacheTime = now;
      return NextResponse.json(rpcData);
    }

    // Fallback: efficient query set
    const [totalPU, submittedRes, verifiedRes, activeRes, incidentRes] =
      await Promise.all([
        supabase.from("polling_units").select("*", { count: "exact", head: true }),
        supabase.from("result_submissions").select("*", { count: "exact", head: true }),
        supabase.from("result_submissions").select("*", { count: "exact", head: true }).eq("status", "VERIFIED"),
        supabase.from("agent_assignments").select("*", { count: "exact", head: true }).eq("status", "CHECKED_IN"),
        supabase.from("incidents").select("*", { count: "exact", head: true }),
      ]);

    const INEC_TOTAL = totalPU.count || 188042;
    const coveredCount = submittedRes.count || 0;
    const verifiedCount = verifiedRes.count || 0;

    // Build state breakdown
    let stateBreakdown: any[] = [];
    if (coveredCount > 0) {
      try {
        stateBreakdown = await fetchStateBreakdown(supabase);
      } catch {
        stateBreakdown = [];
      }
    }

    const result = {
      inec_total_polling_units: INEC_TOTAL,
      total_polling_units: INEC_TOTAL,
      covered_polling_units: coveredCount,
      verified_polling_units: verifiedCount,
      active_observers: activeRes.count || 0,
      total_incidents: incidentRes.count || 0,
      incident_counts: {} as Record<string, number>,
      state_breakdown: stateBreakdown,
      coverage_percent:
        INEC_TOTAL > 0
          ? Number(((coveredCount / INEC_TOTAL) * 100).toFixed(1))
          : 0,
      verification_percent:
        INEC_TOTAL > 0
          ? Number(((verifiedCount / INEC_TOTAL) * 100).toFixed(1))
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
