/**
 * Convex Queries — Live Dashboard Data
 *
 * These queries auto-update in real-time when the underlying data changes.
 * No polling needed — Convex pushes updates to all connected clients.
 *
 * Usage in React:
 *   const stats = useQuery(api.stats.getGlobalStats);
 *   const parties = useQuery(api.stats.getPartyTotals);
 *   const states = useQuery(api.stats.getStateBreakdown);
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ── Global Stats ──
// Returns the single live_stats document (updated after each simulation batch)
export const getGlobalStats = query({
  args: {},
  handler: async (ctx) => {
    const stats = await ctx.db
      .query("live_stats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();

    if (!stats) {
      return {
        inec_total_polling_units: 188042,
        total_polling_units: 188042,
        covered_polling_units: 0,
        verified_polling_units: 0,
        total_votes: 0,
        active_pu_count: 0,
        coverage_percent: 0,
        verification_percent: 0,
        simulation_running: false,
        last_updated: 0,
      };
    }

    return {
      inec_total_polling_units: 188042,
      total_polling_units: stats.total_polling_units,
      covered_polling_units: stats.covered_polling_units,
      verified_polling_units: stats.verified_polling_units,
      total_votes: stats.total_votes,
      active_pu_count: stats.active_pu_count,
      coverage_percent: stats.total_polling_units > 0
        ? Number(((stats.covered_polling_units / stats.total_polling_units) * 100).toFixed(1))
        : 0,
      verification_percent: stats.total_polling_units > 0
        ? Number(((stats.verified_polling_units / stats.total_polling_units) * 100).toFixed(1))
        : 0,
      simulation_running: stats.simulation_running,
      scenario: stats.scenario,
      election_type: stats.election_type,
      last_updated: stats.updated_at,
    };
  },
});

// ── Party Totals ──
// Returns all parties sorted by votes (leaderboard)
export const getPartyTotals = query({
  args: {},
  handler: async (ctx) => {
    const totals = await ctx.db.query("party_totals").collect();
    const sorted = totals.sort((a, b) => b.total_votes - a.total_votes);
    const grandTotal = sorted.reduce((sum, p) => sum + p.total_votes, 0);

    return sorted.map((p) => ({
      name: p.party_name,
      abbreviation: p.party_abbreviation,
      color: p.party_color,
      total_votes: p.total_votes,
      percentage: grandTotal > 0
        ? Number(((p.total_votes / grandTotal) * 100).toFixed(1))
        : 0,
    }));
  },
});

// ── State Breakdown ──
// Returns all states with per-party vote breakdown
export const getStateBreakdown = query({
  args: {},
  handler: async (ctx) => {
    const states = await ctx.db.query("state_stats").collect();
    return states
      .sort((a, b) => b.total_pus - a.total_pus)
      .map((s) => ({
        state_name: s.state_name,
        state_id: s.state_id,
        region: s.region,
        total_pus: s.total_pus,
        covered_pus: s.covered_pus,
        verified_pus: s.verified_pus,
        total_votes: s.total_votes,
        ndc_votes: s.ndc_votes,
        apc_votes: s.apc_votes,
        pdp_votes: s.pdp_votes,
        lp_votes: s.lp_votes,
        nnpp_votes: s.nnpp_votes,
        apga_votes: s.apga_votes,
        sdp_votes: s.sdp_votes,
        ypp_votes: s.ypp_votes,
        adc_votes: s.adc_votes,
        coverage_percent: s.total_pus > 0
          ? Number(((s.covered_pus / s.total_pus) * 100).toFixed(1))
          : 0,
      }));
  },
});

// ── Simulation Config ──
// Returns current simulation state
export const getSimConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db
      .query("sim_config")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .first();

    return config || {
      status: "IDLE",
      scenario: "random",
      election_type: "PRESIDENTIAL",
      progress_percent: 0,
      results_processed: 0,
      total_results: 0,
    };
  },
});

// ── Recent Results Feed ──
// Returns latest results for the feed component
export const getRecentResults = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const results = await ctx.db
      .query("results")
      .order("desc")
      .take(limit);

    return results.map((r) => ({
      id: r._id,
      polling_unit_code: r.pu_code,
      polling_unit_name: r.pu_name,
      state: r.state_name,
      valid_votes: r.valid_votes,
      rejected_votes: r.rejected_votes,
      total_votes: r.total_votes,
      status: r.status,
      submitted_at: r.submitted_at,
      scenario: r.scenario,
    }));
  },
});

// ── Status Distribution ──
// Returns count of PUs per status for charts
export const getStatusDistribution = query({
  args: {},
  handler: async (ctx) => {
    const results = await ctx.db.query("results").collect();
    const dist: Record<string, number> = {};
    for (const r of results) {
      dist[r.status] = (dist[r.status] || 0) + 1;
    }
    return dist;
  },
});

// ── Seed/Mutations for Simulation ──

// Write a batch of results (called by the simulation engine)
export const insertResultsBatch = mutation({
  args: {
    results: v.array(
      v.object({
        polling_unit_id: v.string(),
        state_id: v.string(),
        state_name: v.string(),
        lga_name: v.string(),
        ward_name: v.string(),
        pu_code: v.string(),
        pu_name: v.string(),
        region: v.string(),
        election_type: v.string(),
        valid_votes: v.number(),
        rejected_votes: v.number(),
        total_votes: v.number(),
        status: v.string(),
        submitted_at: v.number(),
        verified_at: v.optional(v.number()),
        scenario: v.string(),
      })
    ),
    party_results: v.array(
      v.object({
        result_index: v.number(), // index into results array
        party_id: v.string(),
        party_name: v.string(),
        party_abbreviation: v.string(),
        party_color: v.string(),
        votes: v.number(),
        region: v.string(),
        state_name: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Insert results and collect their IDs
    const resultIds: string[] = [];
    for (const r of args.results) {
      const id = await ctx.db.insert("results", r);
      resultIds.push(id);
    }

    // Insert party results with correct result IDs
    for (const pr of args.party_results) {
      await ctx.db.insert("party_results", {
        result_id: resultIds[pr.result_index] as any,
        party_id: pr.party_id,
        party_name: pr.party_name,
        party_abbreviation: pr.party_abbreviation,
        party_color: pr.party_color,
        votes: pr.votes,
        region: pr.region,
        state_name: pr.state_name,
      });
    }

    return { inserted: resultIds.length };
  },
});

// Update global stats
export const upsertGlobalStats = mutation({
  args: {
    covered_polling_units: v.number(),
    verified_polling_units: v.number(),
    total_votes: v.number(),
    active_pu_count: v.number(),
    simulation_running: v.boolean(),
    scenario: v.optional(v.string()),
    election_type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("live_stats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();

    const data = {
      key: "global",
      total_polling_units: 188042,
      ...args,
      updated_at: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("live_stats", data);
    }
  },
});

// Upsert party totals
export const upsertPartyTotals = mutation({
  args: {
    parties: v.array(
      v.object({
        party_id: v.string(),
        party_name: v.string(),
        party_abbreviation: v.string(),
        party_color: v.string(),
        total_votes: v.number(),
        percentage: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const p of args.parties) {
      const existing = await ctx.db
        .query("party_totals")
        .withIndex("by_abbreviation", (q) => q.eq("party_abbreviation", p.party_abbreviation))
        .first();

      const data = { ...p, updated_at: Date.now() };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("party_totals", data);
      }
    }
  },
});

// Upsert state stats
export const upsertStateStats = mutation({
  args: {
    states: v.array(
      v.object({
        state_id: v.string(),
        state_name: v.string(),
        region: v.string(),
        total_pus: v.number(),
        covered_pus: v.number(),
        verified_pus: v.number(),
        total_votes: v.number(),
        ndc_votes: v.number(),
        apc_votes: v.number(),
        pdp_votes: v.number(),
        lp_votes: v.number(),
        nnpp_votes: v.number(),
        apga_votes: v.number(),
        sdp_votes: v.number(),
        ypp_votes: v.number(),
        adc_votes: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const s of args.states) {
      const existing = await ctx.db
        .query("state_stats")
        .withIndex("by_state", (q) => q.eq("state_name", s.state_name))
        .first();

      const data = { ...s, updated_at: Date.now() };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("state_stats", data);
      }
    }
  },
});

// Update simulation config
export const updateSimConfig = mutation({
  args: {
    status: v.optional(v.string()),
    scenario: v.optional(v.string()),
    election_type: v.optional(v.string()),
    progress_percent: v.optional(v.number()),
    results_processed: v.optional(v.number()),
    total_results: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sim_config")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .first();

    const updates: Record<string, any> = {};
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined) updates[k] = v;
    }
    updates.updated_at = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("sim_config", {
        key: "current",
        status: "IDLE",
        scenario: "random",
        election_type: "PRESIDENTIAL",
        total_voters: 100_000_000,
        duration_minutes: 5,
        results_processed: 0,
        total_results: 0,
        progress_percent: 0,
        ...updates,
      });
    }
  },
});

// Clear all simulation data
export const clearSimulationData = mutation({
  args: {},
  handler: async (ctx) => {
    // Delete all results
    const results = await ctx.db.query("results").collect();
    for (const r of results) await ctx.db.delete(r._id);

    // Delete all party_results
    const prs = await ctx.db.query("party_results").collect();
    for (const pr of prs) await ctx.db.delete(pr._id);

    // Delete all state_stats
    const states = await ctx.db.query("state_stats").collect();
    for (const s of states) await ctx.db.delete(s._id);

    // Delete all party_totals
    const parties = await ctx.db.query("party_totals").collect();
    for (const p of parties) await ctx.db.delete(p._id);

    // Reset live_stats
    const stats = await ctx.db.query("live_stats").collect();
    for (const s of stats) await ctx.db.delete(s._id);

    // Reset sim_config
    const configs = await ctx.db.query("sim_config").collect();
    for (const c of configs) await ctx.db.delete(c._id);

    return { cleared: true };
  },
});
