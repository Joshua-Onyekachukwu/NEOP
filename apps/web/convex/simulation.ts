/**
 * Convex Simulation Engine — Simplified
 *
 * Runs election simulation entirely in Convex.
 * Processes in batches to stay within execution limits.
 */

import { mutation, query } from "./_generated/server";
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

// Simple state list with PU counts
const STATE_DATA = [
  ["Lagos", "SW", 13320], ["Kano", "NW", 11340], ["Rivers", "SS", 6840],
  ["Kaduna", "NW", 6630], ["Oyo", "SW", 6300], ["Delta", "SS", 5280],
  ["Katsina", "NW", 4950], ["Borno", "NE", 4680], ["Jigawa", "NW", 4590],
  ["Benue", "NC", 4230], ["Anambra", "SE", 4140], ["Plateau", "NC", 3960],
  ["Sokoto", "NW", 3960], ["Cross River", "SS", 3690], ["Adamawa", "NE", 3780],
  ["Ogun", "SW", 3600], ["Bauchi", "NE", 4410], ["Niger", "NC", 4050],
  ["Imo", "SE", 3330], ["Abia", "SE", 2970], ["Osun", "SW", 3330],
  ["Zamfara", "NW", 3420], ["Ondo", "SW", 3060], ["Edo", "SS", 2970],
  ["Akwa Ibom", "SS", 3420], ["Kebbi", "NW", 3150], ["Kogi", "NC", 3060],
  ["Enugu", "SE", 2880], ["Nasarawa", "NC", 2700], ["Taraba", "NE", 2250],
  ["Ebonyi", "SE", 2070], ["Gombe", "NE", 1800], ["Ekiti", "SW", 1980],
  ["Yobe", "NE", 2340], ["Kwara", "NC", 1890], ["Bayelsa", "SS", 1890],
  ["FCT", "FC", 2160],
];

/**
 * Seed simulation data — processes a batch of PUs at a time.
 * Call multiple times with offset to process all 188K PUs.
 */
export const seedBatch = mutation({
  args: {
    scenario: v.string(),
    offset: v.number(),     // which PU to start from (0-188041)
    batchSize: v.number(),  // how many PUs to process (max 5000)
  },
  handler: async (ctx, args) => {
    const scenario = args.scenario === "random"
      ? (["landslide", "sweep", "close"] as const)[Math.floor(Math.random() * 3)]
      : args.scenario as string;
    const shares = PARTY_CONFIG[scenario] || PARTY_CONFIG.landslide;

    // Build flat list of all PUs
    const allPUs: { state: string; region: string }[] = [];
    for (const [state, region, count] of STATE_DATA) {
      for (let i = 0; i < count; i++) {
        allPUs.push({ state, region });
      }
    }

    const start = args.offset;
    const end = Math.min(start + args.batchSize, allPUs.length, 188042);
    const batchResults: any[] = [];
    const batchPR: any[] = [];

    const partyTotals: Record<string, number> = {};
    for (const p of PARTIES) partyTotals[p.abbr] = 0;

    for (let i = start; i < end; i++) {
      const pu = allPUs[i];
      const regionMult = REGION_MULT[pu.region] || [1, 1, 1, 1, 1, 1, 1, 1, 1];
      const totalVotes = Math.max(50, Math.round(530 * (0.5 + Math.random())));
      const rejected = Math.round(totalVotes * (0.01 + Math.random() * 0.04));
      const valid = totalVotes - rejected;

      const statusRoll = Math.random();
      const status = statusRoll < 0.05 ? "VERIFIED"
        : statusRoll < 0.12 ? "RESULT_SUBMITTED"
        : statusRoll < 0.20 ? "RESULT_ANNOUNCED"
        : statusRoll < 0.30 ? "COUNTING"
        : statusRoll < 0.40 ? "VOTING"
        : "NOT_STARTED";

      const resultId = `r${i}`;

      batchResults.push({
        polling_unit_id: `pu-${i}`,
        state_id: pu.state,
        state_name: pu.state,
        lga_name: `${pu.state} LGA`,
        ward_name: `Ward ${(i % 20) + 1}`,
        pu_code: `PU-${String(i + 1).padStart(6, "0")}`,
        pu_name: `PU ${String(i + 1).padStart(6, "0")}`,
        region: pu.region,
        election_type: "PRESIDENTIAL",
        valid_votes: valid,
        rejected_votes: rejected,
        total_votes: totalVotes,
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
      votes[8] = Math.max(0, votes[8] + remaining); // ADC gets remainder

      for (let p = 0; p < 9; p++) {
        batchPR.push({
          result_index: p,
          party_id: PARTIES[p].id,
          party_name: PARTIES[p].name,
          party_abbreviation: PARTIES[p].abbr,
          party_color: PARTIES[p].color,
          votes: votes[p],
          region: pu.region,
          state_name: pu.state,
        });
        partyTotals[PARTIES[p].abbr] += votes[p];
      }
    }

    // Insert batch into Convex
    // First insert results, collect IDs
    const resultIds: string[] = [];
    for (const r of batchResults) {
      const id = await ctx.db.insert("results", {
        ...r,
        submitted_at: r.submitted_at,
        verified_at: r.verified_at,
      });
      resultIds.push(id);
    }

    // Insert party results with correct result IDs
    let prIdx = 0;
    for (let ri = 0; ri < batchResults.length; ri++) {
      for (let p = 0; p < 9; p++) {
        const pr = batchPR[prIdx++];
        await ctx.db.insert("party_results", {
          result_id: resultIds[ri] as any,
          party_id: pr.party_id,
          party_name: pr.party_name,
          party_abbreviation: pr.party_abbreviation,
          party_color: pr.party_color,
          votes: pr.votes,
          region: pr.region,
          state_name: pr.state_name,
        });
      }
    }

    // Update progress
    const progress = Math.round((end / 188042) * 100);
    const existing = await ctx.db
      .query("sim_config")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        progress_percent: progress,
        results_processed: end,
        total_results: 188042,
      });
    }

    return {
      batch: `${start}-${end}`,
      processed: end - start,
      total: 188042,
      progress,
      isComplete: end >= 188042,
      partyTotals,
    };
  },
});

