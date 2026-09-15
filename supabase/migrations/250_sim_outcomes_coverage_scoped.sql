-- ============================================================
-- NEOP 250 — SIMULATION OUTCOMES SCOPED TO ENGINE COVERAGE
--
-- Problem: assign_simulation_outcomes applied the dispute/failed/
-- disrupted profile across the ENTIRE 176,846-PU universe while the
-- wave engine only publishes within its coverage scope. With coverage
-- < 100% every LGA's dominant ledger status became HUMAN_REVIEW and
-- the live map rendered orange everywhere — even LGAs full of green
-- published results.
--
-- Fix:
--   1. The profile now applies ONLY to PUs inside the engine scope
--      (hashtext(pu.id) % 100 < coverage_pct) — the exact predicate
--      neop_sim_wave uses to pick its PUs.
--   2. New p_coverage_pct parameter binds the route's launch coverage
--      to the ledger assignment, so the two always agree.
--   3. PUs outside scope stay AWAITING during the run (gray on the
--      map) and become UNAVAILABLE only at finalize, keeping 100%
--      ledger accounting at run end.
--
-- Also fixes the map dominant-status pick: get_map_lga_geojson now
-- selects the dominant status among REPORTED (non-AWAITING) statuses
-- only, so LGAs light up green as results publish instead of every
-- LGA reading "awaiting" during a partial-coverage run.
-- ============================================================

-- 1. Outcome assignment scoped to engine coverage
CREATE OR REPLACE FUNCTION public.assign_simulation_outcomes(
  p_run uuid,
  p_dispute_rate numeric DEFAULT 0.05,
  p_failed_rate numeric DEFAULT 0.015,
  p_disrupted_rate numeric DEFAULT 0.02,
  p_unavailable_rate numeric DEFAULT 0.01,
  p_max_published_pct numeric DEFAULT 0.95,
  p_coverage_pct int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_disp int; v_fail int; v_disr int; v_un int; v_scope int;
  v_cov int := GREATEST(1, LEAST(100, COALESCE(p_coverage_pct, 50)));
BEGIN
  UPDATE pu_simulation_status s
     SET sim_status = 'HUMAN_REVIEW', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND NOT s.outcome_assigned
     AND ((hashtext(s.polling_unit_id::text) & 2147483647) % 100) < v_cov
     AND ((hashtext(s.polling_unit_id::text || 'd1') & 2147483647) % 1000)
         < ROUND(p_dispute_rate * 1000);
  GET DIAGNOSTICS v_disp = ROW_COUNT;

  UPDATE pu_simulation_status s
     SET sim_status = 'FAILED_VERIFICATION', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND NOT s.outcome_assigned
     AND ((hashtext(s.polling_unit_id::text) & 2147483647) % 100) < v_cov
     AND ((hashtext(s.polling_unit_id::text || 'fv') & 2147483647) % 1000)
         < ROUND(p_failed_rate * 1000);
  GET DIAGNOSTICS v_fail = ROW_COUNT;

  UPDATE pu_simulation_status s
     SET sim_status = 'DISRUPTED', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND NOT s.outcome_assigned
     AND ((hashtext(s.polling_unit_id::text) & 2147483647) % 100) < v_cov
     AND ((hashtext(s.polling_unit_id::text || 'dz') & 2147483647) % 1000)
         < ROUND(p_disrupted_rate * 1000);
  GET DIAGNOSTICS v_disr = ROW_COUNT;

  UPDATE pu_simulation_status s
     SET sim_status = 'UNAVAILABLE', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND NOT s.outcome_assigned
     AND ((hashtext(s.polling_unit_id::text) & 2147483647) % 100) < v_cov
     AND ((hashtext(s.polling_unit_id::text || 'un') & 2147483647) % 1000)
         < ROUND(p_unavailable_rate * 1000);
  GET DIAGNOSTICS v_un = ROW_COUNT;

  WITH pool AS (
    SELECT id, polling_unit_id,
           row_number() OVER (ORDER BY (hashtext(polling_unit_id::text || 'pub') & 2147483647)) AS rn,
           count(*) OVER () AS n
    FROM pu_simulation_status
    WHERE run_id = p_run AND sim_status = 'AWAITING'
      AND ((hashtext(polling_unit_id::text) & 2147483647) % 100) < v_cov
  )
  UPDATE pu_simulation_status s
     SET planned_published = true
    FROM pool x
   WHERE s.id = x.id
     AND x.rn <= floor(x.n * LEAST(1.0, GREATEST(0.0, p_max_published_pct)));

  SELECT count(*) INTO v_scope FROM pu_simulation_status
   WHERE run_id = p_run AND (planned_published OR outcome_assigned);

  UPDATE simulation_runs
     SET dispute_pus = v_disp, failed_pus = v_fail,
         disrupted_pus = v_disr, unavailable_pus = v_un
   WHERE id = p_run;

  RETURN jsonb_build_object(
    'run_id', p_run, 'disputed', v_disp, 'failed', v_fail,
    'disrupted', v_disr, 'unavailable', v_un,
    'in_engine_scope', v_scope, 'coverage_pct', v_cov);
END $function$;

-- 2. Map GeoJSON: dominant status among REPORTED statuses only;
--    LGAs with nothing reported keep 'AWAITING' (gray)
CREATE OR REPLACE FUNCTION public.get_map_lga_geojson()
 RETURNS json
 LANGUAGE sql
 SET statement_timeout TO '30s'
AS $function$
  WITH active_run AS (
    SELECT id FROM simulation_runs WHERE status = 'RUNNING' ORDER BY started_at DESC LIMIT 1
  ),
  ledger AS (
    SELECT pss.polling_unit_id, pss.sim_status
    FROM pu_simulation_status pss
    WHERE pss.run_id = (SELECT id FROM active_run)
  ),
  statuses AS (
    SELECT pu.id, pu.lga_id,
           coalesce(l.sim_status, 'AWAITING') AS eff_status
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
           sum(n) AS total_pus,
           sum(n) FILTER (WHERE eff_status NOT IN ('AWAITING')) AS reported_pus,
           jsonb_object_agg(eff_status, n) AS status_counts
    FROM (SELECT lga_id, eff_status, count(*) AS n FROM statuses GROUP BY 1, 2) x
    GROUP BY lga_id
  ),
  dominant AS (
    SELECT lga_id, eff_status
    FROM (
      SELECT lga_id, eff_status,
             row_number() OVER (
               PARTITION BY lga_id
               ORDER BY count(*) DESC,
                        CASE eff_status
                          WHEN 'PUBLISHED' THEN 1 WHEN 'HUMAN_REVIEW' THEN 2
                          WHEN 'FAILED_VERIFICATION' THEN 3 WHEN 'DISRUPTED' THEN 4
                          WHEN 'UNAVAILABLE' THEN 5
                          ELSE 9
                        END
             ) AS rn
      FROM statuses
      WHERE eff_status <> 'AWAITING'
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
      'reported_pus', pl.reported_pus,
      'dominant_status', coalesce(d.eff_status, 'AWAITING'),
      'status_counts', pl.status_counts
    )
  ) AS f
  FROM per_lga pl
  JOIN lgas lg ON lg.id = pl.lga_id
  JOIN states st ON st.id = lg.state_id
  JOIN lga_centroids lc ON lc.lga_id = pl.lga_id
  LEFT JOIN dominant d ON d.lga_id = pl.lga_id
) feats;
$function$;
