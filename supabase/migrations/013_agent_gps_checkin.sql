-- Add GPS tracking to agent check-ins
ALTER TABLE agent_assignments ADD COLUMN IF NOT EXISTS check_in_lat DOUBLE PRECISION;
ALTER TABLE agent_assignments ADD COLUMN IF NOT EXISTS check_in_lng DOUBLE PRECISION;
ALTER TABLE agent_assignments ADD COLUMN IF NOT EXISTS check_in_accuracy DOUBLE PRECISION;
ALTER TABLE agent_assignments ADD COLUMN IF NOT EXISTS distance_from_pu DOUBLE PRECISION;
ALTER TABLE agent_assignments ADD COLUMN IF NOT EXISTS location_verified BOOLEAN DEFAULT false;

-- Function to calculate distance between two GPS points (Haversine)
CREATE OR REPLACE FUNCTION haversine_distance(
  lat1 DOUBLE PRECISION, lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lon2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
DECLARE
  R DOUBLE PRECISION := 6371000; -- Earth radius in meters
  dlat DOUBLE PRECISION;
  dlon DOUBLE PRECISION;
  a DOUBLE PRECISION;
  c DOUBLE PRECISION;
BEGIN
  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);
  a := sin(dlat / 2) ^ 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ^ 2;
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  RETURN R * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function for admin to see all agent locations
CREATE OR REPLACE FUNCTION get_agent_locations()
RETURNS TABLE (
  assignment_id UUID,
  volunteer_name TEXT,
  polling_unit_name TEXT,
  polling_unit_code TEXT,
  state_name TEXT,
  check_in_lat DOUBLE PRECISION,
  check_in_lng DOUBLE PRECISION,
  check_in_accuracy DOUBLE PRECISION,
  distance_from_pu DOUBLE PRECISION,
  location_verified BOOLEAN,
  checked_in_at TIMESTAMPTZ,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    aa.id as assignment_id,
    COALESCE(ua.full_name, 'Unknown') as volunteer_name,
    COALESCE(pu.name, 'Unknown') as polling_unit_name,
    COALESCE(pu.official_code, '—') as polling_unit_code,
    COALESCE(st.name, 'Unknown') as state_name,
    aa.check_in_lat,
    aa.check_in_lng,
    aa.check_in_accuracy,
    aa.distance_from_pu,
    aa.location_verified,
    aa.checked_in_at,
    aa.status
  FROM agent_assignments aa
  LEFT JOIN volunteers v ON v.id = aa.volunteer_id
  LEFT JOIN user_accounts ua ON ua.id = v.user_id
  LEFT JOIN polling_units pu ON pu.id = aa.polling_unit_id
  LEFT JOIN states st ON st.id = pu.state_id
  WHERE aa.status = 'CHECKED_IN'
    AND aa.check_in_lat IS NOT NULL
    AND aa.check_in_lng IS NOT NULL
  ORDER BY aa.checked_in_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION haversine_distance(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, service_role;
GRANT EXECUTE ON FUNCTION get_agent_locations() TO service_role;
