/**
 * Convex Action — Run Full Election Simulation
 *
 * Runs the entire simulation in Convex, processing PUs in batches.
 * Called by the admin trigger endpoint (fire-and-forget).
 *
 * NOTE: This action does NOT clear previous data. The admin should
 * call clearAllData action before triggering a new simulation.
 *
 * Flow:
 *   1. Set sim_config to RUNNING
 *   2. Process PUs in batches of 2000
 *   3. After each batch, update live_stats and party_totals
 *   4. After all batches, mark as COMPLETED
 *
 * For 46,560 PUs with batch size 2000 = ~24 batches
 */

import { action } from "./_generated/server";
import { v } from "convex/values";
import { PARTIES, PARTY_SHARES, REGION_MULT } from "./party-config";

const PARTY_CONFIG = PARTY_SHARES;

const STATE_DATA: [string, string, number][] = [
  ["Lagos", "SW", 1200], ["Kano", "NW", 2640], ["Rivers", "SS", 1380],
  ["Kaduna", "NW", 1380], ["Oyo", "SW", 1980], ["Delta", "SS", 1500],
  ["Katsina", "NW", 2040], ["Borno", "NE", 1620], ["Jigawa", "NW", 1620],
  ["Benue", "NC", 1380], ["Anambra", "SE", 1260], ["Plateau", "NC", 1020],
  ["Sokoto", "NW", 1380], ["Cross River", "SS", 1080], ["Adamawa", "NE", 1260],
  ["Ogun", "SW", 1200], ["Bauchi", "NE", 1200], ["Niger", "NC", 1500],
  ["Imo", "SE", 1620], ["Abia", "SE", 1020], ["Osun", "SW", 1800],
  ["Zamfara", "NW", 840], ["Ondo", "SW", 1080], ["Edo", "SS", 1080],
  ["Akwa Ibom", "SS", 1860], ["Kebbi", "NW", 1380], ["Kogi", "NC", 1260],
  ["Enugu", "SE", 1020], ["Nasarawa", "NC", 780], ["Taraba", "NE", 960],
  ["Ebonyi", "SE", 780], ["Gombe", "NE", 660], ["Ekiti", "SW", 960],
  ["Yobe", "NE", 1020], ["Kwara", "NC", 960], ["Bayelsa", "SS", 480],
  ["FCT", "FC", 360],
];

const TOTAL_PUS = 46560;
const BATCH_SIZE = 2000; // ~24 batches for 46,560 PUs

/**
 * Run the full election simulation.
 * Computes aggregates incrementally — no separate finalize step needed.
 */
