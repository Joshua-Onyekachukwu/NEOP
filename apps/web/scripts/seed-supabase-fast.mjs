#!/usr/bin/env node

/**
 * Fast Supabase Seed — Populate election data directly in Supabase
 * 
 * Bulk-inserts election results instead of processing 176K PUs individually.
 * 
 * Usage: cd apps/web && node scripts/seed-supabase-fast.mjs
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const paths = [
    resolve(__dirname, "../../.env.local"),
    resolve(process.cwd(), ".env.local"),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      const lines = readFileSync(p, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
      console.log(`Loaded .env.local`);
      return;
    }
  }
  console.error("Cannot find .env.local");
  process.exit(1);
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

async function sbInsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Insert ${table}: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function sbQuery(table, select = "*") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=500`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  return res.json();
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

const REGION_MULT = {
  NW: [0.6, 1.4, 0.8, 0.5, 1.3, 0.7, 0.6, 0.5, 0.6],
  NE: [0.7, 1.3, 0.9, 0.6, 1.2, 0.8, 0.7, 0.6, 0.7],
  NC: [1.0, 1.1, 1.0, 0.8, 0.9, 0.9, 1.0, 0.8, 0.9],
  SW: [0.5, 1.5, 1.1, 0.7, 0.8, 1.2, 0.9, 0.7, 0.8],
  SE: [1.9, 0.3, 0.8, 1.8, 0.5, 1.5, 0.7, 0.9, 0.6],
  SS: [1.6, 0.4, 1.2, 1.4, 0.6, 0.7, 0.8, 0.7, 0.6],
  FC: [1.2, 1.0, 0.9, 1.1, 0.8, 0.8, 1.0, 0.9, 0.8],
};

const BASE_SHARES = [0.35, 0.27, 0.10, 0.08, 0.07, 0.04, 0.03, 0.03, 0.03];

const STATE_REGION = {
  Lagos: "SW", Ogun: "SW", Oyo: "SW", Ondo: "SW", Osun: "SW", Ekiti: "SW",
  Kano: "NW", Katsina: "NW", Sokoto: "NW", Zamfara: "NW", Kebbi: "NW", Jigawa: "NW", Kaduna: "NW",
  Borno: "NE", Yobe: "NE", Adamawa: "NE", Gombe: "NE", Taraba: "NE", Bauchi: "NE",
  Niger: "NC", Kwara: "NC", Kogi: "NC", Benue: "NC", Plateau: "NC", Nasarawa: "NC",
  Abia: "SE", Anambra: "SE", Ebonyi: "SE", Enugu: "SE", Imo: "SE",
  Rivers: "SS", Delta: "SS", Bayelsa: "SS", "Akwa Ibom": "SS", "Cross River": "SS", Edo: "SS",
  FCT: "FC",
};

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

async function main() {
  const rng = mulberry32(20270116);
  const REGISTERED_VOTERS = 50_000_000;
  const totalPop = Object.values(STATE_POP).reduce((s, v) => s + v, 0);

  // Step 1: Get party IDs
  console.log("Step 1: Get party IDs...");
  const partyRows = await sbQuery("parties", "id,abbreviation");
  if (partyRows.length < 9) {
    console.error("Less than 9 parties. Run migrations first.");
    process.exit(1);
  }
  const partyIds = {};
  for (const p of partyRows) partyIds[p.abbreviation] = p.id;
  console.log(`  Found ${partyRows.length} parties`);

  // Get election ID
  const elections = await fetch(`${SUPABASE_URL}/rest/v1/elections?select=id&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  const electionData = await elections.json();
  let electionId = electionData[0]?.id;
  if (!electionId) {
    console.log("  Creating election...");
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elections`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify({ name: "Presidential Election 2027", type: "PRESIDENTIAL" }),
      signal: AbortSignal.timeout(10_000),
    });
    electionId = (await res.json())[0]?.id;
  }
  console.log(`  Election: ${electionId}`);

  // Step 2: Get PU-to-state mapping
  console.log("Step 2: Get PU hierarchy...");
  
  // Paginate ALL queries since Supabase caps at 1000 rows
  async function fetchAll(table, select, idCol = "id") {
    const all = [];
    let off = 0;
    while (true) {
      const batch = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&offset=${off}&limit=1000&order=${idCol}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        signal: AbortSignal.timeout(15_000),
      });
      const data = await batch.json();
      if (!data || data.length === 0) break;
      all.push(...data);
      off += 1000;
      if (data.length < 1000) break;
    }
    return all;
  }

  const [wards, lgas, states] = await Promise.all([
    fetchAll("wards", "id,lga_id"),
    fetchAll("lgas", "id,state_id"),
    fetchAll("states", "id,name"),
  ]);
  console.log(`  ${wards.length} wards, ${lgas.length} LGAs, ${states.length} states`);

  const wardToLga = {};
  for (const w of wards) wardToLga[w.id] = w.lga_id;
  const lgaToState = {};
  for (const l of lgas) lgaToState[l.id] = l.state_id;
  const stateIdToName = {};
  for (const s of states) stateIdToName[s.id] = s.name;

  // Fetch PUs in batches and map to states
  const pusPerState = {};
  let puOffset = 0;
  const PU_BATCH = 1000;
  let totalPUCount = 0;

  while (true) {
    const pus = await fetch(`${SUPABASE_URL}/rest/v1/polling_units?select=id,ward_id&offset=${puOffset}&limit=${PU_BATCH}&order=id`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(15_000),
    });
    const puData = await pus.json();
    if (!puData || puData.length === 0) break;

    for (const pu of puData) {
      const lgaId = wardToLga[pu.ward_id];
      const stateId = lgaToState[lgaId];
      const stateName = stateIdToName[stateId] || "Unknown";
      if (!pusPerState[stateName]) pusPerState[stateName] = [];
      pusPerState[stateName].push(pu.id);
    }
    totalPUCount += puData.length;
    puOffset += PU_BATCH;
    if (puData.length < PU_BATCH) break;
  }
  console.log(`  ${totalPUCount} PUs mapped`);

  // Step 3: Clear old data via DELETE in batches
  console.log("Step 3: Clearing old data...");
  for (const table of ["party_results", "result_submissions"]) {
    let cleared = 0;
    while (true) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=not.is.null&limit=1000`, {
        method: "DELETE",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) break;
      const count = Number(res.headers.get("content-range")?.split("/")[1] || "0");
      cleared += count;
      if (count < 5000) break;
      process.stdout.write(`  Cleared ${table}: ${cleared}\r`);
    }
    console.log(`  Cleared ${table}: ${cleared} rows`);
  }

  // Step 4: Generate and insert data
  console.log("Step 4: Generating vote data...");
  const resultsBatch = [];
  const prBatch = [];
  let grandTotalVotes = 0;
  let grandCovered = 0;
  let totalInserted = 0;
  let totalPRInserted = 0;

  for (const [state, pop] of Object.entries(STATE_POP)) {
    const region = STATE_REGION[state] || "NC";
    const regionMult = REGION_MULT[region] || [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const statePUs = pusPerState[state] || [];
    if (statePUs.length === 0) continue;

    const statePopRatio = pop / totalPop;
    const stateRegistered = Math.round(REGISTERED_VOTERS * statePopRatio);
    const turnoutRate = 0.85 + rng() * 0.10;
    const stateTotalVotes = Math.round(stateRegistered * turnoutRate);
    const votesPerPU = Math.max(50, Math.round(stateTotalVotes / statePUs.length));

    const coverageRate = 0.92 + rng() * 0.06;
    const coveredPUs = Math.min(statePUs.length, Math.round(statePUs.length * coverageRate));
    const verifiedPUs = Math.round(coveredPUs * (0.6 + rng() * 0.3));

    const rawShares = BASE_SHARES.map((s, i) => s * regionMult[i]);
    const shareSum = rawShares.reduce((a, b) => a + b, 0);
    const normalizedShares = rawShares.map((s) => s / shareSum);

    for (let i = 0; i < coveredPUs; i++) {
      const puId = statePUs[i];
      const jitter = 0.7 + rng() * 0.6;
      const totalVotesPU = Math.max(10, Math.round(votesPerPU * jitter));
      const rejected = Math.round(totalVotesPU * (0.01 + rng() * 0.04));
      const validVotes = totalVotesPU - rejected;
      const isVerified = i < verifiedPUs;

      const resultId = crypto.randomUUID();
      resultsBatch.push({
        id: resultId,
        election_id: electionId,
        polling_unit_id: puId,
        valid_votes: validVotes,
        rejected_votes: rejected,
        total_votes: totalVotesPU,
        status: isVerified ? "VERIFIED" : "RESULT_SUBMITTED",
        submitted_at: new Date(Date.now() - rng() * 60 * 24 * 60 * 60 * 1000).toISOString(),
        verified_at: isVerified ? new Date(Date.now() - rng() * 30 * 24 * 60 * 60 * 1000).toISOString() : null,
      });

      // Party votes
      let remaining = validVotes;
      for (let p = 0; p < PARTIES.length; p++) {
        if (p === PARTIES.length - 1) {
          prBatch.push({ result_submission_id: resultId, party_id: partyIds[PARTIES[p].abbr], votes: Math.max(0, remaining) });
        } else {
          const v = Math.round(validVotes * normalizedShares[p] * (0.7 + rng() * 0.6));
          prBatch.push({ result_submission_id: resultId, party_id: partyIds[PARTIES[p].abbr], votes: Math.max(0, v) });
          remaining -= v;
        }
      }

      grandTotalVotes += totalVotesPU;
    }

    grandCovered += coveredPUs;
    process.stdout.write(`  ${state.padEnd(15)} ${(stateTotalVotes / 1e6).toFixed(1).padStart(5)}M votes  ${coveredPUs.toLocaleString().padStart(6)} PUs\r\n`);

    // Flush in batches of 10000
    if (resultsBatch.length >= 900) {
      await sbInsert("result_submissions", resultsBatch);
      totalInserted += resultsBatch.length;
      resultsBatch.length = 0;

      await sbInsert("party_results", prBatch);
      totalPRInserted += prBatch.length;
      prBatch.length = 0;

      process.stdout.write(`  Inserted: ${totalInserted} results, ${totalPRInserted} party results\r\n`);
    }
  }

  // Flush remaining
  if (resultsBatch.length > 0) {
    await sbInsert("result_submissions", resultsBatch);
    totalInserted += resultsBatch.length;
  }
  if (prBatch.length > 0) {
    await sbInsert("party_results", prBatch);
    totalPRInserted += prBatch.length;
  }

  console.log(`\n  Total inserted: ${totalInserted} results, ${totalPRInserted} party results`);
  console.log(`  Grand total votes: ${(grandTotalVotes / 1e6).toFixed(1)}M`);
  console.log(`  PUs covered: ${grandCovered.toLocaleString()}`);

  // Step 5: Update simulation_config
  console.log("Step 5: Updating simulation_config...");
  await fetch(`${SUPABASE_URL}/rest/v1/simulation_config?id=eq.00000000-0000-0000-0000-000000000001`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "COMPLETED",
      last_tick_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      total_results_submitted: totalInserted,
      election_type: "PRESIDENTIAL",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  console.log("  Done!");

  console.log(`\nSeed complete! ${totalInserted} results, ${(grandTotalVotes / 1e6).toFixed(1)}M votes.`);
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
