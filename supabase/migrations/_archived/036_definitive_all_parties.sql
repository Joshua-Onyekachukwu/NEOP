-- ============================================================
-- 036_DEFINITIVE_ALL_PARTIES_SIMULATION.sql
-- Replaces ALL simulation functions with correct all-9-party version.
-- Also cleans up simulation artifacts (190K fake users/volunteers).
-- Run this ONE file in Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- CLEANUP: Remove 190K simulation artifacts
-- ============================================================
DO $$
DECLARE
  v_deleted BIGINT;
BEGIN
  -- Delete in correct foreign key order:
  -- 1. agent_assignments (references volunteers)
  -- 2. volunteers (references user_accounts)
  -- 3. user_accounts
  DELETE FROM agent_assignments WHERE volunteer_id IN (
    SELECT id FROM volunteers WHERE user_id IN (
      SELECT id FROM user_accounts WHERE email LIKE 'sim-%'
    )
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % agent_assignments for sim users', v_deleted;

  DELETE FROM volunteers WHERE user_id IN (
    SELECT id FROM user_accounts WHERE email LIKE 'sim-%'
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % simulation volunteers', v_deleted;

  DELETE FROM user_accounts WHERE email LIKE 'sim-%';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % simulation user_accounts', v_deleted;
END $$;

-- ============================================================
-- FIX: Get the correct party IDs (9 parties)
-- ============================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM parties WHERE abbreviation IN ('NDC','APC','PDP','LP','NNPP','APGA','SDP','YPP','ADC');
  RAISE NOTICE 'Existing valid parties: %', v_count;

  -- Ensure all 9 parties exist (with correct names and colors)
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

  SELECT COUNT(*) INTO v_count FROM parties WHERE abbreviation IN ('NDC','APC','PDP','LP','NNPP','APGA','SDP','YPP','ADC');
  RAISE NOTICE 'Parties after ensure: %', v_count;
END $$;

-- ============================================================
-- FIX: ensure NDC uses correct abbreviation
-- ============================================================
-- There might be duplicates with different abbreviations
UPDATE parties SET abbreviation = 'NDC'
WHERE official_name LIKE '%Democratic Congress%' AND abbreviation != 'NDC';

-- Delete any remaining non-standard party duplicates
DO $$
BEGIN
  -- Remove any party rows with non-standard abbreviations if standard exists
  DELETE FROM parties
  WHERE abbreviation IN ('NDC','APC','PDP','LP','NNPP','APGA','SDP','YPP','ADC')
    AND id NOT IN (
      SELECT DISTINCT ON (abbreviation) id
      FROM parties
      WHERE abbreviation IN ('NDC','APC','PDP','LP','NNPP','APGA','SDP','YPP','ADC')
      ORDER BY abbreviation, created_at ASC NULLS FIRST
    );
END $$;

-- ============================================================
-- RECREATE: run_fast_simulation with ALL 9 PARTIES
-- ============================================================
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
SET lock_timeout = '60s'
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
  v_status_dist JSONB;
  v_total_votes BIGINT;
  v_ndc_party_id UUID;
  v_apc_party_id UUID;
  v_pdp_party_id UUID;
  v_lp_party_id UUID;
  v_nnpp_party_id UUID;
  v_apga_party_id UUID;
  v_sdp_party_id UUID;
  v_ypp_party_id UUID;
  v_adc_party_id UUID;
  v_ndc_share NUMERIC;
  v_apc_share NUMERIC;
  v_total_others NUMERIC;
BEGIN
  -- Determine scenario
  IF p_scenario = 'random' OR p_scenario IS NULL THEN
    v_scenario := (ARRAY['landslide', 'sweep', 'close'])[floor(random() * 3 + 1)];
  ELSE
    v_scenario := p_scenario;
  END IF;

  -- NDC always wins, margin varies by scenario
  v_ndc_share := CASE v_scenario
    WHEN 'landslide' THEN 0.42
    WHEN 'sweep' THEN 0.37
    WHEN 'close' THEN 0.30
    ELSE 0.37
  END;

  -- APC is the main challenger
  v_apc_share := CASE v_scenario
    WHEN 'landslide' THEN 0.22
    WHEN 'sweep' THEN 0.25
    WHEN 'close' THEN 0.28
    ELSE 0.25
  END;

  -- Remaining votes split among 7 other parties (total = 1 - ndc - apc)
  v_total_others := 1.0 - v_ndc_share - v_apc_share;

  RAISE NOTICE '[sim] Scenario: %, NDC: %%, APC: %%, Others: %%', v_scenario, ROUND(v_ndc_share*100), ROUND(v_apc_share*100), ROUND(v_total_others*100);

  -- Get all 9 party IDs
  SELECT id INTO v_ndc_party_id FROM parties WHERE abbreviation = 'NDC' LIMIT 1;
  SELECT id INTO v_apc_party_id FROM parties WHERE abbreviation = 'APC' LIMIT 1;
  SELECT id INTO v_pdp_party_id FROM parties WHERE abbreviation = 'PDP' LIMIT 1;
  SELECT id INTO v_lp_party_id FROM parties WHERE abbreviation = 'LP' LIMIT 1;
  SELECT id INTO v_nnpp_party_id FROM parties WHERE abbreviation = 'NNPP' LIMIT 1;
  SELECT id INTO v_apga_party_id FROM parties WHERE abbreviation = 'APGA' LIMIT 1;
  SELECT id INTO v_sdp_party_id FROM parties WHERE abbreviation = 'SDP' LIMIT 1;
  SELECT id INTO v_ypp_party_id FROM parties WHERE abbreviation = 'YPP' LIMIT 1;
  SELECT id INTO v_adc_party_id FROM parties WHERE abbreviation = 'ADC' LIMIT 1;

  RAISE NOTICE '[sim] Party IDs: NDC=%, APC=%, PDP=%, LP=%, NNPP=%', v_ndc_party_id, v_apc_party_id, v_pdp_party_id, v_lp_party_id, v_nnpp_party_id;

  -- Clear old data
  DELETE FROM party_results WHERE result_submission_id IN (SELECT id FROM result_submissions);
  DELETE FROM result_submissions WHERE true;
  DELETE FROM incidents WHERE true;

  -- Set config
  UPDATE simulation_config SET
    status = 'RUNNING', speed = 3, election_type = p_election_type,
    started_at = now(), last_tick_at = now(), total_results_submitted = 0
  WHERE id = v_config_id;

  -- Get PU count
  SELECT count(*) INTO v_total_pus FROM polling_units;
  v_avg_votes_per_pu := GREATEST(50, (p_total_voters / v_total_pus)::INTEGER);

  -- Set random initial statuses on polling units
  UPDATE polling_units SET status = CASE
    WHEN random() < 0.05 THEN 'VERIFIED'
    WHEN random() < 0.12 THEN 'RESULT_SUBMITTED'
    WHEN random() < 0.20 THEN 'RESULT_ANNOUNCED'
    WHEN random() < 0.30 THEN 'COUNTING'
    WHEN random() < 0.40 THEN 'VOTING'
    ELSE 'NOT_STARTED'
  END WHERE id IS NOT NULL;

  -- Get or create election
  INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL') ON CONFLICT DO NOTHING;
  SELECT id INTO v_election_id FROM elections WHERE type = 'PRESIDENTIAL' LIMIT 1;

  -- MAIN INSERT: Results + all 9 party vote distributions
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
  vote_data AS (
    SELECT ri.id AS result_id, pd.region, ri.valid_votes,
      -- NDC: dominant in SE, SS, FC
      GREATEST(0, ROUND(ri.valid_votes * v_ndc_share *
        CASE pd.region WHEN 'SE' THEN 1.9 WHEN 'SS' THEN 1.6 WHEN 'FC' THEN 1.2 WHEN 'NC' THEN 1.0 WHEN 'NE' THEN 0.7 WHEN 'NW' THEN 0.6 WHEN 'SW' THEN 0.5 ELSE 1.0 END
        * (0.85 + random() * 0.30)))::INTEGER AS ndc_votes,
      -- APC: dominant in SW, NW, NE
      GREATEST(0, ROUND(ri.valid_votes * v_apc_share *
        CASE pd.region WHEN 'SW' THEN 1.5 WHEN 'NW' THEN 1.4 WHEN 'NE' THEN 1.3 WHEN 'NC' THEN 1.1 WHEN 'FC' THEN 1.0 WHEN 'SS' THEN 0.4 WHEN 'SE' THEN 0.3 ELSE 1.0 END
        * (0.85 + random() * 0.30)))::INTEGER AS apc_votes,
      -- Remaining for smaller parties
      ri.valid_votes AS valid_total
    FROM result_insert ri JOIN pu_data pd ON pd.pu_id = ri.polling_unit_id
  )
  INSERT INTO party_results (result_submission_id, party_id, votes)
  -- NDC
  SELECT vd.result_id, v_ndc_party_id, vd.ndc_votes
  FROM vote_data vd WHERE vd.ndc_votes > 0
  UNION ALL
  -- APC
  SELECT vd.result_id, v_apc_party_id, vd.apc_votes
  FROM vote_data vd WHERE vd.apc_votes > 0
  UNION ALL
  -- PDP (30% of remaining)
  SELECT vd.result_id, v_pdp_party_id,
    GREATEST(0, ROUND((vd.valid_total - vd.ndc_votes - vd.apc_votes) * 0.30 * (0.7 + random() * 0.6)))::INTEGER
  FROM vote_data vd WHERE (vd.valid_total - vd.ndc_votes - vd.apc_votes) > 0
  UNION ALL
  -- LP (20% of remaining)
  SELECT vd.result_id, v_lp_party_id,
    GREATEST(0, ROUND((vd.valid_total - vd.ndc_votes - vd.apc_votes) * 0.20 * (0.7 + random() * 0.6)))::INTEGER
  FROM vote_data vd WHERE (vd.valid_total - vd.ndc_votes - vd.apc_votes) > 0
  UNION ALL
  -- NNPP (12% of remaining)
  SELECT vd.result_id, v_nnpp_party_id,
    GREATEST(0, ROUND((vd.valid_total - vd.ndc_votes - vd.apc_votes) * 0.12 * (0.7 + random() * 0.6)))::INTEGER
  FROM vote_data vd WHERE (vd.valid_total - vd.ndc_votes - vd.apc_votes) > 0
  UNION ALL
  -- APGA (10% of remaining)
  SELECT vd.result_id, v_apga_party_id,
    GREATEST(0, ROUND((vd.valid_total - vd.ndc_votes - vd.apc_votes) * 0.10 * (0.7 + random() * 0.6)))::INTEGER
  FROM vote_data vd WHERE (vd.valid_total - vd.ndc_votes - vd.apc_votes) > 0
  UNION ALL
  -- SDP (8% of remaining)
  SELECT vd.result_id, v_sdp_party_id,
    GREATEST(0, ROUND((vd.valid_total - vd.ndc_votes - vd.apc_votes) * 0.08 * (0.7 + random() * 0.6)))::INTEGER
  FROM vote_data vd WHERE (vd.valid_total - vd.ndc_votes - vd.apc_votes) > 0
  UNION ALL
  -- YPP (10% of remaining)
  SELECT vd.result_id, v_ypp_party_id,
    GREATEST(0, ROUND((vd.valid_total - vd.ndc_votes - vd.apc_votes) * 0.10 * (0.7 + random() * 0.6)))::INTEGER
  FROM vote_data vd WHERE (vd.valid_total - vd.ndc_votes - vd.apc_votes) > 0
  UNION ALL
  -- ADC (10% of remaining)
  SELECT vd.result_id, v_adc_party_id,
    GREATEST(0, ROUND((vd.valid_total - vd.ndc_votes - vd.apc_votes) * 0.10 * (0.7 + random() * 0.6)))::INTEGER
  FROM vote_data vd WHERE (vd.valid_total - vd.ndc_votes - vd.apc_votes) > 0;

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
    'description', CASE v_scenario
      WHEN 'landslide' THEN 'NDC wins by 20+ points — massive coalition victory'
      WHEN 'sweep' THEN 'NDC carries every region except SW'
      WHEN 'close' THEN 'NDC edges APC by 2-5 points in a nail-biter'
      ELSE 'Random scenario' END,
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

-- ============================================================
-- VERIFY: get_party_totals (should already work)
-- ============================================================
-- The get_party_totals function from migration 020 is correct.
-- It aggregates all party_results by party abbreviation.
-- No changes needed.

-- ============================================================
-- VERIFY: get_state_breakdown_from_results (fast state breakdown)
-- ============================================================
CREATE OR REPLACE FUNCTION get_state_breakdown_from_results()
RETURNS TABLE (
  state_id UUID, state_name TEXT, state_code TEXT,
  total_polling_units BIGINT, covered_polling_units BIGINT,
  verified_polling_units BIGINT, coverage_percent NUMERIC,
  verification_percent NUMERIC
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH spc AS (
    SELECT pu.state_id, COUNT(*) AS total_pu
    FROM polling_units pu GROUP BY pu.state_id
  ),
  rc AS (
    SELECT pu.state_id, COUNT(*) AS covered
    FROM result_submissions rs
    INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id
    GROUP BY pu.state_id
  ),
  vc AS (
    SELECT pu.state_id, COUNT(*) AS verified
    FROM result_submissions rs
    INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id
    WHERE rs.status = 'VERIFIED'
    GROUP BY pu.state_id
  )
  SELECT spc.state_id, st.name, st.code, spc.total_pu,
    COALESCE(rc.covered, 0), COALESCE(vc.verified, 0),
    CASE WHEN spc.total_pu > 0 THEN ROUND((COALESCE(rc.covered, 0)::NUMERIC / spc.total_pu) * 100, 1) ELSE 0 END,
    CASE WHEN spc.total_pu > 0 THEN ROUND((COALESCE(vc.verified, 0)::NUMERIC / spc.total_pu) * 100, 1) ELSE 0 END
  FROM spc
  INNER JOIN states st ON st.id = spc.state_id
  LEFT JOIN rc ON rc.state_id = spc.state_id
  LEFT JOIN vc ON vc.state_id = spc.state_id
  ORDER BY spc.total_pu DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_state_breakdown_from_results() TO service_role;
GRANT EXECUTE ON FUNCTION get_state_breakdown_from_results() TO anon;

-- ============================================================
-- DONE
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '=== Migration 036 Complete ===';
  RAISE NOTICE '1. Cleaned up simulation artifacts (fake users/volunteers)';
  RAISE NOTICE '2. Ensured all 9 parties exist with correct names/colors';
  RAISE NOTICE '3. Replaced run_fast_simulation with ALL 9 parties version';
  RAISE NOTICE '4. get_state_breakdown_from_results created for fast stats';
  RAISE NOTICE 'Run simulation from admin to populate all 9 parties.';
END $$;
