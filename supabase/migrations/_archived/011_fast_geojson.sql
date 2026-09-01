-- Drop the old slow RPC function that tries to build a single JSONB blob
-- and replace with a fast TABLE-returning function

DROP FUNCTION IF EXISTS get_polling_units_geojson();

-- Returns polling units as rows (no JSONB aggregation)
-- This lets the API route build GeoJSON in JS, avoiding the statement timeout
CREATE OR REPLACE FUNCTION get_polling_unit_rows()
RETURNS TABLE (
  id UUID,
  official_code TEXT,
  name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  status TEXT,
  state_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pu.id,
    pu.official_code,
    pu.name,
    pu.latitude,
    pu.longitude,
    pu.status,
    COALESCE(st.name, 'Unknown') as state_name
  FROM polling_units pu
  LEFT JOIN states st ON st.id = pu.state_id
  WHERE pu.latitude IS NOT NULL AND pu.longitude IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Optimized party totals (handles duplicate abbreviations from multiple elections)
DROP FUNCTION IF EXISTS get_party_totals();
CREATE OR REPLACE FUNCTION get_party_totals()
RETURNS TABLE (
  party_name TEXT,
  party_abbreviation TEXT,
  party_color TEXT,
  total_votes BIGINT,
  percentage NUMERIC
) AS $$
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
    FROM ps
    GROUP BY abbreviation
  )
  SELECT d.official_name, d.abbreviation, d.color, d.votes,
    CASE WHEN gt > 0 THEN ROUND((d.votes::NUMERIC / gt) * 100, 1) ELSE 0 END
  FROM dd d
  ORDER BY d.votes DESC;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_polling_unit_rows() TO anon, service_role;
GRANT EXECUTE ON FUNCTION get_party_totals() TO anon, service_role;
