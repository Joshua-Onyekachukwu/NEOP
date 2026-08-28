import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Dashboard Queries & Mutations
 * 
 * CRITICAL RULE: Supabase is the source of truth.
 * These functions read/write Convex live projections that are
 * updated by Supabase triggers/webhooks, NOT by client-side mutations.
 * Clients subscribe to Convex for realtime updates.
 */

// ============================================================
// QUERIES
// ============================================================

/**
 * Get national dashboard stats for an election.
 * Used by the public dashboard for live updates.
 */
export const getNationalStats = query({
  args: { electionId: v.string() },
  handler: async (ctx, args) => {
    const stats = await ctx.db
      .query("nationalDashboard")
      .withIndex("by_election", (q) => q.eq("electionId", args.electionId))
      .first();

    if (!stats) {
      return null;
    }

    const coveragePercent =
      stats.totalPollingUnits > 0
        ? (stats.coveredPollingUnits / stats.totalPollingUnits) * 100
        : 0;

    const verificationPercent =
      stats.totalPollingUnits > 0
        ? (stats.verifiedPollingUnits / stats.totalPollingUnits) * 100
        : 0;

    return {
      ...stats,
      coveragePercent,
      verificationPercent,
    };
  },
});

/**
 * Get state-level dashboard stats for an election.
 * Returns all states or a specific state.
 */
export const getStateStats = query({
  args: {
    electionId: v.string(),
    stateId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.stateId) {
      const stats = await ctx.db
        .query("stateDashboard")
        .withIndex("by_election_state", (q) =>
          q.eq("electionId", args.electionId).eq("stateId", args.stateId!)
        )
        .first();

      if (!stats) return null;

      const coveragePercent =
        stats.totalPollingUnits > 0
          ? (stats.coveredPollingUnits / stats.totalPollingUnits) * 100
          : 0;

      return { ...stats, coveragePercent };
    }

    const allStates = await ctx.db
      .query("stateDashboard")
      .withIndex("by_election", (q) => q.eq("electionId", args.electionId))
      .collect();

    return allStates.map((s) => ({
      ...s,
      coveragePercent:
        s.totalPollingUnits > 0
          ? (s.coveredPollingUnits / s.totalPollingUnits) * 100
          : 0,
    }));
  },
});

/**
 * Get LGA-level stats for a specific state within an election.
 */
export const getLgaStats = query({
  args: {
    electionId: v.string(),
    stateId: v.string(),
  },
  handler: async (ctx, args) => {
    const lgas = await ctx.db
      .query("lgaDashboard")
      .withIndex("by_state", (q) =>
        q.eq("electionId", args.electionId).eq("stateId", args.stateId)
      )
      .collect();

    return lgas.map((l) => ({
      ...l,
      coveragePercent:
        l.totalPollingUnits > 0
          ? (l.coveredPollingUnits / l.totalPollingUnits) * 100
          : 0,
    }));
  },
});

/**
 * Get live polling unit status.
 * Supports filtering by state, LGA, and status.
 */
export const getLivePollingUnits = query({
  args: {
    electionId: v.string(),
    stateId: v.optional(v.string()),
    lgaId: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("livePollingUnit")
      .withIndex("by_election", (q) => q.eq("electionId", args.electionId));

    if (args.stateId) {
      query = ctx.db
        .query("livePollingUnit")
        .withIndex("by_state", (q) =>
          q.eq("electionId", args.electionId).eq("stateId", args.stateId!)
        );
    }

    if (args.lgaId) {
      query = ctx.db
        .query("livePollingUnit")
        .withIndex("by_lga", (q) =>
          q.eq("electionId", args.electionId).eq("lgaId", args.lgaId!)
        );
    }

    if (args.status) {
      query = ctx.db
        .query("livePollingUnit")
        .withIndex("by_status", (q) =>
          q.eq("electionId", args.electionId).eq("status", args.status!)
        );
    }

    const limit = Math.min(args.limit ?? 100, 500);
    return await query.take(limit);
  },
});

/**
 * Get live result feed (most recent results).
 * Returns verified and pending results with party breakdown.
 */
