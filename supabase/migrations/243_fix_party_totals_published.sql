-- ============================================================
-- NEOP 243 — FIX get_party_totals_published STATUS FILTER
--
-- The status filter lived in the LEFT JOIN ON clause, which only
-- decides WHICH canonical row matches — cpr rows survive the LEFT
-- JOIN regardless, so SUM(cpr.votes) counted SUPERSEDED rows too
-- (duplicate submissions inflated party totals). The FILTER clause
-- puts the status check inside the aggregate where it belongs.
-- Also adds the deterministic alphabetical tiebreak to the ordering.
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
      COALESCE(SUM(cpr.votes) FILTER (WHERE c.status = 'PUBLISHED'), 0)::BIGINT AS votes
    FROM parties p
    LEFT JOIN canonical_party_results cpr ON cpr.party_id = p.id
    LEFT JOIN canonical_pu_results c
      ON c.id = cpr.canonical_result_id
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
  ORDER BY votes DESC, abbreviation ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_party_totals_published() TO service_role;
