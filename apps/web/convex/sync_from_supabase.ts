/**
 * Convex Action — Sync simulation data from Supabase to Convex
 *
 * Called after each simulation run to populate Convex with the latest data.
 * This is a one-time sync per simulation — after this, Convex handles real-time.
 *
 * Flow:
 *   Admin runs simulation → Supabase (run_fast_simulation) → This sync action → Convex
 *   Live dashboard → Convex useQuery (real-time push, no polling)
 */

import { action } from "./_generated/server";
import { v } from "convex/values";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Party abbreviation → color mapping
const PARTY_COLORS: Record<string, string> = {
  NDC: "#1B5E20",
  APC: "#00A859",
  PDP: "#000080",
  LP: "#FF0000",
  NNPP: "#E53935",
  APGA: "#FFD600",
  SDP: "#1565C0",
  YPP: "#6A1B9A",
  ADC: "#00838F",
};

const PARTY_NAMES: Record<string, string> = {
  NDC: "Nigeria Democratic Congress",
  APC: "All Progressives Congress",
  PDP: "Peoples Democratic Party",
  LP: "Labour Party",
  NNPP: "New Nigeria Peoples Party",
  APGA: "All Progressives Grand Alliance",
  SDP: "Social Democratic Party",
  YPP: "Young Progressives Party",
  ADC: "African Democratic Congress",
};

const REGION_MAP: Record<string, string> = {
  Kano: "NW", Katsina: "NW", Sokoto: "NW", Zamfara: "NW", Kebbi: "NW", Jigawa: "NW", Kaduna: "NW",
  Borno: "NE", Yobe: "NE", Adamawa: "NE", Gombe: "NE", Taraba: "NE", Bauchi: "NE",
  Niger: "NC", Kwara: "NC", Kogi: "NC", Benue: "NC", Plateau: "NC", Nasarawa: "NC",
  Lagos: "SW", Ogun: "SW", Oyo: "SW", Ondo: "SW", Osun: "SW", Ekiti: "SW",
  Abia: "SE", Anambra: "SE", Ebonyi: "SE", Enugu: "SE", Imo: "SE",
  Rivers: "SS", Delta: "SS", Bayelsa: "SS", "Akwa Ibom": "SS", "Cross River": "SS", Edo: "SS",
  FCT: "FC",
};

/**
 * Sync all simulation data from Supabase to Convex.
 * Reads in batches to handle 188K+ rows.
 */
export const syncSimulationToConvex = action({
  args: {},
  handler: async (ctx) => {
    console.log("[sync] Starting Supabase → Convex sync...");

    // 1. Fetch all results from Supabase in batches
    const allResults: any[] = [];
    const allPartyResults: any[] = [];
    let offset = 0;
    const batchSize = 5000;

    while (true) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/result_submissions?select=*,polling_units(id,official_code,name,state_id,states(id,name,code),lgas(id,name),wards(id,name))&order=submitted_at.desc&offset=${offset}&limit=${batchSize}`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      if (!res.ok) break;
      const data = await res.json();
      if (data.length === 0) break;

      allResults.push(...data);
      offset += batchSize;

      // Also fetch party results for this batch
      const resultIds = data.map((r: any) => r.id);
      const prRes = await fetch(
        `${SUPABASE_URL}/rest/v1/party_results?select=*,parties(abbreviation,name,color)&result_submission_id=in.(${resultIds.join(",")})`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      if (prRes.ok) {
        const prData = await prRes.json();
        allPartyResults.push(...prData);
      }

      if (data.length < batchSize) break;
    }

    console.log(`[sync] Fetched ${allResults.length} results, ${allPartyResults.length} party results`);

    // 2. Group party results by submission
    const prByResult: Record<string, any[]> = {};
    for (const pr of allPartyResults) {
      const key = pr.result_submission_id;
      if (!prByResult[key]) prByResult[key] = [];
      prByResult[key].push(pr);
    }

    // 3. Build aggregated data
    const stateStats: Record<string, any> = {};
    const partyTotals: Record<string, number> = {};
    let totalVotes = 0;
    let coveredCount = 0;
    let verifiedCount = 0;

    for (const r of allResults) {
      const stateName = r.polling_units?.states?.name || "Unknown";
      const region = REGION_MAP[stateName] || "NC";

      if (!stateStats[stateName]) {
        stateStats[stateName] = {
          state_id: r.polling_units?.states?.id || "",
          state_name: stateName,
          region,
          total_pus: 0,
          covered_pus: 0,
          verified_pus: 0,
          total_votes: 0,
          ndc_votes: 0, apc_votes: 0, pdp_votes: 0, lp_votes: 0, nnpp_votes: 0, apga_votes: 0, sdp_votes: 0, ypp_votes: 0, adc_votes: 0,
        };
      }

      stateStats[stateName].total_pus++;
      stateStats[stateName].covered_pus++;
      stateStats[stateName].total_votes += r.total_votes || 0;
      totalVotes += r.total_votes || 0;
      coveredCount++;

      if (r.status === "VERIFIED") {
        stateStats[stateName].verified_pus++;
        verifiedCount++;
      }

      // Aggregate party votes
      const prs = prByResult[r.id] || [];
      for (const pr of prs) {
        const abbr = pr.parties?.abbreviation || "?";
        const votes = pr.votes || 0;
        partyTotals[abbr] = (partyTotals[abbr] || 0) + votes;

        // State-level party votes
        const stateKey = `${abbr}_votes`;
        if (stateStats[stateName][stateKey] !== undefined) {
          stateStats[stateName][stateKey] += votes;
        }
      }
    }

    // 4. Upsert into Convex
    const grandTotal = Object.values(partyTotals).reduce((a, b) => a + b, 0);

    // Upsert party totals
    const parties = Object.entries(partyTotals)
      .map(([abbr, votes]) => ({
        party_id: abbr,
        party_name: PARTY_NAMES[abbr] || abbr,
        party_abbreviation: abbr,
        party_color: PARTY_COLORS[abbr] || "#6B7280",
        total_votes: votes,
        percentage: grandTotal > 0 ? Number(((votes / grandTotal) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.total_votes - a.total_votes);

    await ctx.runMutation("stats:upsertPartyTotals" as any, { parties });

    // Upsert state stats
    const states = Object.values(stateStats).sort((a: any, b: any) => b.total_pus - a.total_pus);
    await ctx.runMutation("stats:upsertStateStats" as any, { states });

    // Upsert global stats
    await ctx.runMutation("stats:upsertGlobalStats" as any, {
      covered_polling_units: coveredCount,
      verified_polling_units: verifiedCount,
      total_votes: totalVotes,
      active_pu_count: coveredCount,
      simulation_running: false,
    });

    // Mark simulation as complete
    await ctx.runMutation("stats:updateSimConfig" as any, {
      status: "COMPLETED",
      progress_percent: 100,
      results_processed: allResults.length,
      total_results: allResults.length,
    });

    console.log(`[sync] Complete: ${allResults.length} results, ${parties.length} parties, ${states.length} states`);

    return {
      results_synced: allResults.length,
      party_results_synced: allPartyResults.length,
      parties: parties.length,
      states: states.length,
      total_votes: totalVotes,
    };
  },
});