export const runSimulation = action({
  args: {
    scenario: v.string(),
    electionType: v.optional(v.string()),
    totalVoters: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const scenario = args.scenario === "random"
      ? (["landslide", "sweep", "close"] as const)[Math.floor(Math.random() * 3)]
      : args.scenario;
    const electionType = args.electionType || "PRESIDENTIAL";
    const totalVoters = args.totalVoters || 100_000_000;

    console.log(`[runSimulation] Starting: scenario=${scenario}, type=${electionType}, voters=${totalVoters}`);

    // Set sim_config to RUNNING
    await ctx.runMutation("stats:updateSimConfig" as any, {
      status: "RUNNING",
      scenario,
      election_type: electionType,
      started_at: Date.now(),
    });

    const shares = PARTY_CONFIG[scenario] || PARTY_CONFIG.landslide;

    // Build flat list of all PUs
    const allPUs: { state: string; region: string }[] = [];
    for (const [state, region, count] of STATE_DATA) {
      for (let i = 0; i < count; i++) {
        allPUs.push({ state, region });
      }
    }

    // Running aggregates (computed incrementally — no finalize needed)
    const runningPartyTotals: Record<string, number> = {};
    const runningStateStats: Record<string, {
      region: string;
      total_pus: number;
      covered_pus: number;
      verified_pus: number;
      total_votes: number;
      ndc_votes: number;
      apc_votes: number;
      pdp_votes: number;
      lp_votes: number;
      nnpp_votes: number;
      apga_votes: number;
      sdp_votes: number;
      ypp_votes: number;
      adc_votes: number;
    }> = {};
    for (const p of PARTIES) runningPartyTotals[p.abbr] = 0;
    let totalVotes = 0;
    let totalValidVotes = 0;
    let totalRejectedVotes = 0;
    let processedCount = 0;
    let verifiedCount = 0;

    // Initialize state stats
    for (const [state, region] of STATE_DATA) {
      runningStateStats[state] = {
        region,
        total_pus: 0,
        covered_pus: 0,
        verified_pus: 0,
        total_votes: 0,
        ndc_votes: 0,
        apc_votes: 0,
        pdp_votes: 0,
        lp_votes: 0,
        nnpp_votes: 0,
        apga_votes: 0,
        sdp_votes: 0,
        ypp_votes: 0,
        adc_votes: 0,
      };
    }

    for (let offset = 0; offset < TOTAL_PUS; offset += BATCH_SIZE) {
      const end = Math.min(offset + BATCH_SIZE, TOTAL_PUS);
      const batchResults: any[] = [];
      const batchPR: any[] = [];

      for (let i = offset; i < end; i++) {
        const pu = allPUs[i];
        const regionMult = REGION_MULT[pu.region] || [1, 1, 1, 1, 1, 1, 1, 1, 1];

        // Scale registered voters by totalVoters / total_PUs
        const avgVotersPerPU = Math.floor(totalVoters / TOTAL_PUS);
        const registeredVoters = Math.max(100, Math.round(avgVotersPerPU * (0.3 + Math.random() * 1.4)));
        const turnoutRate = 0.3 + Math.random() * 0.5;
        const totalVotesPU = Math.max(50, Math.round(registeredVoters * turnoutRate));
        const rejected = Math.round(totalVotesPU * (0.01 + Math.random() * 0.04));
        const valid = totalVotesPU - rejected;

        const statusRoll = Math.random();
        const status = statusRoll < 0.05 ? "VERIFIED"
          : statusRoll < 0.12 ? "RESULT_SUBMITTED"
          : statusRoll < 0.20 ? "RESULT_ANNOUNCED"
          : statusRoll < 0.30 ? "COUNTING"
          : statusRoll < 0.40 ? "VOTING"
          : "NOT_STARTED";

        batchResults.push({
          polling_unit_id: `pu-${i}`,
          state_id: pu.state,
          state_name: pu.state,
          lga_name: `${pu.state} LGA`,
          ward_name: `Ward ${(i % 20) + 1}`,
          pu_code: `PU-${String(i + 1).padStart(6, "0")}`,
          pu_name: `PU ${String(i + 1).padStart(6, "0")}`,
          region: pu.region,
          election_type: electionType,
          valid_votes: valid,
          rejected_votes: rejected,
          total_votes: totalVotesPU,
          status,
          submitted_at: Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000,
          verified_at: status === "VERIFIED" ? Date.now() : undefined,
          scenario,
        });

        // Calculate party votes
        let remaining = valid;
        const votes: number[] = [];
        for (let p = 0; p < 9; p++) {
          const v = Math.max(0, Math.round(valid * shares[p] * regionMult[p] * (0.7 + Math.random() * 0.6)));
          votes.push(v);
          remaining -= v;
        }
        votes[8] = Math.max(0, votes[8] + remaining);

        // Accumulate into running aggregates
        totalVotes += totalVotesPU;
        totalValidVotes += valid;
        totalRejectedVotes += rejected;
        if (status === "VERIFIED") verifiedCount++;

        const ss = runningStateStats[pu.state];
        ss.total_pus++;
        ss.covered_pus++;
        if (status === "VERIFIED") ss.verified_pus++;
        ss.total_votes += totalVotesPU;
        ss.ndc_votes += votes[0];
        ss.apc_votes += votes[1];
        ss.pdp_votes += votes[2];
        ss.lp_votes += votes[3];
        ss.nnpp_votes += votes[4];
        ss.apga_votes += votes[5];
        ss.sdp_votes += votes[6];
        ss.ypp_votes += votes[7];
        ss.adc_votes += votes[8];

        for (let p = 0; p < 9; p++) {
          runningPartyTotals[PARTIES[p].abbr] += votes[p];
          batchPR.push({
            result_index: batchResults.length - 1,
            party_id: PARTIES[p].id,
            party_name: PARTIES[p].name,
            party_abbreviation: PARTIES[p].abbr,
            party_color: PARTIES[p].color,
            votes: votes[p],
            region: pu.region,
            state_name: pu.state,
          });
        }
      }

      // Insert batch into Convex — split results and party_results
      const insertRes: any = await ctx.runMutation("stats:insertResultsBatch" as any, {
        results: batchResults,
      });
      const resultIds: string[] = insertRes.resultIds || [];

      // Insert party_results in chunks of 8000 (Convex array limit: 8192)
      const CHUNK = 8000;
      for (let ci = 0; ci < batchPR.length; ci += CHUNK) {
        const chunk = batchPR.slice(ci, ci + CHUNK);
        await ctx.runMutation("stats:insertPartyResultsBatch" as any, {
          resultIds,
          partyResults: chunk.map((pr: any) => ({
            resultOffset: pr.result_index,
            party_id: pr.party_id,
            party_name: pr.party_name,
            party_abbreviation: pr.party_abbreviation,
            party_color: pr.party_color,
            votes: pr.votes,
            region: pr.region,
            state_name: pr.state_name,
          })),
        });
      }

      processedCount = end;
      const progress = Math.round((processedCount / TOTAL_PUS) * 100);

      // Update sim_config progress
      await ctx.runMutation("stats:updateSimConfig" as any, {
        progress_percent: progress,
        results_processed: processedCount,
        total_results: TOTAL_PUS,
      });

      console.log(`[runSimulation] Batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${processedCount}/${TOTAL_PUS} (${progress}%)`);
    }

    // ── Finalize aggregates in one shot (small data: 37 states + 9 parties + 1 global) ──

    const grandTotal = Object.values(runningPartyTotals).reduce((s, v) => s + v, 0);

    // Upsert party_totals (9 docs)
    await ctx.runMutation("stats:upsertPartyTotals" as any, {
      parties: PARTIES.map((p) => ({
        party_id: p.id,
        party_name: p.name,
        party_abbreviation: p.abbr,
        party_color: p.color,
        total_votes: runningPartyTotals[p.abbr],
        percentage: grandTotal > 0
          ? Number(((runningPartyTotals[p.abbr] / grandTotal) * 100).toFixed(1))
          : 0,
      })),
    });

    // Upsert state_stats (37 docs)
    const stateEntries = STATE_DATA.map(([state]) => {
      const ss = runningStateStats[state];
      return {
        state_id: state,
        state_name: state,
        region: ss.region,
        total_pus: ss.total_pus,
        covered_pus: ss.covered_pus,
        verified_pus: ss.verified_pus,
        total_votes: ss.total_votes,
        ndc_votes: ss.ndc_votes,
        apc_votes: ss.apc_votes,
        pdp_votes: ss.pdp_votes,
        lp_votes: ss.lp_votes,
        nnpp_votes: ss.nnpp_votes,
        apga_votes: ss.apga_votes,
        sdp_votes: ss.sdp_votes,
        ypp_votes: ss.ypp_votes,
        adc_votes: ss.adc_votes,
      };
    });
    await ctx.runMutation("stats:upsertStateStats" as any, { states: stateEntries });

    // Upsert global live_stats (1 doc)
    await ctx.runMutation("stats:upsertGlobalStats" as any, {
      covered_polling_units: processedCount,
      verified_polling_units: verifiedCount,
      total_votes: totalVotes,
      valid_votes: totalValidVotes,
      rejected_votes: totalRejectedVotes,
      active_pu_count: processedCount,
      simulation_running: false,
      scenario,
      election_type: electionType,
    });

    // Mark simulation complete
    await ctx.runMutation("stats:updateSimConfig" as any, {
      status: "COMPLETED",
      progress_percent: 100,
      completed_at: Date.now(),
    });

    console.log(`[runSimulation] Complete: ${processedCount} PUs, ${totalVotes} total votes`);

    return {
      success: true,
      scenario,
      electionType,
      totalPUs: processedCount,
      totalVotes,
      grandTotal,
    };
  },
});
