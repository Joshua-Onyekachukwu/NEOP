-- ============================================================
-- NEOP: CLEAN + 20M VOTER SIMULATION  
-- Run ALL of this in Supabase SQL Editor (one shot)
-- ============================================================

-- STEP 1: Fix column constraints (allow NULLs for disrupted PUs)
-- ============================================================
ALTER TABLE result_submissions ALTER COLUMN submitted_at DROP NOT NULL;
ALTER TABLE result_submissions ALTER COLUMN party_votes DROP NOT NULL;
ALTER TABLE result_submissions ALTER COLUMN verified_at DROP NOT NULL;


-- STEP 2: Clean old data
-- ============================================================
DELETE FROM party_results WHERE id IS NOT NULL;
DELETE FROM result_submissions WHERE id IS NOT NULL;
DELETE FROM incidents WHERE id IS NOT NULL;

UPDATE simulation_config SET
  status = 'IDLE',
  total_results_submitted = 0,
  total_incidents_submitted = 0,
  started_at = NULL,
  last_tick_at = NULL,
  updated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE polling_units SET status = 'NOT_STARTED' WHERE status != 'NOT_STARTED';


-- STEP 3: Create the 20M voter simulation function
-- ============================================================
-- This must be run in SQL Editor (not via exec_sql) because
-- the dollar-quoting gets mangled through EXECUTE.

DROP FUNCTION IF EXISTS run_sim_upgraded(TEXT, BIGINT);

CREATE FUNCTION run_sim_upgraded(
  p_scenario TEXT DEFAULT 'landslide',
  p_total_voters BIGINT DEFAULT 20000000
)
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '110s'
SET lock_timeout = '30s'
AS $$
DECLARE
  v_ndc NUMERIC := CASE p_scenario
    WHEN 'landslide' THEN 0.42 WHEN 'sweep' THEN 0.37
    WHEN 'close' THEN 0.30 ELSE 0.37 END;
  v_apc NUMERIC := CASE p_scenario
    WHEN 'landslide' THEN 0.22 WHEN 'sweep' THEN 0.25
    WHEN 'close' THEN 0.28 ELSE 0.25 END;
  v_total_pus INTEGER;
  v_active_pus INTEGER;
  v_disrupted_pus INTEGER;
  v_avg_votes INTEGER;
  v_election_id UUID;
  v_created INTEGER;
  v_total_votes BIGINT;
