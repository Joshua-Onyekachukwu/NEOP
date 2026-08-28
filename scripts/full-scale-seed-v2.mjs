/**
 * FULL-SCALE ELECTION SIMULATION v2
 * Creates proper LGA/ward stubs, then generates 176K+ PUs with 100M+ votes.
 * Run: node scripts/full-scale-seed-v2.mjs
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://lgdubqovtyvzckvpbtrs.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  { cat: "VIOLENCE", sev: "HIGH", t: ["Thugs disrupted voting", "Armed men at PU", "Agent altercation"] },
  { cat: "INTIMIDATION", sev: "MEDIUM", t: ["Voters turned away", "Party agents blocking access", "Threats observed"] },
  { cat: "DISRUPTION", sev: "MEDIUM", t: ["Ballot box snatched", "Materials destroyed", "Power outage"] },
  { cat: "MATERIAL_SHORTAGE", sev: "LOW", t: ["Insufficient ballots", "No ink pads", "Missing register"] },
  { cat: "SECURITY_INCIDENT", sev: "HIGH", t: ["Shooting near PU", "Bomb threat", "Military deployed"] },
  { cat: "OTHER", sev: "LOW", t: ["Late start", "BVAS issue", "Results sheet missing"] },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
let puCounter = 0;

function genCode(stateCode, idx) {
  puCounter++;
  return `${stateCode}-PU-${String(puCounter).padStart(6, "0")}`;
}

function genVotes(totalVoters, zone) {
  const s = ZONE_STRENGTHS[zone];
  const noisy = s.map((v) => Math.max(0.01, v + (Math.random() - 0.5) * 0.08));
  const tot = noisy.reduce((a, b) => a + b, 0);
  const norm = noisy.map((v) => v / tot);
  const turnout = 0.35 + Math.random() * 0.40;
  const total = Math.floor(totalVoters * turnout);
  const rejected = Math.floor(total * (0.01 + Math.random() * 0.04));
  const valid = total - rejected;
  const pv = norm.map((n) => Math.round(valid * n));
  pv[pv.length - 1] += valid - pv.reduce((a, b) => a + b, 0);
  return { valid, rejected, total, pv };
}

async function main() {
  console.log("=== FULL-SCALE ELECTION SIMULATION v2 ===\n");
  const t0 = Date.now();

  // Step 1: Get state IDs
  console.log("1. Fetching states...");
  const { data: dbStates } = await supabase.from("states").select("id, code, name");
  const stateMap = {};
  for (const s of dbStates || []) stateMap[s.code] = s.id;
  console.log(`   ${dbStates?.length || 0} states found`);

  // Step 2: Ensure parties
  console.log("2. Ensuring parties...");
  for (const p of PARTIES) {
    const { data } = await supabase.from("parties").select("id").eq("abbreviation", p.abbr).limit(1);
    if (!data || data.length === 0) {
      await supabase.from("parties").insert({ official_name: p.name, abbreviation: p.abbr, color: p.color });
    }
  }
  const { data: partyRows } = await supabase.from("parties").select("id, abbreviation").limit(50);
  const partyMap = {};
  for (const p of partyRows || []) partyMap[p.abbreviation] = p.id;
  console.log(`   ${partyRows?.length || 0} parties`);

  // Step 3: Ensure election
  console.log("3. Ensuring election...");
  let { data: election } = await supabase.from("elections").select("id").eq("name", "Presidential Election 2027").limit(1).single();
  if (!election) {
    const { data: e } = await supabase.from("elections").insert({ name: "Presidential Election 2027", election_type: "PRESIDENTIAL", election_date: "2027-01-16" }).select("id").single();
    election = e;
  }
  console.log(`   Election: ${election?.id}`);

  // Step 4: Ensure volunteers
  console.log("4. Ensuring volunteers...");
  const { count: volCount } = await supabase.from("volunteers").select("*", { count: "exact", head: true });
  if (!volCount || volCount < 500) {
    const vols = Array.from({ length: 1000 }, () => ({ user_id: crypto.randomUUID(), status: "ACTIVE", verification_status: "VERIFIED", training_status: "COMPLETED" }));
    for (let i = 0; i < vols.length; i += 500) await supabase.from("volunteers").insert(vols.slice(i, i + 500));
  }
  const { data: volunteerRows } = await supabase.from("volunteers").select("id").eq("status", "ACTIVE").limit(5000);
  console.log(`   ${volunteerRows?.length || 0} volunteers`);

  // Step 5: Create LGA and Ward stubs for each state
  console.log("5. Creating LGA & Ward stubs...");
  const lgaMap = {}; // stateCode -> lgaId
  const wardMap = {}; // stateCode -> wardId

  for (const state of STATES) {
    const sid = stateMap[state.code];
    if (!sid) continue;

    // Create 1 LGA per state (stub)
    const { data: existingLga } = await supabase.from("lgas").select("id").eq("state_id", sid).limit(1).single();
    let lgaId;
    if (existingLga) {
      lgaId = existingLga.id;
    } else {
      const { data: lga } = await supabase.from("lgas").insert({ name: `${state.name} Central`, state_id: sid }).select("id").single();
      lgaId = lga?.id;
    }
    lgaMap[state.code] = lgaId;

    // Create 1 Ward per state (stub)
    const { data: existingWard } = await supabase.from("wards").select("id").eq("lga_id", lgaId).limit(1).single();
    let wardId;
    if (existingWard) {
      wardId = existingWard.id;
    } else {
      const { data: ward } = await supabase.from("wards").insert({ name: `${state.name} Ward 1`, lga_id: lgaId, state_id: sid }).select("id").single();
      wardId = ward?.id;
    }
    wardMap[state.code] = wardId;
  }
  console.log(`   ${Object.keys(lgaMap).length} LGAs, ${Object.keys(wardMap).length} wards`);

  // Step 6: Clear old PUs
  console.log("6. Clearing old polling units...");
  await supabase.from("party_results").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("result_submissions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("incidents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("agent_assignments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("polling_units").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  console.log("   Cleared");

  // Step 7: Insert polling units
  console.log("7. Inserting polling units...");
  let totalPUs = 0;
  for (const state of STATES) {
    const sid = stateMap[state.code];
    if (!sid) continue;
    const lgaId = lgaMap[state.code];
    const wardId = wardMap[state.code];

    const batch = [];
    for (let i = 0; i < state.puCount; i++) {
      batch.push({
        official_code: genCode(state.code, i),
        name: `PU ${state.code}-${i + 1}`,
        state_id: sid,
        lga_id: lgaId,
        ward_id: wardId,
        latitude: state.lat + (Math.random() - 0.5) * 1.5,
        longitude: state.lng + (Math.random() - 0.5) * 1.5,
        registered_voters: 300 + Math.floor(Math.random() * 1200),
        status: "NOT_STARTED",
      });
    }

    for (let i = 0; i < batch.length; i += 500) {
      const { error } = await supabase.from("polling_units").insert(batch.slice(i, i + 500));
      if (error) console.error(`   ${state.code} batch error:`, error.message.substring(0, 80));
    }
    totalPUs += state.puCount;
    process.stdout.write(`   ${state.code}: ${state.puCount} PUs (total: ${totalPUs})\r`);
  }
  console.log(`\n   ${totalPUs} PUs inserted`);

  // Step 8: Fetch all PUs for result generation
  console.log("8. Generating results, assignments, incidents...");
  let allPUs = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from("polling_units").select("id, official_code, state_id, registered_voters, latitude, longitude").range(offset, offset + 4999);
    if (!data || data.length === 0) break;
    allPUs = allPUs.concat(data);
    offset += 5000;
  }
  console.log(`   ${allPUs.length} PUs loaded`);

  // Map state IDs back to codes
  const idToCode = {};
  for (const s of dbStates || []) idToCode[s.id] = s.code;

  let totalVotes = 0;
  let resultsDone = 0;
  let incidentsDone = 0;
  const BATCH = 200;

  for (let i = 0; i < allPUs.length; i += BATCH) {
    const chunk = allPUs.slice(i, i + BATCH);
    const resBatch = [];
    const prBatch = [];
    const incBatch = [];
    const assignBatch = [];

    for (const pu of chunk) {
      const zone = STATE_ZONE[idToCode[pu.state_id]] || "NC";
      const vol = pick(volunteerRows);
      const votes = genVotes(pu.registered_voters || 500, zone);
      totalVotes += votes.total;
      const rid = crypto.randomUUID();

      assignBatch.push({
        volunteer_id: vol.id, polling_unit_id: pu.id, election_id: election.id,
        observer_number: 1, status: "CHECKED_IN", checked_in_at: new Date().toISOString(),
      });

      resBatch.push({
        id: rid, volunteer_id: vol.id, polling_unit_id: pu.id, election_id: election.id,
        valid_votes: votes.valid, rejected_votes: votes.rejected, total_votes: votes.total,
        status: Math.random() > 0.3 ? "VERIFIED" : "UNVERIFIED",
        submitted_at: new Date(Date.now() - Math.floor(Math.random() * 7200000)).toISOString(),
      });

      for (let j = 0; j < Math.min(PARTIES.length, votes.pv.length); j++) {
        if (partyMap[PARTIES[j].abbr]) {
          prBatch.push({ result_id: rid, party_id: partyMap[PARTIES[j].abbr], votes: votes.pv[j] });
        }
      }

      if (Math.random() < 0.03) {
        const tmpl = pick(INCIDENT_TEMPLATES);
        incBatch.push({
          volunteer_id: vol.id, polling_unit_id: pu.id, category: tmpl.cat, severity: tmpl.sev,
          what_observed: pick(tmpl.t), latitude: pu.latitude, longitude: pu.longitude,
          status: "REPORTED", submitted_at: new Date(Date.now() - Math.floor(Math.random() * 7200000)).toISOString(),
        });
      }
    }

    if (assignBatch.length) await supabase.from("agent_assignments").insert(assignBatch);
    if (resBatch.length) await supabase.from("result_submissions").insert(resBatch);
    for (let j = 0; j < prBatch.length; j += 500) {
      await supabase.from("party_results").insert(prBatch.slice(j, j + 500));
    }
    if (incBatch.length) { await supabase.from("incidents").insert(incBatch); incidentsDone += incBatch.length; }

    resultsDone += resBatch.length;
    if (resultsDone % 2000 === 0 || resultsDone === allPUs.length) {
      console.log(`   ${resultsDone}/${allPUs.length} results | ${(totalVotes / 1e6).toFixed(1)}M votes | ${incidentsDone} incidents`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n=== COMPLETE ===`);
  console.log(`Polling Units: ${totalPUs.toLocaleString()}`);
  console.log(`Results: ${resultsDone.toLocaleString()}`);
  console.log(`Total Votes: ${(totalVotes / 1e6).toFixed(1)}M`);
  console.log(`Incidents: ${incidentsDone.toLocaleString()}`);
  console.log(`Time: ${elapsed}s`);
}

main().catch(console.error);
