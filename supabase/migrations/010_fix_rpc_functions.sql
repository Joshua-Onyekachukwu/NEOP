-- Fixed SQL functions — run this in Supabase SQL Editor to replace existing ones

-- Reset function
CREATE OR REPLACE FUNCTION reset_simulation_data()
RETURNS TEXT AS $$
BEGIN
  TRUNCATE party_results, result_submissions CASCADE;
  RETURN 'CLEARED';
END;
$$ LANGUAGE plpgsql;

-- State breakdown — single query, no 1000-row limit
DROP FUNCTION IF EXISTS get_state_breakdown();
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

-- Party totals — deduplicate by abbreviation (take the party_id with most votes)
DROP FUNCTION IF EXISTS get_party_totals();
CREATE OR REPLACE FUNCTION get_party_totals()
RETURNS TABLE (party_name TEXT, party_abbreviation TEXT, party_color TEXT, total_votes BIGINT, percentage NUMERIC) AS $$
DECLARE gt BIGINT;
BEGIN
  SELECT COALESCE(SUM(pr.votes), 0) INTO gt FROM party_results pr;
  RETURN QUERY
  WITH party_sums AS (
    SELECT p.official_name, p.abbreviation, p.color, SUM(pr.votes) AS votes
    FROM parties p
    INNER JOIN party_results pr ON pr.party_id = p.id
    GROUP BY p.id, p.official_name, p.abbreviation, p.color
  ),
  deduped AS (
    SELECT abbreviation, MAX(official_name) AS official_name, MAX(color) AS color, MAX(votes) AS votes
    FROM party_sums
    GROUP BY abbreviation
  )
  SELECT d.official_name, d.abbreviation, d.color, d.votes,
    CASE WHEN gt > 0 THEN ROUND((d.votes::NUMERIC / gt) * 100, 1) ELSE 0 END
  FROM deduped d
  ORDER BY d.votes DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- GeoJSON — single query
DROP FUNCTION IF EXISTS get_polling_units_geojson();
CREATE OR REPLACE FUNCTION get_polling_units_geojson()
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'geometry', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(pu.longitude, pu.latitude)),
        'properties', jsonb_build_object('id', pu.id, 'official_code', pu.official_code, 'name', pu.name, 'status', pu.status, 'state_name', COALESCE(st.name, 'Unknown'))
      ))
    )
    FROM polling_units pu LEFT JOIN states st ON st.id = pu.state_id
    WHERE pu.latitude IS NOT NULL AND pu.longitude IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Active polling units
DROP FUNCTION IF EXISTS get_active_polling_units();
CREATE OR REPLACE FUNCTION get_active_polling_units()
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'active', COALESCE(jsonb_agg(jsonb_build_object('id', pu.id, 'status', pu.status, 'latitude', pu.latitude, 'longitude', pu.longitude)), '[]'::jsonb),
      'count', COUNT(*), 'timestamp', EXTRACT(EPOCH FROM now()) * 1000
    )
    FROM polling_units pu
    WHERE pu.latitude IS NOT NULL AND pu.longitude IS NOT NULL AND pu.status != 'NOT_STARTED'
  );
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION reset_simulation_data() TO service_role;
GRANT EXECUTE ON FUNCTION get_state_breakdown() TO anon, service_role;
GRANT EXECUTE ON FUNCTION get_party_totals() TO anon, service_role;
GRANT EXECUTE ON FUNCTION get_polling_units_geojson() TO anon, service_role;
GRANT EXECUTE ON FUNCTION get_active_polling_units() TO anon, service_role;
