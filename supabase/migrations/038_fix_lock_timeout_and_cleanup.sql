-- ============================================================
-- 038: Fix lock timeout + cleanup + elections is_active
-- Run in Supabase SQL Editor (this is short and fast)
-- ============================================================

-- 1. Add is_active to elections
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'elections' AND column_name = 'is_active') THEN
    ALTER TABLE elections ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
END $$;
UPDATE elections SET is_active = true WHERE is_active IS NULL;

-- 2. Cleanup fake users/volunteers (fast single DELETE)
DELETE FROM user_accounts WHERE email LIKE 'sim-%';
DELETE FROM volunteers WHERE user_id NOT IN (SELECT id FROM user_accounts);
DELETE FROM agent_assignments WHERE volunteer_id NOT IN (SELECT id FROM volunteers);

-- 3. Verify
SELECT 'Parties: ' || count(*) FROM parties;
SELECT 'Elections: ' || count(*) FROM elections;
SELECT 'Users: ' || count(*) FROM user_accounts;
SELECT 'Volunteers: ' || count(*) FROM volunteers;

-- 4. Fix the simulation function to use TRUNCATE instead of DELETE
-- (TRUNCATE is instant, DELETE locks 500K+ rows)
DROP FUNCTION IF EXISTS run_fast_simulation(TEXT, INTEGER, BIGINT, TEXT);
DROP FUNCTION IF EXISTS run_fast_simulation(TEXT, INTEGER, BIGINT);

CREATE OR REPLACE FUNCTION run_fast_simulation(
  p_scenario TEXT DEFAULT 'random',
  p_duration_minutes INTEGER DEFAULT 5,
  p_total_voters BIGINT DEFAULT 100000000,
  p_election_type TEXT DEFAULT 'PRESIDENTIAL'
)
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '300s'
SET lock_timeout = '120s'
AS $$
DECLARE
  v_scenario TEXT;
  v_total_pus INTEGER;
  v_avg_votes_per_pu INTEGER;
  v_results_created INTEGER := 0;
  v_pr_created INTEGER := 0;
  v_election_id UUID;
  v_config_id UUID := '00000000-0000-0000-0000-000000000001';
  v_start_time TIMESTAMPTZ := clock_timestamp();
  v_total_votes BIGINT;
  v_ndc UUID; v_apc UUID; v_pdp UUID; v_lp UUID;
  v_nnpp UUID; v_apga UUID; v_sdp UUID; v_ypp UUID; v_adc UUID;
  v_ndc_share NUMERIC; v_apc_share NUMERIC;
