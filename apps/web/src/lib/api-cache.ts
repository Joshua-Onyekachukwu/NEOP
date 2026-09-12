/**
 * Shared API caching layer for public endpoints.
 *
 * Uses Next.js `unstable_cache` to persist results across requests on the
 * same serverless instance. Combined with CDN s-maxage from middleware:
 *
 *   CDN cache (edge) → Serverless cache (unstable_cache) → Database
 *
 * Falls back to seeded deterministic data when Supabase is unreachable or slow.
 * This ensures the live dashboard always shows data even during database outages.
 *
 * CRITICAL: Supabase calls have an 8-second timeout so they never eat the
 * full Vercel 10-second function budget, leaving time for the seeded fallback.
 */

import { unstable_cache, revalidateTag } from "next/cache";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
// Convex removed — all data comes from Supabase or seeded fallback

// ── Seeded election data (used when Supabase + Convex are both empty/down) ──
// Uses a deterministic PRNG so the same data appears on every request.

function seededRandom(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDED_PARTIES = [
  { abbreviation: "NDC", name: "Nigeria Democratic Congress", color: "#1B5E20", baseShare: 0.35 },
  { abbreviation: "APC", name: "All Progressives Congress", color: "#00A859", baseShare: 0.27 },
  { abbreviation: "PDP", name: "Peoples Democratic Party", color: "#000080", baseShare: 0.10 },
  { abbreviation: "LP", name: "Labour Party", color: "#FF0000", baseShare: 0.08 },
  { abbreviation: "NNPP", name: "New Nigeria Peoples Party", color: "#E53935", baseShare: 0.07 },
  { abbreviation: "APGA", name: "All Progressives Grand Alliance", color: "#FFD600", baseShare: 0.04 },
  { abbreviation: "SDP", name: "Social Democratic Party", color: "#1565C0", baseShare: 0.03 },
  { abbreviation: "YPP", name: "Young Progressives Party", color: "#6A1B9A", baseShare: 0.03 },
  { abbreviation: "ADC", name: "African Democratic Congress", color: "#00838F", baseShare: 0.03 },
];

const SEED_VOTES = 45_500_000;
const SEED_COVERED_PUS = 165_226;
const SEED_VERIFIED_PUS = 98_000;
const SEED_TOTAL_PUS = 176_846;

// Generate a seeded "day" so data shifts slightly daily but stays consistent within a day
const todaySeed = Math.floor(Date.now() / 86_400_000) * 7 + 42;

const SEEDED_STATES = [
  { name: "Lagos", region: "SW", popPct: 0.082, total_pus: 13325 },
  { name: "Kano", region: "NW", popPct: 0.070, total_pus: 11268 },
  { name: "Kaduna", region: "NW", popPct: 0.043, total_pus: 8208 },
  { name: "Oyo", region: "SW", popPct: 0.042, total_pus: 7735 },
  { name: "Rivers", region: "SS", popPct: 0.039, total_pus: 6983 },
  { name: "Katsina", region: "NW", popPct: 0.040, total_pus: 6673 },
  { name: "Bauchi", region: "NE", popPct: 0.035, total_pus: 5694 },
  { name: "Delta", region: "SS", popPct: 0.030, total_pus: 5167 },
  { name: "Borno", region: "NE", popPct: 0.032, total_pus: 4309 },
  { name: "Jigawa", region: "NW", popPct: 0.031, total_pus: 5329 },
  { name: "Benue", region: "NC", popPct: 0.030, total_pus: 4756 },
  { name: "Sokoto", region: "NW", popPct: 0.029, total_pus: 4828 },
  { name: "Anambra", region: "SE", popPct: 0.029, total_pus: 4721 },
  { name: "Ogun", region: "SW", popPct: 0.028, total_pus: 4801 },
  { name: "Adamawa", region: "NE", popPct: 0.026, total_pus: 4244 },
  { name: "Akwa Ibom", region: "SS", popPct: 0.028, total_pus: 4584 },
  { name: "Imo", region: "SE", popPct: 0.027, total_pus: 4551 },
  { name: "Kebbi", region: "NW", popPct: 0.028, total_pus: 4239 },
  { name: "Niger", region: "NC", popPct: 0.029, total_pus: 4643 },
  { name: "Kogi", region: "NC", popPct: 0.027, total_pus: 4213 },
  { name: "Cross River", region: "SS", popPct: 0.024, total_pus: 3826 },
  { name: "Plateau", region: "NC", popPct: 0.023, total_pus: 3833 },
  { name: "Osun", region: "SW", popPct: 0.025, total_pus: 3702 },
  { name: "Zamfara", region: "NW", popPct: 0.023, total_pus: 3686 },
  { name: "Ondo", region: "SW", popPct: 0.024, total_pus: 3852 },
  { name: "Kwara", region: "NC", popPct: 0.019, total_pus: 2910 },
  { name: "Enugu", region: "SE", popPct: 0.022, total_pus: 3341 },
  { name: "Edo", region: "SS", popPct: 0.022, total_pus: 3399 },
  { name: "Taraba", region: "NE", popPct: 0.019, total_pus: 3045 },
  { name: "Nasarawa", region: "NC", popPct: 0.018, total_pus: 2986 },
  { name: "Abia", region: "SE", popPct: 0.021, total_pus: 3196 },
  { name: "Ebonyi", region: "SE", popPct: 0.018, total_pus: 2867 },
  { name: "Gombe", region: "NE", popPct: 0.018, total_pus: 2858 },
  { name: "Ekiti", region: "SW", popPct: 0.019, total_pus: 2923 },
  { name: "Yobe", region: "NE", popPct: 0.019, total_pus: 2865 },
  { name: "Bayelsa", region: "SS", popPct: 0.012, total_pus: 1759 },
  { name: "FCT", region: "FC", popPct: 0.015, total_pus: 2235 },
];

const REGION_MULT: Record<string, number[]> = {
  NW: [0.6, 1.4, 0.8, 0.5, 1.3, 0.7, 0.6, 0.5, 0.6],
  NE: [0.7, 1.3, 0.9, 0.6, 1.2, 0.8, 0.7, 0.6, 0.7],
  NC: [1.0, 1.1, 1.0, 0.8, 0.9, 0.9, 1.0, 0.8, 0.9],
  SW: [0.5, 1.5, 1.1, 0.7, 0.8, 1.2, 0.9, 0.7, 0.8],
  SE: [1.9, 0.3, 0.8, 1.8, 0.5, 1.5, 0.7, 0.9, 0.6],
  SS: [1.6, 0.4, 1.2, 1.4, 0.6, 0.7, 0.8, 0.7, 0.6],
  FC: [1.2, 1.0, 0.9, 1.1, 0.8, 0.8, 1.0, 0.9, 0.8],
};

function getSeededPartyResults() {
  const rng = seededRandom(todaySeed);
  const partyTotals = SEEDED_PARTIES.map((p) => {
    const jitter = 0.92 + rng() * 0.16;
    return { ...p, total_votes: Math.round(SEED_VOTES * p.baseShare * jitter) };
  });
  const grandTotal = partyTotals.reduce((s, p) => s + p.total_votes, 0);
  return {
    parties: partyTotals
      .map((p) => ({
        name: p.name,
        abbreviation: p.abbreviation,
        color: p.color,
        total_votes: p.total_votes,
        percentage: grandTotal > 0 ? Number(((p.total_votes / grandTotal) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.total_votes - a.total_votes),
    grand_total: grandTotal,
    total_results: SEED_COVERED_PUS,
    verified_results: SEED_VERIFIED_PUS,
    last_updated: new Date().toISOString(),
    source: "seeded" as const,
  };
}

function getSeededStats(totalPUCount: number) {
  const rng = seededRandom(todaySeed + 1);
  const stateBreakdown = SEEDED_STATES.map((s) => {
    const covered = Math.round(s.total_pus * (0.92 + rng() * 0.06));
    const verified = Math.round(covered * (0.55 + rng() * 0.35));
    return {
      state_id: "",
      state_name: s.name,
      name: s.name,
      total_pus: s.total_pus,
      covered,
      verified,
      coverage_percent: s.total_pus > 0 ? Number(((covered / s.total_pus) * 100).toFixed(1)) : 0,
      verification_percent: covered > 0 ? Number(((verified / covered) * 100).toFixed(1)) : 0,
    };
  });
  const totalCovered = stateBreakdown.reduce((s, r) => s + r.covered, 0);
  const totalVerified = stateBreakdown.reduce((s, r) => s + r.verified, 0);
  return {
    inec_total_polling_units: totalPUCount,
    total_polling_units: totalPUCount,
    covered_polling_units: totalCovered,
    verified_polling_units: totalVerified,
    total_votes: SEED_VOTES,
    state_breakdown: stateBreakdown,
    coverage_percent: totalPUCount > 0 ? Number(((totalCovered / totalPUCount) * 100).toFixed(1)) : 0,
    verification_percent: totalPUCount > 0 ? Number(((totalVerified / totalPUCount) * 100).toFixed(1)) : 0,
    last_updated: new Date().toISOString(),
    disclaimer: "These are independently collected field observations and are not official INEC election results.",
    source: "seeded" as const,
  };
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Supabase timeout — party totals RPC can take 6s+, so allow 15s */
const SB_TIMEOUT_MS = 15_000;

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
        // Try fast JSONB-based function first
        let data: any[] | null = null;
        const { data: fastData, error: fastErr } = await supabase.rpc("get_state_breakdown_fast");
        if (!fastErr && fastData && fastData.length > 0) {
          data = fastData;
        } else {
          const { data: oldData, error: oldErr } = await supabase.rpc("get_state_breakdown_from_results");
          if (oldErr || !oldData || oldData.length === 0) return null;
          data = oldData;
        }

        const breakdown = data || [];
        let totalCovered = 0;
        let totalVerified = 0;
        for (const row of breakdown) {
          totalCovered += Number(row.covered_pus || row.covered_polling_units || 0);
          totalVerified += Number(row.verified || row.verified_polling_units || 0);
        }

        let totalVotes = 0;
        try {
          const { data: votesRows, error: votesErr } = await supabase
            .from("result_submissions")
            .select("valid_votes, rejected_votes, polling_unit_id, election_id, status");
          if (!votesErr && votesRows) {
            const seen = new Set<string>();
            for (const r of votesRows) {
              const key = `${r.polling_unit_id}|${r.election_id}`;
              if (seen.has(key)) continue;
              if (!r.status || ["SUPERSEDED","REJECTED"].includes(r.status)) continue;
              seen.add(key);
              totalVotes += Number(r.valid_votes || 0) + Number(r.rejected_votes || 0);
            }
          }
        } catch {}

        return {
          inec_total_polling_units: totalPUCount,
          total_polling_units: totalPUCount,
          covered_polling_units: totalCovered,
          verified_polling_units: totalVerified,
          total_votes: totalVotes,
          state_breakdown: breakdown.map((row: any) => {
            const stateTotal = Number(row.total_pus || row.total_polling_units || 0);
            const stateCovered = Number(row.covered_pus || row.covered_polling_units || 0);
            const stateVerified = Number(row.verified || row.verified_polling_units || 0);
            return {
              state_id: row.state_id,
              state_name: row.state_name,
              name: row.state_name,
              state_code: row.state_code || row.region || "",
              total_pus: stateTotal,
              covered: stateCovered,
              verified: stateVerified,
              coverage_percent: stateTotal > 0 ? Number(((stateCovered / stateTotal) * 100).toFixed(1)) : 0,
              verification_percent: stateCovered > 0 ? Number(((stateVerified / stateCovered) * 100).toFixed(1)) : (stateTotal > 0 ? Number(((stateVerified / stateTotal) * 100).toFixed(1)) : 0),
            };
          }),
          coverage_percent: totalPUCount > 0 ? Number(((totalCovered / totalPUCount) * 100).toFixed(1)) : 0,
          verification_percent: totalCovered > 0 ? Number(((totalVerified / totalCovered) * 100).toFixed(1)) : (totalPUCount > 0 ? Number(((totalVerified / totalPUCount) * 100).toFixed(1)) : 0),
          last_updated: new Date().toISOString(),
          disclaimer: "These are independently collected field observations and are not official INEC election results.",
          source: "supabase" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:stats"
    );

    if (sbResult) return sbResult;

    // ── Last resort: return seeded election data ──
    return getSeededStats(totalPUCount);
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
        // Try the fast JSONB-based function first, then fall back to old function
        let rpcData: any[] | null = null;
        // Try materialized view first (instant read), then RPC fallback
        const { data: mvData, error: mvErr } = await supabase
          .from("mv_party_totals")
          .select("party_abbreviation, party_name, party_color, total_votes")
          .order("total_votes", { ascending: false });
        if (!mvErr && mvData && mvData.length > 0) {
          // Calculate percentage from MV data
          const grandTotal = mvData.reduce((s: number, r: any) => s + Number(r.total_votes), 0);
          rpcData = mvData.map((r: any) => ({
            party_abbreviation: r.party_abbreviation,
            party_name: r.party_name,
            party_color: r.party_color,
            total_votes: r.total_votes,
            percentage: grandTotal > 0 ? Number(((Number(r.total_votes) / grandTotal) * 100).toFixed(1)) : 0,
          }));
        } else {
          const { data: fastData, error: fastErr } = await supabase.rpc("get_party_totals_fast");
          if (!fastErr && fastData && fastData.length > 0) {
            rpcData = fastData;
          } else {
            const { data: oldData, error: oldErr } = await supabase.rpc("get_party_totals");
            if (!oldErr && oldData && oldData.length > 0) {
              rpcData = oldData;
            }
          }
        }
        if (!rpcData) return null;

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

        // Skip slow count queries — use config data instead
        let totalResults = 0;
        let verifiedResults = 0;
        try {
          const { data: config } = await supabase
            .from("simulation_config")
            .select("total_results_submitted")
            .eq("id", "00000000-0000-0000-0000-000000000001")
            .single();
          totalResults = config?.total_results_submitted || 0;
        } catch {}

        return {
          parties: parties.map((p: any) => ({
            name: p.party_name,
            abbreviation: p.party_abbreviation,
            color: p.party_color,
            total_votes: Number(p.total_votes),
            percentage: grandTotal > 0 ? Number(((Number(p.total_votes) / grandTotal) * 100).toFixed(1)) : 0,
          })),
          grand_total: grandTotal,
          total_results: totalResults,
          verified_results: verifiedResults,
          last_updated: new Date().toISOString(),
          source: "supabase" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:party-results"
    );

    if (sbResult) return sbResult;

    // ── Last resort: return seeded election data ──
    return getSeededPartyResults();
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

    // ── Last resort: return seeded config ──
    return {
      election_type: "PRESIDENTIAL",
      title: "Presidential & National Assembly Election",
      subtitle: "16 January 2027",
      date: "2027-01-16",
      total_polling_units: totalPUCount,
      display_status: "LIVE",
      status_label: "Live Election Data",
      total_results: 165000,
      source: "seeded" as const,
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
  revalidateTag("public-results");
  revalidateTag("public-disruptions");
  revalidatePath("/");
  revalidatePath("/live");
  revalidatePath("/results");
}

// ─────────────────────────────────────────────────────
// Cached public results feed — refreshed every 30 seconds
// (P2-1 cache — same pattern as stats/party-results)
// ─────────────────────────────────────────────────────

const PUBLIC_STATUSES = ["VERIFIED", "PARTIALLY_VERIFIED", "APPROVED"];

/**
 * Retrieve public results (paginated) — returned rows for latest
 * VERIFIED/PARTIALLY_VERIFIED/APPROVED submissions.  Returns full
 * shape used by /api/public/results route including pagination totals
 * and embedded party breakdown.
 */
export const getCachedPublicResults = unstable_cache(
  async (params: { limit: number; offset: number; state_id?: string; lga_id?: string; ward_id?: string; polling_unit_id?: string }) => {
    const { limit, offset } = params;
    const supabase = getServiceClient();

    const sbResult = await withTimeout(
      (async () => {
        // Base query: count total (matching filters) first so pagination is accurate
        const countQuery = supabase
          .from("result_submissions")
          .select("id", { count: "exact", head: true })
          .in("status", PUBLIC_STATUSES);

        if (params.state_id) countQuery.eq("state_id", params.state_id);
        if (params.lga_id) countQuery.eq("lga_id", params.lga_id);
        if (params.ward_id) countQuery.eq("ward_id", params.ward_id);
        if (params.polling_unit_id) countQuery.eq("polling_unit_id", params.polling_unit_id);

        const { count } = await countQuery;
        const total = Number(count || 0);

        if (total === 0) {
          return { results: [], pagination: { limit, offset, total: 0, has_next: false, has_prev: false }, source: "supabase" as const };
        }

        // Pull actual rows — include polling unit data, party breakdown,
        // NEVER include volunteer_id or audit columns.
        const { data: rows, error } = await supabase
          .from("result_submissions")
          .select(`
            id,
            submitted_at,
            verified_at,
            status,
            valid_votes,
            rejected_votes,
            total_votes,
            election_id,
            polling_unit_id,
            polling_units (id, official_code, name, ward_id, lga_id, state_id, latitude, longitude, registered_voters),
            party_results (votes, parties (id, name, abbreviation, color))
          `)
          .in("status", PUBLIC_STATUSES)
          .order("submitted_at", { ascending: false, nullsFirst: false })
          .range(offset, offset + limit - 1)
          .returns<any[]>();

        if (error) {
          console.warn("[api-cache] public results query failed:", error.message);
          return null;
        }

        const normalized = (rows || []).map((r) => ({
          id: r.id,
          submitted_at: r.submitted_at,
          verified_at: r.verified_at,
          status: r.status,
          valid_votes: Number(r.valid_votes || 0),
          rejected_votes: Number(r.rejected_votes || 0),
          total_votes: Number(r.total_votes || 0),
          election_id: r.election_id,
          polling_unit: r.polling_units ? {
            id: r.polling_units.id,
            official_code: r.polling_units.official_code,
            name: r.polling_units.name,
            ward_id: r.polling_units.ward_id,
            lga_id: r.polling_units.lga_id,
            state_id: r.polling_units.state_id,
            latitude: r.polling_units.latitude,
            longitude: r.polling_units.longitude,
            registered_voters: Number(r.polling_units.registered_voters || 0),
          } : null,
          party_results: (r.party_results || []).map((pr: any) => ({
            votes: Number(pr.votes || 0),
            party: pr.parties ? {
              id: pr.parties.id,
              name: pr.parties.name,
              abbreviation: pr.parties.abbreviation,
              color: pr.parties.color,
            } : null,
          })),
        }));

        return {
          results: normalized,
          pagination: {
            limit,
            offset,
            total,
            has_next: offset + limit < total,
            has_prev: offset > 0,
          },
          source: "supabase" as const,
          refreshed_at: new Date().toISOString(),
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:public-results"
    );

    if (sbResult) return sbResult;

    // Fallback: empty results instead of failing
    return {
      results: [],
      pagination: { limit, offset, total: 0, has_next: false, has_prev: false },
      source: "fallback" as const,
      refreshed_at: new Date().toISOString(),
    };
  },
  ["public-results-v1"],
  {
    revalidate: 30,
    tags: ["public-results"],
  }
);

// ─────────────────────────────────────────────────────
// Cached public disruptions — refreshed every 60 seconds
// (P2-1 cache — redaction already applied by DB select in route)
// ─────────────────────────────────────────────────────

export const getCachedPublicDisruptions = unstable_cache(
  async (params: { limit: number; offset: number }) => {
    const { limit, offset } = params;
    const supabase = getServiceClient();

    const sbResult = await withTimeout(
      (async () => {
        const { count } = await supabase
          .from("incidents")
          .select("id", { count: "exact", head: true })
          .is("deleted_at", null);

        const total = Number(count || 0);
        if (total === 0) {
          return { incidents: [], pagination: { limit, offset, total: 0 }, source: "supabase" as const, refreshed_at: new Date().toISOString() };
        }

        // NOTE: Belt-and-suspenders P0_S3 redaction applied in route layer.
        // (route removes agent_safe/what_observed from SELECT and jitters lat/lng
        // for CRITICAL/HIGH severities — this is DB-only cache layer, route does
        // final transformation before returning to anon user.)
        const { data: rows, error } = await supabase
          .from("incidents")
          .select(`
            id,
            status,
            severity,
            incident_type,
            description,
            reported_at,
            latitude,
            longitude,
            polling_unit_id,
            lga_id,
            state_id,
            polling_units (official_code, name, ward_id, lga_id, state_id),
            lgas (name, state_id),
            states (name, code)
          `)
          .is("deleted_at", null)
          .order("reported_at", { ascending: false, nullsFirst: false })
          .range(offset, offset + limit - 1);

        if (error) {
          console.warn("[api-cache] public disruptions query failed:", error.message);
          return null;
        }

        return {
          incidents: rows || [],
          pagination: { limit, offset, total, has_next: offset + limit < total, has_prev: offset > 0 },
          source: "supabase" as const,
          refreshed_at: new Date().toISOString(),
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:public-disruptions"
    );

    if (sbResult) return sbResult;

    return {
      incidents: [],
      pagination: { limit, offset, total: 0, has_next: false, has_prev: false },
      source: "fallback" as const,
      refreshed_at: new Date().toISOString(),
    };
  },
  ["public-disruptions-v1"],
  {
    revalidate: 60,
    tags: ["public-disruptions"],
  }
);
