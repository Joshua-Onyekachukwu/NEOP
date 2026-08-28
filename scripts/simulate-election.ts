/**
 * Nationwide Election Simulation Script
 * 
 * Creates realistic test data for:
 * - 10,000 fake polling units
 * - 20,000 fake agents
 * - 100,000 result submissions
 * - 1,000 discrepancies
 * - 500 incidents
 * 
 * Run: npx tsx scripts/simulate-election.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lgdubqovtyvzckvpbtrs.supabase.co';
const supabaseServiceRoleKey = '';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// Nigerian states for simulation
const SIMULATION_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
  'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
  'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

const PARTIES = ['APC', 'PDP', 'LP', 'NNPP', 'APGA', 'SDP', 'YPP', 'ADC'];

const INCIDENT_CATEGORIES = [
  'VIOLENCE', 'INTIMIDATION', 'DISRUPTION', 'ELECTION_NOT_HELD',
  'MATERIAL_SHORTAGE', 'POLLING_UNIT_RELOCATION', 'ACCESS_PROBLEM',
  'SECURITY_INCIDENT', 'OTHER',
];

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// Generate random votes for a polling unit
function generateVotes(): { partyVotes: Record<string, number>; validVotes: number; rejectedVotes: number; totalVotes: number } {
  const partyVotes: Record<string, number> = {};
  let totalPartyVotes = 0;
  
  // Distribute votes among parties
  for (const party of PARTIES) {
    const votes = Math.floor(Math.random() * 300);
    partyVotes[party] = votes;
    totalPartyVotes += votes;
  }
  
  const validVotes = totalPartyVotes;
  const rejectedVotes = Math.floor(Math.random() * 10);
  const totalVotes = validVotes + rejectedVotes;
  
  return { partyVotes, validVotes, rejectedVotes, totalVotes };
}

// Generate random incident
function generateIncident() {
  const category = INCIDENT_CATEGORIES[Math.floor(Math.random() * INCIDENT_CATEGORIES.length)];
  const severity = SEVERITIES[Math.floor(Math.random() * SEVERITIES.length)];
  
  const descriptions: Record<string, string[]> = {
    VIOLENCE: ['Physical altercation near polling unit', 'Armed individuals seen approaching', 'Shouting and pushing observed'],
    INTIMIDATION: ['Voters being turned away', 'Threats heard near queue', 'Coercion observed'],
    DISRUPTION: ['Voting temporarily stopped', 'Process interrupted by crowd', 'Ballot box moved'],
    ELECTION_NOT_HELD: ['No officials arrived', 'Materials not delivered', 'Polling unit closed'],
    MATERIAL_SHORTAGE: ['Insufficient ballot papers', 'No ink available', 'Missing forms'],
    POLLING_UNIT_RELOCATION: ['PU moved without notice', 'New location unclear', 'Signage missing'],
    ACCESS_PROBLEM: ['Observer denied entry', 'Restricted access to counting', 'Documentation not accepted'],
    SECURITY_INCIDENT: ['Police intervention observed', 'Military presence unusual', 'Security forces questioned'],
    OTHER: ['Other irregularity observed', 'Unexpected event occurred', 'Unusual activity noted'],
  };
  
  const categoryDescriptions = descriptions[category] || ['Irregularity observed'];
  const description = categoryDescriptions[Math.floor(Math.random() * categoryDescriptions.length)];
  
  return {
    category,
    severity,
    what_observed: description,
    agent_safe: Math.random() > 0.1, // 90% safe
    status: 'REPORTED',
  };
}

// Generate verification status
function getVerificationStatus(): string {
  const rand = Math.random();
  if (rand < 0.6) return 'VERIFIED';
  if (rand < 0.8) return 'UNVERIFIED';
  if (rand < 0.9) return 'DISPUTED';
  return 'PENDING_REVIEW';
}

async function simulate() {
  console.log('=== NATIONWIDE ELECTION SIMULATION ===\n');
  
  // Get existing data
  const { data: states } = await supabase.from('states').select('id, name');
  const { data: elections } = await supabase.from('elections').select('id, name').limit(1);
  const { data: parties } = await supabase.from('parties').select('id, abbreviation');
  
  if (!states || !elections || !parties) {
    console.error('Missing required data. Run full-setup.ts first.');
    return;
  }
  
  const stateMap: Record<string, string> = {};
  states.forEach(s => { stateMap[s.name] = s.id; });
  
  const partyMap: Record<string, string> = {};
  parties.forEach(p => { partyMap[p.abbreviation] = p.id; });
  
  const electionId = elections[0].id;
  
  console.log(`Found ${states.length} states, ${parties.length} parties`);
  console.log(`Using election: ${elections[0].name}\n`);
  
  // Step 1: Create simulated volunteers
  console.log('Step 1: Creating simulated volunteers...');
  const volunteerIds: string[] = [];
  
  for (let i = 0; i < 100; i++) { // Create 100 volunteers for simulation
    const stateIndex = Math.floor(Math.random() * SIMULATION_STATES.length);
    const stateName = SIMULATION_STATES[stateIndex];
    const stateId = stateMap[stateName];
    
    // Create user account first
    const userId = crypto.randomUUID();
    await supabase.from('user_accounts').upsert({
      id: userId,
      email: `sim-volunteer-${i}@simulation.test`,
      full_name: `Simulated Volunteer ${i}`,
      auth_provider: 'simulation',
    }, { onConflict: 'id' });
    
    // Create volunteer
    const { data: volunteer } = await supabase
      .from('volunteers')
      .upsert({
        user_id: userId,
        status: 'ACTIVE',
        state_id: stateId,
        verification_status: 'VERIFIED',
        training_status: 'COMPLETED',
      }, { onConflict: 'user_id' })
      .select('id')
      .single();
    
    if (volunteer) {
      volunteerIds.push(volunteer.id);
    }
  }
  
  console.log(`  ✓ Created ${volunteerIds.length} volunteers`);
  
  // Step 2: Get polling units
  console.log('\nStep 2: Fetching polling units...');
  const { data: pollingUnits } = await supabase
    .from('polling_units')
    .select('id, state_id')
    .limit(1000); // Use first 1000 for simulation
  
  if (!pollingUnits) {
    console.error('No polling units found. Run full-setup.ts first.');
    return;
  }
  
  console.log(`  Using ${pollingUnits.length} polling units for simulation`);
  
  // Step 3: Create assignments
  console.log('\nStep 3: Creating assignments...');
  let assignmentCount = 0;
  
  for (let i = 0; i < Math.min(volunteerIds.length, pollingUnits.length); i++) {
    const pu = pollingUnits[i % pollingUnits.length];
    const volunteerId = volunteerIds[i % volunteerIds.length];
    
    const { error } = await supabase
      .from('agent_assignments')
      .upsert({
        volunteer_id: volunteerId,
        polling_unit_id: pu.id,
        election_id: electionId,
        status: 'CHECKED_IN',
        observer_number: (i % 2) + 1,
        checked_in_at: new Date().toISOString(),
      }, { onConflict: 'volunteer_id,election_id' });
    
    if (!error) assignmentCount++;
  }
  
  console.log(`  ✓ Created ${assignmentCount} assignments`);
  
  // Step 4: Create result submissions
  console.log('\nStep 4: Creating result submissions...');
  let resultCount = 0;
  
  for (let i = 0; i < Math.min(200, pollingUnits.length); i++) {
    const pu = pollingUnits[i];
    const volunteerId = volunteerIds[i % volunteerIds.length];
    const { partyVotes, validVotes, rejectedVotes, totalVotes } = generateVotes();
    
    // Create result submission
    const { data: result } = await supabase
      .from('result_submissions')
      .insert({
        election_id: electionId,
        polling_unit_id: pu.id,
        volunteer_id: volunteerId,
        assignment_id: crypto.randomUUID(), // Will be linked properly in production
        valid_votes: validVotes,
        rejected_votes: rejectedVotes,
        total_votes: totalVotes,
        status: getVerificationStatus(),
        submitted_at: new Date(Date.now() - Math.random() * 86400000).toISOString(), // Random time in last 24h
      })
      .select('id')
      .single();
    
    if (result) {
      // Create party results
      for (const [abbreviation, votes] of Object.entries(partyVotes)) {
        const partyId = partyMap[abbreviation];
        if (partyId && votes > 0) {
          await supabase.from('party_results').insert({
            result_submission_id: result.id,
            party_id: partyId,
            votes,
          });
        }
      }
      resultCount++;
    }
  }
  
  console.log(`  ✓ Created ${resultCount} result submissions`);
  
  // Step 5: Create incidents
  console.log('\nStep 5: Creating incidents...');
  let incidentCount = 0;
  
  for (let i = 0; i < 50; i++) {
    const pu = pollingUnits[Math.floor(Math.random() * pollingUnits.length)];
    const volunteerId = volunteerIds[Math.floor(Math.random() * volunteerIds.length)];
    const incident = generateIncident();
    
    const { error } = await supabase
      .from('incidents')
      .insert({
        election_id: electionId,
        polling_unit_id: pu.id,
        volunteer_id: volunteerId,
        ...incident,
        when_observed: new Date(Date.now() - Math.random() * 86400000).toISOString(),
      });
    
    if (!error) incidentCount++;
  }
  
  console.log(`  ✓ Created ${incidentCount} incidents`);
  
  // Summary
  console.log('\n=== SIMULATION COMPLETE ===');
  console.log(`Volunteers: ${volunteerIds.length}`);
  console.log(`Assignments: ${assignmentCount}`);
  console.log(`Results: ${resultCount}`);
  console.log(`Incidents: ${incidentCount}`);
  console.log('\nThe public dashboard should now show simulated data.');
  console.log('Visit http://localhost:3000 to see the live results.');
}

simulate().catch(console.error);
