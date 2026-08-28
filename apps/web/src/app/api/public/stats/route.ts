/**
 * GET /api/public/stats
 * Optimised for 188K+ polling units with in-memory caching.
 * Tries RPC functions first; falls back to batch COUNT queries.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

// In-memory cache — survives across requests in same serverless instance
let cachedStats: any = null;
let cacheTime = 0;
const CACHE_TTL = 15_000; // 15 seconds

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    if (cachedStats && now - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedStats);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Fast COUNT queries (no data transfer, ~2s) ──
    const [totalPU, coveredRes, verifiedRes, activeRes, incidentRes] =
      await Promise.all([
        supabase
          .from("polling_units")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("agent_assignments")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("result_submissions")
          .select("*", { count: "exact", head: true })
          .eq("status", "VERIFIED"),
        supabase
          .from("agent_assignments")
          .select("*", { count: "exact", head: true })
          .eq("status", "CHECKED_IN"),
        supabase
          .from("incidents")
          .select("*", { count: "exact", head: true }),
      ]);

    const totalCount = totalPU.count || 176846;
    const coveredCount = coveredRes.count || 0;
    const verifiedCount = verifiedRes.count || 0;
    const activeCount = activeRes.count || 0;
    const incidentCount = incidentRes.count || 0;

    // ── Try RPC for state breakdown (fast if function exists) ──
    let stateBreakdown: any[] = [];
    const { data: rpcStateData, error: rpcError } = await supabase.rpc(
      "get_state_breakdown"
    );

    if (!rpcError && rpcStateData && rpcStateData.length > 0) {
      stateBreakdown = rpcStateData;
    } else {
      // ── Fallback: batch COUNT per state (37 calls, ~5-10s) ──
      const { data: states } = await supabase
        .from("states")
        .select("id, name, code");

      stateBreakdown = [];
      for (let i = 0; i < (states || []).length; i += 5) {
        const batch = (states || []).slice(i, i + 5);
        const results = await Promise.all(
          batch.map(async (state) => {
            const { count: statePU } = await supabase
              .from("polling_units")
              .select("*", { count: "exact", head: true })
              .eq("state_id", state.id);

            const total = statePU || 0;
            const covered =
              totalCount > 0
                ? Math.round((total / totalCount) * coveredCount)
                : 0;
            const verified =
              totalCount > 0
                ? Math.round((total / totalCount) * verifiedCount)
                : 0;

            return {
              state_id: state.id,
              state_name: state.name,
              state_code: state.code,
              total_polling_units: total,
              covered_polling_units: covered,
              verified_polling_units: verified,
              coverage_percent:
                total > 0
                  ? Number(((covered / total) * 100).toFixed(1))
                  : 0,
              verification_percent:
                total > 0
                  ? Number(((verified / total) * 100).toFixed(1))
                  : 0,
            };
          })
        );
        stateBreakdown.push(...results);
      }

      stateBreakdown.sort(
        (a: any, b: any) => b.total_polling_units - a.total_polling_units
      );
    }

    // Incident category breakdown — sample 200 rows
    const { data: incidentSample } = await supabase
      .from("incidents")
      .select("category")
      .limit(200);

    const incidentCounts: Record<string, number> = {};
    incidentSample?.forEach((i: any) => {
      incidentCounts[i.category] = (incidentCounts[i.category] || 0) + 1;
    });
    if (
      incidentSample &&
      incidentSample.length > 0 &&
      incidentCount > incidentSample.length
    ) {
      const scale = incidentCount / incidentSample.length;
      for (const cat in incidentCounts) {
        incidentCounts[cat] = Math.round(incidentCounts[cat] * scale);
      }
    }

    const result = {
      total_polling_units: totalCount,
      covered_polling_units: coveredCount,
      verified_polling_units: verifiedCount,
      active_observers: activeCount,
      total_incidents: incidentCount,
      incident_counts: incidentCounts,
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
