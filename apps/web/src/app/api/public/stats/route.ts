/**
 * GET /api/public/stats
 * Dashboard statistics endpoint.
 * Always queries DB directly (fast aggregation queries).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

// In-memory cache (10s TTL)
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

    // Try fast SQL functions first
    let result: any = null;

    // Attempt 1: Use get_state_breakdown_from_results RPC (fast, aggregated in Postgres)
    try {
      const { data: sbData, error: sbError } = await supabase.rpc(
        "get_state_breakdown_from_results"
      );

      if (!sbError && sbData && sbData.length > 0) {
        // The RPC returns columns: state_name, state_id, total_pus, verified, submitted, disputed, disrupted
        // (from migration 030). Handle both old and new column names.
        let totalCovered = 0;
        let totalVerified = 0;
        for (const row of sbData) {
          totalCovered += Number(row.total_pus || row.total_polling_units || row.covered_polling_units || 0);
          totalVerified += Number(row.verified || row.verified_polling_units || 0);
        }

        result = {
          inec_total_polling_units: 188042,
          total_polling_units: 188042,
          covered_polling_units: totalCovered,
          verified_polling_units: totalVerified,
          active_observers: 0,
          total_incidents: 0,
          incident_counts: {},
          state_breakdown: sbData.map((row: any) => ({
            state_id: row.state_id,
            state_name: row.state_name,
            name: row.state_name,
            state_code: row.state_code || "",
            total_pus: Number(row.total_pus || row.total_polling_units || 0),
            covered: Number(row.total_pus || row.total_polling_units || row.covered_polling_units || 0),
            verified: Number(row.verified || row.verified_polling_units || 0),
            coverage_percent: Number(row.coverage_percent || 0),
            verification_percent: Number(row.verification_percent || 0),
          })),
          coverage_percent:
            188042 > 0
              ? Number(((totalCovered / 188042) * 100).toFixed(1))
              : 0,
          verification_percent:
            188042 > 0
              ? Number(((totalVerified / 188042) * 100).toFixed(1))
              : 0,
          last_updated: new Date().toISOString(),
          disclaimer:
            "These are independently collected field observations and are not official INEC election results.",
        };
      }
    } catch (e) {
      console.error("State breakdown RPC failed, using fallback:", e);
    }

    // Attempt 2: Fallback — direct queries
    if (!result) {
      const [totalPU, submittedRes, verifiedRes] = await Promise.all([
        supabase
          .from("polling_units")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("result_submissions")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("result_submissions")
          .select("*", { count: "exact", head: true })
          .eq("status", "VERIFIED"),
      ]);

      const INEC_TOTAL = 188042;
      const coveredCount = submittedRes.count || 0;
      const verifiedCount = verifiedRes.count || 0;

      // Build state breakdown from result_submissions
      let stateBreakdown: any[] = [];
      if (coveredCount > 0) {
        try {
          const { data: sbData } = await supabase.rpc(
            "get_state_breakdown_from_results"
          );
          if (sbData && sbData.length > 0) {
            stateBreakdown = sbData.map((row: any) => ({
              state_id: row.state_id,
              state_name: row.state_name,
              name: row.state_name,
              state_code: row.state_code,
              total_pus: Number(row.total_polling_units || 0),
              covered: Number(row.covered_polling_units || 0),
              verified: Number(row.verified_polling_units || 0),
              coverage_percent: Number(row.coverage_percent || 0),
              verification_percent: Number(row.verification_percent || 0),
            }));
          }
        } catch (e) {
          console.error("State breakdown fallback failed:", e);
        }
      }

      result = {
        inec_total_polling_units: INEC_TOTAL,
        total_polling_units: INEC_TOTAL,
        covered_polling_units: coveredCount,
        verified_polling_units: verifiedCount,
        active_observers: 0,
        total_incidents: 0,
        incident_counts: {},
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
    }

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
