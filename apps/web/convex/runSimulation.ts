/**
 * Convex Action — Run Full Election Simulation
 *
 * Runs the entire simulation in Convex, processing PUs in batches.
 * This is called by the admin trigger endpoint (fire-and-forget).
 *
 * Flow:
 *   1. Set sim_config to RUNNING
 *   2. Process PUs in batches of 2000 (stay within execution limits)
 *   3. After all batches, aggregate stats
 *   4. Mark as COMPLETED
 *
 * For 46,560 PUs with batch size 2000 = ~24 batches
 * Each batch takes ~2-3 seconds = ~60-70 seconds total
 */

import { action } from "./_generated/server";
import { v } from "convex/values";

const PARTIES = [
  { id: "ndc", name: "Nigeria Democratic Congress", abbr: "NDC", color: "#1B5E20" },
  { id: "apc", name: "All Progressives Congress", abbr: "APC", color: "#00A859" },
  { id: "pdp", name: "Peoples Democratic Party", abbr: "PDP", color: "#000080" },
  { id: "lp", name: "Labour Party", abbr: "LP", color: "#FF0000" },
  { id: "nnpp", name: "New Nigeria Peoples Party", abbr: "NNPP", color: "#E53935" },
  { id: "apga", name: "All Progressives Grand Alliance", abbr: "APGA", color: "#FFD600" },
  { id: "sdp", name: "Social Democratic Party", abbr: "SDP", color: "#1565C0" },
  { id: "ypp", name: "Young Progressives Party", abbr: "YPP", color: "#6A1B9A" },
  { id: "adc", name: "African Democratic Congress", abbr: "ADC", color: "#00838F" },
];

const PARTY_CONFIG: Record<string, number[]> = {
  landslide: [0.42, 0.22, 0.10, 0.08, 0.06, 0.04, 0.03, 0.03, 0.02],
  sweep: [0.37, 0.25, 0.10, 0.08, 0.06, 0.04, 0.03, 0.04, 0.03],
  close: [0.30, 0.28, 0.12, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03],
};

const REGION_MULT: Record<string, number[]> = {
  NW: [0.6, 1.4, 0.8, 0.5, 1.3, 0.7, 0.6, 0.5, 0.6],
  NE: [0.7, 1.3, 0.9, 0.6, 1.2, 0.8, 0.7, 0.6, 0.7],
  NC: [1.0, 1.1, 1.0, 0.8, 0.9, 0.9, 1.0, 0.8, 0.9],
  SW: [0.5, 1.5, 1.1, 0.7, 0.8, 1.2, 0.9, 0.7, 0.8],
  SE: [1.9, 0.3, 0.8, 1.8, 0.5, 1.5, 0.7, 0.9, 0.6],
  SS: [1.6, 0.4, 1.2, 1.4, 0.6, 0.7, 0.8, 0.7, 0.6],
  FC: [1.2, 1.0, 0.9, 1.1, 0.8, 0.8, 1.0, 0.9, 0.8],
};

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
const BATCH_SIZE = 800; // 800 PUs × 9 parties = 7200 party_results (under 8192 limit)

/**
 * Run the full election simulation.
 * Called once by the admin trigger endpoint.
 * Processes all PUs in batches internally.
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

    console.log(`[runSimulation] Starting: scenario=${scenario}, type=${electionType}`);

    // 1. Clear existing simulation data
    await ctx.runMutation("stats:clearSimulationData" as any, {});

    // 2. Set sim_config to RUNNING
    await ctx.runMutation("stats:updateSimConfig" as any, {
      status: "RUNNING",
      scenario,
      election_type: electionType,
      started_at: Date.now(),
    });

    // 3. Process PUs in batches
    const shares = PARTY_CONFIG[scenario] || PARTY_CONFIG.landslide;

    // Build flat list of all PUs
    const allPUs: { state: string; region: string }[] = [];
    for (const [state, region, count] of STATE_DATA) {
      for (let i = 0; i < count; i++) {
        allPUs.push({ state, region });
      }
    }

    let totalVotes = 0;
    let processedCount = 0;

    for (let offset = 0; offset < TOTAL_PUS; offset += BATCH_SIZE) {
      const end = Math.min(offset + BATCH_SIZE, TOTAL_PUS);
      const batchResults: any[] = [];
      const batchPR: any[] = [];

      for (let i = offset; i < end; i++) {
        const pu = allPUs[i];
        const regionMult = REGION_MULT[pu.region] || [1, 1, 1, 1, 1, 1, 1, 1, 1];

        // Realistic vote counts based on registered voters per PU
        const registeredVoters = 500 + Math.floor(Math.random() * 2000);
        const turnoutRate = 0.3 + Math.random() * 0.5; // 30-80% turnout
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

        for (let p = 0; p < 9; p++) {
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

        totalVotes += totalVotesPU;
      }

      // Insert batch into Convex
      await ctx.runMutation("stats:insertResultsBatch" as any, {
        results: batchResults,
        party_results: batchPR,
      });

      processedCount = end;
      const progress = Math.round((processedCount / TOTAL_PUS) * 100);

      // Update progress
      await ctx.runMutation("stats:updateSimConfig" as any, {
        progress_percent: progress,
        results_processed: processedCount,
        total_results: TOTAL_PUS,
      });

      console.log(`[runSimulation] Batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${processedCount}/${TOTAL_PUS} (${progress}%)`);
    }

    // 4. Mark simulation complete
    // (Aggregated stats computed lazily by queries, not in this action)
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
    };
  },
});
