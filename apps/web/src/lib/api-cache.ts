/**
 * Shared API caching layer for public endpoints.
 *
 * Uses Next.js `unstable_cache` (stable in Next.js 15) to persist results
 * across requests on the same serverless instance. This means the DB is NOT
 * hit on every request — only once per cache TTL.
 *
 * Combined with CDN s-maxage from the middleware, this gives us:
 *   CDN cache (edge) → Serverless cache (unstable_cache) → Database
 *
 * For 100M+ users:
 *   - CDN absorbs 90%+ of read traffic (served from edge, never hits serverless)
 *   - unstable_cache absorbs remaining cold-start hits
 *   - Database only gets hit when both caches expire
 */

import { unstable_cache, revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

// ─────────────────────────────────────────────────────
// Cached queries (unstable_cache = serverless-level cache)
// ─────────────────────────────────────────────────────

/**
 * Cached stats — refreshed every 30 seconds on the serverless instance.
 * CDN serves from edge cache for up to 30s, then stale for 120s.
 */
export const getCachedStats = unstable_cache(
  async () => {
    const supabase = getServiceClient();

    // Try fast SQL function first
    try {
      const { data: sbData, error: sbError } = await supabase.rpc(
        "get_state_breakdown_from_results"
      );

      if (!sbError && sbData && sbData.length > 0) {
        let totalCovered = 0;
        let totalVerified = 0;
        for (const row of sbData) {
          totalCovered += Number(row.total_pus || row.total_polling_units || row.covered_polling_units || 0);
          totalVerified += Number(row.verified || row.verified_polling_units || 0);
        }

        return {
          inec_total_polling_units: 188042,
          total_polling_units: 188042,
          covered_polling_units: totalCovered,
          verified_polling_units: totalVerified,
          state_breakdown: sbData.map((row: any) => ({
            state_id: row.state_id,
            state_name: row.state_name,
            name: row.state_name,
            total_pus: Number(row.total_pus || row.total_polling_units || 0),
            covered: Number(row.total_pus || row.total_polling_units || row.covered_polling_units || 0),
            verified: Number(row.verified || row.verified_polling_units || 0),
            coverage_percent: Number(row.coverage_percent || 0),
            verification_percent: Number(row.verification_percent || 0),
          })),
          coverage_percent: 188042 > 0 ? Number(((totalCovered / 188042) * 100).toFixed(1)) : 0,
          verification_percent: 188042 > 0 ? Number(((totalVerified / 188042) * 100).toFixed(1)) : 0,
          last_updated: new Date().toISOString(),
          disclaimer: "These are independently collected field observations and are not official INEC election results.",
        };
      }
    } catch (e) {
      console.error("Cached stats RPC failed:", e);
    }

    // Fallback: direct count queries
    const [totalPU, submittedRes, verifiedRes] = await Promise.all([
      getServiceClient().from("polling_units").select("*", { count: "exact", head: true }),
      getServiceClient().from("result_submissions").select("*", { count: "exact", head: true }),
      getServiceClient().from("result_submissions").select("*", { count: "exact", head: true }).eq("status", "VERIFIED"),
    ]);

    return {
      inec_total_polling_units: 188042,
      total_polling_units: 188042,
      covered_polling_units: submittedRes.count || 0,
      verified_polling_units: verifiedRes.count || 0,
      state_breakdown: [],
      coverage_percent: 188042 > 0 ? Number((((submittedRes.count || 0) / 188042) * 100).toFixed(1)) : 0,
      verification_percent: 188042 > 0 ? Number((((verifiedRes.count || 0) / 188042) * 100).toFixed(1)) : 0,
      last_updated: new Date().toISOString(),
      disclaimer: "These are independently collected field observations and are not official INEC election results.",
    };
  },
  ["stats-v1"],
  {
    revalidate: 30,        // Serverless-level cache TTL (seconds)
    tags: ["stats"],       // Can be invalidated via revalidateTag("stats")
  }
);

/**
 * Cached party results — refreshed every 30 seconds.
 */
export const getCachedPartyResults = unstable_cache(
  async () => {
    const supabase = getServiceClient();
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_party_totals");

    if (!rpcError && rpcData && rpcData.length > 0) {
      const deduped: Record<string, any> = {};
      for (const p of rpcData) {
        const abbr = p.party_abbreviation;
        if (!deduped[abbr] || Number(p.total_votes) > Number(deduped[abbr].total_votes)) {
          deduped[abbr] = p;
        }
      }
      const parties = Object.values(deduped).sort(
        (a, b) => Number(b.total_votes) - Number(a.total_votes)
      );
      const grandTotal = parties.reduce(
        (s: number, r: any) => s + Number(r.total_votes), 0
      );

      return {
        parties: parties.map((p: any) => ({
          name: p.party_name,
          abbreviation: p.party_abbreviation,
          color: p.party_color,
          total_votes: Number(p.total_votes),
          percentage: grandTotal > 0 ? Number(((Number(p.total_votes) / grandTotal) * 100).toFixed(1)) : 0,
        })),
        grand_total: grandTotal,
        last_updated: new Date().toISOString(),
      };
    }

    // Fallback: client-side aggregation
    const { data: allParties } = await supabase
      .from("parties")
      .select("id, official_name, abbreviation, color");

    const partyMap: Record<string, { name: string; abbreviation: string; color: string; total_votes: number }> = {};
    const idToAbbr: Record<string, string> = {};
    const seen = new Set<string>();

    for (const p of allParties || []) {
      if (!seen.has(p.abbreviation)) {
        seen.add(p.abbreviation);
        partyMap[p.abbreviation] = {
          name: p.official_name,
          abbreviation: p.abbreviation,
          color: p.color || "#6B7280",
          total_votes: 0,
        };
      }
      idToAbbr[p.id] = p.abbreviation;
    }

    let offset = 0;
    const pageSize = 10000;
    while (offset < 500000) {
      const { data: batch } = await supabase
        .from("party_results")
        .select("votes, party_id")
        .range(offset, offset + pageSize - 1);
      if (!batch || batch.length === 0) break;
      for (const pr of batch) {
        const abbr = idToAbbr[pr.party_id];
        if (abbr && partyMap[abbr]) partyMap[abbr].total_votes += pr.votes;
      }
      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    const sorted = Object.values(partyMap).sort((a, b) => b.total_votes - a.total_votes);
    const grandTotal = sorted.reduce((sum, p) => sum + p.total_votes, 0);

    return {
      parties: sorted.map((p) => ({
        ...p,
        percentage: grandTotal > 0 ? Number(((p.total_votes / grandTotal) * 100).toFixed(1)) : 0,
      })),
      grand_total: grandTotal,
      last_updated: new Date().toISOString(),
    };
  },
  ["party-results-v1"],
  {
    revalidate: 30,
    tags: ["party-results"],
  }
);

/**
 * Cached config — refreshed every 5 minutes.
 */
export const getCachedConfig = unstable_cache(
  async () => {
    const supabase = getServiceClient();
    const { data } = await supabase
      .from("simulation_config")
      .select("*")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single();

    const isRunning = data?.status === "RUNNING";

    return {
      election_type: data?.election_type || "PRESIDENTIAL",
      title: data?.election_type === "GOVERNORSHIP"
        ? "Governorship & State Assembly Election"
        : "Presidential & National Assembly Election",
      subtitle: data?.election_type === "GOVERNORSHIP"
        ? "6 February 2027"
        : "16 January 2027",
      date: data?.election_type === "GOVERNORSHIP" ? "2027-02-06" : "2027-01-16",
      total_polling_units: 188042,
      display_status: isRunning ? "SIMULATION" : "LIVE",
      status_label: isRunning ? "Simulation Running" : "Live Election Data",
      total_results: data?.total_results_submitted || 0,
    };
  },
  ["config-v1"],
  {
    revalidate: 300, // 5 minutes
    tags: ["config"],
  }
);

/**
 * Invalidate all caches after a simulation completes.
 * Call this from the simulate API after run_fast_simulation succeeds.
 */
export function invalidateAllCaches() {
  revalidateTag("stats");
  revalidateTag("party-results");
  revalidateTag("config");
}
