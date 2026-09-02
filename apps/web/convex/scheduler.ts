/**
 * Convex Scheduling Helper
 *
 * Provides mutations to schedule simulations for delayed execution.
 * Uses Convex's built-in ctx.scheduler.runAfter() and ctx.scheduler.runAt().
 *
 * Usage from admin:
 *   1. Admin sets scheduled_at timestamp
 *   2. scheduleSimulation mutation is called
 *   3. Convex scheduler triggers runSimulationV2 at the specified time
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Schedule a simulation to run after a delay (in milliseconds).
 * Called by the admin trigger endpoint when delay_ms is set.
 */
export const scheduleSimulationDelayed = mutation({
  args: {
    delayMs: v.number(),
    config: v.object({
      scenario: v.string(),
      election_type: v.string(),
      target_voters: v.number(),
      random_seed: v.number(),
      batch_size: v.number(),
      pu_failure_rate: v.number(),
      turnout_min: v.number(),
      turnout_max: v.number(),
      geographic_scope: v.string(),
      simulation_speed: v.number(),
    }),
    supabaseUrl: v.string(),
    supabaseKey: v.string(),
  },
  handler: async (ctx, args) => {
    // Update sim_config to show scheduled status
    await ctx.runMutation("stats:updateSimConfig" as any, {
      status: "SCHEDULED",
      scheduled_at: Date.now() + args.delayMs,
    });

    // Schedule the simulation action
    await ctx.scheduler.runAfter(args.delayMs, "simEngineV2:runSimulationV2" as any, {
      config: args.config,
      supabaseUrl: args.supabaseUrl,
      supabaseKey: args.supabaseKey,
    });

    return {
      scheduled: true,
      scheduledAt: Date.now() + args.delayMs,
      delayMs: args.delayMs,
    };
  },
});

/**
 * Cancel a scheduled simulation.
 * Sets status back to IDLE.
 */
export const cancelScheduledSimulation = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation("stats:updateSimConfig" as any, {
      status: "IDLE",
      scheduled_at: undefined,
    });
    return { cancelled: true };
  },
});
