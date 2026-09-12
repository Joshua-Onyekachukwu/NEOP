-- ============================================================
-- 216 — AGGREGATION DEDUP: Correct per-PU + per-election
-- Fixes double-counting 2 observers on same PU + excludes SUPERSEDED/REJECTED
-- Authoritative source: party_results JOIN table (NOT jsonb party_votes — col absent)
-- ============================================================

SET search_path = public;

-- Drop old (broken / empty / non-deduped) objects in correct order
DROP FUNCTION IF EXISTS get_state_breakdown_fast();
DROP FUNCTION IF EXISTS get_party_totals_mv();
DROP FUNCTION IF EXISTS get_party_totals_fast();
DROP FUNCTION IF EXISTS get_party_totals();
DROP FUNCTION IF EXISTS get_state_breakdown_from_results();
DROP MATERIALIZED VIEW IF EXISTS mv_party_totals CASCADE;

-- ============================================================
-- A. Materialized View mv_party_totals — CORRECT implementation
--   Uses party_results JOIN table
--   DISTINCT ON (polling_unit_id, election_id) => pick LATEST submission per PU+election
--   Excludes SUPERSEDED, REJECTED from aggregation
-- ============================================================
CREATE MATERIALIZED VIEW mv_party_totals AS
WITH latest_submissions AS (
  -- Pick exactly 1 submission per (PU, election): latest submitted_at
  -- Exclude: SUPERSEDED, REJECTED — never counted in totals
  SELECT DISTINCT ON (rs.polling_unit_id, rs.election_id)
    rs.id AS submission_id,
    rs.polling_unit_id,
    rs.election_id,
    rs.status
  FROM result_submissions rs
  WHERE rs.status NOT IN ('SUPERSEDED', 'REJECTED')
  ORDER BY rs.polling_unit_id, rs.election_id, rs.submitted_at DESC, rs.id DESC
)
SELECT
  p.abbreviation                          AS party_abbreviation,
  COALESCE(p.official_name, p.abbreviation) AS party_name,
  COALESCE(p.color, '#666666')            AS party_color,
  COALESCE(SUM(pr.votes), 0)::BIGINT      AS total_votes
FROM parties p
LEFT JOIN party_results pr ON pr.party_id = p.id
LEFT JOIN latest_submissions ls ON ls.submission_id = pr.result_submission_id
GROUP BY p.abbreviation, p.official_name, p.color
ORDER BY COALESCE(SUM(pr.votes), 0)::BIGINT DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_party_totals_abbr ON mv_party_totals (party_abbreviation);
CREATE INDEX IF NOT EXISTS idx_mv_party_totals_votes ON mv_party_totals (total_votes DESC);
ANALYZE mv_party_totals;

GRANT SELECT ON mv_party_totals TO anon;
GRANT SELECT ON mv_party_totals TO service_role;

-- ============================================================
-- B. get_party_totals_mv() — reads directly from MV
-- ============================================================
CREATE OR REPLACE FUNCTION get_party_totals_mv()
RETURNS TABLE (
  party_abbreviation TEXT,
  party_name         TEXT,
  party_color        TEXT,
  total_votes        BIGINT,
  percentage         NUMERIC
) LANGUAGE sql STABLE AS $$
  SELECT
    party_abbreviation,
    party_name,
    party_color,
    total_votes,
    CASE WHEN SUM(total_votes) OVER () > 0
      THEN ROUND(total_votes::NUMERIC / SUM(total_votes) OVER () * 100, 1)
      ELSE 0
    END AS percentage
  FROM mv_party_totals
  ORDER BY total_votes DESC;
$$;

GRANT EXECUTE ON FUNCTION get_party_totals_mv() TO anon;
GRANT EXECUTE ON FUNCTION get_party_totals_mv() TO service_role;

-- ============================================================
-- C. get_party_totals_fast() — live-query with same dedup logic
--   Used when MV hasn't been REFRESHed after new submissions
-- ============================================================
CREATE OR REPLACE FUNCTION get_party_totals_fast()
RETURNS TABLE (
  party_abbreviation TEXT,
  party_name         TEXT,
  party_color        TEXT,
  total_votes        BIGINT,
  percentage         NUMERIC
) LANGUAGE sql STABLE AS $$
  WITH latest_submissions AS (
    SELECT DISTINCT ON (rs.polling_unit_id, rs.election_id)
      rs.id AS submission_id
    FROM result_submissions rs
    WHERE rs.status NOT IN ('SUPERSEDED', 'REJECTED')
    ORDER BY rs.polling_unit_id, rs.election_id, rs.submitted_at DESC, rs.id DESC
  ),
  party_agg AS (
    SELECT
      p.abbreviation,
      COALESCE(p.official_name, p.abbreviation) AS official_name,
      COALESCE(p.color, '#666666')            AS color,
      COALESCE(SUM(pr.votes), 0)::BIGINT      AS votes
    FROM parties p
    LEFT JOIN party_results pr ON pr.party_id = p.id
    LEFT JOIN latest_submissions ls ON ls.submission_id = pr.result_submission_id
    GROUP BY p.abbreviation, p.official_name, p.color
  )
  SELECT
    abbreviation,
    official_name,
    color,
    votes,
    CASE WHEN SUM(votes) OVER () > 0
      THEN ROUND(votes::NUMERIC / SUM(votes) OVER () * 100, 1)
      ELSE 0
    END
  FROM party_agg
  ORDER BY votes DESC;
