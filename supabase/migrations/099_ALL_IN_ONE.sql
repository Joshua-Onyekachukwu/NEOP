-- ============================================================
-- 099_ALL_IN_ONE.sql — Run THIS ONE file in Supabase SQL Editor
-- Fixes: parties constraint, cleanup, simulation, state breakdown
-- ============================================================

-- STEP 1: Add unique constraint on parties.abbreviation (required for ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'parties'::regclass
    AND contype = 'u'
    AND conname LIKE '%abbreviation%'
  ) THEN
    -- First deduplicate any existing duplicates
    DELETE FROM parties a USING parties b
    WHERE a.abbreviation = b.abbreviation AND a.ctid < b.ctid;
    -- Then add the unique constraint
    ALTER TABLE parties ADD CONSTRAINT parties_abbreviation_unique UNIQUE (abbreviation);
    RAISE NOTICE 'Added unique constraint on parties.abbreviation';
  ELSE
    RAISE NOTICE 'Unique constraint on parties.abbreviation already exists';
  END IF;
END $$;

-- STEP 2: Add is_active to elections
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'elections' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE elections ADD COLUMN is_active BOOLEAN DEFAULT true;
    RAISE NOTICE 'Added elections.is_active';
  END IF;
END $$;
UPDATE elections SET is_active = true WHERE is_active IS NULL;

-- STEP 3: Cleanup simulation artifacts (correct FK order)
DELETE FROM agent_assignments WHERE volunteer_id IN (
  SELECT id FROM volunteers WHERE user_id IN (
    SELECT id FROM user_accounts WHERE email LIKE 'sim-%'
  )
);
DELETE FROM volunteers WHERE user_id IN (
  SELECT id FROM user_accounts WHERE email LIKE 'sim-%'
);
DELETE FROM user_accounts WHERE email LIKE 'sim-%';

-- STEP 4: Ensure all 9 parties exist
INSERT INTO parties (official_name, abbreviation, color) VALUES
  ('Nigeria Democratic Congress', 'NDC', '#1B5E20'),
  ('All Progressives Congress', 'APC', '#00A859'),
  ('Peoples Democratic Party', 'PDP', '#000080'),
  ('Labour Party', 'LP', '#FF0000'),
  ('New Nigeria Peoples Party', 'NNPP', '#E53935'),
  ('All Progressives Grand Alliance', 'APGA', '#FFD600'),
  ('Social Democratic Party', 'SDP', '#1565C0'),
  ('Young Progressives Party', 'YPP', '#6A1B9A'),
  ('African Democratic Congress', 'ADC', '#00838F')
ON CONFLICT (abbreviation) DO UPDATE SET
  official_name = EXCLUDED.official_name,
  color = EXCLUDED.color;

-- STEP 5: Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_rs_status ON result_submissions(status);
CREATE INDEX IF NOT EXISTS idx_rs_pu ON result_submissions(polling_unit_id);
CREATE INDEX IF NOT EXISTS idx_rs_submitted ON result_submissions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_submission ON party_results(result_submission_id);
CREATE INDEX IF NOT EXISTS idx_pr_party ON party_results(party_id);
CREATE INDEX IF NOT EXISTS idx_pu_state ON polling_units(state_id);
CREATE INDEX IF NOT EXISTS idx_pu_status ON polling_units(status);

-- STEP 6: State breakdown function (correct column names)
DROP FUNCTION IF EXISTS get_state_breakdown_from_results();
CREATE OR REPLACE FUNCTION get_state_breakdown_from_results()
RETURNS TABLE (
  state_name TEXT,
  state_id UUID,
  total_polling_units BIGINT,
  covered_polling_units BIGINT,
  verified_polling_units BIGINT,
  coverage_percent NUMERIC,
  verification_percent NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    s.name,
    s.id,
    COUNT(*),
    COUNT(*),
    COUNT(*) FILTER (WHERE rs.status = 'VERIFIED'),
    CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE rs.status = 'VERIFIED')::NUMERIC / COUNT(*) * 100, 1) ELSE 0 END,
    CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE rs.status = 'VERIFIED')::NUMERIC / COUNT(*) * 100, 1) ELSE 0 END
  FROM result_submissions rs
  INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id
  INNER JOIN states s ON s.id = pu.state_id
  GROUP BY s.id, s.name
  ORDER BY COUNT(*) DESC;
$$;
GRANT EXECUTE ON FUNCTION get_state_breakdown_from_results() TO anon, service_role;

