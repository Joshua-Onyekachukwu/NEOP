/**
 * Fast Simulation Phase 1 — Clear data + insert result_submissions
 *
 * This handles the TRUNCATE and bulk INSERT of result_submissions.
 * Runs within Supabase's ~120s gateway timeout.
 *
 * Usage: SELECT run_sim_phase1('landslide', 50000000);
 */

-- Phase 1: Clear + insert result_submissions
CREATE OR REPLACE FUNCTION run_sim_phase1(
  p_scenario TEXT DEFAULT 'landslide',
  p_total_voters BIGINT DEFAULT 50000000
)
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '100s'
SET lock_timeout = '30s'
AS $$
DECLARE
  v_total_pus INTEGER;
  v_avg_votes INTEGER;
  v_election_id UUID;
  v_results_created INTEGER;
  v_total_votes BIGINT;
BEGIN
  -- Clear old data (instant)
  TRUNCATE TABLE party_results, result_submissions, incidents RESTART IDENTITY;

  -- Mark simulation running
  UPDATE simulation_config SET
    status = 'RUNNING', last_tick_at = now(), total_results_submitted = 0,
    election_type = 'PRESIDENTIAL', updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  -- Ensure election exists
  INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_election_id FROM elections WHERE type = 'PRESIDENTIAL' LIMIT 1;

  -- Calculate average votes per PU
  SELECT count(*) INTO v_total_pus FROM polling_units;
  v_avg_votes := GREATEST(50, (p_total_voters / v_total_pus)::INTEGER);

  -- Bulk insert all result_submissions in one CTE
  WITH pu_data AS (
    SELECT pu.id AS pu_id,
      GREATEST(50, ROUND(v_avg_votes * (0.5 + random()))) AS total_votes,
      (0.01 + random() * 0.04) AS reject_rate
    FROM polling_units pu
  )
  INSERT INTO result_submissions (
    polling_unit_id, election_id, volunteer_id, assignment_id,
    valid_votes, rejected_votes, total_votes, status,
    submitted_at, verified_at
  )
  SELECT
    pd.pu_id, v_election_id, NULL, NULL,
    pd.total_votes - ROUND(pd.total_votes * pd.reject_rate)::INTEGER,
    ROUND(pd.total_votes * pd.reject_rate)::INTEGER,
    pd.total_votes,
    CASE WHEN random() < 0.05 THEN 'VERIFIED' ELSE 'RESULT_SUBMITTED' END,
    now() - (random() * interval '60 days'),
    CASE WHEN random() < 0.05 THEN now() - (random() * interval '30 days') ELSE NULL END
  FROM pu_data pd;

  GET DIAGNOSTICS v_results_created = ROW_COUNT;
  SELECT sum(total_votes) INTO v_total_votes FROM result_submissions;

  RETURN jsonb_build_object(
    'phase', 1, 'success', true,
    'results_created', v_results_created,
    'total_votes', v_total_votes,
    'scenario', p_scenario
  );
END;
$$;

GRANT EXECUTE ON FUNCTION run_sim_phase1(TEXT, BIGINT) TO service_role;
