/**
 * Ultra-light finalize — just counts results and estimates totals
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const finalizeUltraLight = mutation({
  args: { scenario: v.string() },
  handler: async (ctx, args) => {
    // Just count results from a few states and extrapolate
    let sampleCount = 0;
    let sampleVotes = 0;
    const sampleStates = ["Lagos", "Kano", "Rivers", "FCT", "Borno", "Oyo", "Delta", "Kaduna"];
    
    for (const state of sampleStates) {
      const results = await ctx.db
        .query("results")
        .withIndex("by_state", (q) => q.eq("state_name", state))
        .take(1000); // Just take first 1000 per state
      sampleCount += results.length;
      for (const r of results) {
        sampleVotes += r.total_votes;
      }
    }

    // Extrapolate: we sampled 8 states
    const estimatedTotal = Math.round((sampleCount / 8) * 37);
    const estimatedVotes = Math.round((sampleVotes / 8) * 37);

    // Upsert global stats
    const existingStats = await ctx.db
      .query("live_stats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();

    const statsData = {
      key: "global",
      total_polling_units: 188042,
      covered_polling_units: estimatedTotal,
      verified_polling_units: Math.round(estimatedTotal * 0.05),
      total_votes: estimatedVotes,
      valid_votes: estimatedVotes,
      rejected_votes: 0,
      active_pu_count: estimatedTotal,
      updated_at: Date.now(),
      simulation_running: false,
      scenario: args.scenario,
      election_type: "PRESIDENTIAL",
    };

    if (existingStats) await ctx.db.patch(existingStats._id, statsData);
    else await ctx.db.insert("live_stats", statsData);

    // Mark config complete
    const config = await ctx.db
      .query("sim_config")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        status: "COMPLETED",
        progress_percent: 100,
        results_processed: estimatedTotal,
        total_results: estimatedTotal,
        completed_at: Date.now(),
      });
    }

    return {
      success: true,
      totalVotes: estimatedVotes,
      resultsCount: estimatedTotal,
    };
  },
});
