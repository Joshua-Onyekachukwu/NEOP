-- Add party_votes JSONB column
ALTER TABLE result_submissions ADD COLUMN IF NOT EXISTS party_votes JSONB DEFAULT NULL;

-- Single-statement fast simulation: computes everything in one INSERT
CREATE OR REPLACE FUNCTION run_sim_fast(
  p_scenario TEXT DEFAULT 'landslide',
  p_total_voters BIGINT DEFAULT 10000000
)
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '110s'
SET lock_timeout = '30s'
AS $$
DECLARE
  v_ndc NUMERIC := CASE p_scenario WHEN 'landslide' THEN 0.42 WHEN 'sweep' THEN 0.37 ELSE 0.30 END;
  v_apc NUMERIC := CASE p_scenario WHEN 'landslide' THEN 0.22 WHEN 'sweep' THEN 0.25 ELSE 0.28 END;
  v_total_pus INTEGER;
  v_avg_votes INTEGER;
  v_election_id UUID;
  v_created INTEGER;
  v_total_votes BIGINT;
BEGIN
  TRUNCATE TABLE party_results, result_submissions, incidents RESTART IDENTITY;
  UPDATE simulation_config SET
    status = 'RUNNING', last_tick_at = now(), total_results_submitted = 0,
    election_type = 'PRESIDENTIAL', updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_election_id FROM elections WHERE type = 'PRESIDENTIAL' LIMIT 1;

  SELECT count(*) INTO v_total_pus FROM polling_units;
  v_avg_votes := GREATEST(50, (p_total_voters / v_total_pus)::INTEGER);

  INSERT INTO result_submissions (
    polling_unit_id, election_id, valid_votes, rejected_votes, total_votes,
    status, submitted_at, verified_at, party_votes
  )
  SELECT
    pu.id,
    v_election_id,
    tv - ROUND(tv * rr)::INTEGER,
    ROUND(tv * rr)::INTEGER,
    tv,
    CASE WHEN random() < 0.05 THEN 'VERIFIED' ELSE 'RESULT_SUBMITTED' END,
    now() - (random() * interval '60 days'),
    CASE WHEN random() < 0.05 THEN now() - (random() * interval '30 days') ELSE NULL END,
    jsonb_build_object(
      'NDC', GREATEST(0, ROUND((tv - ROUND(tv*rr)::INTEGER) * v_ndc *
        CASE st.name WHEN 'Abia' THEN 1.9 WHEN 'Anambra' THEN 1.9 WHEN 'Ebonyi' THEN 1.9 WHEN 'Enugu' THEN 1.9 WHEN 'Imo' THEN 1.9
          WHEN 'Rivers' THEN 1.6 WHEN 'Delta' THEN 1.6 WHEN 'Bayelsa' THEN 1.6 WHEN 'Akwa Ibom' THEN 1.6 WHEN 'Cross River' THEN 1.6 WHEN 'Edo' THEN 1.6
          WHEN 'FCT' THEN 1.2 WHEN 'Niger' THEN 1.0 WHEN 'Kwara' THEN 1.0 WHEN 'Kogi' THEN 1.0 WHEN 'Benue' THEN 1.0 WHEN 'Plateau' THEN 1.0 WHEN 'Nasarawa' THEN 1.0
          WHEN 'Borno' THEN 0.7 WHEN 'Yobe' THEN 0.7 WHEN 'Adamawa' THEN 0.7 WHEN 'Gombe' THEN 0.7 WHEN 'Taraba' THEN 0.7 WHEN 'Bauchi' THEN 0.7
          WHEN 'Kano' THEN 0.6 WHEN 'Katsina' THEN 0.6 WHEN 'Sokoto' THEN 0.6 WHEN 'Zamfara' THEN 0.6 WHEN 'Kebbi' THEN 0.6 WHEN 'Jigawa' THEN 0.6 WHEN 'Kaduna' THEN 0.6
          WHEN 'Lagos' THEN 0.5 WHEN 'Ogun' THEN 0.5 WHEN 'Oyo' THEN 0.5 WHEN 'Ondo' THEN 0.5 WHEN 'Osun' THEN 0.5 WHEN 'Ekiti' THEN 0.5
          ELSE 1.0 END * (0.85+random()*0.3)))::INTEGER,
      'APC', GREATEST(0, ROUND((tv - ROUND(tv*rr)::INTEGER) * v_apc *
        CASE st.name WHEN 'Lagos' THEN 1.5 WHEN 'Ogun' THEN 1.5 WHEN 'Oyo' THEN 1.5 WHEN 'Ondo' THEN 1.5 WHEN 'Osun' THEN 1.5 WHEN 'Ekiti' THEN 1.5
          WHEN 'Kano' THEN 1.4 WHEN 'Katsina' THEN 1.4 WHEN 'Sokoto' THEN 1.4 WHEN 'Zamfara' THEN 1.4 WHEN 'Kebbi' THEN 1.4 WHEN 'Jigawa' THEN 1.4 WHEN 'Kaduna' THEN 1.4
          WHEN 'Borno' THEN 1.3 WHEN 'Yobe' THEN 1.3 WHEN 'Adamawa' THEN 1.3 WHEN 'Gombe' THEN 1.3 WHEN 'Taraba' THEN 1.3 WHEN 'Bauchi' THEN 1.3
          WHEN 'Niger' THEN 1.1 WHEN 'Kwara' THEN 1.1 WHEN 'Kogi' THEN 1.1 WHEN 'Benue' THEN 1.1 WHEN 'Plateau' THEN 1.1 WHEN 'Nasarawa' THEN 1.1
          WHEN 'FCT' THEN 1.0 WHEN 'Rivers' THEN 0.4 WHEN 'Delta' THEN 0.4 WHEN 'Bayelsa' THEN 0.4 WHEN 'Akwa Ibom' THEN 0.4 WHEN 'Cross River' THEN 0.4 WHEN 'Edo' THEN 0.4
          WHEN 'Abia' THEN 0.3 WHEN 'Anambra' THEN 0.3 WHEN 'Ebonyi' THEN 0.3 WHEN 'Enugu' THEN 0.3 WHEN 'Imo' THEN 0.3
          ELSE 1.0 END * (0.85+random()*0.3)))::INTEGER,
      'PDP', GREATEST(0, ROUND((tv - ROUND(tv*rr)::INTEGER) * 0.30 * (0.7 + random() * 0.6)))::INTEGER,
      'LP', GREATEST(0, ROUND((tv - ROUND(tv*rr)::INTEGER) * 0.20 * (0.7 + random() * 0.6)))::INTEGER,
      'NNPP', GREATEST(0, ROUND((tv - ROUND(tv*rr)::INTEGER) * 0.12 * (0.7 + random() * 0.6)))::INTEGER,
      'APGA', GREATEST(0, ROUND((tv - ROUND(tv*rr)::INTEGER) * 0.10 * (0.7 + random() * 0.6)))::INTEGER,
      'SDP', GREATEST(0, ROUND((tv - ROUND(tv*rr)::INTEGER) * 0.08 * (0.7 + random() * 0.6)))::INTEGER,
      'YPP', GREATEST(0, ROUND((tv - ROUND(tv*rr)::INTEGER) * 0.10 * (0.7 + random() * 0.6)))::INTEGER,
      'ADC', GREATEST(0, ROUND((tv - ROUND(tv*rr)::INTEGER) * 0.10 * (0.7 + random() * 0.6)))::INTEGER
    )
  FROM (
    SELECT id,
      GREATEST(50, ROUND(v_avg_votes * (0.5 + random()))) AS tv,
      (0.01 + random() * 0.04) AS rr
    FROM polling_units
  ) sub
  LEFT JOIN polling_units pu ON pu.id = sub.id
  LEFT JOIN states st ON st.id = pu.state_id;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  SELECT sum(total_votes) INTO v_total_votes FROM result_submissions;

  UPDATE simulation_config SET
    status = 'COMPLETED', last_tick_at = now(), updated_at = now(),
    total_results_submitted = v_created
  WHERE id = '00000000-0000-0000-0000-000000000001';

  RETURN jsonb_build_object(
    'success', true, 'results_created', v_created,
    'total_votes', v_total_votes, 'scenario', p_scenario
  );
END;
$$;

GRANT EXECUTE ON FUNCTION run_sim_fast(TEXT, BIGINT) TO service_role;
