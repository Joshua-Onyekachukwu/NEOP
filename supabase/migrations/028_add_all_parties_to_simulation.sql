-- Fix: distribute remaining votes to all 9 parties, not just NDC and APC
-- Remaining votes = valid_votes - ndc_votes - apc_votes

DROP FUNCTION IF EXISTS run_fast_simulation(TEXT, INTEGER, BIGINT, TEXT);

CREATE OR REPLACE FUNCTION run_fast_simulation(
  p_scenario TEXT DEFAULT 'random',
  p_duration_minutes INTEGER DEFAULT 5,
  p_total_voters BIGINT DEFAULT 100000000,
  p_election_type TEXT DEFAULT 'PRESIDENTIAL'
)
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '300s'
AS $$
DECLARE
  v_scenario TEXT;
  v_ndc_share NUMERIC;
  v_total_pus INTEGER;
  v_avg_votes_per_pu INTEGER;
  v_results_created INTEGER := 0;
  v_pr_created INTEGER := 0;
  v_election_id UUID;
  v_config_id UUID := '00000000-0000-0000-0000-000000000001';
  v_start_time TIMESTAMPTZ := clock_timestamp();
  v_status_dist JSONB;
  v_total_votes BIGINT;
  v_ndc_party_id UUID;
  v_apc_party_id UUID;
