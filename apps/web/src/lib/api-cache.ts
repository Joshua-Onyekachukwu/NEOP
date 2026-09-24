import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SYSTEM_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Display scaling for SIMULATED mode: the sim backend stores real (small)
 * vote counts so the DB stays under the Free-plan quota, while the public
 * site renders them ×display_multiplier (e.g. ×10) for realistic national
 * headlines. Live elections never scale (multiplier stays 1).
 */
async function getDisplayScale(): Promise<number> {
  try {
    const supabase = getServiceClient();
    const { data } = await supabase
      .from("system_config")
      .select("data_mode, display_multiplier")
      .eq("id", SYSTEM_CONFIG_ID)
      .maybeSingle();
    if (data?.data_mode === "SIMULATED") {
      const m = Number(data.display_multiplier || 1);
      return m > 1 ? m : 1;
    }
  } catch {}
  return 1;
}

/**
 * National leaderboard rows for the stats payload — the SAME source the
 * party-results endpoint uses (get_election_summary's per-party rows), so
 * the two endpoints can never disagree. Accepts either key convention
 * (summary rows use name/abbreviation/color; the published-totals RPC uses
 * party_name/party_abbreviation/party_color).
 */
function buildLeaderboard(parties: any[] | null | undefined): any[] {
  if (!Array.isArray(parties) || parties.length === 0) return [];
  const rows = parties
    .map((p: any) => ({
      name: p.name || p.party_name || p.abbreviation || p.party_abbreviation,
      abbreviation: p.abbreviation || p.party_abbreviation,
      color: p.color || p.party_color || null,
      total_votes: Number(p.total_votes || 0),
    }))
    .sort(
      (a: any, b: any) =>
        b.total_votes - a.total_votes ||
        String(a.abbreviation).localeCompare(String(b.abbreviation))
    );
  const grand = rows.reduce((s: number, r: any) => s + r.total_votes, 0);
  // Percentages are shares of the unscaled grand total — display scaling
  // multiplies magnitudes only, so shares must be computed here.
  return rows.map((r: any) => ({
    ...r,
    percentage: grand > 0 ? Number(((r.total_votes / grand) * 100).toFixed(1)) : 0,
  }));
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const SB_TIMEOUT_MS = 25_000;
/** Total PU universe (filled in by get_fast_stats at runtime). */
let totalPUCount = 176846;

function getServiceClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey);
}

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

/**
 * Last successful real stats snapshot (§24). Served ONLY when the live
 * database path fails outright — never fabricated, always the most
 * recent genuine numbers.
 */
const lastGoodStats: { value: any | null } = { value: null };

/** Last successful real party-results snapshot (§24). */
const lastGoodPartyResults: { value: any[] | null } = { value: null };

