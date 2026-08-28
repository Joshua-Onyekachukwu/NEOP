-- Returns all polling units as GeoJSON FeatureCollection in a single query.
-- Bypasses the PostgREST 1000-row limit.

DROP FUNCTION IF EXISTS get_polling_units_geojson();

CREATE OR REPLACE FUNCTION get_polling_units_geojson()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'geometry', jsonb_build_object(
          'type', 'Point',
          'coordinates', jsonb_build_array(pu.longitude, pu.latitude)
        ),
        'properties', jsonb_build_object(
          'id', pu.id,
          'official_code', pu.official_code,
          'name', pu.name,
          'status', pu.status,
          'state_name', COALESCE(st.name, 'Unknown')
        )
      )
    )
  ) INTO result
  FROM polling_units pu
  LEFT JOIN states st ON st.id = pu.state_id
  WHERE pu.latitude IS NOT NULL
    AND pu.longitude IS NOT NULL;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Also create a function for active status changes (not NOT_STARTED)
DROP FUNCTION IF EXISTS get_active_polling_units();

CREATE OR REPLACE FUNCTION get_active_polling_units()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT jsonb_build_object(
    'active', COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', pu.id,
        'status', pu.status,
        'latitude', pu.latitude,
        'longitude', pu.longitude
      )
    ), '[]'::jsonb),
    'count', COUNT(*),
    'timestamp', EXTRACT(EPOCH FROM now()) * 1000
  ) INTO result
  FROM polling_units pu
  WHERE pu.latitude IS NOT NULL
    AND pu.longitude IS NOT NULL
    AND pu.status != 'NOT_STARTED';

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_polling_units_geojson() TO anon;
GRANT EXECUTE ON FUNCTION get_polling_units_geojson() TO service_role;
GRANT EXECUTE ON FUNCTION get_active_polling_units() TO anon;
GRANT EXECUTE ON FUNCTION get_active_polling_units() TO service_role;