BEGIN
  -- Clear old data
  DELETE FROM party_results WHERE id IS NOT NULL;
  DELETE FROM result_submissions WHERE id IS NOT NULL;
  DELETE FROM incidents WHERE id IS NOT NULL;

  UPDATE simulation_config SET
    status = 'RUNNING', last_tick_at = now(), total_results_submitted = 0,
    election_type = 'PRESIDENTIAL', updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_election_id FROM elections WHERE type = 'PRESIDENTIAL' LIMIT 1;

  SELECT count(*) INTO v_total_pus FROM polling_units;
  v_active_pus := ROUND(v_total_pus * 0.92)::INTEGER;
  v_disrupted_pus := v_total_pus - v_active_pus;
  v_avg_votes := GREATEST(50, (p_total_voters / v_active_pus)::INTEGER);

  -- v_avg_votes = 20M / 162698 = ~123
  -- Multiplier (0.75 + random() * 0.50) averages 1.0 (range 0.75-1.25)
  -- So average votes per active PU ~123
  -- 162698 * 123 = ~20M total votes

  INSERT INTO result_submissions (
    polling_unit_id, election_id, valid_votes, rejected_votes, total_votes,
    status, submitted_at, verified_at, party_votes
  )
  SELECT
    pu.id,
    v_election_id,
    CASE WHEN sub.is_disrupted THEN 0
         ELSE sub.tv - ROUND(sub.tv * sub.rejection_rate)::INTEGER END,
    CASE WHEN sub.is_disrupted THEN 0
         ELSE ROUND(sub.tv * sub.rejection_rate)::INTEGER END,
    CASE WHEN sub.is_disrupted THEN 0 ELSE sub.tv END,
    CASE WHEN sub.is_disrupted THEN 'DISRUPTED'
         WHEN random() < 0.05 THEN 'VERIFIED'
         ELSE 'RESULT_SUBMITTED' END,
    CASE WHEN sub.is_disrupted THEN NULL
         ELSE now() - (random() * interval '60 days') END,
    CASE WHEN sub.is_disrupted THEN NULL
         WHEN random() < 0.05 THEN now() - (random() * interval '30 days')
         ELSE NULL END,
    CASE WHEN sub.is_disrupted THEN NULL ELSE jsonb_build_object(
      'NDC', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rejection_rate)::INTEGER) * v_ndc *
        CASE st.name
          WHEN 'Abia' THEN 1.9 WHEN 'Anambra' THEN 1.9 WHEN 'Ebonyi' THEN 1.9
          WHEN 'Enugu' THEN 1.9 WHEN 'Imo' THEN 1.9
          WHEN 'Rivers' THEN 1.6 WHEN 'Delta' THEN 1.6 WHEN 'Bayelsa' THEN 1.6
          WHEN 'Akwa Ibom' THEN 1.6 WHEN 'Cross River' THEN 1.6 WHEN 'Edo' THEN 1.6
          WHEN 'FCT' THEN 1.2
          WHEN 'Niger' THEN 1.0 WHEN 'Kwara' THEN 1.0 WHEN 'Kogi' THEN 1.0
          WHEN 'Benue' THEN 1.0 WHEN 'Plateau' THEN 1.0 WHEN 'Nasarawa' THEN 1.0
          WHEN 'Borno' THEN 0.7 WHEN 'Yobe' THEN 0.7 WHEN 'Adamawa' THEN 0.7
          WHEN 'Gombe' THEN 0.7 WHEN 'Taraba' THEN 0.7 WHEN 'Bauchi' THEN 0.7
          WHEN 'Kano' THEN 0.6 WHEN 'Katsina' THEN 0.6 WHEN 'Sokoto' THEN 0.6
          WHEN 'Zamfara' THEN 0.6 WHEN 'Kebbi' THEN 0.6 WHEN 'Jigawa' THEN 0.6
          WHEN 'Kaduna' THEN 0.6
          WHEN 'Lagos' THEN 0.5 WHEN 'Ogun' THEN 0.5 WHEN 'Oyo' THEN 0.5
          WHEN 'Ondo' THEN 0.5 WHEN 'Osun' THEN 0.5 WHEN 'Ekiti' THEN 0.5
          ELSE 1.0 END * (0.85+random()*0.3)))::INTEGER,
      'APC', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rejection_rate)::INTEGER) * v_apc *
        CASE st.name
          WHEN 'Lagos' THEN 1.5 WHEN 'Ogun' THEN 1.5 WHEN 'Oyo' THEN 1.5
          WHEN 'Ondo' THEN 1.5 WHEN 'Osun' THEN 1.5 WHEN 'Ekiti' THEN 1.5
          WHEN 'Kano' THEN 1.4 WHEN 'Katsina' THEN 1.4 WHEN 'Sokoto' THEN 1.4
          WHEN 'Zamfara' THEN 1.4 WHEN 'Kebbi' THEN 1.4 WHEN 'Jigawa' THEN 1.4
          WHEN 'Kaduna' THEN 1.4
          WHEN 'Borno' THEN 1.3 WHEN 'Yobe' THEN 1.3 WHEN 'Adamawa' THEN 1.3
          WHEN 'Gombe' THEN 1.3 WHEN 'Taraba' THEN 1.3 WHEN 'Bauchi' THEN 1.3
          WHEN 'Niger' THEN 1.1 WHEN 'Kwara' THEN 1.1 WHEN 'Kogi' THEN 1.1
          WHEN 'Benue' THEN 1.1 WHEN 'Plateau' THEN 1.1 WHEN 'Nasarawa' THEN 1.1
          WHEN 'FCT' THEN 1.0
          WHEN 'Rivers' THEN 0.4 WHEN 'Delta' THEN 0.4 WHEN 'Bayelsa' THEN 0.4
          WHEN 'Akwa Ibom' THEN 0.4 WHEN 'Cross River' THEN 0.4 WHEN 'Edo' THEN 0.4
          WHEN 'Abia' THEN 0.3 WHEN 'Anambra' THEN 0.3 WHEN 'Ebonyi' THEN 0.3
          WHEN 'Enugu' THEN 0.3 WHEN 'Imo' THEN 0.3
          ELSE 1.0 END * (0.85+random()*0.3)))::INTEGER,
      'PDP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rejection_rate)::INTEGER) * 0.30 * (0.7+random()*0.6)))::INTEGER,
      'LP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rejection_rate)::INTEGER) * 0.20 * (0.7+random()*0.6)))::INTEGER,
      'NNPP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rejection_rate)::INTEGER) * 0.12 * (0.7+random()*0.6)))::INTEGER,
      'APGA', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rejection_rate)::INTEGER) * 0.10 * (0.7+random()*0.6)))::INTEGER,
      'SDP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rejection_rate)::INTEGER) * 0.08 * (0.7+random()*0.6)))::INTEGER,
      'YPP', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rejection_rate)::INTEGER) * 0.10 * (0.7+random()*0.6)))::INTEGER,
      'ADC', GREATEST(0, ROUND((sub.tv - ROUND(sub.tv*sub.rejection_rate)::INTEGER) * 0.10 * (0.7+random()*0.6)))::INTEGER
    ) END
  FROM (
    SELECT
      pu_inner.id,
      (hashtext(pu_inner.id::text) % 100) < 8 AS is_disrupted,
      GREATEST(50, ROUND(v_avg_votes * (0.75 + random() * 0.50))) AS tv,
      (0.05 + random() * 0.10) AS rejection_rate
    FROM polling_units pu_inner
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
    'success', true,
    'scenario', p_scenario,
    'total_pus', v_total_pus,
    'active_pus', v_active_pus,
    'disrupted_pus', v_disrupted_pus,
    'results_created', v_created,
    'total_votes', v_total_votes,
    'avg_turnout', '85-95%'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION run_sim_upgraded(TEXT, BIGINT) TO service_role;


-- STEP 4: Run the simulation (should take ~40 seconds)
-- ============================================================
SELECT run_sim_upgraded('landslide', 20000000);


-- STEP 5: Verify results
-- ============================================================

-- Status breakdown
SELECT status, count(*) AS cnt
FROM result_submissions
GROUP BY status
ORDER BY cnt DESC;

-- Total votes
SELECT sum(total_votes) AS total_votes FROM result_submissions;

-- Party breakdown
SELECT
  key AS party,
  sum(value::BIGINT) AS total_votes,
  ROUND(sum(value::BIGINT) * 100.0 / (SELECT sum(total_votes) FROM result_submissions WHERE party_votes IS NOT NULL), 1) AS pct
FROM result_submissions,
  jsonb_each_text(party_votes)
WHERE party_votes IS NOT NULL
GROUP BY key
ORDER BY total_votes DESC;

-- Simulation config
SELECT status, total_results_submitted, started_at, last_tick_at, updated_at
FROM simulation_config
WHERE id = '00000000-0000-0000-0000-000000000001';
