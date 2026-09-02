/**
 * Convex Schema — Real-time simulation data
 *
 * Tables that live in Convex (not Supabase).
 * Supabase holds: auth, polling_units, states, lgas, wards, parties, agents.
 * Convex holds: simulation results, live aggregations, simulation state.
 *
 * Architecture decision:
 * - Convex handles high-frequency simulation writes (no cold start, no connection pool)
 * - Supabase holds authoritative relational election data
 * - Simulation queries Supabase for PU hierarchy at start, then runs in Convex
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── Simulation Results ──
  // One row per polling unit result. Max rows: number of PUs (46K-176K).
  results: defineTable({
    polling_unit_id: v.string(),
    state_id: v.string(),
    state_name: v.string(),
    lga_name: v.string(),
    ward_name: v.string(),
    pu_code: v.string(),
    pu_name: v.string(),
    region: v.string(),
    election_id: v.optional(v.string()),
    election_type: v.string(),
    valid_votes: v.number(),
    rejected_votes: v.number(),
    total_votes: v.number(),
    status: v.string(),
    submitted_at: v.number(),
    verified_at: v.optional(v.number()),
    scenario: v.string(),
  })
    .index("by_state", ["state_name"])
    .index("by_status", ["status"])
    .index("by_region", ["region"])
    .index("by_scenario", ["scenario"]),

  // ── Party Vote Breakdown ──
  // One row per party per PU result. Max rows: 9 × number of PUs.
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
  // Single document updated after each simulation batch.
  live_stats: defineTable({
    key: v.string(),
    total_polling_units: v.number(),
    covered_polling_units: v.number(),
    verified_polling_units: v.number(),
    total_votes: v.number(),
    valid_votes: v.number(),
    rejected_votes: v.number(),
    active_pu_count: v.number(),
    unavailable_pu_count: v.number(),
    updated_at: v.number(),
    simulation_running: v.boolean(),
    scenario: v.optional(v.string()),
    election_type: v.optional(v.string()),
  }).index("by_key", ["key"]),

  // ── State-Level Aggregation ──
  state_stats: defineTable({
    state_id: v.string(),
    state_name: v.string(),
    region: v.string(),
    total_pus: v.number(),
    covered_pus: v.number(),
    verified_pus: v.number(),
    unavailable_pus: v.number(),
    total_votes: v.number(),
    registered_voters: v.number(),
    turnout_percent: v.number(),
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
  party_totals: defineTable({
    party_id: v.string(),
    party_name: v.string(),
    party_abbreviation: v.string(),
    party_color: v.string(),
    total_votes: v.number(),
    percentage: v.number(),
    updated_at: v.number(),
  }).index("by_abbreviation", ["party_abbreviation"]),

  // ── Simulation Config ──
  // Single document tracking simulation state + full configuration.
  sim_config: defineTable({
    key: v.string(),
    status: v.string(), // IDLE, SCHEDULED, RUNNING, PAUSED, COMPLETED, CANCELLED, FAILED

    // Configuration
    scenario: v.string(),
    election_type: v.string(),
    target_voters: v.number(),
    random_seed: v.number(),
    batch_size: v.number(),
    pu_failure_rate: v.number(),        // 0-1, probability a PU is unavailable
    turnout_min: v.number(),             // 0-1
    turnout_max: v.number(),             // 0-1
    geographic_scope: v.string(),        // "national" or "state:name"
    simulation_speed: v.number(),        // multiplier

    // Scheduling
    scheduled_at: v.optional(v.number()),

    // Progress tracking
    started_at: v.optional(v.number()),
    paused_at: v.optional(v.number()),
    completed_at: v.optional(v.number()),
    results_processed: v.number(),
    total_results: v.number(),
    progress_percent: v.number(),
    batches_completed: v.number(),
    batches_total: v.number(),
    batches_failed: v.number(),
    batches_retried: v.number(),

    // Run-time stats
    total_votes: v.number(),
    valid_votes: v.number(),
    rejected_votes: v.number(),
    unavailable_pus: v.number(),
    processing_rate: v.number(),        // results per second
    estimated_completion_ms: v.number(),

    updated_at: v.optional(v.number()),
  }).index("by_key", ["key"]),

  // ── Batch Log ──
  // Tracks each batch for idempotency and failure recovery.
  batch_log: defineTable({
    simulation_id: v.string(),
    batch_index: v.number(),
    status: v.string(), // PENDING, RUNNING, COMPLETED, FAILED, RETRYING
    offset: v.number(),
    limit: v.number(),
    results_inserted: v.number(),
    party_results_inserted: v.number(),
    total_votes: v.number(),
    error_message: v.optional(v.string()),
    started_at: v.optional(v.number()),
    completed_at: v.optional(v.number()),
    retry_count: v.number(),
  })
    .index("by_simulation", ["simulation_id", "batch_index"])
    .index("by_status", ["status"]),
});
