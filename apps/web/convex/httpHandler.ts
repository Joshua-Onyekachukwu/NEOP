/**
 * Convex HTTP Handler — routes requests to simulation functions
 */

import { httpAction } from "./_generated/server";

export const triggerSimulation = httpAction(async (ctx, request) => {
  const body = await request.json();
  const { scenario, batchSize, offset, action } = body;

  if (action === "seed") {
    const result = await ctx.runMutation("simulation:seedBatch", {
      scenario: scenario || "landslide",
      offset: offset || 0,
      batchSize: Math.min(batchSize || 500, 5000),
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (action === "finalize") {
    const result = await ctx.runMutation("finalize:finalizeLight", {
      scenario: scenario || "landslide",
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Default: run a single batch
  const result = await ctx.runMutation("simulation:seedBatch", {
    scenario: scenario || "landslide",
    offset: offset || 0,
    batchSize: Math.min(batchSize || 100, 5000),
  });
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});
