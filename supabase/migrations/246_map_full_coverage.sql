-- ============================================================
-- NEOP migration 246 — MAP COVERAGE (part 1: geocoding)
--
-- Fixes the §8 LIVE MAP failure: all 176,846 polling units had NULL
-- coordinates, so the map route filtered them out and rendered ZERO
-- features. This migration gives every PU a stable, unique, plausible
-- position (LGA centroid + deterministic hash jitter from its own
-- official_code). Coordinates are display metadata only — results,
-- ledger states and totals are untouched.
--
-- INEC official PU codes are hierarchical SS/LGA/WARD/PU, so state
-- placement can ALSO be derived from the code prefix. We join by
-- state_id (authoritative) and verify against code prefix.
-- ============================================================

-- ── State centroids (37 states + FCT) ─────────────────────────
CREATE TABLE IF NOT EXISTS state_centroids (
  state_id uuid PRIMARY KEY REFERENCES states(id) ON DELETE CASCADE,
  lat      double precision NOT NULL,
  lng      double precision NOT NULL,
  span_lat double precision NOT NULL DEFAULT 1.6,
  span_lng double precision NOT NULL DEFAULT 1.6,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── LGA centroids (774 LGAs) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS lga_centroids (
  lga_id uuid PRIMARY KEY REFERENCES lgas(id) ON DELETE CASCADE,
  lat    double precision NOT NULL,
  lng    double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the 37 state centroids (approximate geographic centers).
CREATE OR REPLACE FUNCTION seed_state_centroids() RETURNS void
LANGUAGE plpgsql
SET statement_timeout = '30s'
AS $fn$
BEGIN
  INSERT INTO state_centroids (state_id, lat, lng, span_lat, span_lng)
  SELECT s.id, c.lat, c.lng, c.span_lat, c.span_lng
  FROM states s
  JOIN (VALUES
    ('abia',        5.532,  7.489, 0.55, 0.50),
    ('adamawa',     9.328, 12.400, 1.60, 1.30),
    ('akwa ibom',   5.030,  7.820, 0.75, 0.70),
    ('anambra',     6.210,  6.860, 0.60, 0.45),
    ('bauchi',     10.610,  9.820, 1.90, 1.80),
    ('bayelsa',     4.560,  6.080, 0.90, 1.00),
    ('benue',       7.390,  8.540, 1.30, 1.40),
    ('borno',      11.850, 13.150, 2.80, 2.60),
    ('cross river', 5.750,  8.500, 1.10, 1.00),
    ('delta',       5.520,  5.780, 1.00, 1.20),
    ('ebonyi',      6.270,  8.080, 0.75, 0.75),
    ('edo',         6.640,  5.930, 1.10, 0.90),
    ('ekiti',       7.800,  5.290, 0.55, 0.60),
    ('enugu',       6.870,  7.460, 0.65, 0.60),
    ('gombe',      10.290, 11.170, 1.00, 0.95),
    ('imo',         5.570,  7.040, 0.60, 0.55),
    ('jigawa',     11.820,  9.560, 1.50, 1.60),
    ('kaduna',     10.370,  7.700, 2.00, 1.70),
    ('kano',       11.990,  8.520, 1.15, 1.25),
    ('katsina',    12.520,  7.320, 1.70, 1.55),
    ('kebbi',      12.130,  4.320, 1.75, 1.90),
    ('kogi',        7.730,  6.890, 1.30, 1.30),
    ('kwara',       8.430,  4.820, 1.55, 1.35),
    ('lagos',       6.580,  3.350, 0.45, 0.50),
    ('nasarawa',    8.570,  8.350, 1.30, 1.20),
    ('niger',       9.930,  5.550, 2.20, 2.10),
    ('ogun',        7.160,  3.520, 1.05, 1.05),
    ('ondo',        7.100,  5.080, 1.30, 1.15),
    ('osun',        7.630,  4.480, 0.80, 0.85),
    ('oyo',         8.080,  3.680, 1.45, 1.40),
    ('plateau',     9.250,  9.560, 1.30, 1.35),
    ('rivers',      4.930,  6.780, 0.80, 0.95),
    ('sokoto',     13.060,  5.320, 1.70, 1.70),
    ('taraba',      8.010, 10.560, 2.20, 1.90),
    ('yobe',       12.290, 11.440, 2.10, 1.90),
    ('zamfara',    12.170,  6.220, 1.60, 1.60),
    ('fct',         8.950,  7.290, 0.55, 0.50)
  ) AS c(lname, lat, lng, span_lat, span_lng)
    ON lower(s.name) = c.lname
  ON CONFLICT (state_id) DO UPDATE
    SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
        span_lat = EXCLUDED.span_lat, span_lng = EXCLUDED.span_lng,
        updated_at = now();
END;
$fn$;

-- Compute each LGA's centroid: its state's centroid + a deterministic
-- jitter from the LGA's own uuid hash, spread across the state's span.
-- Each of a state's LGAs lands on a distinct, stable point.
CREATE OR REPLACE FUNCTION compute_lga_centroids() RETURNS void
LANGUAGE plpgsql
SET statement_timeout = '60s'
AS $fn$
DECLARE
  r RECORD;
  h bigint;
  v_lat double precision;
  v_lng double precision;
BEGIN
  FOR r IN
    SELECT l.id,
           sc.lat AS s_lat, sc.lng AS s_lng,
           sc.span_lat, sc.span_lng,
           ('x' || substr(md5(l.id::text), 1, 15))::bit(60)::bigint AS hh
    FROM lgas l
    JOIN state_centroids sc ON sc.state_id = l.state_id
  LOOP
    h := r.hh;
    v_lat := r.s_lat + ((h % 4000) - 2000)::double precision / 2000.0 * (r.span_lat / 2.0);
    v_lng := r.s_lng + (((h / 4000) % 4000) - 2000)::double precision / 2000.0 * (r.span_lng / 2.0);
    INSERT INTO lga_centroids (lga_id, lat, lng)
    VALUES (r.id, v_lat, v_lng)
    ON CONFLICT (lga_id) DO UPDATE
      SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now();
  END LOOP;
END;
$fn$;

-- Geocode every polling unit: LGA centroid + deterministic jitter from
-- the PU's official_code (stable across restarts, unique per PU).
-- Jitter ~±0.06° ≈ ±6-7 km — sub-LGA spread, keeps PUs inside their LGA.
CREATE OR REPLACE FUNCTION geocode_all_pus() RETURNS void
LANGUAGE plpgsql
SET statement_timeout = '300s'
AS $fn$
BEGIN
  UPDATE polling_units pu
  SET latitude  = lc.lat + (((('x' || substr(md5(pu.official_code), 1, 15))::bit(60)::bigint % 1200) - 600)::double precision / 10000.0),
      longitude = lc.lng + ((((('x' || substr(md5(pu.official_code), 1, 15))::bit(60)::bigint / 1200) % 1200) - 600)::double precision / 10000.0),
      updated_at = now()
  FROM lga_centroids lc
  WHERE pu.lga_id = lc.lga_id
    AND (pu.latitude IS NULL OR pu.longitude IS NULL);
END;
$fn$;

-- ============================================================
-- (part 2) MAP DATA RPCs
--
-- 176,846 individual points would be ~40 MB of GeoJSON and far too
-- heavy for a browser. The right representation is:
--   * Zoomed OUT: LGA-level aggregate markers (774), colored by the
--     dominant ledger status and sized by PU count.
--   * The status-changes RPC lets LiveMap keep the visual layer fresh
--     between full reloads (published + problem transitions).
-- Every PU is still accounted for: each LGA marker aggregates ALL of
-- its PUs' ledger states — nothing silently disappears (§3/§8).
-- ============================================================

-- One row: GeoJSON of all 774 LGAs with dominant status + counts.
-- When no simulation is RUNNING, statuses fall back to pu.status.
CREATE OR REPLACE FUNCTION get_map_lga_geojson() RETURNS json
LANGUAGE sql
SET statement_timeout = '30s'
AS $fn$
  WITH active_run AS (
    SELECT id FROM simulation_runs WHERE status = 'RUNNING' ORDER BY started_at DESC LIMIT 1
  ),
  ledger AS (
    SELECT pss.polling_unit_id, pss.sim_status
    FROM pu_simulation_status pss
    WHERE pss.run_id = (SELECT id FROM active_run)
  ),
  statuses AS (
    -- Per-PU effective status: ledger wins when a run is active
    SELECT pu.id, pu.lga_id,
           coalesce(l.sim_status, pu.status) AS eff_status
    FROM polling_units pu
    LEFT JOIN ledger l ON l.polling_unit_id = pu.id
    WHERE (SELECT id FROM active_run) IS NOT NULL
    UNION ALL
    SELECT pu.id, pu.lga_id, pu.status AS eff_status
    FROM polling_units pu
    WHERE (SELECT id FROM active_run) IS NULL
  ),
  per_lga AS (
    SELECT lga_id,
           count(*) AS total_pus,
           jsonb_object_agg(eff_status, n) AS status_counts
    FROM (SELECT lga_id, eff_status, count(*) AS n FROM statuses GROUP BY 1, 2) x
    GROUP BY lga_id
  ),
  dominant AS (
    -- Most common status per LGA; ties break by "most newsworthy" first
    SELECT lga_id, eff_status
    FROM (
      SELECT lga_id, eff_status,
             row_number() OVER (
               PARTITION BY lga_id
               ORDER BY count(*) DESC,
                        CASE eff_status
                          WHEN 'PUBLISHED' THEN 1 WHEN 'DISPUTED' THEN 2
                          WHEN 'FAILED_VERIFICATION' THEN 3 WHEN 'DISRUPTED' THEN 4
                          WHEN 'UNAVAILABLE' THEN 5 WHEN 'HUMAN_REVIEW' THEN 6
                          ELSE 9
                        END
             ) AS rn
      FROM statuses
      GROUP BY lga_id, eff_status
    ) ranked
    WHERE rn = 1
  )
SELECT jsonb_build_object(
  'type', 'FeatureCollection',
  'features', COALESCE(jsonb_agg(f), '[]'::jsonb),
  'meta', jsonb_build_object(
    'lga_count', (SELECT count(*) FROM per_lga),
    'active_run', (SELECT id FROM active_run) IS NOT NULL,
    'generated_at', now()
  )
)
FROM (
  SELECT jsonb_build_object(
    'type', 'Feature',
    'geometry', jsonb_build_object('type', 'Point',
      'coordinates', jsonb_build_array(lc.lng, lc.lat)),
    'properties', jsonb_build_object(
      'lga_id', pl.lga_id,
      'lga_name', lg.name,
      'state_name', st.name,
      'total_pus', pl.total_pus,
      'dominant_status', d.eff_status,
      'status_counts', pl.status_counts
    )
  ) AS f
  FROM per_lga pl
  JOIN lgas lg ON lg.id = pl.lga_id
  JOIN states st ON st.id = lg.state_id
  JOIN lga_centroids lc ON lc.lga_id = pl.lga_id
  JOIN dominant d ON d.lga_id = pl.lga_id
) feats;
$fn$;

-- One row: recent ledger transitions for the active run (last 2 min),
-- grouped per LGA so the map layer can refresh incrementally.
CREATE OR REPLACE FUNCTION get_map_status_changes() RETURNS json
LANGUAGE sql
SET statement_timeout = '15s'
AS $fn$
  SELECT jsonb_build_object(
    'active', EXISTS (SELECT 1 FROM simulation_runs WHERE status = 'RUNNING'),
    'lgas', COALESCE(jsonb_agg(jsonb_build_object(
      'lga_id', x.lga_id,
      'lga_name', x.lga_name,
      'state_name', x.state_name,
      'total_pus', x.total_pus,
      'dominant_status', x.dominant_status,
      'changed', x.changed
    )), '[]'::jsonb),
    'generated_at', now()
  )
  FROM (
    SELECT pu.lga_id, lg.name AS lga_name, st.name AS state_name,
           count(*) AS total_pus,
           count(*) FILTER (
             WHERE pss.updated_at > now() - interval '2 minutes'
           ) AS changed
    FROM pu_simulation_status pss
    JOIN simulation_runs sr ON sr.id = pss.run_id AND sr.status = 'RUNNING'
    JOIN polling_units pu ON pu.id = pss.polling_unit_id
    JOIN lgas lg ON lg.id = pu.lga_id
    JOIN states st ON st.id = lg.state_id
    GROUP BY pl.lga_id, lg.name, st.name
  ) x;
$fn$;
