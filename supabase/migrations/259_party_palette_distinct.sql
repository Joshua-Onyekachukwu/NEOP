-- ============================================================
-- NEOP 259 — ONE VISUALLY DISTINCT COLOUR PER PARTY
--
-- Product rule: no two parties may share a colour family, so a viewer can
-- identify any party at a glance on the dark leaderboard, the map legend
-- and the state breakdown.
--
-- Two violations existed before:
--   · NNPP #E53935 and LP #FF0000 were both red.
--   · SDP #1565C0 and PDP #000080 were both blue.
-- NNPP moves to orange and SDP to sky blue, leaving nine well-separated
-- hues (white, green, navy, red, orange, yellow, sky, teal, violet).
--
-- public.parties.color is what the live site actually renders, so this is
-- the authoritative palette; apps/web/src/lib/party-config.ts carries the
-- same values as the offline fallback.
-- ============================================================

UPDATE public.parties SET color = '#FFFFFF' WHERE abbreviation = 'NDC';
UPDATE public.parties SET color = '#00A859' WHERE abbreviation = 'APC';
UPDATE public.parties SET color = '#000080' WHERE abbreviation = 'PDP';
UPDATE public.parties SET color = '#FF0000' WHERE abbreviation = 'LP';
UPDATE public.parties SET color = '#FF6D00' WHERE abbreviation = 'NNPP';
UPDATE public.parties SET color = '#FFD600' WHERE abbreviation = 'APGA';
UPDATE public.parties SET color = '#00B0FF' WHERE abbreviation = 'SDP';
UPDATE public.parties SET color = '#6A1B9A' WHERE abbreviation = 'YPP';
UPDATE public.parties SET color = '#00838F' WHERE abbreviation = 'ADC';