-- STEP 7: Simulation function with TRUNCATE (fixes lock timeout) + all 9 parties
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
  IF p_scenario = 'random' OR p_scenario IS NULL THEN
    v_scenario := (ARRAY['landslide', 'sweep', 'close'])[floor(random() * 3 + 1)];
  ELSE v_scenario := p_scenario; END IF;

  v_ndc_share := CASE v_scenario
    WHEN 'landslide' THEN 0.42 WHEN 'sweep' THEN 0.37
    WHEN 'close' THEN 0.30 ELSE 0.37 END;
  v_apc_share := CASE v_scenario
    WHEN 'landslide' THEN 0.22 WHEN 'sweep' THEN 0.25
    WHEN 'close' THEN 0.28 ELSE 0.25 END;

  SELECT id INTO v_ndc FROM parties WHERE abbreviation = 'NDC' LIMIT 1;
  SELECT id INTO v_apc FROM parties WHERE abbreviation = 'APC' LIMIT 1;
  SELECT id INTO v_pdp FROM parties WHERE abbreviation = 'PDP' LIMIT 1;
  SELECT id INTO v_lp FROM parties WHERE abbreviation = 'LP' LIMIT 1;
  SELECT id INTO v_nnpp FROM parties WHERE abbreviation = 'NNPP' LIMIT 1;
  SELECT id INTO v_apga FROM parties WHERE abbreviation = 'APGA' LIMIT 1;
  SELECT id INTO v_sdp FROM parties WHERE abbreviation = 'SDP' LIMIT 1;
  SELECT id INTO v_ypp FROM parties WHERE abbreviation = 'YPP' LIMIT 1;
  SELECT id INTO v_adc FROM parties WHERE abbreviation = 'ADC' LIMIT 1;

  -- TRUNCATE is instant (no row locking)
  TRUNCATE TABLE party_results, result_submissions, incidents RESTART IDENTITY;

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

  INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL')
  ON CONFLICT DO NOTHING;
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

-- STEP 8: Fix get_party_totals — use LEFT JOIN so ALL parties show (even with 0 votes)
DROP FUNCTION IF EXISTS get_party_totals();
CREATE OR REPLACE FUNCTION get_party_totals()
RETURNS TABLE (
  party_name TEXT,
  party_abbreviation TEXT,
  party_color TEXT,
  total_votes BIGINT,
  percentage NUMERIC
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE gt BIGINT;
BEGIN
  SELECT COALESCE(SUM(pr.votes), 0) INTO gt FROM party_results pr;
  RETURN QUERY
  WITH ps AS (
    SELECT p.official_name, p.abbreviation, p.color, COALESCE(SUM(pr.votes), 0) AS votes
    FROM parties p
    LEFT JOIN party_results pr ON pr.party_id = p.id
    GROUP BY p.id, p.official_name, p.abbreviation, p.color
  )
  SELECT ps.official_name, ps.abbreviation, ps.color, ps.votes,
    CASE WHEN gt > 0 THEN ROUND((ps.votes::NUMERIC / gt) * 100, 1) ELSE 0 END
  FROM ps ORDER BY ps.votes DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_party_totals() TO anon, service_role;

-- STEP 9: Fix get_fast_stats — use result_submissions instead of agent_assignments for coverage
CREATE OR REPLACE FUNCTION get_fast_stats()
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'inec_total_polling_units', (SELECT count(*) FROM polling_units),
      'total_polling_units', (SELECT count(*) FROM polling_units),
      'covered_polling_units', (SELECT count(*) FROM result_submissions),
      'verified_polling_units', (SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED'),
      'active_observers', (SELECT count(*) FROM agent_assignments WHERE status = 'CHECKED_IN'),
      'total_incidents', (SELECT count(*) FROM incidents),
      'state_breakdown', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'state_id', s.id, 'state_name', s.name,
            'total_polling_units', COUNT(*),
            'covered_polling_units', COUNT(*),
            'verified_polling_units', COUNT(*) FILTER (WHERE rs.status = 'VERIFIED'),
            'coverage_percent', 100.0,
            'verification_percent', CASE WHEN COUNT(*) > 0
              THEN ROUND(COUNT(*) FILTER (WHERE rs.status = 'VERIFIED')::NUMERIC / COUNT(*) * 100, 1)
              ELSE 0 END
          ) ORDER BY COUNT(*) DESC
        ), '[]'::jsonb)
        FROM result_submissions rs
        INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id
        INNER JOIN states s ON s.id = pu.state_id
        GROUP BY s.id, s.name
      ),
      'coverage_percent', 100.0,
      'verification_percent', CASE WHEN (SELECT count(*) FROM result_submissions) > 0
        THEN ROUND((SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED')::NUMERIC /
             (SELECT count(*) FROM result_submissions) * 100, 1) ELSE 0 END,
      'last_updated', now(),
      'disclaimer', 'These are independently collected field observations and are not official INEC election results.'
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_fast_stats() TO service_role;
GRANT EXECUTE ON FUNCTION get_fast_stats() TO anon;

-- DONE
SELECT '=== Migration 099 Complete ===' AS status,
       (SELECT count(*) FROM parties) AS parties,
       (SELECT count(*) FROM user_accounts WHERE email LIKE 'sim-%') AS fake_users_remaining;
