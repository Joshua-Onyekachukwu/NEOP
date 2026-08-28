import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://lgdubqovtyvzckvpbtrs.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PARTIES = [
  { official_name: 'All Progressives Congress', abbreviation: 'APC', color: '#00A859', status: 'ACTIVE' },
  { official_name: 'Peoples Democratic Party', abbreviation: 'PDP', color: '#0000FF', status: 'ACTIVE' },
  { official_name: 'Labour Party', abbreviation: 'LP', color: '#00FF00', status: 'ACTIVE' },
  { official_name: 'New Nigeria Peoples Party', abbreviation: 'NNPP', color: '#FF0000', status: 'ACTIVE' },
  { official_name: 'All Progressives Grand Alliance', abbreviation: 'APGA', color: '#FFD700', status: 'ACTIVE' },
  { official_name: 'Social Democratic Party', abbreviation: 'SDP', color: '#800080', status: 'ACTIVE' },
  { official_name: 'Young Progressives Party', abbreviation: 'YPP', color: '#FF4500', status: 'ACTIVE' },
  { official_name: 'African Democratic Congress', abbreviation: 'ADC', color: '#008000', status: 'ACTIVE' },
];

const ELECTIONS = [
  { name: '2027 Presidential Election', type: 'PRESIDENTIAL', scheduled_start: '2027-01-16T08:00:00Z', scheduled_end: '2027-01-16T18:00:00Z', status: 'PLANNED' },
  { name: '2027 Governorship Election', type: 'GOVERNORSHIP', scheduled_start: '2027-02-06T08:00:00Z', scheduled_end: '2027-02-06T18:00:00Z', status: 'PLANNED' },
];

