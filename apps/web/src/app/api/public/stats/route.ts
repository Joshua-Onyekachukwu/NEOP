/**
 * GET /api/public/stats
 * Dashboard statistics endpoint.
 * Strategy: RPC first, then client-side aggregation with correct joins.
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
 * Build state breakdown by querying with explicit FK join.
 * Batches in groups of 5000 to avoid Supabase row limits.
 */
async function fetchStateBreakdown(supabase: any): Promise<any[]> {
  const stateMap: Record<string, Record<string, number>> = {};
  let offset = 0;
  const pageSize = 5000;
  const maxRows = 200000;
  const startTime = Date.now();
  const maxTime = 25000;

  while (offset < maxRows && Date.now() - startTime < maxTime) {
    const { data, error } = await supabase
      .from("result_submissions")
      .select("status, polling_units ( name, state_id )")
      .range(offset, offset + pageSize - 1);

    if (error || !data || data.length === 0) break;

    for (const r of data) {
      const stateId = (r.polling_units as any)?.state_id || "unknown";
      if (!stateMap[stateId]) stateMap[stateId] = {};
      stateMap[stateId][r.status] = (stateMap[stateId][r.status] || 0) + 1;
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  // Now resolve state IDs to names
  const stateIds = Object.keys(stateMap).filter((id) => id !== "unknown");
  const stateNameMap: Record<string, string> = {};

  if (stateIds.length > 0) {
    // Fetch state names in batches
    for (let i = 0; i < stateIds.length; i += 50) {
      const batch = stateIds.slice(i, i + 50);
      const { data: states } = await supabase
        .from("states")
        .select("id, name")
        .in("id", batch);
      for (const s of states || []) {
        stateNameMap[s.id] = s.name;
      }
    }
  }

  return Object.entries(stateMap)
    .map(([id, statuses]) => ({
      state_name: stateNameMap[id] || id,
      state_id: id,
      name: stateNameMap[id] || id,
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

    // Always compute fresh stats from the database (skip potentially stale RPC)
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

    // Build state breakdown — try fast SQL function first, fall back to pagination
    let stateBreakdown: any[] = [];
    if (coveredCount > 0) {
      try {
        const { data: sbRpc, error: sbErr } = await supabase.rpc("get_state_breakdown_from_results");
        if (!sbErr && sbRpc && sbRpc.length > 0) {
          stateBreakdown = sbRpc;
        } else {
          // Fallback to client-side pagination
          stateBreakdown = await fetchStateBreakdown(supabase);
        }
      } catch (e) {
        console.error("State breakdown fetch failed:", e);
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