BEGIN
  -- Pick scenario
  IF p_scenario = 'random' OR p_scenario IS NULL THEN
    v_scenario := (ARRAY['landslide', 'sweep', 'close'])[floor(random() * 3 + 1)];
  ELSE v_scenario := p_scenario;
  END IF;

  v_ndc_share := CASE v_scenario
    WHEN 'landslide' THEN 0.42 WHEN 'sweep' THEN 0.37 WHEN 'close' THEN 0.30 ELSE 0.37 END;
  v_apc_share := CASE v_scenario
    WHEN 'landslide' THEN 0.22 WHEN 'sweep' THEN 0.25 WHEN 'close' THEN 0.28 ELSE 0.25 END;

  -- Get party IDs
  SELECT id INTO v_ndc FROM parties WHERE abbreviation = 'NDC' LIMIT 1;
  SELECT id INTO v_apc FROM parties WHERE abbreviation = 'APC' LIMIT 1;
  SELECT id INTO v_pdp FROM parties WHERE abbreviation = 'PDP' LIMIT 1;
  SELECT id INTO v_lp FROM parties WHERE abbreviation = 'LP' LIMIT 1;
  SELECT id INTO v_nnpp FROM parties WHERE abbreviation = 'NNPP' LIMIT 1;
  SELECT id INTO v_apga FROM parties WHERE abbreviation = 'APGA' LIMIT 1;
  SELECT id INTO v_sdp FROM parties WHERE abbreviation = 'SDP' LIMIT 1;
  SELECT id INTO v_ypp FROM parties WHERE abbreviation = 'YPP' LIMIT 1;
  SELECT id INTO v_adc FROM parties WHERE abbreviation = 'ADC' LIMIT 1;

  -- TRUNCATE is instant (no row locking), unlike DELETE which locks all rows
  TRUNCATE TABLE party_results, result_submissions, incidents RESTART IDENTITY;

  -- Set config
  UPDATE simulation_config SET
    status = 'RUNNING', speed = 3, election_type = p_election_type,
    started_at = now(), last_tick_at = now(), total_results_submitted = 0
  WHERE id = v_config_id;

  SELECT count(*) INTO v_total_pus FROM polling_units;
  v_avg_votes_per_pu := GREATEST(50, (p_total_voters / v_total_pus)::INTEGER);

  -- Set random PU statuses
  UPDATE polling_units SET status = CASE
    WHEN random() < 0.05 THEN 'VERIFIED'
    WHEN random() < 0.12 THEN 'RESULT_SUBMITTED'
    WHEN random() < 0.20 THEN 'RESULT_ANNOUNCED'
    WHEN random() < 0.30 THEN 'COUNTING'
    WHEN random() < 0.40 THEN 'VOTING'
    ELSE 'NOT_STARTED'
  END WHERE id IS NOT NULL;

  -- Get or create election
  INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_election_id FROM elections WHERE type = 'PRESIDENTIAL' LIMIT 1;

  -- Bulk insert results + all 9 party vote distributions
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
    INSERT INTO result_submissions (polling_unit_id, election_id, volunteer_id, assignment_id,
      valid_votes, rejected_votes, total_votes, status, submitted_at, verified_at)
    SELECT pd.pu_id, v_election_id, NULL, NULL,
      pd.total_votes - ROUND(pd.total_votes * pd.reject_rate)::INTEGER,
      ROUND(pd.total_votes * pd.reject_rate)::INTEGER,
      pd.total_votes,
      CASE WHEN random() < 0.05 THEN 'VERIFIED' ELSE 'RESULT_SUBMITTED' END,
      now() - (random() * interval '60 days'),
      CASE WHEN random() < 0.05 THEN now() - (random() * interval '30 days') ELSE NULL END
    FROM pu_data pd RETURNING id, polling_unit_id, total_votes, valid_votes
  ),
  vote_data AS (
    SELECT ri.id AS result_id, pd.region, ri.valid_votes,
      GREATEST(0, ROUND(ri.valid_votes * v_ndc_share *
        CASE pd.region WHEN 'SE' THEN 1.9 WHEN 'SS' THEN 1.6 WHEN 'FC' THEN 1.2
          WHEN 'NC' THEN 1.0 WHEN 'NE' THEN 0.7 WHEN 'NW' THEN 0.6 WHEN 'SW' THEN 0.5
          ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER AS ndc_votes,
      GREATEST(0, ROUND(ri.valid_votes * v_apc_share *
        CASE pd.region WHEN 'SW' THEN 1.5 WHEN 'NW' THEN 1.4 WHEN 'NE' THEN 1.3
          WHEN 'NC' THEN 1.1 WHEN 'FC' THEN 1.0 WHEN 'SS' THEN 0.4 WHEN 'SE' THEN 0.3
          ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER AS apc_votes,
      ri.valid_votes AS valid_total
    FROM result_insert ri JOIN pu_data pd ON pd.pu_id = ri.polling_unit_id
  )
  INSERT INTO party_results (result_submission_id, party_id, votes)
  SELECT result_id, v_ndc, ndc_votes FROM vote_data WHERE ndc_votes > 0
  UNION ALL
  SELECT result_id, v_apc, apc_votes FROM vote_data WHERE apc_votes > 0
  UNION ALL
  SELECT result_id, v_pdp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.30 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_lp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.20 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_nnpp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.12 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_apga, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.10 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_sdp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.08 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_ypp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.10 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_adc, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.10 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0;

  GET DIAGNOSTICS v_pr_created = ROW_COUNT;
  SELECT count(*) INTO v_results_created FROM result_submissions;
  SELECT sum(total_votes) INTO v_total_votes FROM result_submissions;

  UPDATE simulation_config SET
    status = 'COMPLETED', last_tick_at = now(),
    total_results_submitted = v_results_created, updated_at = now()
  WHERE id = v_config_id;

  RETURN jsonb_build_object(
    'success', true, 'scenario', v_scenario, 'election_type', p_election_type,
    'total_polling_units', v_total_pus, 'results_created', v_results_created,
    'party_results_created', v_pr_created, 'total_votes', v_total_votes,
    'duration_ms', extract(milliseconds from clock_timestamp() - v_start_time)::INTEGER,
    'ndc_wins', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION run_fast_simulation(TEXT, INTEGER, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION run_fast_simulation(TEXT, INTEGER, BIGINT, TEXT) TO anon;

-- 5. Ensure state breakdown function exists
DROP FUNCTION IF EXISTS get_state_breakdown_from_results();
CREATE OR REPLACE FUNCTION get_state_breakdown_from_results()
RETURNS TABLE (
  state_name TEXT, state_id UUID,
  total_pus BIGINT, verified BIGINT, submitted BIGINT,
  disputed BIGINT, disrupted BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT s.name, s.id,
    COUNT(*),
    COUNT(*) FILTER (WHERE rs.status = 'VERIFIED'),
    COUNT(*) FILTER (WHERE rs.status = 'RESULT_SUBMITTED'),
    COUNT(*) FILTER (WHERE rs.status = 'DISPUTED'),
    COUNT(*) FILTER (WHERE rs.status = 'DISRUPTED')
  FROM result_submissions rs
  INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id
  INNER JOIN states s ON s.id = pu.state_id
  GROUP BY s.id, s.name ORDER BY total_pus DESC;
$$;
GRANT EXECUTE ON FUNCTION get_state_breakdown_from_results() TO anon, service_role;

SELECT '=== Migration 038 Complete ===' AS status;
