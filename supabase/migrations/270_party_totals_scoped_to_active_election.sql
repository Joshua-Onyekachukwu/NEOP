-- NEOP 270 — get_party_totals_published scoped to the ACTIVE election
--
-- Problem: the public /api/public/party-results endpoint's fallback RPC
-- aggregated canonical rows across EVERY election in the table. After three
-- simulation runs the leaderboard summed all three (23,160 rows / 8.7M
-- votes) while the stats + config endpoints correctly showed one run
-- (7,167 PUs / 583K votes) — the public site double-counted superseded
-- simulations.
--
-- Fix: scope the aggregate to system_config.active_election_id (falling back
-- to the most recently published election when unset), matching the scoping
-- get_election_summary already uses.

CREATE OR REPLACE FUNCTION public.get_party_totals_published()
 RETURNS TABLE(party_abbreviation text, party_name text, party_color text, total_votes bigint, percentage numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scoping AS (
    SELECT COALESCE(
      (SELECT active_election_id FROM system_config
        WHERE id = '00000000-0000-0000-0000-000000000001'
          AND active_election_id IS NOT NULL),
      (SELECT election_id FROM canonical_pu_results
        WHERE status = 'PUBLISHED'
        ORDER BY published_at DESC NULLS LAST LIMIT 1)
    ) AS eid
  ),
  agg AS (
    SELECT
      p.abbreviation,
      COALESCE(p.official_name, p.abbreviation) AS official_name,
      COALESCE(p.color, '#666666')              AS color,
      COALESCE(SUM(cpr.votes) FILTER (WHERE c.status = 'PUBLISHED' AND c.election_id = s.eid), 0)::BIGINT AS votes
    FROM parties p
    CROSS JOIN scoping s
    LEFT JOIN canonical_party_results cpr ON cpr.party_id = p.id
    LEFT JOIN canonical_pu_results c
      ON c.id = cpr.canonical_result_id
    GROUP BY p.abbreviation, p.official_name, p.color, s.eid
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
