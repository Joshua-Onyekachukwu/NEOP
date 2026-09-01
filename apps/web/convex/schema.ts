/**
 * Convex Schema — Real-time simulation data
 *
 * This schema defines tables that live in Convex (not Supabase).
 * Supabase still holds: auth, polling_units, states, lgas, wards, parties, agents.
 * Convex holds: simulation results, live aggregations, status feeds.
 *
 * Why Convex?
 * - Real-time subscriptions without polling (useQuery auto-updates)
 * - Handles millions of rows efficiently
 * - No cold-start penalty on reads
 * - Built-in caching and pagination
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── Simulation Results ──
  // One row per polling unit result (188K rows max)
  results: defineTable({
    polling_unit_id: v.string(),
    state_id: v.string(),
    state_name: v.string(),
    lga_name: v.string(),
    ward_name: v.string(),
    pu_code: v.string(),
    pu_name: v.string(),
    region: v.string(), // NW, NE, NC, SW, SE, SS, FC
    election_id: v.optional(v.string()),
    election_type: v.string(), // PRESIDENTIAL or GOVERNORSHIP
    valid_votes: v.number(),
    rejected_votes: v.number(),
    total_votes: v.number(),
    status: v.string(), // VOTING, COUNTING, RESULT_ANNOUNCED, RESULT_SUBMITTED, VERIFIED, DISPUTED, DISRUPTED
    submitted_at: v.number(), // timestamp ms
    verified_at: v.optional(v.number()),
    scenario: v.string(), // landslide, sweep, close
  })
    .index("by_state", ["state_name"])
    .index("by_status", ["status"])
    .index("by_region", ["region"])
    .index("by_scenario", ["scenario"]),

  // ── Party Vote Breakdown ──
  // One row per party per polling unit result (up to 9 * 188K = 1.7M rows)
  party_results: defineTable({
    result_id: v.id("results"),
    party_id: v.string(),
    party_name: v.string(),
    party_abbreviation: v.string(),
    party_color: v.string(),
    votes: v.number(),
    region: v.string(),
    state_name: v.string(),
  })
    .index("by_result", ["result_id"])
    .index("by_party", ["party_abbreviation"])
    .index("by_state_party", ["state_name", "party_abbreviation"]),

  // ── Live Aggregated Stats ──
  // Single document updated after each simulation batch
  live_stats: defineTable({
    key: v.string(), // always "global"
    total_polling_units: v.number(),
    covered_polling_units: v.number(),
    verified_polling_units: v.number(),
    total_votes: v.number(),
    valid_votes: v.number(),
    rejected_votes: v.number(),
    active_pu_count: v.number(),
    updated_at: v.number(),
    simulation_running: v.boolean(),
    scenario: v.optional(v.string()),
    election_type: v.optional(v.string()),
  })
    .index("by_key", ["key"]),

  // ── State-Level Aggregation ──
  // One row per state, updated after simulation
  state_stats: defineTable({
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
    updated_at: v.number(),
  })
    .index("by_state", ["state_name"])
    .index("by_region", ["region"]),

  // ── Party National Totals ──
  // One row per party, updated after simulation
  party_totals: defineTable({
    party_id: v.string(),
    party_name: v.string(),
    party_abbreviation: v.string(),
    party_color: v.string(),
    total_votes: v.number(),
    percentage: v.number(),
    updated_at: v.number(),
  })
    .index("by_abbreviation", ["party_abbreviation"]),

  // ── Simulation Config ──
  // Single document tracking simulation state
  sim_config: defineTable({
    key: v.string(), // always "current"
    status: v.string(), // IDLE, RUNNING, COMPLETED
    scenario: v.string(),
    election_type: v.string(),
    total_voters: v.number(),
    duration_minutes: v.number(),
    started_at: v.optional(v.number()),
    completed_at: v.optional(v.number()),
    results_processed: v.number(),
    total_results: v.number(),
    progress_percent: v.number(),
    updated_at: v.optional(v.number()),
  })
    .index("by_key", ["key"]),
});