BEGIN
  IF p_scenario = 'random' OR p_scenario IS NULL THEN
    v_scenario := (ARRAY['landslide', 'sweep', 'close'])[floor(random() * 3 + 1)];
  ELSE
    v_scenario := p_scenario;
  END IF;

  v_ndc_share := CASE v_scenario
    WHEN 'landslide' THEN 0.38
    WHEN 'sweep' THEN 0.35
    WHEN 'close' THEN 0.28
    ELSE 0.35
  END;

  INSERT INTO parties (official_name, abbreviation, color)
  SELECT 'New Democratic Coalition', 'NDC', '#22C55E'
  WHERE NOT EXISTS (SELECT 1 FROM parties WHERE abbreviation = 'NDC');

  SELECT id INTO v_ndc_party_id FROM parties WHERE abbreviation = 'NDC' LIMIT 1;
  SELECT id INTO v_apc_party_id FROM parties WHERE abbreviation = 'APC' LIMIT 1;

  TRUNCATE TABLE party_results, result_submissions, incidents CASCADE;
  UPDATE simulation_config SET
    status = 'RUNNING', speed = 3, election_type = p_election_type,
    started_at = now(), last_tick_at = now(), total_results_submitted = 0
  WHERE id = v_config_id;

  SELECT count(*) INTO v_total_pus FROM polling_units;
  v_avg_votes_per_pu := GREATEST(50, (p_total_voters / v_total_pus)::INTEGER);

  UPDATE polling_units SET status = CASE
    WHEN random() < 0.05 THEN 'VERIFIED'
    WHEN random() < 0.12 THEN 'RESULT_SUBMITTED'
    WHEN random() < 0.20 THEN 'RESULT_ANNOUNCED'
    WHEN random() < 0.30 THEN 'COUNTING'
    WHEN random() < 0.40 THEN 'VOTING'
    ELSE 'NOT_STARTED'
  END WHERE id IS NOT NULL;

  INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL') ON CONFLICT DO NOTHING;
  SELECT id INTO v_election_id FROM elections WHERE type = 'PRESIDENTIAL' LIMIT 1;

  WITH pu_data AS (
    SELECT pu.id AS pu_id, st.name AS state_name,
      CASE COALESCE(st.name, '')
        WHEN 'Kano' THEN 'NW' WHEN 'Katsina' THEN 'NW' WHEN 'Sokoto' THEN 'NW'
        WHEN 'Zamfara' THEN 'NW' WHEN 'Kebbi' THEN 'NW' WHEN 'Jigawa' THEN 'NW'
        WHEN 'Kaduna' THEN 'NW' WHEN 'Borno' THEN 'NE' WHEN 'Yobe' THEN 'NE'
        WHEN 'Adamawa' THEN 'NE' WHEN 'Gombe' THEN 'NE' WHEN 'Taraba' THEN 'NE'
        WHEN 'Bauchi' THEN 'NE' WHEN 'Niger' THEN 'NC' WHEN 'Kwara' THEN 'NC'
        WHEN 'Kogi' THEN 'NC' WHEN 'Benue' THEN 'NC' WHEN 'Plateau' THEN 'NC'
        WHEN 'Nasarawa' THEN 'NC' WHEN 'Lagos' THEN 'SW' WHEN 'Ogun' THEN 'SW'
        WHEN 'Oyo' THEN 'SW' WHEN 'Ondo' THEN 'SW' WHEN 'Osun' THEN 'SW'
        WHEN 'Ekiti' THEN 'SW' WHEN 'Abia' THEN 'SE' WHEN 'Anambra' THEN 'SE'
        WHEN 'Ebonyi' THEN 'SE' WHEN 'Enugu' THEN 'SE' WHEN 'Imo' THEN 'SE'
        WHEN 'Rivers' THEN 'SS' WHEN 'Delta' THEN 'SS' WHEN 'Bayelsa' THEN 'SS'
        WHEN 'Akwa Ibom' THEN 'SS' WHEN 'Cross River' THEN 'SS' WHEN 'Edo' THEN 'SS'
        WHEN 'FCT' THEN 'FC' ELSE 'NC'
      END AS region,
      GREATEST(50, ROUND(v_avg_votes_per_pu * (0.5 + random()))) AS total_votes,
      (0.01 + random() * 0.04) AS reject_rate
    FROM polling_units pu LEFT JOIN states st ON st.id = pu.state_id
  ),
  result_insert AS (
    INSERT INTO result_submissions (polling_unit_id, election_id, volunteer_id, assignment_id, valid_votes, rejected_votes, total_votes, status, submitted_at, verified_at)
    SELECT pd.pu_id, v_election_id, NULL, NULL,
      pd.total_votes - ROUND(pd.total_votes * pd.reject_rate)::INTEGER,
      ROUND(pd.total_votes * pd.reject_rate)::INTEGER,
      pd.total_votes,
      CASE WHEN random() < 0.05 THEN 'VERIFIED' ELSE 'RESULT_SUBMITTED' END,
      now() - (random() * interval '60 days'),
      CASE WHEN random() < 0.05 THEN now() - (random() * interval '30 days') ELSE NULL END
    FROM pu_data pd RETURNING id, polling_unit_id, total_votes, valid_votes
  ),
  -- Compute NDC and APC votes from valid_votes
  vote_data AS (
    SELECT ri.id AS result_id, pd.region, ri.valid_votes,
      GREATEST(0, ROUND(ri.valid_votes * v_ndc_share *
        CASE pd.region WHEN 'SE' THEN 1.9 WHEN 'SS' THEN 1.6 WHEN 'FC' THEN 1.2 WHEN 'NC' THEN 1.0 WHEN 'NE' THEN 0.7 WHEN 'NW' THEN 0.6 WHEN 'SW' THEN 0.5 ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER AS ndc_votes,
      GREATEST(0, ROUND(ri.valid_votes * 0.24 *
        CASE pd.region WHEN 'SW' THEN 1.5 WHEN 'NW' THEN 1.4 WHEN 'NE' THEN 1.3 WHEN 'NC' THEN 1.1 WHEN 'FC' THEN 1.0 WHEN 'SS' THEN 0.4 WHEN 'SE' THEN 0.3 ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER AS apc_votes
    FROM result_insert ri JOIN pu_data pd ON pd.pu_id = ri.polling_unit_id
  ),
  -- Distribute remaining votes across PDP, LP, NNPP, APGA, SDP, YPP, ADC
  other_party_ids AS (
    SELECT id, abbreviation, ROW_NUMBER() OVER (ORDER BY abbreviation) AS rn
    FROM parties WHERE abbreviation IN ('PDP', 'LP', 'NNPP', 'APGA', 'SDP', 'YPP', 'ADC')
  )
  INSERT INTO party_results (result_submission_id, party_id, votes)
  -- NDC
  SELECT vd.result_id, v_ndc_party_id, vd.ndc_votes FROM vote_data vd WHERE vd.ndc_votes > 0
  UNION ALL
  -- APC
  SELECT vd.result_id, v_apc_party_id, vd.apc_votes FROM vote_data vd WHERE vd.apc_votes > 0
  UNION ALL
  -- Other 7 parties: split remaining votes with random distribution
  SELECT vd.result_id, op.id,
    GREATEST(0, ROUND((vd.valid_votes - vd.ndc_votes - vd.apc_votes) *
      (CASE op.rn
        WHEN 1 THEN 0.30  -- PDP
        WHEN 2 THEN 0.20  -- LP
        WHEN 3 THEN 0.12  -- NNPP
        WHEN 4 THEN 0.10  -- APGA
        WHEN 5 THEN 0.08  -- SDP
        WHEN 6 THEN 0.10  -- YPP
        WHEN 7 THEN 0.10  -- ADC
      END) * (0.7 + random() * 0.6)))::INTEGER
  FROM vote_data vd
  CROSS JOIN other_party_ids op
  WHERE (vd.valid_votes - vd.ndc_votes - vd.apc_votes) > 0;

  GET DIAGNOSTICS v_pr_created = ROW_COUNT;
  SELECT count(*) INTO v_results_created FROM result_submissions;
  SELECT sum(total_votes) INTO v_total_votes FROM result_submissions;

  SELECT jsonb_object_agg(status, cnt) INTO v_status_dist
  FROM (SELECT status, count(*) AS cnt FROM polling_units GROUP BY status) sub;

  UPDATE simulation_config SET
    status = 'COMPLETED', last_tick_at = now(),
    total_results_submitted = v_results_created, updated_at = now()
  WHERE id = v_config_id;

  RETURN jsonb_build_object(
    'success', true, 'scenario', v_scenario, 'election_type', p_election_type,
    'description', CASE v_scenario WHEN 'landslide' THEN 'NDC wins by 20+ points' WHEN 'sweep' THEN 'NDC carries every region' WHEN 'close' THEN 'NDC edges APC by 2-5 points' ELSE 'Random scenario' END,
    'total_polling_units', v_total_pus, 'results_created', v_results_created,
    'party_results_created', v_pr_created, 'total_votes', v_total_votes,
    'duration_minutes', p_duration_minutes, 'target_voters', p_total_voters,
    'final_status_distribution', v_status_dist,
    'duration_ms', extract(milliseconds from clock_timestamp() - v_start_time)::INTEGER,
    'ndc_wins', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION run_fast_simulation(TEXT, INTEGER, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION run_fast_simulation(TEXT, INTEGER, BIGINT, TEXT) TO anon;
