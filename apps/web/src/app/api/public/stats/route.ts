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

    // Fallback: minimal query set
    const [totalPU, coveredRes, verifiedRes, activeRes, incidentRes] =
      await Promise.all([
        supabase.from("polling_units").select("*", { count: "exact", head: true }),
        supabase.from("agent_assignments").select("*", { count: "exact", head: true }),
        supabase.from("result_submissions").select("*", { count: "exact", head: true }).eq("status", "VERIFIED"),
        supabase.from("agent_assignments").select("*", { count: "exact", head: true }).eq("status", "CHECKED_IN"),
        supabase.from("incidents").select("*", { count: "exact", head: true }),
      ]);

    const INEC_TOTAL = totalPU.count || 188042;
    const totalCount = INEC_TOTAL;

    const result = {
      inec_total_polling_units: INEC_TOTAL,
      total_polling_units: totalCount,
      covered_polling_units: coveredRes.count || 0,
      verified_polling_units: verifiedRes.count || 0,
      active_observers: activeRes.count || 0,
      total_incidents: incidentRes.count || 0,
      incident_counts: {} as Record<string, number>,
      state_breakdown: [] as any[],
      coverage_percent:
        totalCount > 0
          ? Number((((coveredRes.count || 0) / totalCount) * 100).toFixed(1))
          : 0,
      verification_percent:
        totalCount > 0
          ? Number((((verifiedRes.count || 0) / totalCount) * 100).toFixed(1))
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
