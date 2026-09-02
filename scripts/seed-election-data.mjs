#!/usr/bin/env node

/**
 * Seed Election Data — Populate Convex with realistic election results
 *
 * This script generates realistic Nigerian election data:
 * - ~45M total votes (90% turnout from ~50M registered voters)
 * - 9 parties with realistic vote shares
 * - 37 states with regional voting patterns
 * - State-level breakdowns
 *
 * Usage:
 *   cd apps/web && node ../../scripts/seed-election-data.mjs
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──
function loadEnv() {
  const envPath = resolve(__dirname, "../apps/web/.env.local");
  if (!existsSync(envPath)) {
    // Try relative to cwd
    const cwdEnv = resolve(process.cwd(), ".env.local");
    if (existsSync(cwdEnv)) return loadEnvFile(cwdEnv);
    console.error("❌ Cannot find .env.local");
    process.exit(1);
  }
  return loadEnvFile(envPath);
}

function loadEnvFile(path) {
  const lines = readFileSync(path, "utf-8").split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = val;
    if (!process.env[key]) process.env[key] = val;
  }
  return env;
}

const env = loadEnv();
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const CONVEX_DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;

if (!CONVEX_URL || !CONVEX_DEPLOY_KEY) {
  console.error("❌ Missing NEXT_PUBLIC_CONVEX_URL or CONVEX_DEPLOY_KEY in .env.local");
  process.exit(1);
}

console.log(`🔗 Convex URL: ${CONVEX_URL}`);

// ── Party Configuration ──
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

// ── Regional vote share weights [NDC, APC, PDP, LP, NNPP, APGA, SDP, YPP, ADC] ──
// These represent the relative strength of each party in each region
const REGION_MULT = {
  NW: [0.6, 1.4, 0.8, 0.5, 1.3, 0.7, 0.6, 0.5, 0.6],
  NE: [0.7, 1.3, 0.9, 0.6, 1.2, 0.8, 0.7, 0.6, 0.7],
  NC: [1.0, 1.1, 1.0, 0.8, 0.9, 0.9, 1.0, 0.8, 0.9],
  SW: [0.5, 1.5, 1.1, 0.7, 0.8, 1.2, 0.9, 0.7, 0.8],
  SE: [1.9, 0.3, 0.8, 1.8, 0.5, 1.5, 0.7, 0.9, 0.6],
  SS: [1.6, 0.4, 1.2, 1.4, 0.6, 0.7, 0.8, 0.7, 0.6],
  FC: [1.2, 1.0, 0.9, 1.1, 0.8, 0.8, 1.0, 0.9, 0.8],
};

// National base shares
const BASE_SHARES = [0.35, 0.27, 0.10, 0.08, 0.07, 0.04, 0.03, 0.03, 0.03];

// ── State → Region mapping ──
const STATE_REGION = {
  Lagos: "SW", Ogun: "SW", Oyo: "SW", Ondo: "SW", Osun: "SW", Ekiti: "SW",
  Kano: "NW", Katsina: "NW", Sokoto: "NW", Zamfara: "NW", Kebbi: "NW", Jigawa: "NW", Kaduna: "NW",
  Borno: "NE", Yobe: "NE", Adamawa: "NE", Gombe: "NE", Taraba: "NE", Bauchi: "NE",
  Niger: "NC", Kwara: "NC", Kogi: "NC", Benue: "NC", Plateau: "NC", Nasarawa: "NC",
  Abia: "SE", Anambra: "SE", Ebonyi: "SE", Enugu: "SE", Imo: "SE",
  Rivers: "SS", Delta: "SS", Bayelsa: "SS", "Akwa Ibom": "SS", "Cross River": "SS", Edo: "SS",
  FCT: "FC",
};

// Approximate state populations (millions)
const STATE_POP = {
  Lagos: 15.4, Kano: 13.1, Rivers: 7.3, Kaduna: 8.0, Oyo: 7.8,
  Delta: 5.6, Katsina: 7.4, Borno: 5.9, Jigawa: 5.7, Benue: 5.5,
  Anambra: 5.3, Plateau: 4.2, Sokoto: 5.3, "Cross River": 4.4, Adamawa: 4.8,
  Ogun: 5.2, Bauchi: 6.5, Niger: 5.3, Imo: 5.0, Abia: 3.9,
  Osun: 4.7, Zamfara: 4.3, Ondo: 4.5, Edo: 4.1, "Akwa Ibom": 5.2,
  Kebbi: 5.2, Kogi: 4.9, Enugu: 4.1, Nasarawa: 3.4, Taraba: 3.6,
  Ebonyi: 3.3, Gombe: 3.3, Ekiti: 3.6, Yobe: 3.5, Kwara: 3.6,
  Bayelsa: 2.3, FCT: 2.8,
};

// Approximate PUs per state (based on INEC data ratios)
const STATE_PU_COUNT = {
  Lagos: 13325, Kano: 11268, Rivers: 6983, Kaduna: 8208, Oyo: 7735,
  Delta: 5167, Katsina: 6673, Borno: 4309, Jigawa: 5329, Benue: 4756,
  Anambra: 4721, Plateau: 3833, Sokoto: 4828, "Cross River": 3826, Adamawa: 4244,
  Ogun: 4801, Bauchi: 5694, Niger: 4643, Imo: 4551, Abia: 3196,
  Osun: 3702, Zamfara: 3686, Ondo: 3852, Edo: 3399, "Akwa Ibom": 4584,
  Kebbi: 4239, Kogi: 4213, Enugu: 3341, Nasarawa: 2986, Taraba: 3045,
  Ebonyi: 2867, Gombe: 2858, Ekiti: 2923, Yobe: 2865, Kwara: 2910,
  Bayelsa: 1759, FCT: 2235,
};

// ── Seeded PRNG ──
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Convex HTTP helper ──
async function convexMutation(path, args) {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Convex ${CONVEX_DEPLOY_KEY}`,
    },
    body: JSON.stringify({ path, args }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Convex mutation ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ── Main seeding logic ──
async function main() {
  const rng = mulberry32(20270116); // Election date seed
  const TARGET_TOTAL_VOTES = 45_000_000;
  const REGISTERED_VOTERS = 50_000_000;

  // Step 1: Calculate total population for proportional distribution
  const totalPop = Object.values(STATE_POP).reduce((s, v) => s + v, 0);

  console.log("📊 Generating realistic election data...\n");

  // Step 2: Calculate state-level data
  const stateResults = [];
  const partyTotals = {};
  for (const p of PARTIES) partyTotals[p.abbr] = 0;

  let grandTotalVotes = 0;
  let grandCovered = 0;
  let grandVerified = 0;

  for (const [state, pop] of Object.entries(STATE_POP)) {
    const region = STATE_REGION[state] || "NC";
    const regionMult = REGION_MULT[region] || [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const totalPUs = STATE_PU_COUNT[state] || 1000;

    // State gets voters proportional to population
    const statePopRatio = pop / totalPop;
    const stateRegisteredVoters = Math.round(REGISTERED_VOTERS * statePopRatio);

    // Turnout: 85-95% (realistic for competitive Nigerian election)
    const turnoutRate = 0.85 + rng() * 0.10;
    const stateTotalVotes = Math.round(stateRegisteredVoters * turnoutRate);

    // Coverage: ~92-98% of PUs report
    const coverageRate = 0.92 + rng() * 0.06;
    const coveredPUs = Math.round(totalPUs * coverageRate);
    const verifiedPUs = Math.round(coveredPUs * (0.6 + rng() * 0.3));

    // Calculate regional party shares
    const rawShares = BASE_SHARES.map((s, i) => s * regionMult[i]);
    const shareSum = rawShares.reduce((a, b) => a + b, 0);
    const normalizedShares = rawShares.map((s) => s / shareSum);

    // Distribute votes among parties
    const statePartyVotes = {};
    let remaining = stateTotalVotes;

    for (let i = 0; i < PARTIES.length; i++) {
      if (i === PARTIES.length - 1) {
        // Last party gets remainder
        statePartyVotes[PARTIES[i].abbr] = Math.max(0, remaining);
      } else {
        const jitter = 0.85 + rng() * 0.30;
        const votes = Math.round(stateTotalVotes * normalizedShares[i] * jitter);
        statePartyVotes[PARTIES[i].abbr] = votes;
        remaining -= votes;
      }
    }

    // Accumulate grand totals
    for (const p of PARTIES) {
      partyTotals[p.abbr] += statePartyVotes[p.abbr];
    }
    grandTotalVotes += stateTotalVotes;
    grandCovered += coveredPUs;
    grandVerified += verifiedPUs;

    stateResults.push({
      state_id: "",
      state_name: state,
      region,
      total_pus: totalPUs,
      covered_pus: coveredPUs,
      verified_pus: verifiedPUs,
      unavailable_pus: totalPUs - coveredPUs,
      total_votes: stateTotalVotes,
      registered_voters: stateRegisteredVoters,
      turnout_percent: Number(((stateTotalVotes / stateRegisteredVoters) * 100).toFixed(1)),
      ndc_votes: statePartyVotes["NDC"] || 0,
      apc_votes: statePartyVotes["APC"] || 0,
      pdp_votes: statePartyVotes["PDP"] || 0,
      lp_votes: statePartyVotes["LP"] || 0,
      nnpp_votes: statePartyVotes["NNPP"] || 0,
      apga_votes: statePartyVotes["APGA"] || 0,
      sdp_votes: statePartyVotes["SDP"] || 0,
      ypp_votes: statePartyVotes["YPP"] || 0,
      adc_votes: statePartyVotes["ADC"] || 0,
    });

    console.log(`  ${state.padEnd(15)} ${region} ${(stateTotalVotes / 1e6).toFixed(1).padStart(5)}M votes  ${coveredPUs.toLocaleString().padStart(6)} PUs`);
  }

  // Step 3: Build party totals with percentages
  const grandPartyTotal = Object.values(partyTotals).reduce((s, v) => s + v, 0);
  const partyTotalData = PARTIES.map((p) => ({
    party_id: p.id,
    party_name: p.name,
    party_abbreviation: p.abbr,
    party_color: p.color,
    total_votes: partyTotals[p.abbr],
    percentage: grandPartyTotal > 0 ? Number(((partyTotals[p.abbr] / grandPartyTotal) * 100).toFixed(1)) : 0,
  }));

  // Sort by votes descending for display
  partyTotalData.sort((a, b) => b.total_votes - a.total_votes);

  console.log("\n📊 National Results:");
  for (const p of partyTotalData) {
    console.log(`  ${p.party_abbreviation.padEnd(5)} ${(p.total_votes / 1e6).toFixed(1).padStart(7)}M votes  ${p.percentage}%`);
  }
  console.log(`\n  Total: ${(grandTotalVotes / 1e6).toFixed(1)}M votes across ${grandCovered.toLocaleString()} PUs`);

  // Step 4: Write to Convex
  console.log("\n🚀 Writing to Convex...");

  // 4a: Upsert party totals
  await convexMutation("stats:upsertPartyTotals", {
    parties: partyTotalData,
  });
  console.log("  ✅ Party totals saved");

  // 4b: Upsert global stats
  await convexMutation("stats:upsertGlobalStats", {
    covered_polling_units: grandCovered,
    verified_polling_units: grandVerified,
    total_votes: grandTotalVotes,
    valid_votes: Math.round(grandTotalVotes * 0.97),
    rejected_votes: Math.round(grandTotalVotes * 0.03),
    active_pu_count: grandCovered,
    simulation_running: false,
    scenario: "landslide",
    election_type: "PRESIDENTIAL",
    total_polling_units: 176846,
  });
  console.log("  ✅ Global stats saved");

  // 4c: Upsert state stats (in batches of 10)
  for (let i = 0; i < stateResults.length; i += 10) {
    const batch = stateResults.slice(i, i + 10);
    await convexMutation("stats:upsertStateStats", { states: batch });
  }
  console.log(`  ✅ State stats saved (${stateResults.length} states)`);

  // 4d: Mark simulation as completed
  await convexMutation("stats:updateSimConfig", {
    status: "COMPLETED",
    scenario: "landslide",
    election_type: "PRESIDENTIAL",
    target_voters: REGISTERED_VOTERS,
    progress_percent: 100,
    results_processed: grandCovered,
    total_results: 176846,
    completed_at: Date.now(),
    total_votes: grandTotalVotes,
    valid_votes: Math.round(grandTotalVotes * 0.97),
    rejected_votes: Math.round(grandTotalVotes * 0.03),
    unavailable_pus: 176846 - grandCovered,
  });
  console.log("  ✅ Sim config updated (COMPLETED)");

  console.log("\n🎉 Seed complete! The live site should now show election data.");
  console.log(`   Total votes: ${(grandTotalVotes / 1e6).toFixed(1)}M`);
  console.log(`   PUs covered: ${grandCovered.toLocaleString()}`);
  console.log(`   States: ${stateResults.length}`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