export const getLiveResults = query({
  args: {
    electionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);

    const results = await ctx.db
      .query("liveResult")
      .withIndex("by_election_submitted", (q) =>
        q.eq("electionId", args.electionId)
      )
      .order("desc")
      .take(limit);

    return results;
  },
});

/**
 * Get live incident feed.
 * Returns incidents with severity and status.
 */
export const getLiveIncidents = query({
  args: {
    electionId: v.string(),
    severity: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("liveIncident")
      .withIndex("by_election", (q) => q.eq("electionId", args.electionId));

    if (args.severity) {
      q = ctx.db
        .query("liveIncident")
        .withIndex("by_election_severity", (q) =>
          q.eq("electionId", args.electionId).eq("severity", args.severity!)
        );
    }

    const limit = Math.min(args.limit ?? 50, 200);
    return await q.order("desc").take(limit);
  },
});

/**
 * Get coverage map points for MapLibre rendering.
 * Returns lat/lng and status for each polling unit.
 */
export const getCoveragePoints = query({
  args: {
    electionId: v.string(),
    stateId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.stateId) {
      return await ctx.db
        .query("coveragePoint")
        .withIndex("by_election_state", (q) =>
          q.eq("electionId", args.electionId).eq("stateId", args.stateId!)
        )
        .collect();
    }

    return await ctx.db
      .query("coveragePoint")
      .withIndex("by_election", (q) => q.eq("electionId", args.electionId))
      .collect();
  },
});

/**
 * Get live operational counters.
 * Returns key-value pairs like active_observers, total_submissions, etc.
 */
export const getLiveCounters = query({
  args: { electionId: v.string() },
  handler: async (ctx, args) => {
    const counters = await ctx.db
      .query("liveCounter")
      .withIndex("by_election_key", (q) => q.eq("electionId", args.electionId))
      .collect();

    // Convert to a key-value map
    const counterMap: Record<string, number> = {};
    for (const counter of counters) {
      counterMap[counter.key] = counter.value;
    }

    return counterMap;
  },
});

/**
 * Get system health status.
 * Used by the admin command center.
 */
export const getSystemHealth = query({
  handler: async (ctx) => {
    return await ctx.db.query("systemHealth").collect();
  },
});

// ============================================================
// MUTATIONS (called by Supabase webhooks, not clients)
// ============================================================

/**
 * Update national dashboard stats.
 * Called by Supabase webhook when results change.
 */
