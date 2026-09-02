/**
 * Shared API caching layer for public endpoints.
 *
 * Uses Next.js `unstable_cache` to persist results across requests on the
 * same serverless instance. Combined with CDN s-maxage from middleware:
 *
 *   CDN cache (edge) → Serverless cache (unstable_cache) → Database
 *
 * Falls back to Convex when Supabase is unreachable or slow. This ensures
 * the live dashboard always shows data even during database outages.
 *
 * CRITICAL: Supabase calls have a 4-second timeout so they never eat the
 * full Vercel 10-second function budget, leaving time for the Convex fallback.
 */

import { unstable_cache, revalidateTag } from "next/cache";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  getConvexPartyTotals,
  getConvexGlobalStats,
  getConvexStateBreakdown,
  getConvexSimConfig,
} from "./convex-http";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Supabase timeout — must be under 8s (Vercel Hobby limit is 10s) */
const SB_TIMEOUT_MS = 4_000;

function getServiceClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Race a promise against a timeout. Returns null on timeout or error.
 * This prevents Supabase hangs from eating the full Vercel function budget.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        console.warn(`[api-cache] ${label} timed out after ${ms}ms`);
        resolve(null);
      }, ms)
    ),
  ]).catch((e) => {
    console.warn(`[api-cache] ${label} error:`, e?.message || e);
    return null;
  });
}

// ─────────────────────────────────────────────────────
// Cached stats — refreshed every 30 seconds
// ─────────────────────────────────────────────────────

