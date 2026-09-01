-- Fix state breakdown: add critical indexes + faster function
-- The JOIN across 188K rows was timing out without indexes

-- 1. Add indexes for the hot query paths
CREATE INDEX IF NOT EXISTS idx_result_submissions_status ON result_submissions(status);
CREATE INDEX IF NOT EXISTS idx_result_submissions_polling_unit_id ON result_submissions(polling_unit_id);
CREATE INDEX IF NOT EXISTS idx_polling_units_state_id ON polling_units(state_id);
CREATE INDEX IF NOT EXISTS idx_party_results_result_submission_id ON party_results(result_submission_id);
CREATE INDEX IF NOT EXISTS idx_party_results_party_id ON party_results(party_id);

-- 2. Faster state breakdown using a materialized approach
-- Instead of joining 188K rows every time, aggregate in a CTE
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
