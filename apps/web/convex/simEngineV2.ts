/**
 * Convex Simulation Engine v2
 *
 * Runs election simulation using REAL PU data from Supabase.
 * Features:
 * - Queries Supabase for actual PU hierarchy at start
 * - Dynamic voter distribution (state-level population, turnout variation)
 * - PU availability/disruption modeling
 * - Pause/resume/cancel support
 * - Idempotent batches (safe retry)
 * - Incremental aggregation (no finalize step needed)
 *
 * Architecture: Supabase (PU hierarchy) → Convex (simulation engine)
 */

import { action } from "./_generated/server";
import { v } from "convex/values";

// ── Constants ──

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

const PARTY_SHARES: Record<string, number[]> = {
  landslide: [0.42, 0.22, 0.10, 0.08, 0.06, 0.04, 0.03, 0.03, 0.02],
  sweep: [0.37, 0.25, 0.10, 0.08, 0.06, 0.04, 0.03, 0.04, 0.03],
  close: [0.30, 0.28, 0.12, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03],
};

// Regional vote multipliers (NDC vs APC strength by geo-political zone)
const REGION_MULT: Record<string, number[]> = {
  NW: [0.6, 1.4, 0.8, 0.5, 1.3, 0.7, 0.6, 0.5, 0.6],
  NE: [0.7, 1.3, 0.9, 0.6, 1.2, 0.8, 0.7, 0.6, 0.7],
  NC: [1.0, 1.1, 1.0, 0.8, 0.9, 0.9, 1.0, 0.8, 0.9],
  SW: [0.5, 1.5, 1.1, 0.7, 0.8, 1.2, 0.9, 0.7, 0.8],
  SE: [1.9, 0.3, 0.8, 1.8, 0.5, 1.5, 0.7, 0.9, 0.6],
  SS: [1.6, 0.4, 1.2, 1.4, 0.6, 0.7, 0.8, 0.7, 0.6],
  FC: [1.2, 1.0, 0.9, 1.1, 0.8, 0.8, 1.0, 0.9, 0.8],
};

// State → Region mapping
const STATE_REGION: Record<string, string> = {
  Lagos: "SW", Ogun: "SW", Oyo: "SW", Ondo: "SW", Osun: "SW", Ekiti: "SW",
  Kano: "NW", Katsina: "NW", Sokoto: "NW", Zamfara: "NW", Kebbi: "NW", Jigawa: "NW", Kaduna: "NW",
  Borno: "NE", Yobe: "NE", Adamawa: "NE", Gombe: "NE", Taraba: "NE", Bauchi: "NE",
  Niger: "NC", Kwara: "NC", Kogi: "NC", Benue: "NC", Plateau: "NC", Nasarawa: "NC",
  Abia: "SE", Anambra: "SE", Ebonyi: "SE", Enugu: "SE", Imo: "SE",
  Rivers: "SS", Delta: "SS", Bayelsa: "SS", "Akwa Ibom": "SS", "Cross River": "SS", Edo: "SS",
  FCT: "FC",
};

// Approximate state populations (millions) for realistic voter distribution
// Source: NPC 2006 census projections + INEC registration patterns
const STATE_POP: Record<string, number> = {
  Lagos: 15.4, Kano: 13.1, Rivers: 7.3, Kaduna: 8.0, Oyo: 7.8,
  Delta: 5.6, Katsina: 7.4, Borno: 5.9, Jigawa: 5.7, Benue: 5.5,
  Anambra: 5.3, Plateau: 4.2, Sokoto: 5.3, "Cross River": 4.4, Adamawa: 4.8,
  Ogun: 5.2, Bauchi: 6.5, Niger: 5.3, Imo: 5.0, Abia: 3.9,
  Osun: 4.7, Zamfara: 4.3, Ondo: 4.5, Edo: 4.1, "Akwa Ibom": 5.2,
  Kebbi: 5.2, Kogi: 4.9, Enugu: 4.1, Nasarawa: 3.4, Taraba: 3.6,
  Ebonyi: 3.3, Gombe: 3.3, Ekiti: 3.6, Yobe: 3.5, Kwara: 3.6,
  Bayelsa: 2.3, FCT: 2.8,
};

// Total Nigerian population ~220M, registered voters ~93M (2023)
const NATIONAL_POPULATION = 220_000_000;
const REGISTERED_VOTER_RATIO = 93_000_000 / 220_000_000; // ~42%