export const getCachedStats = unstable_cache(
  async () => {
    // ── Try Supabase with timeout ──
    const supabase = getServiceClient();

    // Query PU count once, reuse throughout
    let totalPUCount = 176846; // INEC 2026 official count fallback
    try {
      const { data: fastStats } = await supabase.rpc("get_fast_stats");
      if (fastStats?.total_polling_units) {
        totalPUCount = Number(fastStats.total_polling_units);
      }
    } catch {}

    const sbResult = await withTimeout(
      (async () => {
        const { data, error } = await supabase.rpc("get_state_breakdown_from_results");
        if (error) return null;

        const breakdown = data || [];
        let totalCovered = 0;
        let totalVerified = 0;
        for (const row of breakdown) {
          totalCovered += Number(row.total_pus || row.total_polling_units || row.covered_polling_units || 0);
          totalVerified += Number(row.verified || row.verified_polling_units || 0);
        }

        return {
          inec_total_polling_units: totalPUCount,
          total_polling_units: totalPUCount,
          covered_polling_units: totalCovered,
          verified_polling_units: totalVerified,
          state_breakdown: breakdown.map((row: any) => ({
            state_id: row.state_id,
            state_name: row.state_name,
            name: row.state_name,
            total_pus: Number(row.total_pus || row.total_polling_units || 0),
            covered: Number(row.total_pus || row.total_polling_units || row.covered_polling_units || 0),
            verified: Number(row.verified || row.verified_polling_units || 0),
            coverage_percent: Number(row.coverage_percent || 0),
            verification_percent: Number(row.verification_percent || 0),
          })),
          coverage_percent: totalPUCount > 0 ? Number(((totalCovered / totalPUCount) * 100).toFixed(1)) : 0,
          verification_percent: totalPUCount > 0 ? Number(((totalVerified / totalPUCount) * 100).toFixed(1)) : 0,
          last_updated: new Date().toISOString(),
          disclaimer: "These are independently collected field observations and are not official INEC election results.",
          source: "supabase" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:stats"
    );

    if (sbResult) return sbResult;

    // ── Fallback: Convex (also with timeout) ──
    const convexResult = await withTimeout(
      (async () => {
        const convexStats = await getConvexGlobalStats();
        const convexStates = await getConvexStateBreakdown();

        if (!convexStats || convexStats.covered_polling_units === 0) return null;

        return {
          inec_total_polling_units: totalPUCount,
          total_polling_units: convexStats.total_polling_units,
          covered_polling_units: convexStats.covered_polling_units,
          verified_polling_units: convexStats.verified_polling_units,
          state_breakdown: (convexStates || []).map((s: any) => ({
            state_id: s.state_id,
            state_name: s.state_name,
            name: s.state_name,
            total_pus: s.total_pus,
            covered: s.covered_pus,
            verified: s.verified_pus,
            coverage_percent: s.total_pus > 0 ? Number(((s.covered_pus / s.total_pus) * 100).toFixed(1)) : 0,
            verification_percent: s.total_pus > 0 ? Number(((s.verified_pus / s.total_pus) * 100).toFixed(1)) : 0,
          })),
          coverage_percent: convexStats.coverage_percent,
          verification_percent: convexStats.verification_percent,
          last_updated: new Date().toISOString(),
          disclaimer: "These are independently collected field observations and are not official INEC election results.",
          source: "convex" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "convex:stats"
    );

    if (convexResult) return convexResult;

    // ── Last resort ──
    return {
      inec_total_polling_units: totalPUCount,
      total_polling_units: totalPUCount,
      covered_polling_units: 0,
      verified_polling_units: 0,
      state_breakdown: [],
      coverage_percent: 0,
      verification_percent: 0,
      last_updated: new Date().toISOString(),
      disclaimer: "These are independently collected field observations and are not official INEC election results.",
      source: "empty" as const,
    };
  },
  ["stats-v5"],
  {
    revalidate: 30,
    tags: ["stats"],
  }
);

// ─────────────────────────────────────────────────────
// Cached party results — refreshed every 30 seconds
// ─────────────────────────────────────────────────────

export const getCachedPartyResults = unstable_cache(
  async () => {
    // ── Try Supabase with timeout ──
    const supabase = getServiceClient();

    const sbResult = await withTimeout(
      (async () => {
        const { data: rpcData, error: rpcError } = await supabase.rpc("get_party_totals");
        if (rpcError || !rpcData || rpcData.length === 0) return null;

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

        const [totalRes, verifiedRes] = await Promise.all([
          supabase.from("result_submissions").select("*", { count: "exact", head: true }),
          supabase.from("result_submissions").select("*", { count: "exact", head: true }).eq("status", "VERIFIED"),
        ]);

        return {
          parties: parties.map((p: any) => ({
            name: p.party_name,
            abbreviation: p.party_abbreviation,
            color: p.party_color,
            total_votes: Number(p.total_votes),
            percentage: grandTotal > 0 ? Number(((Number(p.total_votes) / grandTotal) * 100).toFixed(1)) : 0,
          })),
          grand_total: grandTotal,
          total_results: totalRes.count || 0,
          verified_results: verifiedRes.count || 0,
          last_updated: new Date().toISOString(),
          source: "supabase" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:party-results"
    );

    if (sbResult) return sbResult;

    // ── Fallback: Convex ──
    const convexResult = await withTimeout(
      (async () => {
        const convexParties = await getConvexPartyTotals();
        if (!convexParties || convexParties.length === 0) return null;

        const grandTotal = convexParties.reduce(
          (sum: number, p: any) => sum + p.total_votes, 0
        );

        return {
          parties: convexParties.map((p: any) => ({
            name: p.name,
            abbreviation: p.abbreviation,
            color: p.color,
            total_votes: p.total_votes,
            percentage: grandTotal > 0 ? Number(((p.total_votes / grandTotal) * 100).toFixed(1)) : 0,
          })),
          grand_total: grandTotal,
          total_results: 0,
          verified_results: 0,
          last_updated: new Date().toISOString(),
          source: "convex" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "convex:party-results"
    );

    if (convexResult) return convexResult;

    // ── Last resort ──
    return {
      parties: [],
      grand_total: 0,
      total_results: 0,
      verified_results: 0,
      last_updated: new Date().toISOString(),
      source: "empty" as const,
    };
  },
  ["party-results-v5"],
  {
    revalidate: 30,
    tags: ["party-results"],
  }
);

// ─────────────────────────────────────────────────────
// Cached config — refreshed every 5 minutes
// ─────────────────────────────────────────────────────

export const getCachedConfig = unstable_cache(
  async () => {
    // ── Try Supabase with timeout ──
    const supabase = getServiceClient();

    // Query PU count once, reuse throughout
    let totalPUCount = 176846; // INEC 2026 official count fallback
    try {
      const { data: fastStats } = await supabase.rpc("get_fast_stats");
      if (fastStats?.total_polling_units) {
        totalPUCount = Number(fastStats.total_polling_units);
      }
    } catch {}

    const sbResult = await withTimeout(
      (async () => {
        const { data } = await supabase
          .from("simulation_config")
          .select("*")
          .eq("id", "00000000-0000-0000-0000-000000000001")
          .single();

        if (!data) return null;

        const isRunning = data.status === "RUNNING";
        return {
          election_type: data.election_type || "PRESIDENTIAL",
          title: data.election_type === "GOVERNORSHIP"
            ? "Governorship & State Assembly Election"
            : "Presidential & National Assembly Election",
          subtitle: data.election_type === "GOVERNORSHIP"
            ? "6 February 2027"
            : "16 January 2027",
          date: data.election_type === "GOVERNORSHIP" ? "2027-02-06" : "2027-01-16",
          total_polling_units: totalPUCount,
          display_status: isRunning ? "SIMULATION" : "LIVE",
          status_label: isRunning ? "Simulation Running" : "Live Election Data",
          total_results: data.total_results_submitted || 0,
          source: "supabase" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:config"
    );

    if (sbResult) return sbResult;

    // ── Fallback: Convex ──
    const convexResult = await withTimeout(
      (async () => {
        const convexConfig = await getConvexSimConfig();
        if (!convexConfig) return null;

        const isRunning = convexConfig.status === "RUNNING";
        return {
          election_type: convexConfig.election_type || "PRESIDENTIAL",
          title: convexConfig.election_type === "GOVERNORSHIP"
            ? "Governorship & State Assembly Election"
            : "Presidential & National Assembly Election",
          subtitle: convexConfig.election_type === "GOVERNORSHIP"
            ? "6 February 2027"
            : "16 January 2027",
          date: convexConfig.election_type === "GOVERNORSHIP" ? "2027-02-06" : "2027-01-16",
          total_polling_units: totalPUCount,
          display_status: isRunning ? "SIMULATION" : (convexConfig.status === "COMPLETED" ? "LIVE" : "LIVE"),
          status_label: isRunning ? "Simulation Running" : "Live Election Data",
          total_results: convexConfig.results_processed || 0,
          source: "convex" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "convex:config"
    );

    if (convexResult) return convexResult;

    // ── Last resort: defaults ──
    return {
      election_type: "PRESIDENTIAL",
      title: "Presidential & National Assembly Election",
      subtitle: "16 January 2027",
      date: "2027-01-16",
      total_polling_units: totalPUCount,
      display_status: "LIVE",
      status_label: "Live Election Data",
      total_results: 0,
      source: "empty" as const,
    };
  },
  ["config-v3"],
  {
    revalidate: 300,
    tags: ["config"],
  }
);

/**
 * Invalidate all caches after a simulation completes.
 */
export function invalidateAllCaches() {
  revalidateTag("stats");
  revalidateTag("party-results");
  revalidateTag("config");
}