$$;

GRANT EXECUTE ON FUNCTION get_party_totals_fast() TO anon;
GRANT EXECUTE ON FUNCTION get_party_totals_fast() TO service_role;

-- ============================================================
-- D. get_party_totals() — public canonical RPC (matches old contract)
-- ============================================================
CREATE OR REPLACE FUNCTION get_party_totals()
RETURNS TABLE (
  party_name         TEXT,
  party_abbreviation TEXT,
  party_color        TEXT,
  total_votes        BIGINT,
  percentage         NUMERIC
) LANGUAGE sql STABLE AS $$
  SELECT party_name, party_abbreviation, party_color, total_votes, percentage
  FROM get_party_totals_fast();
$$;

GRANT EXECUTE ON FUNCTION get_party_totals() TO anon;
GRANT EXECUTE ON FUNCTION get_party_totals() TO service_role;

-- ============================================================
-- E. get_state_breakdown_from_results() — coverage per state
--   Also fixed: dedupe per (PU, election) so coverage% accurate
-- ============================================================
CREATE OR REPLACE FUNCTION get_state_breakdown_from_results()
RETURNS TABLE (
  state_name            TEXT,
  state_id              UUID,
  total_pus             BIGINT,
  verified              BIGINT,
  submitted             BIGINT,
  disputed              BIGINT,
  disrupted             BIGINT,
  covered_pus           BIGINT,
  coverage_percent      NUMERIC
) LANGUAGE sql STABLE AS $$
  WITH state_pus AS (
    SELECT s.id AS state_id, s.name AS state_name, COUNT(pu.id) AS total
    FROM states s
    LEFT JOIN polling_units pu ON pu.state_id = s.id
    GROUP BY s.id, s.name
  ),
  latest_submissions AS (
    SELECT DISTINCT ON (rs.polling_unit_id, rs.election_id)
      rs.polling_unit_id,
      rs.status
    FROM result_submissions rs
    WHERE rs.status NOT IN ('SUPERSEDED', 'REJECTED')
    ORDER BY rs.polling_unit_id, rs.election_id, rs.submitted_at DESC, rs.id DESC
  )
  SELECT
    sp.state_name,
    sp.state_id,
    sp.total,
    COUNT(*) FILTER (WHERE ls.status = 'VERIFIED')       AS verified,
    COUNT(*) FILTER (WHERE ls.status = 'RESULT_SUBMITTED') AS submitted,
    COUNT(*) FILTER (WHERE ls.status = 'DISPUTED')       AS disputed,
    COUNT(*) FILTER (WHERE ls.status = 'DISRUPTED')      AS disrupted,
    COUNT(*) FILTER (WHERE ls.status IS NOT NULL)        AS covered_pus,
    CASE WHEN sp.total > 0
      THEN ROUND(COUNT(*) FILTER (WHERE ls.status IS NOT NULL)::NUMERIC / sp.total * 100, 1)
      ELSE 0
    END AS coverage_percent
  FROM state_pus sp
  LEFT JOIN polling_units pu ON pu.state_id = sp.state_id
  LEFT JOIN latest_submissions ls ON ls.polling_unit_id = pu.id
  GROUP BY sp.state_id, sp.state_name, sp.total
  ORDER BY sp.total DESC;
$$;

GRANT EXECUTE ON FUNCTION get_state_breakdown_from_results() TO anon;
GRANT EXECUTE ON FUNCTION get_state_breakdown_from_results() TO service_role;

-- ============================================================
-- F. get_state_breakdown_fast() — alias for above
-- ============================================================
CREATE OR REPLACE FUNCTION get_state_breakdown_fast()
RETURNS TABLE (
  state_name            TEXT,
  state_id              UUID,
  total_pus             BIGINT,
  verified              BIGINT,
  submitted             BIGINT,
  disputed              BIGINT,
  disrupted             BIGINT,
  covered_pus           BIGINT,
  coverage_percent      NUMERIC
) LANGUAGE sql STABLE AS $$
  SELECT * FROM get_state_breakdown_from_results();
$$;

GRANT EXECUTE ON FUNCTION get_state_breakdown_fast() TO anon;
GRANT EXECUTE ON FUNCTION get_state_breakdown_fast() TO service_role;

-- ============================================================
-- G. REFRESH MV once so reads from it work immediately after apply
-- ============================================================
REFRESH MATERIALIZED VIEW mv_party_totals;
ANALYZE mv_party_totals;

DO $$
BEGIN
  RAISE NOTICE '216 applied: mv_party_totals + 4 RPCs rebuilt with dedup per (PU, election)';
END $$;
