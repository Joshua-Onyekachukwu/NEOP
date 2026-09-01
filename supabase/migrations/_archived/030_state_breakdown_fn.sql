-- State breakdown via SQL aggregation (fast, single query)
-- Replaces the slow client-side pagination approach

DROP FUNCTION IF EXISTS get_state_breakdown_from_results();
CREATE OR REPLACE FUNCTION get_state_breakdown_from_results()
RETURNS TABLE (
  state_name TEXT,
  state_id UUID,
  total_pus BIGINT,
  verified BIGINT,
  submitted BIGINT,
  disputed BIGINT,
  disrupted BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT 
    s.name AS state_name,
    s.id AS state_id,
    COUNT(*) AS total_pus,
    COUNT(*) FILTER (WHERE rs.status = 'VERIFIED') AS verified,
    COUNT(*) FILTER (WHERE rs.status = 'RESULT_SUBMITTED') AS submitted,
    COUNT(*) FILTER (WHERE rs.status = 'DISPUTED') AS disputed,
    COUNT(*) FILTER (WHERE rs.status = 'DISRUPTED') AS disrupted
  FROM result_submissions rs
  INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id
  INNER JOIN states s ON s.id = pu.state_id
  GROUP BY s.id, s.name
  ORDER BY total_pus DESC;
$$;

GRANT EXECUTE ON FUNCTION get_state_breakdown_from_results() TO anon, service_role;
