-- Fast stats functions for VoteWatch Nigeria
-- Run this in Supabase SQL Editor

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_state_breakdown();

-- Returns state breakdown in a single query (no row-by-row fetching)
CREATE OR REPLACE FUNCTION get_state_breakdown()
RETURNS TABLE (
  state_id UUID,
  state_name TEXT,
  state_code TEXT,
  total_polling_units BIGINT,
  covered_polling_units BIGINT,
  verified_polling_units BIGINT,
  coverage_percent NUMERIC,
  verification_percent NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH state_pu_counts AS (
    SELECT 
      pu.state_id,
      COUNT(*) AS total_pu
    FROM polling_units pu
    GROUP BY pu.state_id
  ),
  state_covered AS (
    SELECT 
      pu.state_id,
      COUNT(DISTINCT pu.id) AS covered
    FROM polling_units pu
    INNER JOIN agent_assignments aa ON aa.polling_unit_id = pu.id
    GROUP BY pu.state_id
  ),
  state_verified AS (
    SELECT 
      rs.polling_unit_id,
      pu.state_id
    FROM result_submissions rs
    INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id
    WHERE rs.status = 'VERIFIED'
  ),
  state_verified_counts AS (
    SELECT 
      sv.state_id,
      COUNT(DISTINCT sv.polling_unit_id) AS verified
    FROM state_verified sv
    GROUP BY sv.state_id
  )
  SELECT 
    spc.state_id,
    st.name AS state_name,
    st.code AS state_code,
    spc.total_pu AS total_polling_units,
    COALESCE(sc.covered, 0) AS covered_polling_units,
    COALESCE(svc.verified, 0) AS verified_polling_units,
    CASE WHEN spc.total_pu > 0 
      THEN ROUND((COALESCE(sc.covered, 0)::NUMERIC / spc.total_pu) * 100, 1)
      ELSE 0 
    END AS coverage_percent,
    CASE WHEN spc.total_pu > 0 
      THEN ROUND((COALESCE(svc.verified, 0)::NUMERIC / spc.total_pu) * 100, 1)
      ELSE 0 
    END AS verification_percent
  FROM state_pu_counts spc
  INNER JOIN states st ON st.id = spc.state_id
  LEFT JOIN state_covered sc ON sc.state_id = spc.state_id
  LEFT JOIN state_verified_counts svc ON svc.state_id = spc.state_id
  ORDER BY spc.total_pu DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Drop and recreate party totals function
DROP FUNCTION IF EXISTS get_party_totals();

CREATE OR REPLACE FUNCTION get_party_totals()
RETURNS TABLE (
  party_name TEXT,
  party_abbreviation TEXT,
  party_color TEXT,
  total_votes BIGINT,
  percentage NUMERIC
) AS $$
DECLARE
  grand_total BIGINT;
BEGIN
  SELECT COALESCE(SUM(pr.votes), 0) INTO grand_total
  FROM party_results pr;

  RETURN QUERY
  SELECT 
    p.official_name AS party_name,
    p.abbreviation AS party_abbreviation,
    p.color AS party_color,
    COALESCE(SUM(pr.votes), 0) AS total_votes,
    CASE WHEN grand_total > 0 
      THEN ROUND((COALESCE(SUM(pr.votes), 0)::NUMERIC / grand_total) * 100, 1)
      ELSE 0 
    END AS percentage
  FROM parties p
  LEFT JOIN party_results pr ON pr.party_id = p.id
  GROUP BY p.id, p.official_name, p.abbreviation, p.color
  ORDER BY total_votes DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute to anon and service_role
GRANT EXECUTE ON FUNCTION get_state_breakdown() TO anon;
GRANT EXECUTE ON FUNCTION get_state_breakdown() TO service_role;
GRANT EXECUTE ON FUNCTION get_party_totals() TO anon;
GRANT EXECUTE ON FUNCTION get_party_totals() TO service_role;