export const getCachedStats = unstable_cache(
  async () => {
    const supabase = getServiceClient();

    const sbResult = await withTimeout(
      (async () => {
        // Everything below is independent — fetch in parallel so the whole
        // chain fits in one timeout even when each RPC takes seconds.
        // (Sequential prefixes previously pushed the chain past 15s.)
        const [fastRes, sumRes, covRes] = await Promise.all([
          Promise.resolve(supabase.rpc("get_fast_stats"))
            .catch(() => ({ data: null, error: null })),
          supabase.rpc("get_election_summary"),
          Promise.resolve(supabase.rpc("get_pu_coverage_summary"))
            .catch(() => ({ data: null, error: null })),
        ]);
        const fastStats = fastRes.data;
        if (fastStats?.total_polling_units) {
          totalPUCount = Number(fastStats.total_polling_units);
        }

        try {
          const sumData = sumRes.data;
          const sumErr = sumRes.error;
          const sum = sumErr ? null : (Array.isArray(sumData) ? sumData[0] : sumData);
          if (sum && (sum.national || sum.states)) {
            const nat = sum.national || {};
            const covered = Number(nat.covered_results || 0);
            const verified = Number(nat.verified_results || 0);
            const totalPU = Number(sum.total_polling_units || 0);
            const states = (sum.states || []).map((s: any) => {
              const totalPus = Number(s.total_pus || 0);
              const cov = Number(s.covered_pus || 0);
              const ver = Number(s.verified_pus || 0);
              return {
                state_id: s.state_id,
                state_name: s.state_name,
                name: s.state_name,
                state_code: s.state_code || "",
                total_pus: totalPus,
                // Alias keys: consumers read either naming
                total_polling_units: totalPus,
                covered: cov,
                covered_pus: cov,
                covered_polling_units: cov,
                verified: ver,
                verified_pus: ver,
                verified_polling_units: ver,
                total_votes: Number(s.total_votes || 0),
                leader_abbreviation: s.leader_abbreviation || null,
                leader_votes: Number(s.leader_votes || 0),
                reporting_status: s.reporting_status || "AWAITING",
                coverage_percent: Number(s.coverage_percent || 0),
                verification_percent: cov > 0 ? Number(((ver / cov) * 100).toFixed(1)) : 0,
              };
            });
            // ── Full-coverage ledger merge (migration 245) ──
            // Every PU is accounted for (published / disputed / failed /
            // disrupted / unavailable / awaiting). These counters come
            // from the run ledger, NOT from result rows — so PUs that
            // never publish still appear in the public accounting.
            let ledger: any = covRes.data ? (Array.isArray(covRes.data) ? covRes.data[0] : covRes.data) : null;

            const ledgerActive = !!ledger?.active;
            // Universe size: active ledger > summary > known PU count.
            const universe =
              (ledgerActive ? Number(ledger.total_pus || 0) : 0) ||
              totalPU || totalPUCount;

            // ── SIMULATED display scaling (user-approved architecture) ──
            // Only VOTE MAGNITUDES are display-scaled: the engine stores a
            // reduced dataset (disk quota) and the public site renders
            // election-day-scale totals, so every vote figure the user sees
            // is the stored figure × display_multiplier (LIVE mode: ×1).
            //
            // POLLING-UNIT COUNTERS ARE NEVER EXTRAPOLATED. An earlier
            // version multiplied the ledger's published/disputed/... counts
            // by universe/scope, which made the banner claim 146,291
            // published PUs while the same payload reported 32,188 verified
            // results and 18.2% reporting — three answers to one question.
            // The ledger already sums to the exact PU universe (the AWAITING
            // remainder absorbs every unreported unit), so the real counts
            // are also the complete ones.
            const scaleLedger = (v: any) => Number(v ?? 0);

            let mergedStates: any[] = states;
            if (ledgerActive && Array.isArray(ledger.state_breakdown) && ledger.state_breakdown.length > 0) {
              const covByState = new Map<string, any>(
                ledger.state_breakdown.map((s: any) => [s.state_id, s] as [string, any])
              );
              mergedStates = states.map((s: any) => {
                const c = covByState.get(s.state_id) || covByState.get(s.state_name);
                if (!c) return s;
                const stTotal = Number(c.total_pus ?? 0);
                const stAwaiting = Number(c.awaiting ?? 0);
                const stPublished = Number(c.published ?? 0);
                const stUnavailable = Number(c.unavailable ?? 0);
                const stAccounted = Math.max(0, stTotal - stAwaiting);
                // Reporting scope excludes PUs that never reported at all
                // (unavailable) — same denominator the national Verified
                // card uses, so state bars reconcile with the headline.
                const stReporting = Math.max(1, stTotal - stUnavailable - stAwaiting);
                return {
                  ...s,
                  // Ledger coverage columns: REAL per-state counts (the
                  // ledger accounts for every PU in the universe, so no
                  // extrapolation is needed or wanted).
                  published: scaleLedger(c.published),
                  disputed: scaleLedger(c.disputed),
                  failed: scaleLedger(c.failed),
                  disrupted: scaleLedger(c.disrupted),
                  unavailable: scaleLedger(c.unavailable),
                  awaiting: stAwaiting,
                  accounted: c.accounted ?? stAccounted,
                  published_percent: c.published_percent ?? 0,
                  // Run-scoped totals + coverage: the DB-wide per-state PU
                  // counts (e.g. Abia 4,062) made state bars stick at the
                  // run's slice (~4%) forever; the ledger universe is what
                  // this run actually covers, so PUs/Cov/Ver and the bar
                  // tell one story.
                  total_pus: stTotal,
                  total_polling_units: stTotal,
                  covered: stAccounted,
                  covered_pus: stAccounted,
                  covered_polling_units: stAccounted,
                  verified: stPublished,
                  verified_pus: stPublished,
                  verified_polling_units: stPublished,
                  coverage_percent: stTotal > 0
                    ? Number(((stAccounted / stTotal) * 100).toFixed(1))
                    : 0,
                  verification_percent: Number(((stPublished / stReporting) * 100).toFixed(1)),
                };
              });
            }

            // AWAITING is the remainder, so the counters always sum to the
            // exact PU universe (176,846).
            const scaledAwaiting = ledgerActive
              ? Math.max(
                  0,
                  universe -
                    scaleLedger(ledger.published_pus) -
                    scaleLedger(ledger.dispute_pus) -
                    scaleLedger(ledger.failed_pus) -
                    scaleLedger(ledger.disrupted_pus) -
                    scaleLedger(ledger.unavailable_pus)
                )
              : Number(ledger?.awaiting_pus ?? 0);

            return {
              inec_total_polling_units: universe,
              total_polling_units: universe,
              covered_polling_units: ledgerActive ? Number(ledger.accounted_pus ?? 0) : covered,
              verified_polling_units: verified,
              // Full-coverage accounting (banner + dashboards), display-
              // scaled in SIMULATED mode. Only meaningful while a ledger
              // run exists; null otherwise so the UI falls back to
              // result-derived counters.
              published_pus: ledgerActive ? scaleLedger(ledger.published_pus) : null,
              disputed_pus: ledgerActive ? scaleLedger(ledger.dispute_pus) : null,
              failed_pus: ledgerActive ? scaleLedger(ledger.failed_pus) : null,
              disrupted_pus: ledgerActive ? scaleLedger(ledger.disrupted_pus) : null,
              unavailable_pus: ledgerActive ? scaleLedger(ledger.unavailable_pus) : null,
              awaiting_pus: ledgerActive ? scaledAwaiting : null,
              accounted_pus: ledgerActive ? Number(ledger.accounted_pus ?? 0) : null,
              published_percent: ledgerActive ? ledger.published_percent : null,
              sim_run_id: ledger?.run_id ?? null,
              sim_run_status: ledger?.run_status ?? null,
              total_votes: Number(nat.total_votes || 0),
              // National leaderboard — same summary rows /api/public/party-
              // results serves. This was previously dropped here, so /stats
              // carried no leaderboard at all while party-results worked;
              // any consumer keying off stats got a silent empty/0.
              leaderboard: buildLeaderboard(sum.parties),
              state_breakdown: mergedStates,
              // §2 glossary — one word per denominator, never one word for
              // two numbers (get_pu_coverage_summary computes all three):
              //   coverage_percent     = ACCOUNTED share of the universe
              //                          (published+disputed+failed+disrupted
              //                          +unavailable; awaiting excluded)
              //   published_percent    = PUBLISHED share of the universe
              //   verification_percent = published share of REPORTING PUs
              coverage_percent: ledgerActive
                ? Number(ledger.coverage_percent ?? 0)
                : universe > 0 ? Number(((covered / universe) * 100).toFixed(1)) : 0,
              verification_percent: ledgerActive && Number(ledger.verified_percent ?? 0) > 0
                ? Number(ledger.verified_percent)
                : covered > 0 ? Number(((verified / covered) * 100).toFixed(1)) : 0,
              last_updated: sum.generated_at || new Date().toISOString(),
              disclaimer: "These are independently collected field observations and are not official INEC election results.",
              source: "live" as const,
            };
          }
        } catch {}
        // ── Legacy fallback chain (resilience only) ──
        let totalVotes = 0;
        let totalCovered = 0;
        let totalVerified = 0;
        let breakdown: any[] = [];

        try {
          // Server-side aggregate: PostgREST hard-caps un-capped selects
          // at 1000 rows, so summing rows over REST undercounted once the
          // dataset exceeded ~1000 rows (migration 240).
          const { data: voteTotals, error: votesErr } = await supabase.rpc("get_published_vote_totals");
          if (!votesErr && voteTotals) {
            const vt = Array.isArray(voteTotals) ? voteTotals[0] : voteTotals;
            totalVotes = Number(vt?.total_votes || 0);
          }
        } catch {}

        try {
          const { count: coveredCount, error: coveredErr } = await supabase
            .from("canonical_pu_results")
            .select("polling_unit_id", { count: "exact", head: true })
            .in("status", ["ONE_SUBMISSION", "VERIFYING", "VERIFIED", "FLAGGED", "HUMAN_REVIEW", "PUBLISHED"]);
          if (!coveredErr) {
            totalCovered = Number(coveredCount || 0);
          }
        } catch {}

        try {
          const { count: verifiedCount, error: verifiedErr } = await supabase
            .from("canonical_pu_results")
            .select("polling_unit_id", { count: "exact", head: true })
            .in("status", ["VERIFIED", "PUBLISHED"]);
          if (!verifiedErr) {
            totalVerified = Number(verifiedCount || 0);
          }
        } catch {}

        try {
          const { data: mvData, error: mvErr } = await supabase
            .from("mv_public_published_results")
            .select("state_id, state_name, polling_unit_id, status");
          if (!mvErr && mvData && mvData.length > 0) {
            const stateMap = new Map<string, any>();
            for (const row of mvData) {
              const key = row.state_id || row.state_name;
              if (!stateMap.has(key)) {
                stateMap.set(key, {
                  state_id: row.state_id,
                  state_name: row.state_name,
                  _pus: new Set(),
                  _published: 0,
                });
              }
              const entry = stateMap.get(key);
              if (row.polling_unit_id) entry._pus.add(row.polling_unit_id);
              if (row.status === "PUBLISHED") entry._published++;
            }
            for (const entry of stateMap.values()) {
              breakdown.push({
                state_id: entry.state_id,
                state_name: entry.state_name,
                covered_pus: entry._pus.size,
                verified: entry._published,
              });
            }
            if (breakdown.length === 0) {
              const { data: rpcData, error: rpcErr } = await supabase.rpc("get_state_breakdown_fast");
              if (!rpcErr && rpcData && rpcData.length > 0) {
                breakdown = rpcData;
              }
            }
          } else {
            const { data: rpcData, error: rpcErr } = await supabase.rpc("get_state_breakdown_fast");
            if (!rpcErr && rpcData && rpcData.length > 0) {
              breakdown = rpcData;
            } else {
              const { data: oldData, error: oldErr } = await supabase.rpc("get_state_breakdown_from_results");
              if (!oldErr && oldData && oldData.length > 0) {
                breakdown = oldData;
              }
            }
          }
        } catch {
          try {
            const { data: rpcData, error: rpcErr } = await supabase.rpc("get_state_breakdown_fast");
            if (!rpcErr && rpcData && rpcData.length > 0) {
              breakdown = rpcData;
            }
          } catch {}
        }

        if (breakdown.length === 0 && totalCovered === 0 && totalVerified === 0 && totalVotes === 0) {
          return null;
        }

        return {
          inec_total_polling_units: totalPUCount,
          total_polling_units: totalPUCount,
          covered_polling_units: totalCovered,
          verified_polling_units: totalVerified,
          total_votes: totalVotes,
          // Legacy fallback chain has no party aggregate — the field must
          // still exist so consumers can rely on one stats shape.
          leaderboard: [],
          state_breakdown: breakdown.map((row: any) => {
            const stateTotal = Number(row.total_pus || row.total_polling_units || 0);
            const stateCovered = Number(row.covered_pus || row.covered_polling_units || row.covered || 0);
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
          source: "live" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:stats"
    );

    if (sbResult) {
      const m = await getDisplayScale();
      if (m > 1) {
        sbResult.total_votes = Math.round(Number(sbResult.total_votes || 0) * m);
        // State-level display numbers must scale identically so every
        // surface reconciles with the national headline. The leaderboard's
        // percentage shares were computed on unscaled totals above, so they
        // survive the scaling untouched.
        sbResult.state_breakdown = (sbResult.state_breakdown || []).map((s: any) => ({
          ...s,
          total_votes: Math.round(Number(s.total_votes || 0) * m),
          leader_votes: Math.round(Number(s.leader_votes || 0) * m),
        }));
        sbResult.leaderboard = (sbResult.leaderboard || []).map((p: any) => ({
          ...p,
          total_votes: Math.round(Number(p.total_votes || 0) * m),
        }));
      }
      lastGoodStats.value = sbResult;
      return sbResult;
    }

    // Last-good-real fallback (§24: no disconnected mock calculations).
    // The seeded generator fabricated plausible-looking results unrelated
    // to the database — during engine load it silently replaced real
    // numbers. Now we serve the most recent successful snapshot instead,
    // or an honest empty dataset on a truly cold start.
    const lastGood = lastGoodStats.value;
    if (lastGood) {
      // This cycle's database read failed and we are re-serving an older
      // snapshot. Mark it STALE so the UI can say "last known data" rather
      // than presenting possibly-old numbers as if they were live.
      return { ...lastGood, data_status: "STALE" as const };
    }

    return {
      inec_total_polling_units: totalPUCount,
      total_polling_units: totalPUCount,
      covered_polling_units: 0,
      verified_polling_units: 0,
      total_votes: 0,
      leaderboard: [],
      state_breakdown: [],
      coverage_percent: 0,
      verification_percent: 0,
      last_updated: new Date().toISOString(),
      disclaimer: "These are independently collected field observations and are not official INEC election results.",
      data_status: "UNAVAILABLE" as const,
      source: "live" as const,
    };
  },
  ["stats"],
  {
    revalidate: 30,
    tags: ["stats"],
  }
);

export const getCachedPartyResults = unstable_cache(
  async () => {
    const supabase = getServiceClient();

    const sbResult = await withTimeout(
      (async () => {
        let rpcData: any[] | null = null;

        // PRIMARY: the same authoritative summary the stats endpoint uses —
        // one computation feeds leaderboard + stats + state breakdown.
        try {
          const { data: sumData, error: sumErr } = await supabase.rpc("get_election_summary");
          const sum = sumErr ? null : (Array.isArray(sumData) ? sumData[0] : sumData);
          if (sum && Array.isArray(sum.parties) && sum.parties.length > 0) {
            rpcData = sum.parties.map((p: any) => ({
              party_abbreviation: p.abbreviation,
              party_name: p.name,
              party_color: p.color,
              total_votes: Number(p.total_votes || 0),
            }));
          }
        } catch {}

        // Fallback: published-canonical aggregate (migration 239). Only
        // consulted when the primary summary produced nothing — it used to
        // overwrite the primary unconditionally, and with multiple simulated
        // elections in the table that summed THREE runs into the public
        // leaderboard while every other endpoint showed one.
        if (!rpcData) {
          try {
            const { data: pubData, error: pubErr } = await supabase.rpc("get_party_totals_published");
            if (!pubErr && pubData && pubData.length > 0) {
              rpcData = pubData;
            }
          } catch {}
        }

        if (!rpcData) {
          try {
            const { data: canonicalData, error: canonicalErr } = await supabase
              .from("canonical_party_results")
              .select(`
                votes,
                party_id,
                canonical_result_id,
                canonical_pu_results!inner (id, status),
                parties!inner (id, name, abbreviation, color)
              `)
              .eq("canonical_pu_results.status", "PUBLISHED")
              .limit(500000)
              .returns<any[]>();
            if (!canonicalErr && canonicalData && canonicalData.length > 0) {
              const partyMap = new Map<string, any>();
              for (const row of canonicalData) {
                const pid = row.party_id;
                if (!partyMap.has(pid)) {
                  partyMap.set(pid, {
                    party_abbreviation: row.parties?.abbreviation,
                    party_name: row.parties?.name,
                    party_color: row.parties?.color,
                    total_votes: 0,
                  });
                }
                const entry = partyMap.get(pid);
                if (entry) entry.total_votes += Number(row.votes || 0);
              }
              rpcData = Array.from(partyMap.values()).sort(
                (a: any, b: any) => b.total_votes - a.total_votes
              );
            }
          } catch {}
        }

        if (!rpcData || rpcData.length === 0) {
          try {
            const { data: mvData, error: mvErr } = await supabase
              .from("mv_party_totals")
              .select("party_abbreviation, party_name, party_color, total_votes")
              .order("total_votes", { ascending: false });
            if (!mvErr && mvData && mvData.length > 0) {
              rpcData = mvData;
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
          } catch {}
        }

        if (!rpcData || rpcData.length === 0) return null;

        const deduped: Record<string, any> = {};
        for (const p of rpcData) {
          const abbr = p.party_abbreviation;
          if (!deduped[abbr] || Number(p.total_votes) > Number(deduped[abbr].total_votes)) {
            deduped[abbr] = p;
          }
        }
        // Authoritative ordering: highest votes first; ties (including the
        // all-zero state) break alphabetically by abbreviation.
        const parties = Object.values(deduped).sort(
          (a, b) =>
            Number(b.total_votes) - Number(a.total_votes) ||
            String(a.party_abbreviation).localeCompare(String(b.party_abbreviation))
        );
        const grandTotal = parties.reduce(
          (s: number, r: any) => s + Number(r.total_votes), 0
        );

        let totalResults = 0;
        let verifiedResults = 0;
        try {
          // Count only the active election's published rows — the unscoped
          // variant double-counted every superseded simulation still on disk.
          const activeElectionId = (await supabase
            .from("system_config")
            .select("active_election_id")
            .eq("id", SYSTEM_CONFIG_ID)
            .maybeSingle()).data?.active_election_id as string | undefined;
          let countQuery = supabase
            .from("canonical_pu_results")
            .select("polling_unit_id", { count: "exact", head: true })
            .eq("status", "PUBLISHED");
          if (activeElectionId) countQuery = countQuery.eq("election_id", activeElectionId);
          const { count: pubCount } = await countQuery;
          totalResults = Number(pubCount || 0);
          verifiedResults = totalResults;
        } catch {}

        const payload: any = {
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
          source: "live" as const,
        };
        const m = await getDisplayScale();
        if (m > 1) {
          payload.grand_total = Math.round(Number(payload.grand_total || 0) * m);
          payload.parties = payload.parties.map((p: any) => ({
            ...p,
            total_votes: Math.round(Number(p.total_votes || 0) * m),
          }));
        }
        return payload;
      })(),
      SB_TIMEOUT_MS,
      "supabase:party-results"
    );

    if (sbResult) {
      lastGoodPartyResults.value = sbResult;
      return sbResult;
    }

    // Last-good-real fallback (§24) — never serve fabricated party votes.
    const lastGood = lastGoodPartyResults.value;
    if (lastGood) return lastGood;

    return [];
  },
  ["party-results"],
  {
    revalidate: 30,
    tags: ["party-results"],
  }
);

export const getCachedConfig = unstable_cache(
  async () => {
    const supabase = getServiceClient();

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
          source: "live" as const,
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:config"
    );

    if (sbResult) return sbResult;

    return {
      election_type: "PRESIDENTIAL",
      title: "Presidential & National Assembly Election",
      subtitle: "16 January 2027",
      date: "2027-01-16",
      total_polling_units: totalPUCount,
      display_status: "WAITING",
      status_label: "AWAITING DATA",
      total_results: 0,
      total_published_results: 0,
      data_status: "UNAVAILABLE" as const,
      source: "live" as const,
    };
  },
  ["config-v3"],
  {
    revalidate: 300,
    tags: ["config"],
  }
);

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

export const getCachedPublicResults = unstable_cache(
  async (params: { limit: number; offset: number; state_id?: string; lga_id?: string; ward_id?: string; polling_unit_id?: string }) => {
    const { limit, offset } = params;
    const supabase = getServiceClient();

    const sbResult = await withTimeout(
      (async () => {
        const displayScale = await getDisplayScale();
        const countQuery = supabase
          .from("mv_public_published_results")
          .select("id", { count: "exact", head: true });

        if (params.state_id) countQuery.eq("state_id", params.state_id);
        if (params.lga_id) countQuery.eq("lga_id", params.lga_id);
        if (params.ward_id) countQuery.eq("ward_id", params.ward_id);
        if (params.polling_unit_id) countQuery.eq("polling_unit_id", params.polling_unit_id);

        const { count } = await countQuery;
        const total = Number(count || 0);

        if (total === 0) {
          return { results: [], pagination: { limit, offset, total: 0, has_next: false, has_prev: false }, source: "live" as const };
        }

        const baseQuery = supabase
          .from("mv_public_published_results")
          .select(`
            id,
            canonical_result_id,
            published_at,
            status,
            valid_votes,
            rejected_votes,
            total_votes,
            election_id,
            polling_unit_id,
            official_code,
            pu_name,
            ward_id,
            ward_name,
            lga_id,
            lga_name,
            state_id,
            state_name,
            latitude,
            longitude,
            registered_voters
          `);

        if (params.state_id) baseQuery.eq("state_id", params.state_id);
        if (params.lga_id) baseQuery.eq("lga_id", params.lga_id);
        if (params.ward_id) baseQuery.eq("ward_id", params.ward_id);
        if (params.polling_unit_id) baseQuery.eq("polling_unit_id", params.polling_unit_id);

        const { data: rows, error } = await baseQuery
          .order("published_at", { ascending: false, nullsFirst: false })
          .range(offset, offset + limit - 1)
          .returns<any[]>();

        if (error) {
          console.warn("[api-cache] public results MV query failed:", error.message);
          return null;
        }

        const canonicalIds = (rows || []).map((r: any) => r.canonical_result_id).filter(Boolean);
        const partyMap = new Map<string, any[]>();

        if (canonicalIds.length > 0) {
          try {
            // Plain select + JS merge: the embedded "parties (...)" join
            // silently returned nothing on some PostgREST states, which
            // emptied every feed row's party chips. Two tiny queries are
            // deterministic and cheap (parties has 9 rows).
            const { data: partyRows, error: partyErr } = await supabase
              .from("canonical_party_results")
              .select("canonical_result_id, party_id, votes")
              .in("canonical_result_id", canonicalIds)
              .returns<any[]>();
            if (partyErr) {
              console.warn("[api-cache] feed party rows failed:", partyErr.message);
            }
            const { data: partyMeta, error: metaErr } = await supabase
              .from("parties")
              .select("id, official_name, abbreviation, color");
            if (metaErr) {
              console.warn("[api-cache] parties meta failed:", metaErr.message);
            }
            const pmeta = new Map<string, any>(
              (partyMeta || []).map((p: any) => [p.id, p])
            );
            if (!partyErr && partyRows) {
              for (const pr of partyRows) {
                const cid = pr.canonical_result_id;
                if (!partyMap.has(cid)) partyMap.set(cid, []);
                const arr = partyMap.get(cid);
                const meta = pmeta.get(pr.party_id);
                if (arr && meta) {
                  arr.push({
                    votes: Number(pr.votes || 0) * displayScale,
                    party: {
                      id: meta.id,
                      name: meta.official_name,
                      abbreviation: meta.abbreviation,
                      color: meta.color,
                    },
                  });
                }
              }
            }
          } catch {}
        }

        const normalized = (rows || []).map((r) => ({
          id: r.id,
          submitted_at: r.published_at,
          verified_at: r.published_at,
          status: r.status,
          valid_votes: Math.round(Number(r.valid_votes || 0) * displayScale),
          rejected_votes: Math.round(Number(r.rejected_votes || 0) * displayScale),
          total_votes: Math.round(Number(r.total_votes || 0) * displayScale),
          election_id: r.election_id,
          polling_unit: {
            id: r.polling_unit_id,
            official_code: r.official_code,
            name: r.pu_name,
            ward_id: r.ward_id,
            ward_name: r.ward_name,
            lga_id: r.lga_id,
            lga_name: r.lga_name,
            state_id: r.state_id,
            state_name: r.state_name,
            latitude: r.latitude,
            longitude: r.longitude,
            registered_voters: Math.round(Number(r.registered_voters || 0) * displayScale),
          },
          party_results: partyMap.get(r.canonical_result_id) || [],
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
          source: "live" as const,
          refreshed_at: new Date().toISOString(),
        };
      })(),
      SB_TIMEOUT_MS,
      "supabase:public-results"
    );

    if (sbResult) return sbResult;

    return {
      results: [],
      pagination: { limit, offset, total: 0, has_next: false, has_prev: false },
      source: "fallback" as const,
      refreshed_at: new Date().toISOString(),
    };
  },
  ["public-results"],
  {
    revalidate: 30,
    tags: ["public-results"],
  }
);

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
          return { incidents: [], pagination: { limit, offset, total: 0 }, source: "live" as const, refreshed_at: new Date().toISOString() };
        }

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
          source: "live" as const,
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
