-- ============================================================
-- NEOP 254 — PARTY COLOR DIFFERENTIATION + MIGRATION BACKFILL
--
-- Problem: NDC (#1B5E20) and APC (#00A859) were both green —
-- indistinguishable on the leaderboard at a glance.
--
-- New palette: every party visually distinct. NDC → pure white
-- (stands out on the dark leaderboard, reads as "neutral flag"),
-- APC keeps bright green, PDP/SDP blues, LP/NNPP reds, APGA gold,
-- YPP violet, ADC teal.
--
-- Also syncs the TS fallbacks (party-config.ts, PartyResults
-- defaults) which previously drifted from the DB.
-- ============================================================

UPDATE parties
SET color = CASE abbreviation
  WHEN 'ADC'  THEN '#00838F'
  WHEN 'APC'  THEN '#00A859'
  WHEN 'APGA' THEN '#FFD600'
  WHEN 'LP'   THEN '#FF0000'
  WHEN 'NDC'  THEN '#FFFFFF'
  WHEN 'NNPP' THEN '#E53935'
  WHEN 'PDP'  THEN '#000080'
  WHEN 'SDP'  THEN '#1565C0'
  WHEN 'YPP'  THEN '#6A1B9A'
END,
updated_at = now()
WHERE abbreviation IN ('ADC','APC','APGA','LP','NDC','NNPP','PDP','SDP','YPP');
