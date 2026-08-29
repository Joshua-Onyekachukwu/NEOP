-- Fast stats: single function returns all dashboard data
-- Replaces 5+ COUNT queries + 37 state queries with one call

CREATE OR REPLACE FUNCTION get_fast_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_inec_total INTEGER := 176846;
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'inec_total_polling_units', v_inec_total,
    'total_polling_units', (SELECT count(*) FROM polling_units),
    'covered_polling_units', (SELECT count(*) FROM agent_assignments),
    'verified_polling_units', (SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED'),
    'active_observers', (SELECT count(*) FROM agent_assignments WHERE status = 'CHECKED_IN'),
    'total_incidents', (SELECT count(*) FROM incidents),
    'state_breakdown', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'state_id', s.id,
          'state_name', s.name,
          'state_code', s.code,
          'total_polling_units', COALESCE(pu_counts.cnt, 0),
          'covered_polling_units', COALESCE(aa_counts.cnt, 0),
          'verified_polling_units', COALESCE(rs_counts.cnt, 0),
          'coverage_percent', CASE
            WHEN COALESCE(pu_counts.cnt, 0) > 0
            THEN ROUND((COALESCE(aa_counts.cnt, 0)::NUMERIC / pu_counts.cnt * 100), 1)
            ELSE 0
          END,
          'verification_percent', CASE
            WHEN COALESCE(pu_counts.cnt, 0) > 0
            THEN ROUND((COALESCE(rs_counts.cnt, 0)::NUMERIC / pu_counts.cnt * 100), 1)
            ELSE 0
          END
        )
        ORDER BY pu_counts.cnt DESC NULLS LAST
      )
      FROM states s
      LEFT JOIN LATERAL (
        SELECT count(*) AS cnt FROM polling_units WHERE state_id = s.id
      ) pu_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS cnt FROM agent_assignments a
        JOIN polling_units pu ON pu.id = a.polling_unit_id
        WHERE pu.state_id = s.id
      ) aa_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS cnt FROM result_submissions rs
        JOIN polling_units pu ON pu.id = rs.polling_unit_id
        WHERE pu.state_id = s.id AND rs.status = 'VERIFIED'
      ) rs_counts ON true
    ),
    'incident_counts', (
      SELECT COALESCE(jsonb_object_agg(category, cnt), '{}'::jsonb)
      FROM (
        SELECT category, count(*) AS cnt
        FROM incidents
        GROUP BY category
      ) sub
    ),
    'coverage_percent', CASE
      WHEN (SELECT count(*) FROM polling_units) > 0
      THEN ROUND((SELECT count(*) FROM agent_assignments)::NUMERIC /
                  (SELECT count(*) FROM polling_units) * 100, 1)
      ELSE 0
    END,
    'verification_percent', CASE
      WHEN (SELECT count(*) FROM polling_units) > 0
      THEN ROUND((SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED')::NUMERIC /
                  (SELECT count(*) FROM polling_units) * 100, 1)
      ELSE 0
    END,
    'last_updated', now(),
    'disclaimer', 'These are independently collected field observations and are not official INEC election results.'
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_fast_stats() TO service_role;
GRANT EXECUTE ON FUNCTION get_fast_stats() TO anon;

-- Also create a fast config function
CREATE OR REPLACE FUNCTION get_simulation_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_config JSONB;
BEGIN
  SELECT jsonb_build_object(
    'status', sc.status,
    'election_type', sc.election_type,
    'title', CASE
      WHEN sc.election_type = 'PRESIDENTIAL' THEN 'Presidential & National Assembly Election'
      WHEN sc.election_type = 'HOUSE_OF_REPS' THEN 'House of Representatives Election'
      WHEN sc.election_type = 'GOVERNORSHIP' THEN 'Governorship & State House of Assembly Election'
      ELSE 'Election Observation'
    END,
    'subtitle', CASE
      WHEN sc.status = 'RUNNING' THEN 'Simulation in progress — data updating live'
      WHEN sc.status = 'COMPLETED' THEN 'Simulation complete — reviewing results'
      ELSE 'Awaiting election data — observers will report from polling units'
    END,
    'date', '2027-01-16',
    'total_polling_units', (SELECT count(*) FROM polling_units),
    'total_results', COALESCE(sc.total_results_submitted, 0),
    'display_status', CASE
      WHEN sc.status = 'RUNNING' THEN 'SIMULATION'
      WHEN sc.status = 'COMPLETED' THEN 'LIVE'
      ELSE 'IDLE'
    END,
    'status_label', CASE
      WHEN sc.status = 'RUNNING' THEN 'SIMULATION RUNNING'
      WHEN sc.status = 'COMPLETED' THEN 'LIVE ELECTION DATA'
      ELSE 'AWAITING DATA'
    END
  )
  FROM simulation_config sc
  WHERE sc.id = '00000000-0000-0000-0000-000000000001'
  INTO v_config;

  IF v_config IS NULL THEN
    v_config := jsonb_build_object(
      'status', 'IDLE',
      'election_type', 'PRESIDENTIAL',
      'title', 'Presidential & National Assembly Election',
      'subtitle', 'Awaiting election data',
      'date', '2027-01-16',
      'total_polling_units', (SELECT count(*) FROM polling_units),
      'total_results', 0,
      'display_status', 'IDLE',
      'status_label', 'AWAITING DATA'
    );
  END IF;

  RETURN v_config;
END;
$$;

GRANT EXECUTE ON FUNCTION get_simulation_status() TO service_role;
GRANT EXECUTE ON FUNCTION get_simulation_status() TO anon;
