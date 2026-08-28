/**
 * FULL-SCALE ELECTION SIMULATION — FINAL VERSION
 * 
 * Generates realistic data for 188K+ polling units:
 * - ~100M total votes across 8 political parties
 * - Regional vote distributions (North-West APC strong, South-East LP strong, etc.)
 * - Agent assignments for all PUs
 * - Party-level vote breakdowns per result
 * - Random incident reports (~3% per PU)
 * 
 * PREREQUISITE: Run migration 007 in Supabase SQL Editor first!
 * 
 * Run: node scripts/full-seed-final.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const supabase = createClient(
  "https://lgdubqovtyvzckvpbtrs.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── CONSTANTS ────────────────────────────────────────────────

const PARTIES = ["APC", "PDP", "LP", "NNPP", "APGA", "SDP", "YPP", "ADC"];

// Regional voting patterns (APC dominates North, LP dominates South-East, etc.)
const ZONE_STRENGTHS = {
  NW: [0.40, 0.15, 0.05, 0.25, 0.02, 0.03, 0.05, 0.05],
  NE: [0.35, 0.20, 0.05, 0.20, 0.02, 0.03, 0.08, 0.07],
  NC: [0.30, 0.25, 0.15, 0.08, 0.02, 0.08, 0.07, 0.05],
  SW: [0.35, 0.20, 0.20, 0.05, 0.02, 0.05, 0.05, 0.08],
  SE: [0.10, 0.15, 0.45, 0.03, 0.10, 0.02, 0.05, 0.10],
  SS: [0.15, 0.40, 0.15, 0.05, 0.02, 0.08, 0.05, 0.10],
};

const STATE_ZONE = {
  AB:"SE",AD:"NE",AK:"SS",AN:"SE",BA:"NE",BY:"SS",BE:"NC",BO:"NE",CR:"SS",
  DE:"SS",EB:"SE",ED:"SS",EK:"SW",EN:"SE",FC:"NC",GO:"NE",IM:"SE",JI:"NW",
  KD:"NW",KN:"NW",KT:"NW",KB:"NW",KG:"NC",KW:"NC",LA:"SW",NA:"NC",NI:"NC",
  OG:"SW",ON:"SW",OS:"SW",OY:"SW",PL:"NC",RV:"SS",SO:"NW",TA:"NE",YO:"NE",ZF:"NW",
};

const INCIDENT_TEMPLATES = [
  { cat: "VIOLENCE", sev: "HIGH", t: ["Thugs disrupted voting at PU", "Armed men near polling unit", "Agent altercation escalated"] },
  { cat: "INTIMIDATION", sev: "MEDIUM", t: ["Voters turned away by unknown persons", "Party agents blocking access", "Threats against INEC staff"] },
  { cat: "DISRUPTION", sev: "MEDIUM", t: ["Ballot box snatched", "Voting materials destroyed", "Power outage delayed process"] },
  { cat: "MATERIAL_SHORTAGE", sev: "LOW", t: ["Insufficient ballot papers", "No ink pads available", "Missing voter register"] },
  { cat: "SECURITY_INCIDENT", sev: "HIGH", t: ["Shooting near polling unit", "Bomb threat evacuated area", "Military deployment in vicinity"] },
  { cat: "ELECTION_NOT_HELD", sev: "HIGH", t: ["Polling unit did not open", "INEC officials did not arrive", "Security prevented voting"] },
  { cat: "OTHER", sev: "LOW", t: ["Late start to voting", "BVAS technical issues", "Results sheet not provided"] },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ─── VOTE GENERATION ──────────────────────────────────────────

function generateVotes(registeredVoters, zone) {
  const strengths = ZONE_STRENGTHS[zone];
  // Add noise to strengths for realism
  const noisy = strengths.map((s) => Math.max(0.01, s + (Math.random() - 0.5) * 0.08));
  const total = noisy.reduce((a, b) => a + b, 0);
  const normalized = noisy.map((s) => s / total);

  // Turnout: 35-75% (Nigerian average ~35-45% in recent elections)
  const turnout = 0.35 + Math.random() * 0.40;
  const totalVoters = Math.floor(registeredVoters * turnout);
  
  // Rejected ballots: 1-4%
  const rejectRate = 0.01 + Math.random() * 0.04;
  const rejected = Math.floor(totalVoters * rejectRate);
  const valid = totalVoters - rejected;

  // Distribute votes
  const partyVotes = normalized.map((n) => Math.round(valid * n));
  // Fix rounding: give remainder to last party
  partyVotes[7] += valid - partyVotes.reduce((a, b) => a + b, 0);

  return { valid, rejected, total: totalVoters, partyVotes };
}

// ─── MAIN SEED FUNCTION ───────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   FULL-SCALE ELECTION SIMULATION            ║");
  console.log("║   188K polling units • 100M+ votes          ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // ── Step 1: Get reference data ──────────────────────────────
  console.log("📋 Loading reference data...");
  
  const { data: dbStates } = await supabase.from("states").select("id, code");
  const stateMap = {};
  for (const s of dbStates || []) stateMap[s.code] = s.id;

  const { data: partyRows } = await supabase.from("parties").select("id, abbreviation").limit(50);
  const partyMap = {};
  for (const p of partyRows || []) partyMap[p.abbreviation] = p.id;

  const { data: electionRows } = await supabase.from("elections").select("id").limit(1);
  const electionId = electionRows?.[0]?.id;
  if (!electionId) { console.error("❌ No election found. Run full-setup first."); return; }

  const { data: volRows } = await supabase.from("volunteers").select("id").limit(10000);
  const volunteers = volRows || [];
  console.log(`   States: ${dbStates?.length || 0} | Parties: ${partyRows?.length || 0} | Volunteers: ${volunteers.length} | Election: ${electionId.substring(0, 8)}...`);

  // ── Step 2: Load all polling units ──────────────────────────
  console.log("\n📍 Loading polling units...");
  let allPUs = [];
  for (let offset = 0; offset < 250000; offset += 1000) {
    const { data } = await supabase
      .from("polling_units")
      .select("id, state_id, registered_voters, latitude, longitude")
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allPUs = allPUs.concat(data);
    if (allPUs.length % 10000 === 0) process.stdout.write(`   ${allPUs.length} loaded...\r`);
  }
  console.log(`\n   Total PUs: ${allPUs.length}`);

  // ── Step 3: Generate results in batches ─────────────────────
  console.log("\n🗳️  Generating results...");
  
  let totalVotes = 0;
  let resultsInserted = 0;
  let incidentsInserted = 0;
  let assignmentsInserted = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < allPUs.length; i += BATCH_SIZE) {
    const chunk = allPUs.slice(i, i + BATCH_SIZE);
    const assignments = [];
    const results = [];
    const partyResults = [];
    const incidents = [];

    // Create assignments for this batch
    for (const pu of chunk) {
      const volunteer = pick(volunteers);
      assignments.push({
        volunteer_id: volunteer.id,
        polling_unit_id: pu.id,
        election_id: electionId,
        observer_number: 1,
        status: "CHECKED_IN",
        checked_in_at: new Date().toISOString(),
      });
    }

    // Insert assignments and get their IDs
    const { data: createdAssignments, error: assignErr } = await supabase
      .from("agent_assignments")
      .insert(assignments)
      .select("id, polling_unit_id");

    if (assignErr) {
      // If constraint error, try inserting one at a time to find which PUs already have assignments
      console.error(`   ⚠️  Batch ${i} assignment error: ${assignErr.message.substring(0, 80)}`);
      continue;
    }

    // Map polling_unit_id → assignment_id
    const assignMap = {};
    for (const a of createdAssignments || []) {
      assignMap[a.polling_unit_id] = a.id;
    }

    // Generate results for each PU
    for (const pu of chunk) {
      const assignmentId = assignMap[pu.id];
      if (!assignmentId) continue;

      const zone = STATE_ZONE[stateMap[Object.keys(stateMap).find(k => stateMap[k] === pu.state_id)]] || "NC";
      const votes = generateVotes(pu.registered_voters || 500, zone);
      totalVotes += votes.total;

      const resultId = randomUUID();
      results.push({
        id: resultId,
        election_id: electionId,
        polling_unit_id: pu.id,
        volunteer_id: pick(volunteers).id,
        assignment_id: assignmentId,
        valid_votes: votes.valid,
        rejected_votes: votes.rejected,
        total_votes: votes.total,
        status: Math.random() > 0.3 ? "VERIFIED" : "UNVERIFIED",
        submitted_at: new Date(Date.now() - Math.floor(Math.random() * 7200000)).toISOString(),
      });

      // Party results for this PU
      for (let j = 0; j < 8; j++) {
        if (partyMap[PARTIES[j]]) {
          partyResults.push({
            result_submission_id: resultId,
            party_id: partyMap[PARTIES[j]],
            votes: votes.partyVotes[j],
          });
        }
      }

      // ~3% chance of incident
      if (Math.random() < 0.03) {
        const tmpl = pick(INCIDENT_TEMPLATES);
        incidents.push({
          volunteer_id: pick(volunteers).id,
          polling_unit_id: pu.id,
          category: tmpl.cat,
          severity: tmpl.sev,
          what_observed: pick(tmpl.t),
          latitude: pu.latitude + (Math.random() - 0.5) * 0.001,
          longitude: pu.longitude + (Math.random() - 0.5) * 0.001,
          status: "REPORTED",
          submitted_at: new Date(Date.now() - Math.floor(Math.random() * 7200000)).toISOString(),
        });
      }
    }

    // Insert results
    if (results.length > 0) {
      const { error: resErr } = await supabase.from("result_submissions").insert(results);
      if (resErr) {
        console.error(`   ⚠️  Results batch error: ${resErr.message.substring(0, 80)}`);
        continue;
      }
    }

    // Insert party results in sub-batches (Supabase limits)
    for (let j = 0; j < partyResults.length; j += 500) {
      const subBatch = partyResults.slice(j, j + 500);
      const { error: prErr } = await supabase.from("party_results").insert(subBatch);
      if (prErr) {
        console.error(`   ⚠️  Party results error: ${prErr.message.substring(0, 80)}`);
      }
    }

    // Insert incidents
    if (incidents.length > 0) {
      const { error: incErr } = await supabase.from("incidents").insert(incidents);
      if (!incErr) incidentsInserted += incidents.length;
    }

    resultsInserted += results.length;
    assignmentsInserted += createdAssignments?.length || 0;

    // Progress logging
    if (resultsInserted % 5000 === 0 || i + BATCH_SIZE >= allPUs.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const pct = ((resultsInserted / allPUs.length) * 100).toFixed(1);
      console.log(`   ${resultsInserted.toLocaleString()}/${allPUs.length.toLocaleString()} (${pct}%) | ${(totalVotes / 1e6).toFixed(1)}M votes | ${incidentsInserted} incidents | ${elapsed}s`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   SIMULATION COMPLETE                        ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║   Polling Units:  ${allPUs.length.toLocaleString().padStart(8)}                ║`);
  console.log(`║   Assignments:    ${assignmentsInserted.toLocaleString().padStart(8)}                ║`);
  console.log(`║   Results:        ${resultsInserted.toLocaleString().padStart(8)}                ║`);
  console.log(`║   Total Votes:    ${(totalVotes / 1e6).toFixed(1).padStart(7)}M               ║`);
  console.log(`║   Incidents:      ${incidentsInserted.toLocaleString().padStart(8)}                ║`);
  console.log(`║   Time:           ${elapsed.padStart(6)}s                ║`);
  console.log("╚══════════════════════════════════════════════╝");
}

main().catch(console.error);
