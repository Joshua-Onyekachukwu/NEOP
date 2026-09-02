#!/usr/bin/env node

/**
 * Run Election Simulation — Hybrid Node.js + Supabase approach
 *
 * Phase 1: Supabase SQL function (clear + insert 176K results) — ~25s
 * Phase 2: Node.js loop (fetch results, compute votes, insert party_results)
 *
 * Usage: cd apps/web && node ../../scripts/run-simulation.mjs [scenario] [voters]
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const paths = [resolve(__dirname, "../apps/web/.env.local"), resolve(process.cwd(), ".env.local")];
  for (const p of paths) {
    if (existsSync(p)) {
      for (const line of readFileSync(p, "utf-8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#") || !t.includes("=")) continue;
        const [k, ...v] = t.split("=");
        if (!process.env[k.trim()]) process.env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, "");
      }
      return;
    }
  }
}

loadEnv();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing env vars"); process.exit(1); }

const scenario = process.argv[2] || "landslide";
const voters = parseInt(process.argv[3] || "50000000", 10);
const BATCH_SIZE = 20000;

const PARTY_SHARES = { landslide: 0.42, sweep: 0.37, close: 0.30 };
const APC_SHARES = { landslide: 0.22, sweep: 0.25, close: 0.28 };
const REMAINING_SHARES = [0.30, 0.20, 0.12, 0.10, 0.08, 0.10];
const REGION_NDC = {
  Abia:1.9, Anambra:1.9, Ebonyi:1.9, Enugu:1.9, Imo:1.9,
  Rivers:1.6, Delta:1.6, Bayelsa:1.6, "Akwa Ibom":1.6, "Cross River":1.6, Edo:1.6,
  FCT:1.2, Niger:1.0, Kwara:1.0, Kogi:1.0, Benue:1.0, Plateau:1.0, Nasarawa:1.0,
  Borno:0.7, Yobe:0.7, Adamawa:0.7, Gombe:0.7, Taraba:0.7, Bauchi:0.7,
  Kano:0.6, Katsina:0.6, Sokoto:0.6, Zamfara:0.6, Kebbi:0.6, Jigawa:0.6, Kaduna:0.6,
  Lagos:0.5, Ogun:0.5, Oyo:0.5, Ondo:0.5, Osun:0.5, Ekiti:0.5,
};
const REGION_APC = {
  Lagos:1.5, Ogun:1.5, Oyo:1.5, Ondo:1.5, Osun:1.5, Ekiti:1.5,
  Kano:1.4, Katsina:1.4, Sokoto:1.4, Zamfara:1.4, Kebbi:1.4, Jigawa:1.4, Kaduna:1.4,
  Borno:1.3, Yobe:1.3, Adamawa:1.3, Gombe:1.3, Taraba:1.3, Bauchi:1.3,
  Niger:1.1, Kwara:1.1, Kogi:1.1, Benue:1.1, Plateau:1.1, Nasarawa:1.1,
  FCT:1.0, Rivers:0.4, Delta:0.4, Bayelsa:0.4, "Akwa Ibom":0.4, "Cross River":0.4, Edo:0.4,
  Abia:0.3, Anambra:0.3, Ebonyi:0.3, Enugu:0.3, Imo:0.3,
};

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let PARTY_IDS = {};

async function sbRPC(fn, args, timeout = 180_000) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} (${r.status}): ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function sbInsert(table, rows) {
  const r = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows), signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`Insert ${table}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function fetchAll(table, select) {
  const all = [];
  let off = 0;
  while (true) {
    const r = await fetch(`${URL}/rest/v1/${table}?select=${select}&offset=${off}&limit=10000&order=id`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json();
    if (!data || data.length === 0) break;
    all.push(...data);
    off += data.length;
    if (data.length < 1000) break;
  }
  return all;
}

async function main() {
  console.log(`Simulation: scenario=${scenario}, voters=${(voters / 1e6).toFixed(0)}M\n`);
  const totalStart = Date.now();

  // Fetch party IDs
  const parties = await fetchAll("parties", "id,abbreviation");
  for (const p of parties) PARTY_IDS[p.abbreviation] = p.id;

  // Phase 1
  console.log("Phase 1: Clearing + inserting result_submissions...");
  const t1 = Date.now();
  const p1 = await sbRPC("run_sim_phase1", { p_scenario: scenario, p_total_voters: voters }, 180_000);
  console.log(`  Done in ${((Date.now() - t1) / 1000).toFixed(1)}s — ${p1.results_created?.toLocaleString()} results, ${(p1.total_votes / 1e6).toFixed(1)}M votes\n`);

  // Phase 2: Build PU -> state mapping
  console.log("Phase 2: Building PU->state map...");
  const wards = await fetchAll("wards", "id,lga_id");
  const lgas = await fetchAll("lgas", "id,state_id");
  const states = await fetchAll("states", "id,name");
  const wardToLga = Object.fromEntries(wards.map(w => [w.id, w.lga_id]));
  const lgaToState = Object.fromEntries(lgas.map(l => [l.id, l.state_id]));
  const stateNames = Object.fromEntries(states.map(s => [s.id, s.name]));
  const stateRegionMap = {};
  for (const s of states) stateRegionMap[s.name] = true;

  // Fetch PUs and map to state names
  const pus = await fetchAll("polling_units", "id,ward_id");
  const puStateName = {};
  for (const pu of pus) {
    const lgaId = wardToLga[pu.ward_id];
    const stateId = lgaToState[lgaId];
    puStateName[pu.id] = stateNames[stateId] || "";
  }
  console.log(`  ${Object.keys(puStateName).length} PUs mapped to states\n`);

  // Phase 2: Node.js loop
  console.log("Phase 2: Distributing votes to parties...");
  const t2 = Date.now();
  const rng = mulberry32(20270116);
  const ndcShare = PARTY_SHARES[scenario] || 0.37;
  const apcShare = APC_SHARES[scenario] || 0.25;

  let offset = 0;
  let totalPR = 0;
  const partyTotals = {};
  for (const abbr of Object.keys(PARTY_IDS)) partyTotals[abbr] = 0;

  while (true) {
    const r = await fetch(`${URL}/rest/v1/result_submissions?select=id,valid_votes,polling_unit_id&offset=${offset}&limit=${BATCH_SIZE}&order=id`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(30_000),
    });
    const results = await r.json();
    if (!results || results.length === 0) break;

    const prBatch = [];
    for (const rs of results) {
      const stateName = puStateName[rs.polling_unit_id] || "";
      const vv = rs.valid_votes;

      const ndcVotes = Math.max(0, Math.round(vv * ndcShare * (REGION_NDC[stateName] || 1.0) * (0.85 + rng() * 0.3)));
      const apcVotes = Math.max(0, Math.round(vv * apcShare * (REGION_APC[stateName] || 1.0) * (0.85 + rng() * 0.3)));
      const remaining = Math.max(0, vv - ndcVotes - apcVotes);

      if (ndcVotes > 0) { prBatch.push({ result_submission_id: rs.id, party_id: PARTY_IDS.NDC, votes: ndcVotes }); partyTotals.NDC += ndcVotes; }
      if (apcVotes > 0) { prBatch.push({ result_submission_id: rs.id, party_id: PARTY_IDS.APC, votes: apcVotes }); partyTotals.APC += apcVotes; }

      const otherParties = ["PDP", "LP", "NNPP", "APGA", "SDP", "YPP"];
      let leftover = remaining;
      for (let i = 0; i < otherParties.length; i++) {
        const pv = Math.max(0, Math.round(remaining * REMAINING_SHARES[i] * (0.7 + rng() * 0.6)));
        if (pv > 0) { prBatch.push({ result_submission_id: rs.id, party_id: PARTY_IDS[otherParties[i]], votes: pv }); partyTotals[otherParties[i]] += pv; }
        leftover -= pv;
      }
      if (leftover > 0) { prBatch.push({ result_submission_id: rs.id, party_id: PARTY_IDS.ADC, votes: leftover }); partyTotals.ADC += leftover; }
    }

    // Insert in sub-batches of 5000
    for (let i = 0; i < prBatch.length; i += 5000) {
      await sbInsert("party_results", prBatch.slice(i, i + 5000));
    }

    totalPR += prBatch.length;
    offset += results.length;
    process.stdout.write(`  ${offset.toLocaleString()} results, ${(totalPR / 1e6).toFixed(2)}M party results\r\n`);
    if (results.length < BATCH_SIZE) break;
  }

  console.log(`\n  Done in ${((Date.now() - t2) / 1000).toFixed(1)}s\n`);

  // Update simulation config
  await fetch(`${URL}/rest/v1/simulation_config?id=eq.00000000-0000-0000-0000-000000000001`, {
    method: "PATCH",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "COMPLETED", last_tick_at: new Date().toISOString(), updated_at: new Date().toISOString(), total_results_submitted: offset }),
    signal: AbortSignal.timeout(10_000),
  });

  const grandTotal = Object.values(partyTotals).reduce((s, v) => s + v, 0);
  const sorted = Object.entries(partyTotals).sort((a, b) => b[1] - a[1]);
  console.log("National Results:");
  for (const [abbr, votes] of sorted) {
    console.log(`  ${abbr.padEnd(5)} ${(votes / 1e6).toFixed(1).padStart(5)}M  ${grandTotal > 0 ? ((votes / grandTotal) * 100).toFixed(1) : 0}%`);
  }
  console.log(`\nTotal: ${(grandTotal / 1e6).toFixed(1)}M votes, ${offset.toLocaleString()} PUs in ${((Date.now() - totalStart) / 1000).toFixed(1)}s`);
}

main().catch((err) => { console.error("Failed:", err.message); process.exit(1); });