export const updateNationalStats = mutation({
  args: {
    electionId: v.string(),
    totalPollingUnits: v.number(),
    coveredPollingUnits: v.number(),
    verifiedPollingUnits: v.number(),
    reportedPollingUnits: v.number(),
    disruptedPollingUnits: v.number(),
    totalReportedVotes: v.number(),
    totalVerifiedVotes: v.number(),
    activeObservers: v.number(),
    incidentsReported: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("nationalDashboard")
      .withIndex("by_election", (q) => q.eq("electionId", args.electionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastUpdatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("nationalDashboard", {
        ...args,
        lastUpdatedAt: Date.now(),
      });
    }
  },
});

/**
 * Update state-level dashboard stats.
 * Called by Supabase webhook.
 */
export const updateStateStats = mutation({
  args: {
    electionId: v.string(),
    stateId: v.string(),
    stateName: v.string(),
    totalPollingUnits: v.number(),
    coveredPollingUnits: v.number(),
    verifiedPollingUnits: v.number(),
    reportedPollingUnits: v.number(),
    disruptedPollingUnits: v.number(),
    noReportPollingUnits: v.number(),
    totalReportedVotes: v.number(),
    totalVerifiedVotes: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stateDashboard")
      .withIndex("by_election_state", (q) =>
        q.eq("electionId", args.electionId).eq("stateId", args.stateId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastUpdatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("stateDashboard", {
        ...args,
        lastUpdatedAt: Date.now(),
      });
    }
  },
});

/**
 * Update a live polling unit's status.
 * Called by Supabase webhook when a field report comes in.
 */
export const updateLivePollingUnit = mutation({
  args: {
    electionId: v.string(),
    pollingUnitId: v.string(),
    officialCode: v.string(),
    stateId: v.string(),
    stateName: v.string(),
    lgaId: v.string(),
    lgaName: v.string(),
    wardId: v.string(),
    wardName: v.string(),
    status: v.string(),
    observerCount: v.number(),
    hasResultImage: v.number(),
    verificationStatus: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("livePollingUnit")
      .withIndex("by_election", (q) =>
        q.eq("electionId", args.electionId).eq("pollingUnitId", args.pollingUnitId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        observerCount: args.observerCount,
        hasResultImage: args.hasResultImage,
        verificationStatus: args.verificationStatus,
        lastUpdateAt: Date.now(),
      });
    } else {
      await ctx.db.insert("livePollingUnit", {
        ...args,
        lastUpdateAt: Date.now(),
      });
    }
  },
});

/**
 * Upsert a live result into the feed.
 * Called by Supabase webhook when a result is submitted or verified.
 */
export const upsertLiveResult = mutation({
  args: {
    electionId: v.string(),
    pollingUnitId: v.string(),
    officialCode: v.string(),
    stateName: v.string(),
    lgaName: v.string(),
    status: v.string(),
    partyResults: v.array(
      v.object({
        partyAbbreviation: v.string(),
        partyName: v.string(),
        votes: v.number(),
      })
    ),
    totalVotes: v.number(),
    validVotes: v.number(),
    rejectedVotes: v.number(),
    confidenceLabel: v.string(),
    submittedAt: v.number(),
    verifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if result already exists for this polling unit
    const existing = await ctx.db
      .query("liveResult")
      .withIndex("by_election", (q) =>
        q.eq("electionId", args.electionId).eq("pollingUnitId", args.pollingUnitId)
      )
      .first();

    if (existing) {
      // Update existing result (new submission supersedes old)
      await ctx.db.patch(existing._id, {
        status: args.status,
        partyResults: args.partyResults,
        totalVotes: args.totalVotes,
        validVotes: args.validVotes,
        rejectedVotes: args.rejectedVotes,
        confidenceLabel: args.confidenceLabel,
        submittedAt: args.submittedAt,
        verifiedAt: args.verifiedAt,
      });
    } else {
      await ctx.db.insert("liveResult", args);
    }
  },
});

/**
 * Upsert a live incident into the feed.
 * Called by Supabase webhook when an incident is reported.
 */
export const upsertLiveIncident = mutation({
  args: {
    electionId: v.string(),
    pollingUnitId: v.string(),
    officialCode: v.string(),
    stateName: v.string(),
    lgaName: v.string(),
    category: v.string(),
    severity: v.string(),
    status: v.string(),
    reportedAt: v.number(),
    agentSafe: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("liveIncident", args);
  },
});

/**
 * Upsert a coverage map point.
 * Called by Supabase webhook when a polling unit is assigned or reports.
 */
export const upsertCoveragePoint = mutation({
  args: {
    electionId: v.string(),
    pollingUnitId: v.string(),
    officialCode: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    status: v.string(),
    verificationStatus: v.string(),
    stateId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("coveragePoint")
      .withIndex("by_election", (q) =>
        q.eq("electionId", args.electionId).eq("pollingUnitId", args.pollingUnitId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        verificationStatus: args.verificationStatus,
      });
    } else {
      await ctx.db.insert("coveragePoint", args);
    }
  },
});

/**
 * Update a live counter.
 * Called by Supabase webhook when counters change.
 */
export const updateLiveCounter = mutation({
  args: {
    electionId: v.string(),
    key: v.string(),
    value: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("liveCounter")
      .withIndex("by_election_key", (q) =>
        q.eq("electionId", args.electionId).eq("key", args.key)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        lastUpdatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("liveCounter", {
        ...args,
        lastUpdatedAt: Date.now(),
      });
    }
  },
});

/**
 * Update system health status.
 * Called by health check cron or monitoring.
 */
export const updateSystemHealth = mutation({
  args: {
    component: v.string(),
    status: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("systemHealth")
      .withIndex("by_component", (q) => q.eq("component", args.component))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        details: args.details,
        lastCheckedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("systemHealth", {
        ...args,
        lastCheckedAt: Date.now(),
      });
    }
  },
});
