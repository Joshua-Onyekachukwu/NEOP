import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://lgdubqovtyvzckvpbtrs.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  // Check what exists
  const { count: vCount } = await supabase.from('volunteers').select('*', { count: 'exact', head: true });
  const { count: aCount } = await supabase.from('agent_assignments').select('*', { count: 'exact', head: true });
  const { count: rCount } = await supabase.from('result_submissions').select('*', { count: 'exact', head: true });
  const { count: pCount } = await supabase.from('parties').select('*', { count: 'exact', head: true });
  const { count: eCount } = await supabase.from('elections').select('*', { count: 'exact', head: true });
  const { count: puCount } = await supabase.from('polling_units').select('*', { count: 'exact', head: true });
  
  console.log('Current state:');
  console.log(`  Parties: ${pCount}`);
  console.log(`  Elections: ${eCount}`);
  console.log(`  Polling Units: ${puCount}`);
  console.log(`  Volunteers: ${vCount}`);
  console.log(`  Assignments: ${aCount}`);
  console.log(`  Results: ${rCount}`);

  // Get election + parties
  const { data: elections } = await supabase.from('elections').select('id').limit(1);
  const { data: parties } = await supabase.from('parties').select('id, abbreviation');
  const { data: pus } = await supabase.from('polling_units').select('id').limit(700);
  const { data: volunteers } = await supabase.from('volunteers').select('id').limit(200);

  if (!elections?.length || !parties?.length || !pus?.length || !volunteers?.length) {
    console.error('Missing data:', { elections: elections?.length, parties: parties?.length, pus: pus?.length, volunteers: volunteers?.length });
    return;
  }

  const electionId = elections[0].id;
  const partyMap = {};
  parties.forEach(p => { partyMap[p.abbreviation] = p.id; });

  // Try creating just ONE assignment to debug
  console.log('\nTrying single assignment...');
  const { data: a, error: aErr } = await supabase.from('agent_assignments').insert({
    volunteer_id: volunteers[0].id,
    polling_unit_id: pus[0].id,
    election_id: electionId,
    status: 'CHECKED_IN',
    observer_number: 99,
    checked_in_at: new Date().toISOString(),
  }).select('id').single();

  if (aErr) {
    console.error('Assignment error:', aErr.message, aErr.details, aErr.hint);
  } else {
    console.log('Assignment created:', a.id);
    
    // Now try result
    console.log('Trying single result...');
    const { data: r, error: rErr } = await supabase.from('result_submissions').insert({
      election_id: electionId,
      polling_unit_id: pus[0].id,
      volunteer_id: volunteers[0].id,
      assignment_id: a.id,
      valid_votes: 150,
      rejected_votes: 3,
      total_votes: 153,
      status: 'UNVERIFIED',
    }).select('id').single();

    if (rErr) {
      console.error('Result error:', rErr.message, rErr.details, rErr.hint);
    } else {
      console.log('Result created:', r.id);
    }
  }
}

run().catch(e => { console.error(e); process.exit(1); });
