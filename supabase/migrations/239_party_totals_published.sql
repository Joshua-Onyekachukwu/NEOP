-- ============================================================
-- NEOP 239 — PUBLISHED-CANONICAL PARTY TOTALS RPC
--
-- getCachedPartyResults previously selected raw canonical_party_results
-- rows over PostgREST. Two problems once the sim grows the dataset:
--   1. PostgREST caps un-capped selects at 1000 rows → totals silently
--      covered only the first 1000 rows (the demo data).
--   2. No election/status scoping beyond the embedded filter.
-- This RPC aggregates over PUBLISHED canonicals only (the same source
-- as the results feed) and returns 9 rows — fast and cap-proof.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_party_totals_published()
RETURNS TABLE(party_abbreviation text, party_name text, party_color text, total_votes bigint, percentage numeric)
LANGUAGE sql STABLE
AS $function$
  WITH agg AS (
    SELECT
      p.abbreviation,
      COALESCE(p.official_name, p.abbreviation) AS official_name,
      COALESCE(p.color, '#666666')              AS color,
      COALESCE(SUM(cpr.votes), 0)::BIGINT       AS votes
    FROM parties p
    LEFT JOIN canonical_party_results cpr ON cpr.party_id = p.id
    LEFT JOIN canonical_pu_results c
      ON c.id = cpr.canonical_result_id
     AND c.status = 'PUBLISHED'
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
  FROM agg
  ORDER BY votes DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_party_totals_published() TO service_role;