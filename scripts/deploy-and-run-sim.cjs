const https = require('https');
const SB_URL = 'https://lvtfrfrnqxqwjuematum.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0';

function postRPC(fn, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('/rest/v1/rpc/' + fn, SB_URL);
    const req = https.request(url, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d.substring(0, 2000) }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Step 1: Fix NOT NULL constraints (already done, but ensure)
  console.log('Step 1: Fixing constraints...');
  let r = await postRPC('exec_sql', { query: 'ALTER TABLE result_submissions ALTER COLUMN submitted_at DROP NOT NULL' });
  console.log('  submitted_at:', r.body.substring(0, 30));
  r = await postRPC('exec_sql', { query: 'ALTER TABLE result_submissions ALTER COLUMN party_votes DROP NOT NULL' });
  console.log('  party_votes:', r.body.substring(0, 30));
  r = await postRPC('exec_sql', { query: 'ALTER TABLE result_submissions ALTER COLUMN verified_at DROP NOT NULL' });
  console.log('  verified_at:', r.body.substring(0, 30));

  // Step 2: Create the function using TRUNCATE instead of DELETE
  console.log('\nStep 2: Creating run_sim_upgraded function...');
  
  const fnSql = `
CREATE OR REPLACE FUNCTION run_sim_upgraded(
  p_scenario TEXT DEFAULT 'landslide',
  p_total_voters BIGINT DEFAULT 20000000
)
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '110s'
SET lock_timeout = '30s'
AS $$ DECLARE
  v_ndc NUMERIC := CASE p_scenario WHEN 'landslide' THEN 0.42 WHEN 'sweep' THEN 0.37 WHEN 'close' THEN 0.30 ELSE 0.37 END;
  v_apc NUMERIC := CASE p_scenario WHEN 'landslide' THEN 0.22 WHEN 'sweep' THEN 0.25 WHEN 'close' THEN 0.28 ELSE 0.25 END;
  v_total_pus INTEGER; v_active_pus INTEGER; v_disrupted_pus INTEGER;
  v_avg_votes INTEGER; v_election_id UUID; v_created INTEGER; v_total_votes BIGINT;
BEGIN
  TRUNCATE TABLE party_results, incidents CASCADE;
  DELETE FROM result_submissions WHERE id IS NOT NULL;
  UPDATE simulation_config SET status='RUNNING', last_tick_at=now(), total_results_submitted=0, election_type='PRESIDENTIAL', updated_at=now() WHERE id='00000000-0000-0000-0000-000000000001';
  INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL') ON CONFLICT DO NOTHING;
  SELECT id INTO v_election_id FROM elections WHERE type='PRESIDENTIAL' LIMIT 1;
  SELECT count(*) INTO v_total_pus FROM polling_units;
  v_active_pus := ROUND(v_total_pus * 0.92)::INTEGER;
  v_disrupted_pus := v_total_pus - v_active_pus;
  v_avg_votes := GREATEST(50, (p_total_voters / v_active_pus)::INTEGER);
  INSERT INTO result_submissions (polling_unit_id, election_id, valid_votes, rejected_votes, total_votes, status, submitted_at, verified_at, party_votes)
  SELECT pu.id, v_election_id,
    CASE WHEN sub.is_disrupted THEN 0 ELSE sub.tv - ROUND(sub.tv * sub.rr)::INTEGER END,
    CASE WHEN sub.is_disrupted THEN 0 ELSE ROUND(sub.tv * sub.rr)::INTEGER END,
    CASE WHEN sub.is_disrupted THEN 0 ELSE sub.tv END,
    CASE WHEN sub.is_disrupted THEN 'DISRUPTED' WHEN random() < 0.05 THEN 'VERIFIED' ELSE 'RESULT_SUBMITTED' END,
    CASE WHEN sub.is_disrupted THEN NULL ELSE now() - (random() * interval '60 days') END,
    CASE WHEN sub.is_disrupted THEN NULL WHEN random() < 0.05 THEN now() - (random() * interval '30 days') ELSE NULL END,
    CASE WHEN sub.is_disrupted THEN NULL ELSE jsonb_build_object(
      'NDC', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rr)::INTEGER) * v_ndc * CASE st.name WHEN 'Abia' THEN 1.9 WHEN 'Anambra' THEN 1.9 WHEN 'Ebonyi' THEN 1.9 WHEN 'Enugu' THEN 1.9 WHEN 'Imo' THEN 1.9 WHEN 'Rivers' THEN 1.6 WHEN 'Delta' THEN 1.6 WHEN 'Bayelsa' THEN 1.6 WHEN 'Akwa Ibom' THEN 1.6 WHEN 'Cross River' THEN 1.6 WHEN 'Edo' THEN 1.6 WHEN 'FCT' THEN 1.2 WHEN 'Niger' THEN 1.0 WHEN 'Kwara' THEN 1.0 WHEN 'Kogi' THEN 1.0 WHEN 'Benue' THEN 1.0 WHEN 'Plateau' THEN 1.0 WHEN 'Nasarawa' THEN 1.0 WHEN 'Borno' THEN 0.7 WHEN 'Yobe' THEN 0.7 WHEN 'Adamawa' THEN 0.7 WHEN 'Gombe' THEN 0.7 WHEN 'Taraba' THEN 0.7 WHEN 'Bauchi' THEN 0.7 WHEN 'Kano' THEN 0.6 WHEN 'Katsina' THEN 0.6 WHEN 'Sokoto' THEN 0.6 WHEN 'Zamfara' THEN 0.6 WHEN 'Kebbi' THEN 0.6 WHEN 'Jigawa' THEN 0.6 WHEN 'Kaduna' THEN 0.6 WHEN 'Lagos' THEN 0.5 WHEN 'Ogun' THEN 0.5 WHEN 'Oyo' THEN 0.5 WHEN 'Ondo' THEN 0.5 WHEN 'Osun' THEN 0.5 WHEN 'Ekiti' THEN 0.5 ELSE 1.0 END * (0.85+random()*0.3)))::INTEGER,
      'APC', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rr)::INTEGER) * v_apc * CASE st.name WHEN 'Lagos' THEN 1.5 WHEN 'Ogun' THEN 1.5 WHEN 'Oyo' THEN 1.5 WHEN 'Ondo' THEN 1.5 WHEN 'Osun' THEN 1.5 WHEN 'Ekiti' THEN 1.5 WHEN 'Kano' THEN 1.4 WHEN 'Katsina' THEN 1.4 WHEN 'Sokoto' THEN 1.4 WHEN 'Zamfara' THEN 1.4 WHEN 'Kebbi' THEN 1.4 WHEN 'Jigawa' THEN 1.4 WHEN 'Kaduna' THEN 1.4 WHEN 'Borno' THEN 1.3 WHEN 'Yobe' THEN 1.3 WHEN 'Adamawa' THEN 1.3 WHEN 'Gombe' THEN 1.3 WHEN 'Taraba' THEN 1.3 WHEN 'Bauchi' THEN 1.3 WHEN 'Niger' THEN 1.1 WHEN 'Kwara' THEN 1.1 WHEN 'Kogi' THEN 1.1 WHEN 'Benue' THEN 1.1 WHEN 'Plateau' THEN 1.1 WHEN 'Nasarawa' THEN 1.1 WHEN 'FCT' THEN 1.0 WHEN 'Rivers' THEN 0.4 WHEN 'Delta' THEN 0.4 WHEN 'Bayelsa' THEN 0.4 WHEN 'Akwa Ibom' THEN 0.4 WHEN 'Cross River' THEN 0.4 WHEN 'Edo' THEN 0.4 WHEN 'Abia' THEN 0.3 WHEN 'Anambra' THEN 0.3 WHEN 'Ebonyi' THEN 0.3 WHEN 'Enugu' THEN 0.3 WHEN 'Imo' THEN 0.3 ELSE 1.0 END * (0.85+random()*0.3)))::INTEGER,
      'PDP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rr)::INTEGER) * 0.30 * (0.7+random()*0.6)))::INTEGER,
      'LP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rr)::INTEGER) * 0.20 * (0.7+random()*0.6)))::INTEGER,
      'NNPP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rr)::INTEGER) * 0.12 * (0.7+random()*0.6)))::INTEGER,
      'APGA', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rr)::INTEGER) * 0.10 * (0.7+random()*0.6)))::INTEGER,
      'SDP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rr)::INTEGER) * 0.08 * (0.7+random()*0.6)))::INTEGER,
      'YPP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rr)::INTEGER) * 0.10 * (0.7+random()*0.6)))::INTEGER,
      'ADC', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rr)::INTEGER) * 0.10 * (0.7+random()*0.6)))::INTEGER
    ) END
  FROM (SELECT id, (hashtext(id::text) % 100) < 8 AS is_disrupted, GREATEST(50, ROUND(v_avg_votes * (0.75 + random() * 0.50))) AS tv, (0.05 + random() * 0.10) AS rr FROM polling_units) sub
  LEFT JOIN polling_units pu ON pu.id = sub.id
  LEFT JOIN states st ON st.id = pu.state_id;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  SELECT sum(total_votes) INTO v_total_votes FROM result_submissions;
  UPDATE simulation_config SET status='COMPLETED', last_tick_at=now(), updated_at=now(), total_results_submitted=v_created WHERE id='00000000-0000-0000-0000-000000000001';
  RETURN jsonb_build_object('success', true, 'scenario', p_scenario, 'total_pus', v_total_pus, 'active_pus', v_active_pus, 'disrupted_pus', v_disrupted_pus, 'results_created', v_created, 'total_votes', v_total_votes);
END; $$;
GRANT EXECUTE ON FUNCTION run_sim_upgraded(TEXT, BIGINT) TO service_role;
`;
  
  r = await postRPC('exec_sql', { query: fnSql });
  console.log('  Result:', r.body.substring(0, 100));
  
  await new Promise(res => setTimeout(res, 2000));
  
  // Step 3: Run the simulation
  console.log('\nStep 3: Running 20M simulation...');
  const start = Date.now();
  r = await postRPC('run_sim_upgraded', { p_scenario: 'landslide', p_total_voters: 20000000 });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  
  console.log('Status:', r.status);
  console.log('Time:', elapsed + 's');
  console.log('Response:', r.body);
  
  if (r.status === 200 && r.body.includes('success')) {
    console.log('\n=== Party Totals ===');
    r = await postRPC('get_party_totals_fast', {});
    console.log(r.body.substring(0, 1500));
  }
}

main().catch(e => console.error('Error:', e.message));