const INCIDENT_CATEGORIES = ['VIOLENCE', 'INTIMIDATION', 'DISRUPTION', 'ELECTION_NOT_HELD', 'MATERIAL_SHORTAGE', 'ACCESS_PROBLEM', 'SECURITY_INCIDENT', 'OTHER'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const DESCRIPTIONS = {
  VIOLENCE: ['Physical altercation near polling unit', 'Armed individuals seen approaching'],
  INTIMIDATION: ['Voters being turned away', 'Threats heard near queue'],
  DISRUPTION: ['Voting temporarily stopped', 'Process interrupted by crowd'],
  ELECTION_NOT_HELD: ['No officials arrived', 'Materials not delivered'],
  MATERIAL_SHORTAGE: ['Insufficient ballot papers', 'No ink available'],
  ACCESS_PROBLEM: ['Observer denied entry', 'Restricted access to counting'],
  SECURITY_INCIDENT: ['Police intervention observed', 'Military presence unusual'],
  OTHER: ['Other irregularity observed', 'Unexpected event occurred'],
};

async function run() {
  console.log('=== SEEDING MINIMAL DATA ===\n');

  // 1. Seed parties
  console.log('Seeding parties...');
  const { error: pe } = await supabase.from('parties').insert(PARTIES);
  if (pe) console.error('Party error:', pe.message);
  else console.log('  ✓ 8 parties');

  // 2. Seed elections
  console.log('Seeding elections...');
  const { error: ee } = await supabase.from('elections').insert(ELECTIONS);
  if (ee) console.error('Election error:', ee.message);
  else console.log('  ✓ 2 elections');

  // 3. Fetch existing data
  const { data: states } = await supabase.from('states').select('id, name');
  const { data: elections } = await supabase.from('elections').select('id, name').limit(1);
  const { data: parties } = await supabase.from('parties').select('id, abbreviation');
  const { data: pollingUnits } = await supabase.from('polling_units').select('id, state_id').limit(700);

  if (!states?.length || !elections?.length || !parties?.length) {
    console.error('Missing reference data. States:', states?.length, 'Elections:', elections?.length, 'Parties:', parties?.length);
    process.exit(1);
  }
  if (!pollingUnits?.length) {
    console.error('No polling units. Run full-setup first.');
    process.exit(1);
  }

  const electionId = elections[0].id;
  const partyMap = {};
  parties.forEach(p => { partyMap[p.abbreviation] = p.id; });

  console.log(`\nReference data: ${states.length} states, ${parties.length} parties, ${pollingUnits.length} PUs`);
  console.log(`Election: ${elections[0].name}\n`);

  // 4. Create volunteers + user accounts
  console.log('Creating 50 volunteers...');
  const volunteerIds = [];
  for (let i = 0; i < 50; i++) {
    const userId = crypto.randomUUID();
    await supabase.from('user_accounts').insert({
      id: userId, email: `sim-${i}@test.ng`, full_name: `Agent ${i}`, auth_provider: 'simulation',
    });

    const stateId = states[i % states.length].id;
    const { data: v } = await supabase.from('volunteers').insert({
      user_id: userId, status: 'ACTIVE', state_id: stateId,
      verification_status: 'VERIFIED', training_status: 'COMPLETED',
    }).select('id').single();

    if (v) volunteerIds.push(v.id);
  }
  console.log(`  ✓ ${volunteerIds.length} volunteers`);

  // 5. Create assignments
  console.log('Creating assignments...');
  const assignmentMap = {};
  let assignmentCount = 0;
  for (let i = 0; i < Math.min(volunteerIds.length, pollingUnits.length); i++) {
    const { data: a, error: aErr } = await supabase.from('agent_assignments').insert({
      volunteer_id: volunteerIds[i],
      polling_unit_id: pollingUnits[(i + 50) % pollingUnits.length].id,
      election_id: electionId,
      status: 'CHECKED_IN',
      observer_number: (i % 2) + 3,
      checked_in_at: new Date().toISOString(),
    }).select('id').single();

    if (aErr) { if (i === 0) console.log('  Assignment error:', aErr.message, aErr.details); }
    if (a) { assignmentMap[volunteerIds[i]] = a.id; assignmentCount++; }
  }
  console.log(`  ✓ ${assignmentCount} assignments`);

  // 6. Create result submissions
  console.log('Creating result submissions...');
  let resultCount = 0;
  const numResults = Math.min(200, pollingUnits.length);
  for (let i = 0; i < numResults; i++) {
    const pu = pollingUnits[i];
    const vid = volunteerIds[i % volunteerIds.length];
    const aid = assignmentMap[vid];
    if (!aid) continue;

    const partyVotes = {};
    let total = 0;
    for (const p of PARTIES) {
      const v = Math.floor(Math.random() * 300);
      partyVotes[p.abbreviation] = v;
      total += v;
    }
    const rejected = Math.floor(Math.random() * 10);
    const statuses = ['VERIFIED', 'UNVERIFIED', 'DISPUTED', 'PENDING_REVIEW'];
    const status = statuses[Math.floor(Math.random() * statuses.length)];

    const { data: r, error: rErr } = await supabase.from('result_submissions').insert({
      election_id: electionId, polling_unit_id: pu.id, volunteer_id: vid,
      assignment_id: aid, valid_votes: total, rejected_votes: rejected,
      total_votes: total + rejected,      status: status,
      submitted_at: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    }).select('id').single();

    if (rErr) { if (i === 0) console.log('  Result error:', rErr.message, rErr.details); }
    if (r) {
      const inserts = [];
      for (const [abbr, votes] of Object.entries(partyVotes)) {
        if (partyMap[abbr] && votes > 0) {
          inserts.push({ result_submission_id: r.id, party_id: partyMap[abbr], votes });
        }
      }
      if (inserts.length) await supabase.from('party_results').insert(inserts);
      resultCount++;
    }
  }
  console.log(`  ✓ ${resultCount} result submissions`);

  // 7. Create incidents
  console.log('Creating incidents...');
  let incidentCount = 0;
  for (let i = 0; i < 30; i++) {
    const pu = pollingUnits[Math.floor(Math.random() * pollingUnits.length)];
    const vid = volunteerIds[Math.floor(Math.random() * volunteerIds.length)];
    const cat = INCIDENT_CATEGORIES[Math.floor(Math.random() * INCIDENT_CATEGORIES.length)];
    const desc = DESCRIPTIONS[cat] || ['Irregularity observed'];

    const { error } = await supabase.from('incidents').insert({
      election_id: electionId, polling_unit_id: pu.id, volunteer_id: vid,
      category: cat, severity: SEVERITIES[Math.floor(Math.random() * SEVERITIES.length)],
      what_observed: desc[Math.floor(Math.random() * desc.length)],
      agent_safe: Math.random() > 0.1, status: 'REPORTED',
      when_observed: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    });
    if (!error) incidentCount++;
  }
  console.log(`  ✓ ${incidentCount} incidents`);

  console.log('\n=== SIMULATION COMPLETE ===');
  console.log(`Volunteers: ${volunteerIds.length}`);
  console.log(`Assignments: ${assignmentCount}`);
  console.log(`Results: ${resultCount}`);
  console.log(`Incidents: ${incidentCount}`);
  console.log('\nVisit http://localhost:3000 to see live data.');
}

run().catch(e => { console.error(e); process.exit(1); });
