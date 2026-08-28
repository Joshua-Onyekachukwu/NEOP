#!/usr/bin/env node
/**
 * Full-scale re-seed with corrected 2027 party landscape:
 * - APC (Tinubu) ~35%
 * - NDC (Peter Obi + Kwankwaso) ~25% 
 * - PDP ~15%
 * - LP ~7% (Peter Obi left)
 * - NNPP ~5% (Kwankwaso left)
 * - APGA ~5%
 * - SDP ~3%
 * - YPP ~3%
 * - ADC ~2%
 * 
 * Target: 100M+ votes across 188K polling units
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lgdubqovtyvzckvpbtrs.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2027 Nigerian election party vote distribution (percentages)
// Based on current political landscape: APC vs NDC coalition
const PARTY_WEIGHTS = {
  APC:  0.34,   // Tinubu's ruling party — strong in SW, North
  NDC:  0.26,   // Peter Obi + Kwankwaso coalition — strong in SE, SS, parts of North
  PDP:  0.14,   // Weakened opposition — still has some governors
  LP:   0.07,   // Peter Obi left — retains some SE/South support
  NNPP: 0.05,   // Kwankwaso left — weakened in North
  APGA: 0.04,   // Strong in Anambra/Igbo areas
  SDP:  0.03,   // Scattered support
  YPP:  0.02,   // Small but growing
  ADC:  0.02,   // Minor party
  NDC:  0.02,   // Wait, NDC is already at 0.26 above... let me fix
};

// Fix: remove duplicate NDC
delete PARTY_WEIGHTS.NDC;

// Regional vote variation (different regions favor different parties)
// These are multipliers applied to the base weights
const REGIONAL_VARIANTS = {
  // North West — APC stronghold, NNPP in Kano
  NW: { APC: 1.3, NDC: 0.7, PDP: 0.8, LP: 0.5, NNPP: 1.5, APGA: 0.3, SDP: 1.2, YPP: 0.8, ADC: 0.7 },
  // North East — APC strong, some PDP
  NE: { APC: 1.2, NDC: 0.8, PDP: 1.0, LP: 0.4, NNPP: 0.8, APGA: 0.2, SDP: 1.0, YPP: 0.6, ADC: 0.8 },
  // North Central — mixed
  NC: { APC: 1.1, NDC: 0.9, PDP: 1.1, LP: 0.6, NNPP: 0.7, APGA: 0.4, SDP: 1.1, YPP: 0.7, ADC: 0.9 },
  // South West — APC stronghold
  SW: { APC: 1.4, NDC: 0.6, PDP: 0.8, LP: 0.7, NNPP: 0.3, APGA: 0.3, SDP: 0.8, YPP: 0.9, ADC: 0.6 },
  // South East — NDC/LP strong (Peter Obi), APGA base
  SE: { APC: 0.4, NDC: 1.8, PDP: 0.5, LP: 1.6, NNPP: 0.2, APGA: 2.0, SDP: 0.4, YPP: 1.2, ADC: 0.5 },
  // South South — PDP/NDC territory
  SS: { APC: 0.5, NDC: 1.5, PDP: 1.4, LP: 1.2, NNPP: 0.2, APGA: 0.5, SDP: 0.6, YPP: 0.8, ADC: 0.7 },
  // FCT — mixed urban
  FC: { APC: 1.0, NDC: 1.1, PDP: 0.9, LP: 1.0, NNPP: 0.5, APGA: 0.4, SDP: 0.9, YPP: 1.0, ADC: 0.8 },
};

// Map states to regions
const STATE_REGION = {
  'Kano': 'NW', 'Katsina': 'NW', 'Sokoto': 'NW', 'Zamfara': 'NW', 'Kebbi': 'NW', 'Jigawa': 'NW', 'Kaduna': 'NW',
  'Borno': 'NE', 'Yobe': 'NE', 'Adamawa': 'NE', 'Gombe': 'NE', 'Taraba': 'NE', 'Bauchi': 'NE',
  'Niger': 'NC', 'Kwara': 'NC', 'Kogi': 'NC', 'Benue': 'NC', 'Plateau': 'NC', 'Nasarawa': 'NC',
  'Lagos': 'SW', 'Ogun': 'SW', 'Oyo': 'SW', 'Ondo': 'SW', 'Osun': 'SW', 'Ekiti': 'SW', 'Oshun': 'SW',
  'Abia': 'SE', 'Anambra': 'SE', 'Ebonyi': 'SE', 'Enugu': 'SE', 'Imo': 'SE',
  'Rivers': 'SS', 'Delta': 'SS', 'Bayelsa': 'SS', 'Akwa Ibom': 'SS', 'Cross River': 'SS', 'Edo': 'SS',
  'FCT': 'FC',
};

function getRegionalWeights(stateName) {
  const region = STATE_REGION[stateName] || 'NC';
  const regional = REGIONAL_VARIANTS[region] || {};
  
  // Apply regional variation to base weights
  const adjusted = {};
  let total = 0;
  for (const [party, baseWeight] of Object.entries(PARTY_WEIGHTS)) {
    const multiplier = regional[party] || 1.0;
    adjusted[party] = baseWeight * multiplier;
    total += adjusted[party];
  }
  
  // Normalize to sum to 1
  for (const party of Object.keys(adjusted)) {
    adjusted[party] /= total;
  }
  
  return adjusted;
}

function generateVotes(weights, totalVotes) {
  const votes = {};
  let remaining = totalVotes;
  const parties = Object.keys(weights);
  
  for (let i = 0; i < parties.length - 1; i++) {
    const party = parties[i];
    const expected = Math.round(totalVotes * weights[party]);
    // Add some randomness: ±20%
    const variation = 1 + (Math.random() - 0.5) * 0.4;
    const actual = Math.min(Math.round(expected * variation), remaining - (parties.length - i - 1));
    votes[party] = Math.max(0, actual);
    remaining -= votes[party];
  }
  
  // Last party gets whatever is left
  votes[parties[parties.length - 1]] = Math.max(0, remaining);
  
  return votes;
}

async function main() {
  console.log('=== FULL-SCALE RE-SEED: 2027 NIGERIAN ELECTION ===');
  console.log('Parties:', Object.keys(PARTY_WEIGHTS).join(', '));
  console.log('Target: 100M+ votes\n');
  
  // Step 1: Get all polling units with state info
  console.log('Step 1: Loading polling units...');
  const t0 = Date.now();
  const { data: states } = await supabase.from('states').select('id, name');
  const stateMap = new Map(states?.map(s => [s.id, s.name]));
  console.log('  States:', states?.length);
  
  // Get all PUs with state info
  const allPUs = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from('polling_units').select('id, state_id').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allPUs.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log('  PUs:', allPUs.length, 'in', Date.now() - t0, 'ms');
  
  // Get assignments (we use these to link results)
  console.log('Step 2: Loading assignments...');
  const assignments = [];
  offset = 0;
  while (true) {
    const { data } = await supabase.from('agent_assignments').select('id, polling_unit_id, election_id, volunteer_id').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    assignments.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log('  Assignments:', assignments.length);
  
  // Get NDC party ID
  const { data: ndcParty } = await supabase.from('parties').select('id').eq('abbreviation', 'NDC').limit(1).single();
  console.log('  NDC party ID:', ndcParty?.id);
  
  // Get all party IDs by abbreviation
  const { data: allParties } = await supabase.from('parties').select('id, abbreviation');
  const partyIdMap = {};
  allParties?.forEach(p => {
    if (!partyIdMap[p.abbreviation]) partyIdMap[p.abbreviation] = p.id;
  });
  
  // Step 3: Generate results for ALL PUs
  console.log('Step 3: Generating results for', allPUs.length, 'polling units...');
  let totalVotesGlobal = 0;
  let resultsCreated = 0;
  let prCreated = 0;
  
  // Process in batches of 500 PUs
  const BATCH_SIZE = 200;
  
  for (let i = 0; i < allPUs.length; i += BATCH_SIZE) {
    const batch = allPUs.slice(i, i + BATCH_SIZE);
    const tBatch = Date.now();
    
    // Create result submissions
    const resultRows = batch.map(pu => {
      const stateName = stateMap.get(pu.state_id) || 'Unknown';
      const weights = getRegionalWeights(stateName);
      
      // Each PU gets 500-1200 total votes (realistic for Nigerian polling units)
      const totalVotes = Math.round(500 + Math.random() * 700);
      totalVotesGlobal += totalVotes;
      
      const validVotes = Math.round(totalVotes * (0.85 + Math.random() * 0.1));
      const rejectedVotes = totalVotes - validVotes;
      
      return {
        polling_unit_id: pu.id,
        election_id: assignments.find(a => a.polling_unit_id === pu.id)?.election_id || null,
        volunteer_id: assignments.find(a => a.polling_unit_id === pu.id)?.volunteer_id || null,
        assignment_id: assignments.find(a => a.polling_unit_id === pu.id)?.id || null,
        valid_votes: validVotes,
        rejected_votes: rejectedVotes,
        total_votes: totalVotes,
        status: 'VERIFIED',
        submitted_at: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString(),
        verified_at: new Date(Date.now() - Math.random() * 86400000 * 15).toISOString(),
        _weights: weights, // carry forward for party_results
        _totalVotes: totalVotes,
      };
    });
    
    // Insert result submissions
    const { data: insertedResults, error: rsError } = await supabase
      .from('result_submissions')
      .insert(resultRows.map(r => ({
        polling_unit_id: r.polling_unit_id,
        election_id: r.election_id,
        volunteer_id: r.volunteer_id,
        assignment_id: r.assignment_id,
        valid_votes: r.valid_votes,
        rejected_votes: r.rejected_votes,
        total_votes: r.total_votes,
        status: r.status,
        submitted_at: r.submitted_at,
        verified_at: r.verified_at,
      })))
      .select('id');
    
    if (rsError) {
      console.log('  RS error:', rsError.message);
      continue;
    }
    
    // Create party_results for each inserted result
    const prRows = [];
    for (let j = 0; j < insertedResults.length; j++) {
      const result = insertedResults[j];
      const row = resultRows[j];
      const votes = generateVotes(row._weights, row._totalVotes);
      
      for (const [abbr, voteCount] of Object.entries(votes)) {
        const partyId = partyIdMap[abbr];
        if (partyId && voteCount > 0) {
          prRows.push({
            result_submission_id: result.id,
            party_id: partyId,
            votes: voteCount,
          });
        }
      }
    }
    
    // Insert party_results in sub-batches of 500
    for (let k = 0; k < prRows.length; k += 500) {
      const prBatch = prRows.slice(k, k + 500);
      const { error: prError } = await supabase.from('party_results').insert(prBatch);
      if (prError) {
        console.log('  PR error:', prError.message);
      } else {
        prCreated += prBatch.length;
      }
    }
    
    resultsCreated += insertedResults.length;
    
    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= allPUs.length) {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      const rate = Math.round(resultsCreated / elapsed);
      console.log(`  [${Math.round((i + BATCH_SIZE) / allPUs.length * 100)}%] Results: ${resultsCreated}, Party Results: ${prCreated}, Votes: ~${(totalVotesGlobal / 1000000).toFixed(1)}M, Speed: ${rate}/sec`);
    }
  }
  
  console.log('\n=== SIMULATION COMPLETE ===');
  console.log('Results created:', resultsCreated);
  console.log('Party results created:', prCreated);
  console.log('Total votes:', totalVotesGlobal.toLocaleString());
  console.log('Time:', Math.round((Date.now() - t0) / 1000), 'seconds');
}

main().catch(console.error);
