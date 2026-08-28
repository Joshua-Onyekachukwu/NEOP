/**
 * FULL-SCALE ELECTION SIMULATION
 * 
 * Generates realistic data for a Nigerian presidential election:
 * - 176,846 polling units across 37 states + FCT
 * - ~100M total votes across 8 political parties
 * - Agent assignments for all PUs
 * - Realistic incident reports
 * 
 * Run: node scripts/full-scale-seed.mjs
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://lgdubqovtyvzckvpbtrs.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Nigerian states with approximate PU counts from INEC data
const STATES = [
  { code: "AB", name: "Abia", puCount: 4048, lat: 5.45, lng: 7.52 },
  { code: "AD", name: "Adamawa", puCount: 4110, lat: 9.32, lng: 12.44 },
  { code: "AK", name: "Akwa Ibom", puCount: 4144, lat: 5.03, lng: 7.91 },
  { code: "AN", name: "Anambra", puCount: 5020, lat: 6.21, lng: 6.99 },
  { code: "BA", name: "Bauchi", puCount: 5458, lat: 10.31, lng: 9.84 },
  { code: "BY", name: "Bayelsa", puCount: 2264, lat: 4.77, lng: 6.26 },
  { code: "BE", name: "Benue", puCount: 5086, lat: 7.34, lng: 8.74 },
  { code: "BO", name: "Borno", puCount: 4320, lat: 11.85, lng: 13.16 },
  { code: "CR", name: "Cross River", puCount: 3980, lat: 5.96, lng: 8.34 },
  { code: "DE", name: "Delta", puCount: 5120, lat: 5.52, lng: 5.75 },
  { code: "EB", name: "Ebonyi", puCount: 3192, lat: 6.32, lng: 8.09 },
  { code: "ED", name: "Edo", puCount: 4210, lat: 6.34, lng: 5.60 },
  { code: "EK", name: "Ekiti", puCount: 3118, lat: 7.62, lng: 5.22 },
  { code: "EN", name: "Enugu", puCount: 3986, lat: 6.44, lng: 7.50 },
  { code: "FC", name: "FCT", puCount: 2080, lat: 9.06, lng: 7.49 },
  { code: "GO", name: "Gombe", puCount: 3160, lat: 10.29, lng: 11.17 },
  { code: "IM", name: "Imo", puCount: 4824, lat: 5.48, lng: 7.03 },
  { code: "JI", name: "Jigawa", puCount: 4820, lat: 12.22, lng: 9.36 },
  { code: "KD", name: "Kaduna", puCount: 6516, lat: 10.52, lng: 7.43 },
  { code: "KN", name: "Kano", puCount: 11340, lat: 12.00, lng: 8.52 },
  { code: "KT", name: "Katsina", puCount: 7560, lat: 12.99, lng: 7.60 },
  { code: "KB", name: "Kebbi", puCount: 4686, lat: 11.49, lng: 4.23 },
  { code: "KG", name: "Kogi", puCount: 4620, lat: 7.73, lng: 6.71 },
  { code: "KW", name: "Kwara", puCount: 3744, lat: 8.50, lng: 4.57 },
  { code: "LA", name: "Lagos", puCount: 13320, lat: 6.45, lng: 3.40 },
  { code: "NA", name: "Nasarawa", puCount: 3800, lat: 8.30, lng: 8.30 },
  { code: "NI", name: "Niger", puCount: 5388, lat: 9.08, lng: 6.55 },
  { code: "OG", name: "Ogun", puCount: 6688, lat: 7.16, lng: 3.35 },
  { code: "ON", name: "Ondo", puCount: 5184, lat: 7.25, lng: 5.19 },
  { code: "OS", name: "Osun", puCount: 4620, lat: 7.77, lng: 4.56 },
  { code: "OY", name: "Oyo", puCount: 8052, lat: 7.84, lng: 3.94 },
  { code: "PL", name: "Plateau", puCount: 4620, lat: 9.89, lng: 8.90 },
  { code: "RV", name: "Rivers", puCount: 6868, lat: 4.81, lng: 7.04 },
  { code: "SO", name: "Sokoto", puCount: 5460, lat: 13.06, lng: 5.24 },
  { code: "TA", name: "Taraba", puCount: 3736, lat: 7.87, lng: 10.77 },
  { code: "YO", name: "Yobe", puCount: 4180, lat: 11.75, lng: 11.97 },
  { code: "ZF", name: "Zamfara", puCount: 4720, lat: 12.17, lng: 6.66 },
];

// 8 major parties with regional strengths
const PARTIES = [
  { abbr: "APC", name: "All Progressives Congress", color: "#00A859" },
  { abbr: "PDP", name: "Peoples Democratic Party", color: "#003DA5" },
  { abbr: "LP", name: "Labour Party", color: "#00FF00" },
  { abbr: "NNPP", name: "New Nigeria Peoples Party", color: "#FF0000" },
  { abbr: "APGA", name: "All Progressives Grand Alliance", color: "#FFD700" },
  { abbr: "SDP", name: "Social Democratic Party", color: "#800080" },
  { abbr: "YPP", name: "Young Progressives Party", color: "#FF4500" },
  { abbr: "ADC", name: "African Democratic Congress", color: "#006400" },
];

// Regional voting patterns (strength multiplier per party per zone)
// Zones: North-West, North-East, North-Central, South-West, South-East, South-South
const ZONE_STRENGTHS = {
  "NW": [0.40, 0.15, 0.05, 0.25, 0.02, 0.03, 0.05, 0.05], // APC dominant
  "NE": [0.35, 0.20, 0.05, 0.20, 0.02, 0.03, 0.08, 0.07], // APC slight lead
  "NC": [0.30, 0.25, 0.15, 0.08, 0.02, 0.08, 0.07, 0.05], // Mixed
  "SW": [0.35, 0.20, 0.20, 0.05, 0.02, 0.05, 0.05, 0.08], // APC/LP strong
  "SE": [0.10, 0.15, 0.45, 0.03, 0.10, 0.02, 0.05, 0.10], // LP dominant
  "SS": [0.15, 0.40, 0.15, 0.05, 0.02, 0.08, 0.05, 0.10], // PDP dominant
};

// Map states to zones
const STATE_ZONES = {
  AB: "SE", AD: "NE", AK: "SS", AN: "SE", BA: "NE", BY: "SS",
  BE: "NC", BO: "NE", CR: "SS", DE: "SS", EB: "SE", ED: "SS",
  EK: "SW", EN: "SE", FC: "NC", GO: "NE", IM: "SE", JI: "NW",
  KD: "NW", KN: "NW", KT: "NW", KB: "NW", KG: "NC", KW: "NC",
  LA: "SW", NA: "NC", NI: "NC", OG: "SW", ON: "SW", OS: "SW",
  OY: "SW", PL: "NC", RV: "SS", SO: "NW", TA: "NE", YO: "NE",
  ZF: "NW",
};

// Incident templates
const INCIDENT_TEMPLATES = [
  { category: "VIOLENCE", severity: "HIGH", templates: ["Thugs disrupted voting at PU", "Altercation between party agents", "Armed men chased voters away"] },
  { category: "INTIMIDATION", severity: "MEDIUM", templates: ["Voters intimidated at queue", "Party agents blocking access", "Threats against INEC officials"] },
  { category: "DISRUPTION", severity: "MEDIUM", templates: ["Ballot box snatched", "Voting materials destroyed", "Power outage delayed process"] },
  { category: "MATERIAL_SHORTAGE", severity: "LOW", templates: ["Insufficient ballot papers", "No ink pads available", "Missing voter register"] },
  { category: "ELECTION_NOT_HELD", severity: "HIGH", templates: ["Polling unit did not open", "INEC officials did not arrive", "Security situation prevented voting"] },
  { category: "SECURITY_INCIDENT", severity: "CRITICAL", templates: ["Shooting near polling unit", "Bomb threat evacuated PU", "Military deployment in area"] },
  { category: "OTHER", severity: "LOW", templates: ["Late start to voting", "Technical issues with BVAS", "Results sheet not provided"] },
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePUCode(stateCode, lgaNum, wardNum, puNum) {
  return `PU/${String(lgaNum).padStart(2, "0")}/${String(wardNum).padStart(2, "0")}/${String(puNum).padStart(3, "0")}`;
}

function generateVotes(totalVoters, zone, electionType) {
  const strengths = ZONE_STRENGTHS[zone];
  // Add randomness to strengths
  const noisy = strengths.map((s) => Math.max(0.01, s + (Math.random() - 0.5) * 0.08));
  const total = noisy.reduce((a, b) => a + b, 0);
  const normalized = noisy.map((s) => s / total);

  // Turnout 35-75%
  const turnout = 0.35 + Math.random() * 0.40;
  const totalVoting = Math.floor(totalVoters * turnout);
  const rejected = Math.floor(totalVoting * (0.01 + Math.random() * 0.04));
  const valid = totalVoting - rejected;

  const partyVotes = normalized.map((s) => Math.round(valid * s));
  // Adjust last party to account for rounding
  const sum = partyVotes.reduce((a, b) => a + b, 0);
  partyVotes[partyVotes.length - 1] += valid - sum;

  return { valid, rejected, total: totalVoting, partyVotes };
}

async function clearExisting() {
  console.log("Clearing existing simulation data...");
  // Delete in reverse dependency order
  await supabase.from("party_results").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("result_submissions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("incidents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("agent_assignments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("polling_units").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  console.log("Cleared.");
}

async function ensureParties() {
  console.log("Ensuring parties exist...");
  for (const p of PARTIES) {
    const { data: existing } = await supabase.from("parties").select("id").eq("abbreviation", p.abbr).limit(1).single();
    if (!existing) {
      await supabase.from("parties").insert({ official_name: p.name, abbreviation: p.abbr, color: p.color });
    }
  }
  const { data: parties } = await supabase.from("parties").select("id, abbreviation").limit(50);
  console.log(`  ${parties?.length || 0} parties ready`);
  return parties || [];
}

async function ensureElection() {
  console.log("Ensuring election exists...");
  const { data: existing } = await supabase.from("elections").select("id").eq("name", "Presidential Election 2027").limit(1).single();
  if (existing) return existing.id;
  const { data } = await supabase.from("elections").insert({
    name: "Presidential Election 2027",
    election_type: "PRESIDENTIAL",
    election_date: "2027-01-16",
  }).select("id").single();
  return data?.id;
}

async function ensureVolunteers() {
  console.log("Ensuring volunteers exist...");
  const { count } = await supabase.from("volunteers").select("*", { count: "exact", head: true });
  if (count && count >= 1000) {
    console.log(`  ${count} volunteers already exist`);
    const { data } = await supabase.from("volunteers").select("id").eq("status", "ACTIVE").limit(5000);
    return data || [];
  }
  // Create 2000 simulated volunteers
  console.log("  Creating 2000 simulated volunteers...");
  const volunteers = [];
  for (let i = 0; i < 2000; i++) {
    volunteers.push({
      user_id: crypto.randomUUID(),
      status: "ACTIVE",
      verification_status: "VERIFIED",
      training_status: "COMPLETED",
      state_id: pickRandom(STATES).code, // We'll fix this below
    });
  }
  // Batch insert (Supabase limit is 1000 per call)
  for (let i = 0; i < volunteers.length; i += 500) {
    await supabase.from("volunteers").insert(volunteers.slice(i, i + 500));
  }
  const { data } = await supabase.from("volunteers").select("id").eq("status", "ACTIVE").limit(5000);
  console.log(`  ${data?.length || 0} volunteers ready`);
  return data || [];
}

async function generateAllPollingUnits(stateIds) {
  console.log("Generating polling units...");
  const allPUs = [];
  const stateIdMap = {};
  for (const s of stateIds) stateIdMap[s.code] = s.id;

  for (const state of STATES) {
    const stateId = stateIdMap[state.code];
    if (!stateId) continue;

    for (let i = 0; i < state.puCount; i++) {
      const lgaNum = Math.floor(i / 50) + 1;
      const wardNum = Math.floor((i % 50) / 5) + 1;
      const puNum = (i % 5) + 1;
      const code = generatePUCode(state.code, Math.min(lgaNum, 20), Math.min(wardNum, 10), puNum);

      // Spread PUs around state center with some randomness
      const lat = state.lat + (Math.random() - 0.5) * 1.5;
      const lng = state.lng + (Math.random() - 0.5) * 1.5;
      const registeredVoters = 300 + Math.floor(Math.random() * 1200);

      allPUs.push({
        official_code: `${state.code}-${code}`,
        name: `Polling Unit ${i + 1}`,
        state_id: stateId,
        lga_id: crypto.randomUUID(), // placeholder
        ward_id: crypto.randomUUID(), // placeholder
        latitude: lat,
        longitude: lng,
        registered_voters: registeredVoters,
        status: "NOT_STARTED",
      });
    }
  }

  console.log(`  ${allPUs.length} PUs to insert (${(allPUs.length * 300 / 1e6).toFixed(0)}M–${(allPUs.length * 1500 / 1e6).toFixed(0)}M voters)`);

  // Batch insert (500 at a time)
  let inserted = 0;
  for (let i = 0; i < allPUs.length; i += 500) {
    const batch = allPUs.slice(i, i + 500);
    const { error } = await supabase.from("polling_units").insert(batch);
    if (error) {
      console.error(`  Batch ${i} error:`, error.message);
    } else {
      inserted += batch.length;
    }
    if (inserted % 5000 === 0) process.stdout.write(`  ${inserted}/${allPUs.length}\r`);
  }
  console.log(`\n  ${inserted} PUs inserted`);

  return inserted;
}

async function generateResults(electionId, partyIds, volunteers, stateIds) {
  console.log("Generating results for all polling units...");

  // Fetch all PUs
  let allPUs = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from("polling_units").select("id, official_code, state_id, registered_voters, latitude, longitude").range(offset, offset + 4999);
    if (!data || data.length === 0) break;
    allPUs = allPUs.concat(data);
    offset += 5000;
  }
  console.log(`  Found ${allPUs.length} PUs to process`);

  // Map state IDs to codes and zones
  const stateCodeMap = {};
  for (const s of stateIds) stateCodeMap[s.id] = s.code;

  const partyIdMap = {};
  for (const p of partyIds) partyIdMap[p.abbreviation] = p.id;

  let totalVotes = 0;
  let resultsInserted = 0;
  let incidentsInserted = 0;
  const BATCH_SIZE = 200;

  // Process in batches
  for (let i = 0; i < allPUs.length; i += BATCH_SIZE) {
    const batch = allPUs.slice(i, i + BATCH_SIZE);
    const resultsBatch = [];
    const partyResultsBatch = [];
    const incidentsBatch = [];
    const assignmentsBatch = [];

    for (const pu of batch) {
      const stateCode = stateCodeMap[pu.state_id];
      const zone = STATE_ZONE_STRENGTHS[stateCode] ? getZone(stateCode) : "NC";
      const vol = pickRandom(volunteers);

      // Generate votes
      const votes = generateVotes(pu.registered_voters || 500, zone, "PRESIDENTIAL");
      totalVotes += votes.total;

      const resultId = crypto.randomUUID();

      // Create assignment
      assignmentsBatch.push({
        volunteer_id: vol.id,
        polling_unit_id: pu.id,
        election_id: electionId,
        observer_number: 1,
        status: "CHECKED_IN",
        checked_in_at: new Date().toISOString(),
      });

      // Create result
      resultsBatch.push({
        id: resultId,
        volunteer_id: vol.id,
        polling_unit_id: pu.id,
        election_id: electionId,
        valid_votes: votes.valid,
        rejected_votes: votes.rejected,
        total_votes: votes.total,
        status: Math.random() > 0.3 ? "VERIFIED" : "UNVERIFIED",
        submitted_at: new Date(Date.now() - Math.floor(Math.random() * 3600000)).toISOString(),
      });

      // Create party results
      for (let j = 0; j < PARTIES.length && j < partyVotes.length; j++) {
        const partyAbbr = PARTIES[j].abbr;
        if (partyIdMap[partyAbbr]) {
          partyResultsBatch.push({
            result_id: resultId,
            party_id: partyIdMap[partyAbbr],
            votes: votes.partyVotes[j],
          });
        }
      }

      // ~3% chance of incident
      if (Math.random() < 0.03) {
        const tmpl = pickRandom(INCIDENT_TEMPLATES);
        incidentsBatch.push({
          volunteer_id: vol.id,
          polling_unit_id: pu.id,
          category: tmpl.category,
          severity: tmpl.severity,
          what_observed: pickRandom(tmpl.templates),
          latitude: pu.latitude + (Math.random() - 0.5) * 0.001,
          longitude: pu.longitude + (Math.random() - 0.5) * 0.001,
          status: "REPORTED",
          submitted_at: new Date(Date.now() - Math.floor(Math.random() * 3600000)).toISOString(),
        });
      }
    }

    // Batch insert assignments
    if (assignmentsBatch.length > 0) {
      await supabase.from("agent_assignments").insert(assignmentsBatch);
    }

    // Batch insert results
    if (resultsBatch.length > 0) {
      await supabase.from("result_submissions").insert(resultsBatch);
    }

    // Batch insert party results
    if (partyResultsBatch.length > 0) {
      for (let j = 0; j < partyResultsBatch.length; j += 500) {
        await supabase.from("party_results").insert(partyResultsBatch.slice(j, j + 500));
      }
    }

    // Batch insert incidents
    if (incidentsBatch.length > 0) {
      await supabase.from("incidents").insert(incidentsBatch);
      incidentsInserted += incidentsBatch.length;
    }

    resultsInserted += resultsBatch.length;
    if (resultsInserted % 1000 === 0) {
      console.log(`  ${resultsInserted}/${allPUs.length} results | ${(totalVotes / 1e6).toFixed(1)}M votes | ${incidentsInserted} incidents`);
    }
  }

  console.log(`\n  DONE: ${resultsInserted} results, ${(totalVotes / 1e6).toFixed(1)}M total votes, ${incidentsInserted} incidents`);
  return { resultsInserted, totalVotes, incidentsInserted };
}

function getZone(stateCode) {
  const mapping = {
    AB: "SE", AD: "NE", AK: "SS", AN: "SE", BA: "NE", BY: "SS",
    BE: "NC", BO: "NE", CR: "SS", DE: "SS", EB: "SE", ED: "SS",
    EK: "SW", EN: "SE", FC: "NC", GO: "NE", IM: "SE", JI: "NW",
    KD: "NW", KN: "NW", KT: "NW", KB: "NW", KG: "NC", KW: "NC",
    LA: "SW", NA: "NC", NI: "NC", OG: "SW", ON: "SW", OS: "SW",
    OY: "SW", PL: "NC", RV: "SS", SO: "NW", TA: "NE", YO: "NE",
    ZF: "NW",
  };
  return mapping[stateCode] || "NC";
}

// Main
async function main() {
  console.log("=== FULL-SCALE ELECTION SIMULATION ===");
  console.log("Target: 176,846 polling units, 100M+ votes, all 8 parties\n");

  const startTime = Date.now();

  // Step 0: Clear old data
  await clearExisting();

  // Step 1: Ensure reference data
  const parties = await ensureParties();
  const electionId = await ensureElection();
  const volunteers = await ensureVolunteers();

  // Step 2: Get state IDs
  const { data: stateIds } = await supabase.from("states").select("id, code, name");

  // Step 3: Generate polling units
  const puCount = await generateAllPollingUnits(stateIds || []);

  // Step 4: Generate results, assignments, incidents
  const { resultsInserted, totalVotes, incidentsInserted } = await generateResults(
    electionId,
    parties,
    volunteers,
    stateIds || []
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  console.log(`\n=== SIMULATION COMPLETE ===`);
  console.log(`Polling Units: ${puCount.toLocaleString()}`);
  console.log(`Results: ${resultsInserted.toLocaleString()}`);
  console.log(`Total Votes: ${(totalVotes / 1e6).toFixed(1)}M`);
  console.log(`Incidents: ${incidentsInserted.toLocaleString()}`);
  console.log(`Time: ${elapsed}s`);
}

main().catch(console.error);