/**
 * Finalize simulation — upsert aggregated stats after all batches
 */
export const finalize = mutation({
  args: { scenario: v.string() },
  handler: async (ctx, args) => {
    // Aggregate party totals
    const allPR = await ctx.db.query("party_results").collect();
    const partyTotals: Record<string, number> = {};
    for (const p of PARTIES) partyTotals[p.abbr] = 0;
    for (const pr of allPR) {
      partyTotals[pr.party_abbreviation] = (partyTotals[pr.party_abbreviation] || 0) + pr.votes;
    }
    const grandTotal = Object.values(partyTotals).reduce((s, v) => s + v, 0);

    // Upsert party_totals
    for (const party of PARTIES) {
      const existing = await ctx.db
        .query("party_totals")
        .withIndex("by_abbreviation", (q) => q.eq("party_abbreviation", party.abbr))
        .first();
      const data = {
        party_id: party.id,
        party_name: party.name,
        party_abbreviation: party.abbr,
        party_color: party.color,
        total_votes: partyTotals[party.abbr],
        percentage: grandTotal > 0 ? Number(((partyTotals[party.abbr] / grandTotal) * 100).toFixed(1)) : 0,
        updated_at: Date.now(),
      };
      if (existing) await ctx.db.patch(existing._id, data);
      else await ctx.db.insert("party_totals", data);
    }

    // Upsert global stats
    const allResults = await ctx.db.query("results").collect();
    const totalVotes = allResults.reduce((s, r) => s + r.total_votes, 0);
    const verified = allResults.filter((r) => r.status === "VERIFIED").length;

    const existingStats = await ctx.db
      .query("live_stats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();

    const statsData = {
      key: "global",
      total_polling_units: 188042,
      covered_polling_units: allResults.length,
      verified_polling_units: verified,
      total_votes: totalVotes,
      valid_votes: totalVotes,
      rejected_votes: 0,
      active_pu_count: allResults.length,
      updated_at: Date.now(),
      simulation_running: false,
      scenario: args.scenario,
      election_type: "PRESIDENTIAL",
    };

    if (existingStats) await ctx.db.patch(existingStats._id, statsData);
    else await ctx.db.insert("live_stats", statsData);

    // Mark complete
    const config = await ctx.db
      .query("sim_config")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        status: "COMPLETED",
        progress_percent: 100,
        results_processed: allResults.length,
        total_results: allResults.length,
        completed_at: Date.now(),
      });
    }

    return { success: true, totalVotes, partyTotals };
  },
});

/**
 * Get simulation progress
 */
export const getProgress = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db
      .query("sim_config")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .first();
    return config || { status: "IDLE", progress_percent: 0, results_processed: 0 };
  },
});
