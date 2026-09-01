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

// State list with PU counts matching actual seeded data (5 PUs × 12 wards × LGAs per state)
// Total: 46,560 PUs across 37 states
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
    const end = Math.min(start + args.batchSize, allPUs.length, 46560);
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
    const progress = Math.round((end / 46560) * 100);
    const existing = await ctx.db
      .query("sim_config")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        progress_percent: progress,
        results_processed: end,
        total_results: 46560,
      });
    }

    return {
      batch: `${start}-${end}`,
      processed: end - start,
      total: 46560,
      progress,
      isComplete: end >= 46560,
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
    // Aggregate party totals in batches (avoids loading all 1.7M rows)
    const partyTotals: Record<string, number> = {};
    for (const p of PARTIES) partyTotals[p.abbr] = 0;
    let totalVotes = 0;
    let totalCount = 0;
    let verifiedCount = 0;

    // Process results in batches using cursor pagination
    let cursor: string | null = null;
    while (true) {
      const { page, isDone, continueCursor } = await ctx.db.query("results").order("asc").paginate({ cursor, numItems: 5000 });
      for (const r of page) {
        totalVotes += r.total_votes;
        totalCount++;
        if (r.status === "VERIFIED") verifiedCount++;
      }
      if (isDone) break;
      cursor = continueCursor;
    }

    // Process party_results in batches using cursor pagination
    cursor = null;
    while (true) {
      const { page, isDone, continueCursor } = await ctx.db.query("party_results").order("asc").paginate({ cursor, numItems: 5000 });
      for (const pr of page) {
        partyTotals[pr.party_abbreviation] = (partyTotals[pr.party_abbreviation] || 0) + pr.votes;
      }
      if (isDone) break;
      cursor = continueCursor;
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

    const existingStats = await ctx.db
      .query("live_stats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();

    const statsData = {
      key: "global",
      total_polling_units: 46560,
      covered_polling_units: totalCount,
      verified_polling_units: verifiedCount,
      total_votes: totalVotes,
      valid_votes: totalVotes,
      rejected_votes: 0,
      active_pu_count: totalCount,
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
        results_processed: totalCount,
        total_results: totalCount,
        completed_at: Date.now(),
      });
    }

    return { success: true, totalVotes, partyTotals, totalCount };
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
