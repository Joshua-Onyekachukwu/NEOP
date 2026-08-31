-- ============================================================
-- 020_comprehensive_qa_fix.sql
-- Complete fix for all SQL issues found during QA audit
-- Run this ONE file in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. DEDUPLICATE PARTIES (41 rows → 10 unique)
-- ============================================================
DO $$
DECLARE
  v_origins RECORD;
  v_keep_id UUID;
  v_dup_ids UUID[];
BEGIN
  FOR v_origins IN (
    SELECT abbreviation, COUNT(*) AS cnt
    FROM parties
    GROUP BY abbreviation
    HAVING COUNT(*) > 1
  ) LOOP
    -- Keep the first (oldest) row, delete the rest
    SELECT id INTO v_keep_id
    FROM parties
    WHERE abbreviation = v_origins.abbreviation
    ORDER BY created_at ASC NULLS FIRST
    LIMIT 1;

    SELECT ARRAY_AGG(id) INTO v_dup_ids
    FROM parties
    WHERE abbreviation = v_origins.abbreviation
      AND id != v_keep_id;

    IF v_dup_ids IS NOT NULL AND array_length(v_dup_ids, 1) > 0 THEN
      -- Can't delete if party_results reference these IDs — update references first
      UPDATE party_results SET party_id = v_keep_id
      WHERE party_id = ANY(v_dup_ids);

      DELETE FROM parties WHERE id = ANY(v_dup_ids);
      RAISE NOTICE 'Deduplicated %: kept %, removed % duplicates', v_origins.abbreviation, v_keep_id, array_length(v_dup_ids, 1);
    END IF;
  END LOOP;

  RAISE NOTICE 'Parties after dedup: %', (SELECT count(*) FROM parties);
END $$;

-- ============================================================
-- 2. FIX RESULT_SUBMISSIONS: ensure NDC party results work
--    The simulation uses 'NDC' as abbreviation, but parties table
--    may not have NDC. Ensure it exists.
-- ============================================================
INSERT INTO parties (official_name, abbreviation, color)
SELECT 'New Democratic Coalition', 'NDC', '#22C55E'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE abbreviation = 'NDC');

-- ============================================================
-- 3. CREATE/REPLACE ALL MISSING SQL FUNCTIONS
-- ============================================================

