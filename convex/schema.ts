import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex Schema — Live Application State
 * 
 * CRITICAL RULE: Supabase is the source of truth.
 * Convex handles live projections, realtime subscriptions, and transient state.
 * Never allow Convex and Supabase to become competing authoritative databases.
 */
export default defineSchema({
  // ============================================================
  // LIVE DASHBOARD STATE
  // ============================================================

  /** Aggregated national dashboard state — updated by Supabase triggers */
  nationalDashboard: defineTable({
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
    lastUpdatedAt: v.number(), // timestamp
  })
    .index("by_election", ["electionId"]),

  /** State-level aggregated dashboard state */
  stateDashboard: defineTable({
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
    lastUpdatedAt: v.number(),
  })
    .index("by_election", ["electionId"])
    .index("by_election_state", ["electionId", "stateId"]),

  /** LGA-level aggregated dashboard state */
  lgaDashboard: defineTable({
    electionId: v.string(),
    lgaId: v.string(),
    lgaName: v.string(),
    stateId: v.string(),
    totalPollingUnits: v.number(),
    coveredPollingUnits: v.number(),
    verifiedPollingUnits: v.number(),
    reportedPollingUnits: v.number(),
    lastUpdatedAt: v.number(),
  })
    .index("by_election", ["electionId"])
    .index("by_state", ["electionId", "stateId"]),

  // ============================================================
  // LIVE POLLING UNIT STATUS
  // ============================================================

  /** Real-time polling unit status — updated as field reports come in */
  livePollingUnit: defineTable({
    electionId: v.string(),
    pollingUnitId: v.string(),
    officialCode: v.string(),
    stateId: v.string(),
    stateName: v.string(),
    lgaId: v.string(),
    lgaName: v.string(),
    wardId: v.string(),
    wardName: v.string(),
    status: v.string(), // polling_unit_status enum value
    observerCount: v.number(),
    hasResultImage: v.number(), // 0 or 1
    verificationStatus: v.string(),
    lastUpdateAt: v.number(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  })
    .index("by_election", ["electionId"])
    .index("by_state", ["electionId", "stateId"])
    .index("by_lga", ["electionId", "lgaId"])
    .index("by_status", ["electionId", "status"]),

  // ============================================================
  // LIVE RESULT FEED
  // ============================================================

  /** Live result feed — latest verified/pending results */
  liveResult: defineTable({
    electionId: v.string(),
    pollingUnitId: v.string(),
    officialCode: v.string(),
    stateName: v.string(),
    lgaName: v.string(),
    status: v.string(), // verification status
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
    confidenceLabel: v.string(), // 'HIGH', 'MEDIUM', 'LOW', 'UNDER_REVIEW'
    submittedAt: v.number(),
    verifiedAt: v.optional(v.number()),
  })
    .index("by_election", ["electionId"])
    .index("by_election_submitted", ["electionId", "submittedAt"])
    .index("by_election_status", ["electionId", "status"]),

  // ============================================================
  // LIVE INCIDENT FEED
  // ============================================================

  /** Live incident feed — public-facing incident status */
  liveIncident: defineTable({
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
  })
    .index("by_election", ["electionId"])
    .index("by_election_severity", ["electionId", "severity"]),

  // ============================================================
  // LIVE COVERAGE MAP
  // ============================================================

  /** Coverage map points for MapLibre rendering */
  coveragePoint: defineTable({
    electionId: v.string(),
    pollingUnitId: v.string(),
    officialCode: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    status: v.string(),
    verificationStatus: v.string(),
    stateId: v.string(),
  })
    .index("by_election", ["electionId"])
    .index("by_election_state", ["electionId", "stateId"]),

  // ============================================================
  // LIVE OPERATIONAL COUNTERS
  // ============================================================

  /** Simple key-value counters for live dashboard */
  liveCounter: defineTable({
    electionId: v.string(),
    key: v.string(), // e.g. 'active_observers', 'total_submissions'
    value: v.number(),
    lastUpdatedAt: v.number(),
  })
    .index("by_election_key", ["electionId", "key"]),

  // ============================================================
  // SYSTEM HEALTH
  // ============================================================

  /** System health status for command center */
  systemHealth: defineTable({
    component: v.string(), // 'API', 'DATABASE', 'AI_WORKER', 'REALTIME', etc.
    status: v.string(), // 'HEALTHY', 'DEGRADED', 'DOWN'
    lastCheckedAt: v.number(),
    details: v.optional(v.string()),
  })
    .index("by_component", ["component"]),
});
