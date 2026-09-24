-- ============================================================
-- NEOP 294 — INEC CONNECTOR LEAST PRIVILEGE + ACCEPT-FN REASSERTION
-- ============================================================
-- Phase K finding: `inec_feed_raw` and `inec_ingest_config` had RLS enabled
-- with zero policies (so no rows were ever returned to anon/authenticated),
-- but they still carried the project's default table-level GRANTs to `anon`
-- and `authenticated` — including INSERT/UPDATE/DELETE/TRUNCATE. Deny-by-RLS
-- is correct but it is a single layer: any future policy added by mistake, or
-- any SECURITY INVOKER path, would expose the raw feed and the ingest secret.
--
-- `sim_driver_config` (the existing trusted-secret table) already uses the
-- stronger pattern — no grants at all for anon/authenticated. Apply the same
-- pattern here so both secret/ledger tables are protected by BOTH layers.
--
-- The connector reads them with the service role server-side only.
-- ============================================================

REVOKE ALL ON TABLE public.inec_feed_raw      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.inec_ingest_config FROM anon, authenticated, PUBLIC;

-- The raw feed is append-only through the connector and is never readable by
-- a client SDK. RLS stays enabled as the second layer (no policies = deny).
ALTER TABLE public.inec_feed_raw      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inec_ingest_config ENABLE ROW LEVEL SECURITY;

-- Fail loudly if any client role can still reach either table.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(t || ':' || r, ', ') INTO v_bad FROM (
    SELECT 'inec_feed_raw' AS t, r FROM unnest(ARRAY['anon','authenticated']) r
      CROSS JOIN LATERAL (SELECT 1) x
     WHERE has_table_privilege(r, 'public.inec_feed_raw', 'SELECT')
        OR has_table_privilege(r, 'public.inec_feed_raw', 'INSERT')
    UNION ALL
    SELECT 'inec_ingest_config', r FROM unnest(ARRAY['anon','authenticated']) r
      CROSS JOIN LATERAL (SELECT 1) x
     WHERE has_table_privilege(r, 'public.inec_ingest_config', 'SELECT')
        OR has_table_privilege(r, 'public.inec_ingest_config', 'INSERT')
  ) s;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '294: client roles still hold privileges on INEC tables: %', v_bad;
  END IF;
END $$;

-- ============================================================
-- Re-assert `inec_accept_result()` to match the LIVE definition.
-- Migration 283 declared an earlier row-by-row form; the deployed object is
-- the set-based (jsonb_to_recordset) revision, which validates unknown parties
-- as one statement and inserts all party rows in one statement. Re-stating it
-- here keeps a from-scratch replay byte-equivalent to production.
--
-- Note: with migration 293 in place the INSERT below no longer depends on
-- `extensions.uuid_generate_v4()` being on this function's search_path.
-- ============================================================
CREATE OR REPLACE FUNCTION public.inec_accept_result(
  p_election_id UUID,
  p_polling_unit_id UUID,
  p_valid_votes INT,
  p_rejected_votes INT,
  p_party_votes JSONB,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_submission UUID;
  v_volunteer  UUID;
  v_unknown    TEXT;
  v_party_sum  INT;
BEGIN
  -- Single-source path: the feed is the trusted source record.
  SELECT id INTO v_volunteer FROM volunteers LIMIT 1;

  INSERT INTO result_submissions (
    election_id, polling_unit_id, volunteer_id, valid_votes, rejected_votes,
    total_votes, status, idempotency_key, source
  ) VALUES (
    p_election_id, p_polling_unit_id, v_volunteer, p_valid_votes, p_rejected_votes,
    p_valid_votes + p_rejected_votes, 'UNVERIFIED', p_idempotency_key, 'INEC_FEED'
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_submission;

  IF v_submission IS NULL THEN
    RAISE EXCEPTION 'DUPLICATE_IDEMPOTENCY_KEY';
  END IF;

  -- Unknown party → whole unit fails (no half-written submission).
  SELECT pv.abbr INTO v_unknown
    FROM jsonb_to_recordset(p_party_votes) AS pv(abbr text, votes int)
   WHERE NOT EXISTS (
     SELECT 1 FROM parties p WHERE p.abbreviation = pv.abbr AND p.status = 'ACTIVE')
   LIMIT 1;
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'UNKNOWN_PARTY:%', v_unknown;
  END IF;

  INSERT INTO party_results (result_submission_id, party_id, votes)
  SELECT v_submission, p.id, pv.votes
    FROM jsonb_to_recordset(p_party_votes) AS pv(abbr text, votes int)
    JOIN parties p ON p.abbreviation = pv.abbr AND p.status = 'ACTIVE';

  -- Party sum must equal valid votes: the feed can never distort a total.
  SELECT sum(pv.votes)::int INTO v_party_sum
    FROM jsonb_to_recordset(p_party_votes) AS pv(abbr text, votes int);
  IF v_party_sum IS DISTINCT FROM p_valid_votes THEN
    RAISE EXCEPTION 'PARTY_SUM_MISMATCH:% vs %', v_party_sum, p_valid_votes;
  END IF;

  RETURN v_submission;
END;
$fn$;