-- 3a. get_admin_stats — admin dashboard
CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'total_volunteers', (SELECT count(*) FROM volunteers),
      'active_volunteers', (SELECT count(*) FROM volunteers WHERE status = 'ACTIVE'),
      'total_assignments', (SELECT count(*) FROM agent_assignments),
      'checked_in_assignments', (SELECT count(*) FROM agent_assignments WHERE status = 'CHECKED_IN'),
      'total_results', (SELECT count(*) FROM result_submissions),
      'verified_results', (SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED'),
      'pending_verification', (SELECT count(*) FROM result_submissions WHERE status = 'UNVERIFIED'),
      'total_incidents', (SELECT count(*) FROM incidents)
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_stats() TO anon;

-- 3b. get_fast_stats — public dashboard
CREATE OR REPLACE FUNCTION get_fast_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'inec_total_polling_units', (SELECT count(*) FROM polling_units),
      'total_polling_units', (SELECT count(*) FROM polling_units),
      'covered_polling_units', (SELECT count(*) FROM agent_assignments),
      'verified_polling_units', (SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED'),
      'active_observers', (SELECT count(*) FROM agent_assignments WHERE status = 'CHECKED_IN'),
      'total_incidents', (SELECT count(*) FROM incidents),
      'state_breakdown', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'state_id', s.id, 'state_name', s.name, 'state_code', s.code,
            'total_polling_units', COALESCE(pu_counts.cnt, 0),
            'covered_polling_units', COALESCE(aa_counts.cnt, 0),
            'verified_polling_units', COALESCE(rs_counts.cnt, 0),
            'coverage_percent', CASE WHEN COALESCE(pu_counts.cnt, 0) > 0
              THEN ROUND((COALESCE(aa_counts.cnt, 0)::NUMERIC / pu_counts.cnt * 100), 1) ELSE 0 END,
            'verification_percent', CASE WHEN COALESCE(pu_counts.cnt, 0) > 0
              THEN ROUND((COALESCE(rs_counts.cnt, 0)::NUMERIC / pu_counts.cnt * 100), 1) ELSE 0 END
          )
          ORDER BY pu_counts.cnt DESC NULLS LAST
        )
        FROM states s
        LEFT JOIN LATERAL (SELECT count(*) AS cnt FROM polling_units WHERE state_id = s.id) pu_counts ON true
        LEFT JOIN LATERAL (SELECT count(*) AS cnt FROM agent_assignments a JOIN polling_units pu ON pu.id = a.polling_unit_id WHERE pu.state_id = s.id) aa_counts ON true
        LEFT JOIN LATERAL (SELECT count(*) AS cnt FROM result_submissions rs JOIN polling_units pu ON pu.id = rs.polling_unit_id WHERE pu.state_id = s.id AND rs.status = 'VERIFIED') rs_counts ON true
      ),
      'incident_counts', (SELECT COALESCE(jsonb_object_agg(category, cnt), '{}'::jsonb) FROM (SELECT category, count(*) AS cnt FROM incidents GROUP BY category) sub),
      'coverage_percent', CASE WHEN (SELECT count(*) FROM polling_units) > 0
        THEN ROUND((SELECT count(*) FROM agent_assignments)::NUMERIC / (SELECT count(*) FROM polling_units) * 100, 1) ELSE 0 END,
      'verification_percent', CASE WHEN (SELECT count(*) FROM polling_units) > 0
        THEN ROUND((SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED')::NUMERIC / (SELECT count(*) FROM polling_units) * 100, 1) ELSE 0 END,
      'last_updated', now(),
      'disclaimer', 'These are independently collected field observations and are not official INEC election results.'
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_fast_stats() TO service_role;
GRANT EXECUTE ON FUNCTION get_fast_stats() TO anon;

-- 3c. get_polling_unit_rows — map GeoJSON
CREATE OR REPLACE FUNCTION get_polling_unit_rows()
RETURNS TABLE (
  id UUID, official_code TEXT, name TEXT,
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  status TEXT, state_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT pu.id, pu.official_code, pu.name, pu.latitude, pu.longitude,
    pu.status, COALESCE(st.name, 'Unknown') as state_name
  FROM polling_units pu
  LEFT JOIN states st ON st.id = pu.state_id
  WHERE pu.latitude IS NOT NULL AND pu.longitude IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;
GRANT EXECUTE ON FUNCTION get_polling_unit_rows() TO anon;
GRANT EXECUTE ON FUNCTION get_polling_unit_rows() TO service_role;

-- 3d. get_party_totals — leaderboard
CREATE OR REPLACE FUNCTION get_party_totals()
RETURNS TABLE (party_name TEXT, party_abbreviation TEXT, party_color TEXT, total_votes BIGINT, percentage NUMERIC)
AS $$
DECLARE gt BIGINT;
BEGIN
  SELECT COALESCE(SUM(pr.votes), 0) INTO gt FROM party_results pr;
  RETURN QUERY
  WITH ps AS (
    SELECT p.official_name, p.abbreviation, p.color, SUM(pr.votes) AS votes
    FROM parties p
    INNER JOIN party_results pr ON pr.party_id = p.id
    GROUP BY p.id, p.official_name, p.abbreviation, p.color
  ),
  dd AS (
    SELECT abbreviation, MAX(official_name) AS official_name, MAX(color) AS color, MAX(votes) AS votes
    FROM ps GROUP BY abbreviation
  )
  SELECT d.official_name, d.abbreviation, d.color, d.votes,
    CASE WHEN gt > 0 THEN ROUND((d.votes::NUMERIC / gt) * 100, 1) ELSE 0 END
  FROM dd d ORDER BY d.votes DESC;
END;
$$ LANGUAGE plpgsql STABLE;
GRANT EXECUTE ON FUNCTION get_party_totals() TO anon;
GRANT EXECUTE ON FUNCTION get_party_totals() TO service_role;

-- 3e. get_state_breakdown
CREATE OR REPLACE FUNCTION get_state_breakdown()
RETURNS TABLE (
  state_id UUID, state_name TEXT, state_code TEXT,
  total_polling_units BIGINT, covered_polling_units BIGINT,
  verified_polling_units BIGINT, coverage_percent NUMERIC,
  verification_percent NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH spc AS (SELECT pu.state_id, COUNT(*) AS total_pu FROM polling_units pu GROUP BY pu.state_id),
  sc AS (SELECT pu.state_id, COUNT(DISTINCT pu.id) AS covered FROM polling_units pu INNER JOIN agent_assignments aa ON aa.polling_unit_id = pu.id GROUP BY pu.state_id),
  svc AS (SELECT pu.state_id, COUNT(DISTINCT rs.polling_unit_id) AS verified FROM result_submissions rs INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id WHERE rs.status = 'VERIFIED' GROUP BY pu.state_id)
  SELECT spc.state_id, st.name, st.code, spc.total_pu, COALESCE(sc.covered,0), COALESCE(svc.verified,0),
    CASE WHEN spc.total_pu > 0 THEN ROUND((COALESCE(sc.covered,0)::NUMERIC / spc.total_pu) * 100, 1) ELSE 0 END,
    CASE WHEN spc.total_pu > 0 THEN ROUND((COALESCE(svc.verified,0)::NUMERIC / spc.total_pu) * 100, 1) ELSE 0 END
  FROM spc INNER JOIN states st ON st.id = spc.state_id LEFT JOIN sc ON sc.state_id = spc.state_id LEFT JOIN svc ON svc.state_id = spc.state_id
  ORDER BY spc.total_pu DESC;
END;
$$ LANGUAGE plpgsql STABLE;
GRANT EXECUTE ON FUNCTION get_state_breakdown() TO anon;
GRANT EXECUTE ON FUNCTION get_state_breakdown() TO service_role;

-- 3f. run_fast_simulation — THE BIG ONE
DROP FUNCTION IF EXISTS run_fast_simulation(TEXT, INTEGER, BIGINT);
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
  -- Pick scenario
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

  RAISE NOTICE '[fast-sim] Scenario: %, NDC share: %, Election: %', v_scenario, v_ndc_share, p_election_type;

  -- Ensure NDC party exists
  INSERT INTO parties (official_name, abbreviation, color)
  SELECT 'New Democratic Coalition', 'NDC', '#22C55E'
  WHERE NOT EXISTS (SELECT 1 FROM parties WHERE abbreviation = 'NDC');

  SELECT id INTO v_ndc_party_id FROM parties WHERE abbreviation = 'NDC' LIMIT 1;
  SELECT id INTO v_apc_party_id FROM parties WHERE abbreviation = 'APC' LIMIT 1;

  -- Step 1: Reset
  TRUNCATE TABLE party_results, result_submissions, incidents CASCADE;
  UPDATE simulation_config SET
    status = 'RUNNING', speed = 3, election_type = p_election_type,
    started_at = now(), last_tick_at = now(), total_results_submitted = 0
  WHERE id = v_config_id;

  -- Step 2: Count PUs
  SELECT count(*) INTO v_total_pus FROM polling_units;
  v_avg_votes_per_pu := GREATEST(50, (p_total_voters / v_total_pus)::INTEGER);
  RAISE NOTICE '[fast-sim] % PUs, ~% votes/PU', v_total_pus, v_avg_votes_per_pu;

  -- Step 3: Set random PU statuses
  UPDATE polling_units SET status = CASE
    WHEN random() < 0.05 THEN 'VERIFIED'
    WHEN random() < 0.12 THEN 'RESULT_SUBMITTED'
    WHEN random() < 0.20 THEN 'RESULT_ANNOUNCED'
    WHEN random() < 0.30 THEN 'COUNTING'
    WHEN random() < 0.40 THEN 'VOTING'
    ELSE 'NOT_STARTED'
  END WHERE id IS NOT NULL;

  -- Step 4: Ensure election exists
  IF p_election_type = 'GOVERNORSHIP' THEN
    INSERT INTO elections (name, type) VALUES ('Governorship Election 2027', 'GOVERNORSHIP'::election_type) ON CONFLICT DO NOTHING;
    SELECT id INTO v_election_id FROM elections WHERE type = 'GOVERNORSHIP' LIMIT 1;
  ELSE
    INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL'::election_type) ON CONFLICT DO NOTHING;
    SELECT id INTO v_election_id FROM elections WHERE type = 'PRESIDENTIAL' LIMIT 1;
  END IF;

  -- Step 5: Bulk insert result submissions (CTE chain)
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
      GREATEST(50, ROUND(v_avg_votes_per_pu * (0.5 + random()))) AS total_votes
    FROM polling_units pu LEFT JOIN states st ON st.id = pu.state_id
  ),
  result_insert AS (
    INSERT INTO result_submissions (polling_unit_id, election_id, volunteer_id, assignment_id, valid_votes, rejected_votes, total_votes, status, submitted_at, verified_at)
    SELECT pd.pu_id, v_election_id, NULL, NULL,
      ROUND(pd.total_votes * (0.82 + random() * 0.15))::INTEGER, NULL, pd.total_votes,
      CASE WHEN random() < 0.05 THEN 'VERIFIED' ELSE 'RESULT_SUBMITTED' END,
      now() - (random() * interval '60 days'),
      CASE WHEN random() < 0.05 THEN now() - (random() * interval '30 days') ELSE NULL END
    FROM pu_data pd RETURNING id, polling_unit_id
  ),
  result_fix AS (
    UPDATE result_submissions rs SET rejected_votes = rs.total_votes - rs.valid_votes
    FROM result_insert ri WHERE rs.id = ri.id RETURNING rs.id
  ),
  vote_data AS (
    SELECT ri.id AS result_id, pd.region, pd.total_votes,
      GREATEST(0, ROUND(pd.total_votes * v_ndc_share *
        CASE pd.region
          WHEN 'SE' THEN 1.9 WHEN 'SS' THEN 1.6 WHEN 'FC' THEN 1.2
          WHEN 'NC' THEN 1.0 WHEN 'NE' THEN 0.7 WHEN 'NW' THEN 0.6
          WHEN 'SW' THEN 0.5 ELSE 1.0
        END * (0.85 + random() * 0.30)))::INTEGER AS ndc_votes,
      GREATEST(0, ROUND(pd.total_votes * 0.24 *
        CASE pd.region
          WHEN 'SW' THEN 1.5 WHEN 'NW' THEN 1.4 WHEN 'NE' THEN 1.3
          WHEN 'NC' THEN 1.1 WHEN 'FC' THEN 1.0 WHEN 'SS' THEN 0.4
          WHEN 'SE' THEN 0.3 ELSE 1.0
        END * (0.85 + random() * 0.30)))::INTEGER AS apc_votes,
      pd.total_votes - GREATEST(0, ROUND(pd.total_votes * v_ndc_share *
        CASE pd.region WHEN 'SE' THEN 1.9 WHEN 'SS' THEN 1.6 WHEN 'FC' THEN 1.2 WHEN 'NC' THEN 1.0 WHEN 'NE' THEN 0.7 WHEN 'NW' THEN 0.6 WHEN 'SW' THEN 0.5 ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER
      - GREATEST(0, ROUND(pd.total_votes * 0.24 *
        CASE pd.region WHEN 'SW' THEN 1.5 WHEN 'NW' THEN 1.4 WHEN 'NE' THEN 1.3 WHEN 'NC' THEN 1.1 WHEN 'FC' THEN 1.0 WHEN 'SS' THEN 0.4 WHEN 'SE' THEN 0.3 ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER AS others_total
    FROM result_insert ri JOIN pu_data pd ON pd.pu_id = ri.polling_unit_id
  )
  INSERT INTO party_results (result_submission_id, party_id, votes)
  SELECT vd.result_id, v_ndc_party_id, vd.ndc_votes
  FROM vote_data vd WHERE vd.ndc_votes > 0
  UNION ALL
  SELECT vd.result_id, v_apc_party_id, vd.apc_votes
  FROM vote_data vd WHERE vd.apc_votes > 0;

  GET DIAGNOSTICS v_pr_created = ROW_COUNT;
  SELECT count(*) INTO v_results_created FROM result_submissions;
  SELECT sum(total_votes) INTO v_total_votes FROM result_submissions;

  RAISE NOTICE '[fast-sim] Created % results, % party_results, % total_votes', v_results_created, v_pr_created, v_total_votes;

  -- Step 6: Status distribution
  SELECT jsonb_object_agg(status, cnt) INTO v_status_dist
  FROM (SELECT status, count(*) AS cnt FROM polling_units GROUP BY status) sub;

  -- Step 7: Mark complete
  UPDATE simulation_config SET
    status = 'COMPLETED', last_tick_at = now(),
    total_results_submitted = v_results_created, updated_at = now()
  WHERE id = v_config_id;

  RAISE NOTICE '[fast-sim] Done in %ms', extract(milliseconds from clock_timestamp() - v_start_time);

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

-- 3g. simulation_tick
CREATE OR REPLACE FUNCTION simulation_tick()
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '60s'
AS $$
DECLARE
  v_changed INTEGER := 0;
  v_config_id UUID := '00000000-0000-0000-0000-000000000001';
  v_config_status TEXT;
BEGIN
  SELECT status INTO v_config_status FROM simulation_config WHERE id = v_config_id;
  IF v_config_status IS NULL OR v_config_status != 'RUNNING' THEN
    RETURN jsonb_build_object('ticked', false, 'reason', 'No active simulation');
  END IF;

  WITH eligible AS (
    SELECT id, status FROM polling_units
    WHERE status NOT IN ('VERIFIED', 'DISPUTED', 'DISRUPTED', 'ELECTION_NOT_HELD')
    ORDER BY random()
    LIMIT (SELECT count(*) * 0.30 FROM polling_units WHERE status NOT IN ('VERIFIED', 'DISPUTED', 'DISRUPTED', 'ELECTION_NOT_HELD'))
  ),
  advanced AS (
    UPDATE polling_units pu SET status = CASE
      WHEN e.status = 'NOT_STARTED' AND random() < 0.85 THEN 'VOTING'
      WHEN e.status = 'NOT_STARTED' THEN 'DISRUPTED'
      WHEN e.status = 'VOTING' AND random() < 0.88 THEN 'COUNTING'
      WHEN e.status = 'VOTING' AND random() < 0.04 THEN 'DISPUTED'
      WHEN e.status = 'VOTING' THEN 'VOTING'
      WHEN e.status = 'COUNTING' AND random() < 0.90 THEN 'RESULT_ANNOUNCED'
      WHEN e.status = 'COUNTING' AND random() < 0.05 THEN 'DISPUTED'
      WHEN e.status = 'COUNTING' THEN 'COUNTING'
      WHEN e.status = 'RESULT_ANNOUNCED' AND random() < 0.92 THEN 'RESULT_SUBMITTED'
      WHEN e.status = 'RESULT_ANNOUNCED' THEN 'RESULT_ANNOUNCED'
      WHEN e.status = 'RESULT_SUBMITTED' AND random() < 0.88 THEN 'VERIFICATION_PENDING'
      WHEN e.status = 'RESULT_SUBMITTED' AND random() < 0.05 THEN 'VERIFIED'
      WHEN e.status = 'RESULT_SUBMITTED' THEN 'RESULT_SUBMITTED'
      WHEN e.status = 'VERIFICATION_PENDING' AND random() < 0.80 THEN 'VERIFIED'
      WHEN e.status = 'VERIFICATION_PENDING' AND random() < 0.10 THEN 'DISPUTED'
      WHEN e.status = 'VERIFICATION_PENDING' THEN 'VERIFICATION_PENDING'
      ELSE pu.status
    END
    FROM eligible e WHERE pu.id = e.id RETURNING pu.id
  )
  SELECT count(*) INTO v_changed FROM advanced;

  UPDATE simulation_config SET last_tick_at = now(), updated_at = now() WHERE id = v_config_id;
  RETURN jsonb_build_object('ticked', true, 'changed', v_changed);
END;
$$;
GRANT EXECUTE ON FUNCTION simulation_tick() TO service_role;
GRANT EXECUTE ON FUNCTION simulation_tick() TO anon;

-- 3h. reset_simulation_data
CREATE OR REPLACE FUNCTION reset_simulation_data()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE TABLE party_results, result_submissions, incidents CASCADE;
  UPDATE simulation_config SET status = 'IDLE', total_results_submitted = 0, updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';
  UPDATE polling_units SET status = 'NOT_STARTED' WHERE id IS NOT NULL;
  RETURN 'RESET_COMPLETE';
END;
$$;
GRANT EXECUTE ON FUNCTION reset_simulation_data() TO service_role;

DO $$
BEGIN
  RAISE NOTICE '=== Migration 020 Complete ===';
  RAISE NOTICE '1. Parties deduplicated';
  RAISE NOTICE '2. NDC party ensured';
  RAISE NOTICE '3. All SQL functions created/granted';
  RAISE NOTICE '4. Simulation function fixed with proper election type + party IDs';
END $$;
