-- ============================================================
-- NEOP 242 — ONE AUTHORITATIVE RESULTS AGGREGATION (v2, optimized)
--
-- get_election_summary() is THE single source of truth for every
-- results surface (leaderboard, state breakdown, stats bar, map
-- counters, feed headers). Chain:
--
--   canonical_pu_results (per-PU, election-scoped)
--     └─ canonical_party_results (per-PU party votes)
--          └─ polling_units.state_id  → state rollup
--               └─ national rollup    → party totals
--
-- Rules enforced here:
--   * Election scoping: the active election (system_config) uses all
--     non-superseded canonicals; legacy elections use PUBLISHED only.
--   * PU canonicals are unique per (election, PU) — superseded rows are
--     excluded, so votes can never double-count.
--   * Party/state totals derive ONLY from PU canonicals — never computed
--     independently by the API layer or UI.
--   * Leaderboard ordering: votes DESC, abbreviation ASC (alphabetical
--     when totals are equal/empty — deterministic).
--   * State leader: votes DESC, abbreviation ASC.
--   * Cap-proof: aggregation is server-side; PostgREST's 1000-row cap
--     cannot truncate it.
--
-- v2 performance notes:
--   * Aggregation starts from the ~37k election-scoped canonicals instead
--     of LEFT JOINing all 176k polling_units (the dominant cost).
--   * COUNT(DISTINCT) dropped: the supersede invariant guarantees at most
--     one active canonical per (election, PU), so plain counts are exact.
--   * total_pus per state comes from a tiny 37-row states aggregate.
--   * One CTE scan feeds national, party and state outputs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_election_summary()
RETURNS JSONB
LANGUAGE sql STABLE
AS $function$
  WITH scoping AS (
    SELECT COALESCE(
      (SELECT active_election_id FROM system_config
        WHERE id = '00000000-0000-0000-0000-000000000001'
          AND active_election_id IS NOT NULL),
      (SELECT election_id FROM canonical_pu_results
        WHERE status = 'PUBLISHED'
        ORDER BY published_at DESC NULLS LAST LIMIT 1)
    ) AS eid,
    (SELECT active_election_id FROM system_config
      WHERE id = '00000000-0000-0000-0000-000000000001') AS active_eid
  ),
  scoped AS (
    SELECT c.id, c.polling_unit_id, c.status,
           c.valid_votes, c.rejected_votes, c.total_votes
    FROM canonical_pu_results c, scoping s
    WHERE s.eid IS NOT NULL
      AND c.election_id = s.eid
      AND c.status NOT IN ('SUPERSEDED', 'REJECTED')
      AND (c.election_id = s.active_eid OR c.status = 'PUBLISHED')
  ),
  base AS (
    -- One pass: canonical + its state, joined once, reused everywhere.
    SELECT c.id, c.status, c.total_votes, c.valid_votes, c.rejected_votes, pu.state_id
    FROM scoped c
    JOIN polling_units pu ON pu.id = c.polling_unit_id
  ),
  national AS (
    SELECT
      COUNT(*)::INT                                                          AS published_results,
      COUNT(*) FILTER (WHERE status IN ('VERIFIED','PUBLISHED'))::INT        AS verified_results,
      COUNT(*) FILTER (WHERE status IN ('ONE_SUBMISSION','VERIFYING','VERIFIED',
                                         'FLAGGED','HUMAN_REVIEW','PUBLISHED'))::INT AS covered_results,
      -- Authoritative headline = party-attributable votes (SUM of party
      -- totals). Total ballots remain visible as total_valid_votes +
      -- total_rejected_votes, so nothing is hidden — they just don't lead.
      COALESCE(SUM(valid_votes) FILTER (WHERE status='PUBLISHED'),0)::BIGINT AS total_votes,
      COALESCE(SUM(valid_votes) FILTER (WHERE status='PUBLISHED'),0)::BIGINT AS total_valid_votes,
      COALESCE(SUM(rejected_votes) FILTER (WHERE status='PUBLISHED'),0)::BIGINT AS total_rejected_votes,
      COALESCE(SUM(total_votes) FILTER (WHERE status='PUBLISHED'),0)::BIGINT AS total_ballots
    FROM base
  ),
  party_totals AS (
    SELECT
      p.abbreviation,
      COALESCE(p.official_name, p.abbreviation) AS name,
      COALESCE(p.color, '#666666')              AS color,
      COALESCE(SUM(cpr.votes) FILTER (WHERE b.status='PUBLISHED'), 0)::BIGINT AS votes
    FROM parties p
    LEFT JOIN canonical_party_results cpr ON cpr.party_id = p.id
    LEFT JOIN base b ON b.id = cpr.canonical_result_id
    GROUP BY p.abbreviation, p.official_name, p.color
  ),
  state_active AS (
    SELECT
      b.state_id,
      COUNT(*)::INT   AS covered_pus,
      COUNT(*) FILTER (WHERE b.status='PUBLISHED')::INT AS published_pus,
      COUNT(*) FILTER (WHERE b.status IN ('VERIFIED','PUBLISHED'))::INT AS verified_pus,
      COALESCE(SUM(b.valid_votes) FILTER (WHERE b.status='PUBLISHED'),0)::BIGINT AS total_votes
    FROM base b
    GROUP BY b.state_id
  ),
  sp AS (
    SELECT b.state_id, p.abbreviation, SUM(cpr.votes)::BIGINT AS votes
    FROM canonical_party_results cpr
    JOIN base b ON b.id = cpr.canonical_result_id AND b.status='PUBLISHED'
    JOIN parties p ON p.id = cpr.party_id
    GROUP BY b.state_id, p.abbreviation
  ),
  state_leaders AS (
    SELECT state_id, abbreviation, votes,
           ROW_NUMBER() OVER (PARTITION BY state_id ORDER BY votes DESC, abbreviation ASC) AS rn
    FROM sp
  ),
  state_pus AS (
    SELECT s.id AS state_id, s.name AS state_name, s.code AS state_code,
           COUNT(pu.id)::INT AS total_pus
    FROM states s
    LEFT JOIN polling_units pu ON pu.state_id = s.id
    GROUP BY s.id, s.name, s.code
  )
  SELECT jsonb_build_object(
    'generated_at',       to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'election_id',        (SELECT eid FROM scoping),
    'total_polling_units',(SELECT COUNT(*)::INT FROM polling_units),
    'national',           (SELECT to_jsonb(n) FROM national n),
    'parties',            COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object('abbreviation', pt.abbreviation,
                             'name',         pt.name,
                             'color',        pt.color,
                             'total_votes',  pt.votes)
          ORDER BY pt.votes DESC, pt.abbreviation ASC)
        FROM party_totals pt), '[]'::jsonb),
    'states',             (
        SELECT jsonb_agg(
          jsonb_build_object(
            'state_id',      spu.state_id,
            'state_name',    spu.state_name,
            'state_code',    spu.state_code,
            'total_pus',     spu.total_pus,
            'covered_pus',   COALESCE(sa.covered_pus, 0),
            'published_pus', COALESCE(sa.published_pus, 0),
            'verified_pus',  COALESCE(sa.verified_pus, 0),
            'total_votes',   COALESCE(sa.total_votes, 0),
            'coverage_percent', CASE WHEN spu.total_pus > 0
                THEN ROUND(COALESCE(sa.covered_pus,0)::numeric * 100 / spu.total_pus, 1) ELSE 0 END,
            'leader_abbreviation', sl.abbreviation,
            'leader_votes',        COALESCE(sl.votes, 0),
            'reporting_status',    CASE
                WHEN spu.total_pus = 0 OR COALESCE(sa.covered_pus,0) = 0      THEN 'AWAITING'
                WHEN COALESCE(sa.covered_pus,0) >= spu.total_pus              THEN 'COMPLETE'
                ELSE 'REPORTING' END
          ) ORDER BY spu.state_name ASC)
        FROM state_pus spu
        LEFT JOIN state_active sa ON sa.state_id = spu.state_id
        LEFT JOIN state_leaders sl ON sl.state_id = spu.state_id AND sl.rn = 1)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_election_summary() TO service_role, anon, authenticated;
