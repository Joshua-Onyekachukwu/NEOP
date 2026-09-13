-- ============================================================
-- NEOP 238 — SIM DISPLAY MULTIPLIER + PUBLIC RESULTS VIEW FIX
--
-- 1. system_config.display_multiplier
--    The simulation backend stores REAL vote counts (kept small so the
--    Free-plan 500MB DB quota is never hit), while the public site can
--    render them scaled (e.g. ×10) for a realistic national headline.
--    The scale applies ONLY while data_mode = 'SIMULATED'; live
--    elections always use 1 (no scaling).
--
-- 2. mv_public_published_results view fix
--    getCachedPublicResults selects `canonical_result_id` and `pu_name`,
--    but the view exposed `id` and `polling_unit_name` — every feed
--    query failed and fell back to empty results. Recreate the view
--    with both aliases.
-- ============================================================

ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS display_multiplier NUMERIC NOT NULL DEFAULT 1;

DROP VIEW IF EXISTS mv_public_published_results;
CREATE VIEW mv_public_published_results AS
SELECT
  cr.id,
  cr.id AS canonical_result_id,
  cr.election_id,
  pu.id AS polling_unit_id,
  pu.official_code AS official_code,
  pu.name AS pu_name,
  pu.name AS polling_unit_name,
  pu.state_id,
  s.name AS state_name,
  pu.lga_id,
  lg.name AS lga_name,
  pu.ward_id,
  w.name AS ward_name,
  pu.latitude,
  pu.longitude,
  pu.registered_voters,
  cr.status,
  cr.valid_votes,
  cr.rejected_votes,
  cr.total_votes,
  cr.published_at,
  cr.source_submission_1,
  cr.source_submission_2
FROM canonical_pu_results cr
JOIN polling_units pu ON pu.id = cr.polling_unit_id
LEFT JOIN states s ON s.id = pu.state_id
LEFT JOIN lgas lg ON lg.id = pu.lga_id
LEFT JOIN wards w ON w.id = pu.ward_id
WHERE cr.status = 'PUBLISHED';