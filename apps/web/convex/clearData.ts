/**
 * Convex Action — Clear All Simulation Data
 *
 * Safely clears all simulation data by calling clearBatch mutation
 * repeatedly. Convex mutations have a 32K doc scan limit, so we
 * must delete in small batches via separate mutation calls.
 *
 * Called by the admin trigger endpoint before starting a new simulation.
 */

import { action } from "./_generated/server";

const TABLES = ["party_results", "results", "state_stats", "party_totals", "live_stats", "sim_config"] as const;

export const clearAllData = action({
  args: {},
  handler: async (ctx) => {
    let totalDeleted = 0;

    for (const table of TABLES) {
      let hasMore = true;
      let batchCount = 0;
      while (hasMore) {
        const result = await ctx.runMutation("stats:clearBatchFast" as any, {
          table,
        });
        totalDeleted += result.deleted;
        hasMore = result.hasMore;
        batchCount++;
        // Safety: max 100 batches per table (500K docs max per table)
        if (batchCount > 100) break;
      }
      console.log(`[clearAllData] Cleared ${table}: ${batchCount} batches`);
    }

    return { cleared: true, totalDeleted };
  },
});