// ── Seeded PRNG (reproducible simulations) ──

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Types ──

interface PURecord {
  id: string;
  state_name: string;
  lga_name: string;
  ward_name: string;
  pu_code: string;
  pu_name: string;
  state_id: string;
}

interface SimulationConfig {
  scenario: string;
  election_type: string;
  target_voters: number;
  random_seed: number;
  batch_size: number;
  pu_failure_rate: number;
  turnout_min: number;
  turnout_max: number;
  geographic_scope: string;
  simulation_speed: number;
}

// ── Main Simulation Action ──

export const runSimulationV2 = action({
  args: {
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
    const config = args.config;
    const rng = mulberry32(config.random_seed);
    const BATCH_SIZE = Math.min(config.batch_size, 2000);

    console.log(`[sim-v2] Starting: scenario=${config.scenario}, voters=${config.target_voters}, seed=${config.random_seed}`);

    // ── Step 1: Query Supabase for real PU hierarchy ──
    const SUPABASE_URL = args.supabaseUrl;
    const SUPABASE_KEY = args.supabaseKey;

    // Step 1a: Fetch states, LGAs, wards for hierarchy mapping
    const stateMap: Record<string, { id: string; name: string }> = {};
    const lgaMap: Record<string, { id: string; name: string; state_id: string }> = {};
    const wardMap: Record<string, { id: string; name: string; lga_id: string }> = {};

    // Fetch states
    const statesRes = await fetch(`${SUPABASE_URL}/rest/v1/states?select=id,name`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (statesRes.ok) {
      for (const s of await statesRes.json()) stateMap[s.id] = s;
    }

    // Fetch LGAs
    const lgasRes = await fetch(`${SUPABASE_URL}/rest/v1/lgas?select=id,name,state_id`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (lgasRes.ok) {
      for (const l of await lgasRes.json()) lgaMap[l.id] = l;
    }

    // Fetch wards
    const wardsRes = await fetch(`${SUPABASE_URL}/rest/v1/wards?select=id,name,lga_id`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (wardsRes.ok) {
      for (const w of await wardsRes.json()) wardMap[w.id] = w;
    }

    console.log(`[sim-v2] Hierarchy: ${Object.keys(stateMap).length} states, ${Object.keys(lgaMap).length} LGAs, ${Object.keys(wardMap).length} wards`);

    // Step 1b: Fetch polling units (no FK joins — avoids 1000 row cap)
    const allPUs: PURecord[] = [];
    let offset = 0;
    const fetchBatch = 1000; // Supabase caps at 1000

    while (true) {
      const url = `${SUPABASE_URL}/rest/v1/polling_units?select=id,name,official_code,ward_id&offset=${offset}&limit=${fetchBatch}&order=id`;
      const res = await fetch(url, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (!res.ok) break;
      const data = await res.json();
      if (data.length === 0) break;

      for (const pu of data) {
        const ward = wardMap[pu.ward_id];
        const lga = ward ? lgaMap[ward.lga_id] : undefined;
        const state = lga ? stateMap[lga.state_id] : undefined;

        allPUs.push({
          id: pu.id,
          state_name: state?.name || "Unknown",
          state_id: state?.id || "",
          lga_name: lga?.name || "Unknown",
          ward_name: ward?.name || "Unknown",
          pu_code: pu.official_code || `PU-${pu.id.slice(0, 8)}`,
          pu_name: pu.name || "Polling Unit",
        });
      }

      offset += fetchBatch;
      if (data.length < fetchBatch) break;
    }

    console.log(`[sim-v2] Fetched ${allPUs.length} PUs from Supabase`);

    if (allPUs.length === 0) {
      console.error("[sim-v2] No PUs found in Supabase!");
      return { success: false, error: "No polling units found" };
    }

    const totalPUs = allPUs.length;
    console.log(`[sim-v2] Total PUs from Supabase: ${totalPUs}`);

    // ── Step 2: Compute state-level voter distribution ──
    // Each state gets voters proportional to its population
    const stateVoters: Record<string, number> = {};
    let totalPop = 0;
    for (const state of Object.keys(STATE_POP)) {
      totalPop += STATE_POP[state];
    }

    // Calculate registered voters per state based on population
    const nationalRegisteredVoters = Math.min(config.target_voters, Math.round(NATIONAL_POPULATION * REGISTERED_VOTER_RATIO));
    for (const [state, pop] of Object.entries(STATE_POP)) {
      stateVoters[state] = Math.round((pop / totalPop) * nationalRegisteredVoters);
    }

    // Adjust if target differs from calculated
    const totalCalculated = Object.values(stateVoters).reduce((s, v) => s + v, 0);
    const scale = totalCalculated > 0 ? config.target_voters / totalCalculated : 1;
    for (const state of Object.keys(stateVoters)) {
      stateVoters[state] = Math.round(stateVoters[state] * scale);
    }

    // ── Step 3: Compute PU-level voter distribution ──
    // Count PUs per state
    const pUsPerState: Record<string, number> = {};
    for (const pu of allPUs) {
      pUsPerState[pu.state_name] = (pUsPerState[pu.state_name] || 0) + 1;
    }

    // Build PU list with voter allocation
interface PUWithVoters extends PURecord {
  registered_voters: number;
  region: string;
  unavailable: boolean;
}

    const puList: PUWithVoters[] = [];
    for (const pu of allPUs) {
      const region = STATE_REGION[pu.state_name] || "NC";
      const statePUCount = pUsPerState[pu.state_name] || 1;
      const stateVoterPool = stateVoters[pu.state_name] || 0;

      // Distribute voters evenly across PUs in the state, with some randomness
      const baseVotersPerPU = Math.floor(stateVoterPool / statePUCount);
      const jitter = 0.5 + rng(); // 0.5 to 1.5
      const registeredVoters = Math.max(50, Math.round(baseVotersPerPU * jitter));

      // PU availability — probabilistic failure
      const isUnavailable = rng() < config.pu_failure_rate;

      puList.push({
        ...pu,
        registered_voters: registeredVoters,
        region,
        unavailable: isUnavailable,
      } as PUWithVoters);
    }

    console.log(`[sim-v2] Distributed voters: ${Object.keys(stateVoters).length} states, ${totalPUs} PUs`);

    // ── Step 4: Initialize simulation config ──
    await ctx.runMutation("stats:updateSimConfig" as any, {
      status: "RUNNING",
      scenario: config.scenario,
      election_type: config.election_type,
      target_voters: config.target_voters,
      random_seed: config.random_seed,
      batch_size: BATCH_SIZE,
      pu_failure_rate: config.pu_failure_rate,
      turnout_min: config.turnout_min,
      turnout_max: config.turnout_max,
      geographic_scope: config.geographic_scope,
      simulation_speed: config.simulation_speed,
      started_at: Date.now(),
      results_processed: 0,
      total_results: totalPUs,
      progress_percent: 0,
      batches_total: Math.ceil(totalPUs / BATCH_SIZE),
      batches_completed: 0,
      batches_failed: 0,
      batches_retried: 0,
      total_votes: 0,
      valid_votes: 0,
      rejected_votes: 0,
      unavailable_pus: 0,
      processing_rate: 0,
      estimated_completion_ms: 0,
    });

    // ── Step 5: Process PUs in batches ──
    const shares = PARTY_SHARES[config.scenario] || PARTY_SHARES.landslide;

    // Running aggregates
    const runningPartyTotals: Record<string, number> = {};
    const runningStateStats: Record<string, {
      region: string;
      total_pus: number;
      covered_pus: number;
      verified_pus: number;
      unavailable_pus: number;
      total_votes: number;
      registered_voters: number;
      party_votes: number[];
    }> = {};

    for (const p of PARTIES) runningPartyTotals[p.abbr] = 0;
    for (const [state] of Object.entries(pUsPerState)) {
      const region = STATE_REGION[state] || "NC";
      runningStateStats[state] = {
        region,
        total_pus: 0,
        covered_pus: 0,
        verified_pus: 0,
        unavailable_pus: 0,
        total_votes: 0,
        registered_voters: 0,
        party_votes: new Array(9).fill(0),
      };
    }

    let totalVotes = 0;
    let totalValidVotes = 0;
    let totalRejectedVotes = 0;
    let unavailableCount = 0;
    let coveredCount = 0;
    let verifiedCount = 0;
    const startTime = Date.now();

    for (let batchIdx = 0; batchIdx < puList.length; batchIdx += BATCH_SIZE) {
      // ── Check for pause/cancel ──
      const currentConfig = await ctx.runQuery("stats:getSimConfig" as any, {});
      if (currentConfig?.status === "PAUSED") {
        console.log(`[sim-v2] Paused at batch ${Math.floor(batchIdx / BATCH_SIZE)}`);
        // Wait and recheck every 5 seconds
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const check = await ctx.runQuery("stats:getSimConfig" as any, {});
          if (check?.status === "RUNNING") break;
          if (check?.status === "CANCELLED") {
            console.log("[sim-v2] Cancelled");
            return { success: false, reason: "cancelled", processed: coveredCount };
          }
        }
      }

      const batchEnd = Math.min(batchIdx + BATCH_SIZE, puList.length);
      const batch = puList.slice(batchIdx, batchEnd);
      const batchResults: any[] = [];
      const batchPR: any[] = [];

      for (let i = 0; i < batch.length; i++) {
        const pu = batch[i];
        const globalIdx = batchIdx + i;
        const regionMult = REGION_MULT[pu.region] || [1, 1, 1, 1, 1, 1, 1, 1, 1];

        if (pu.unavailable) {
          // Unavailable PU — no votes, no result
          unavailableCount++;
          const ss = runningStateStats[pu.state_name];
          if (ss) ss.unavailable_pus++;
          continue;
        }

        // Dynamic turnout based on config
        const turnoutRate = config.turnout_min + rng() * (config.turnout_max - config.turnout_min);
        const totalVotesPU = Math.max(10, Math.round(pu.registered_voters * turnoutRate));
        const rejected = Math.round(totalVotesPU * (0.01 + rng() * 0.04));
        const valid = totalVotesPU - rejected;

        // PU status based on vote completeness
        const statusRoll = rng();
        const status = statusRoll < 0.05 ? "VERIFIED"
          : statusRoll < 0.12 ? "RESULT_SUBMITTED"
          : statusRoll < 0.20 ? "RESULT_ANNOUNCED"
          : statusRoll < 0.30 ? "COUNTING"
          : statusRoll < 0.40 ? "VOTING"
          : "NOT_STARTED";

        batchResults.push({
          polling_unit_id: pu.id,
          state_id: pu.state_id,
          state_name: pu.state_name,
          lga_name: pu.lga_name,
          ward_name: pu.ward_name,
          pu_code: pu.pu_code,
          pu_name: pu.pu_name,
          region: pu.region,
          election_type: config.election_type,
          valid_votes: valid,
          rejected_votes: rejected,
          total_votes: totalVotesPU,
          status,
          submitted_at: Date.now() - rng() * 60 * 24 * 60 * 60 * 1000,
          verified_at: status === "VERIFIED" ? Date.now() : undefined,
          scenario: config.scenario,
        });

        // Calculate party votes
        let remaining = valid;
        const votes: number[] = [];
        for (let p = 0; p < 9; p++) {
          const v = Math.max(0, Math.round(valid * shares[p] * regionMult[p] * (0.7 + rng() * 0.6)));
          votes.push(v);
          remaining -= v;
        }
        votes[8] = Math.max(0, votes[8] + remaining); // ADC gets remainder

        // Accumulate
        totalVotes += totalVotesPU;
        totalValidVotes += valid;
        totalRejectedVotes += rejected;
        coveredCount++;
        if (status === "VERIFIED") verifiedCount++;

        const ss = runningStateStats[pu.state_name];
        if (ss) {
          ss.total_pus++;
          ss.covered_pus++;
          if (status === "VERIFIED") ss.verified_pus++;
          ss.total_votes += totalVotesPU;
          ss.registered_voters += pu.registered_voters;
          for (let p = 0; p < 9; p++) ss.party_votes[p] += votes[p];
        }

        for (let p = 0; p < 9; p++) {
          runningPartyTotals[PARTIES[p].abbr] += votes[p];
          batchPR.push({
            result_index: batchResults.length - 1,
            party_id: PARTIES[p].id,
            party_name: PARTIES[p].name,
            party_abbreviation: PARTIES[p].abbr,
            party_color: PARTIES[p].color,
            votes: votes[p],
            region: pu.region,
            state_name: pu.state_name,
          });
        }
      }

      // ── Insert batch into Convex ──
      if (batchResults.length > 0) {
        // Insert results
        const insertRes: any = await ctx.runMutation("stats:insertResultsBatch" as any, {
          results: batchResults,
        });
        const resultIds: string[] = insertRes.resultIds || [];

        // Insert party_results in chunks (Convex limit: 8192 array elements)
        const CHUNK = 8000;
        for (let ci = 0; ci < batchPR.length; ci += CHUNK) {
          const chunk = batchPR.slice(ci, ci + CHUNK);
          await ctx.runMutation("stats:insertPartyResultsBatch" as any, {
            resultIds,
            partyResults: chunk.map((pr: any) => ({
              resultOffset: pr.result_index,
              party_id: pr.party_id,
              party_name: pr.party_name,
              party_abbreviation: pr.party_abbreviation,
              party_color: pr.party_color,
              votes: pr.votes,
              region: pr.region,
              state_name: pr.state_name,
            })),
          });
        }
      }

      // ── Update progress ──
      const processedCount = batchEnd;
      const progress = Math.round((processedCount / totalPUs) * 100);
      const elapsedMs = Date.now() - startTime;
      const rate = processedCount / (elapsedMs / 1000);
      const remaining = totalPUs - processedCount;
      const eta = rate > 0 ? (remaining / rate) * 1000 : 0;

      await ctx.runMutation("stats:updateSimConfig" as any, {
        results_processed: processedCount,
        progress_percent: progress,
        batches_completed: Math.ceil(processedCount / BATCH_SIZE),
        total_votes: totalVotes,
        valid_votes: totalValidVotes,
        rejected_votes: totalRejectedVotes,
        unavailable_pus: unavailableCount,
        processing_rate: Math.round(rate),
        estimated_completion_ms: Math.round(eta),
      });

      if (batchIdx % (BATCH_SIZE * 5) === 0 || batchEnd >= totalPUs) {
        console.log(`[sim-v2] ${processedCount}/${totalPUs} (${progress}%) — ${Math.round(rate)} PUs/s — ETA ${Math.round(eta / 1000)}s`);
      }
    }

    // ── Step 6: Finalize aggregates ──
    const grandTotal = Object.values(runningPartyTotals).reduce((s, v) => s + v, 0);

    // Upsert party_totals
    await ctx.runMutation("stats:upsertPartyTotals" as any, {
      parties: PARTIES.map((p) => ({
        party_id: p.id,
        party_name: p.name,
        party_abbreviation: p.abbr,
        party_color: p.color,
        total_votes: runningPartyTotals[p.abbr],
        percentage: grandTotal > 0 ? Number(((runningPartyTotals[p.abbr] / grandTotal) * 100).toFixed(1)) : 0,
      })),
    });

    // Upsert state_stats
    const stateEntries = Object.entries(runningStateStats).map(([state, ss]) => ({
      state_id: "",
      state_name: state,
      region: ss.region,
      total_pus: ss.total_pus + ss.unavailable_pus,
      covered_pus: ss.covered_pus,
      verified_pus: ss.verified_pus,
      unavailable_pus: ss.unavailable_pus,
      total_votes: ss.total_votes,
      registered_voters: ss.registered_voters,
      turnout_percent: ss.registered_voters > 0 ? Number(((ss.total_votes / ss.registered_voters) * 100).toFixed(1)) : 0,
      ndc_votes: ss.party_votes[0],
      apc_votes: ss.party_votes[1],
      pdp_votes: ss.party_votes[2],
      lp_votes: ss.party_votes[3],
      nnpp_votes: ss.party_votes[4],
      apga_votes: ss.party_votes[5],
      sdp_votes: ss.party_votes[6],
      ypp_votes: ss.party_votes[7],
      adc_votes: ss.party_votes[8],
    }));
    await ctx.runMutation("stats:upsertStateStats" as any, { states: stateEntries });

    // Upsert global stats
    await ctx.runMutation("stats:upsertGlobalStats" as any, {
      covered_polling_units: coveredCount,
      verified_polling_units: verifiedCount,
      total_votes: totalVotes,
      valid_votes: totalValidVotes,
      rejected_votes: totalRejectedVotes,
      active_pu_count: coveredCount,
      simulation_running: false,
      scenario: config.scenario,
      election_type: config.election_type,
    });

    // Mark complete
    await ctx.runMutation("stats:updateSimConfig" as any, {
      status: "COMPLETED",
      progress_percent: 100,
      completed_at: Date.now(),
      processing_rate: Math.round(coveredCount / ((Date.now() - startTime) / 1000)),
    });

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`[sim-v2] Complete: ${coveredCount} PUs, ${totalVotes} votes, ${duration}s`);

    return {
      success: true,
      scenario: config.scenario,
      total_pus: totalPUs,
      covered_pus: coveredCount,
      unavailable_pus: unavailableCount,
      total_votes: totalVotes,
      duration_seconds: duration,
      processing_rate: Math.round(coveredCount / duration),
    };
  },
});
