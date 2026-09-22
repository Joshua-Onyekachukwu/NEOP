-- 281_public_summary_index_driven.sql
--
-- ROOT CAUSE FIXED HERE
-- ---------------------
-- The live site was serving an honest-empty payload (all zeros,
-- data_status='UNAVAILABLE') because BOTH public aggregates were
-- un-runnable on the production instance:
--
--   get_election_summary()        -> statement timeout  (>110s)
--   get_party_totals_published()  -> statement timeout
--
-- Both wrote their party roll-up as
--
--     FROM parties p
--     LEFT JOIN canonical_party_results cpr ON cpr.party_id = p.id
--     LEFT JOIN canonical_pu_results   c   ON c.id = cpr.canonical_result_id
--
-- i.e. they drove from the 380,070-row child table and only filtered the
-- canonical side inside a FILTER clause / join predicate. On a healthy
-- instance the planner still picks a hash join and survives; on the
-- throttled free-tier instance the plan degenerates (large seq scans of
-- canonical_party_results) and the statement never completes, so
-- api-cache.ts correctly fell through to its "no data" branch and every
-- headline on the site read 0.
--
-- Rewriting the same aggregation to DRIVE from canonical_pu_results and
-- nested-loop into canonical_party_results via idx_canonical_party_result
-- produces the identical numbers in well under a second. Verified on the
-- live dataset before this migration:
--
--   APC 564,742  NDC 539,611  PDP 237,606  LP 158,203  NNPP 92,229
--   YPP  82,412  APGA 82,359  ADC  82,319  SDP  61,547   (total 1,901,028)
--
-- No output shape changes: consumers of national/parties/states are
-- untouched.

-- ---------------------------------------------------------------- summary
CREATE OR REPLACE FUNCTION public.get_election_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scoping AS (
    SELECT COALESCE(
      -- 1. A RUNNING simulation that has already published at least one
      --    canonical row owns the public stage.
      (SELECT r.election_id FROM simulation_runs r
        WHERE r.status = 'RUNNING'
          AND EXISTS (SELECT 1 FROM canonical_pu_results c
                      WHERE c.election_id = r.election_id)
        ORDER BY r.started_at DESC LIMIT 1),
      -- 2. The published dataset (system-config pointer).
      (SELECT active_election_id FROM system_config
        WHERE id = '00000000-0000-0000-0000-000000000001'
          AND active_election_id IS NOT NULL),
      -- 3. Newest published canonical dataset.
      (SELECT election_id FROM canonical_pu_results
        WHERE status = 'PUBLISHED'
        ORDER BY published_at DESC NULLS LAST LIMIT 1)
    ) AS eid,
    (SELECT active_election_id FROM system_config
      WHERE id = '00000000-0000-0000-0000-000000000001') AS active_eid
  ),
  -- The scoped, non-superseded canonical results for the owning election.
  -- Index-driven: idx_canonical_elec_pu, then polling_units by PK.
  base AS MATERIALIZED (
    SELECT c.id, c.status, c.total_votes, c.valid_votes, c.rejected_votes,
           pu.state_id
    FROM canonical_pu_results c
    JOIN polling_units pu ON pu.id = c.polling_unit_id
    CROSS JOIN scoping s
    WHERE s.eid IS NOT NULL
      AND c.election_id = s.eid
      AND c.status NOT IN ('SUPERSEDED', 'REJECTED')
      AND (c.election_id = s.active_eid OR c.status = 'PUBLISHED')
  ),
  national AS (
    SELECT
      COUNT(*)::INT                                                          AS published_results,
      COUNT(*) FILTER (WHERE status IN ('VERIFIED','PUBLISHED'))::INT        AS verified_results,
      COUNT(*) FILTER (WHERE status IN ('ONE_SUBMISSION','VERIFYING','VERIFIED',
                                         'FLAGGED','HUMAN_REVIEW','PUBLISHED'))::INT AS covered_results,
      COALESCE(SUM(valid_votes) FILTER (WHERE status='PUBLISHED'),0)::BIGINT AS total_votes,
      COALESCE(SUM(valid_votes) FILTER (WHERE status='PUBLISHED'),0)::BIGINT AS total_valid_votes,
      COALESCE(SUM(rejected_votes) FILTER (WHERE status='PUBLISHED'),0)::BIGINT AS total_rejected_votes,
      COALESCE(SUM(total_votes) FILTER (WHERE status='PUBLISHED'),0)::BIGINT AS total_ballots
    FROM base
  ),
  -- Party roll-up: DRIVE from the scoped canonical results.
  party_votes AS MATERIALIZED (
    SELECT cpr.party_id, SUM(cpr.votes)::BIGINT AS votes
    FROM canonical_pu_results c
    JOIN canonical_party_results cpr ON cpr.canonical_result_id = c.id
    CROSS JOIN scoping s
    WHERE s.eid IS NOT NULL
      AND c.election_id = s.eid
      AND c.status = 'PUBLISHED'
    GROUP BY cpr.party_id
  ),
  party_totals AS (
    SELECT p.abbreviation,
           COALESCE(p.official_name, p.abbreviation) AS name,
           COALESCE(p.color, '#666666')              AS color,
           COALESCE(pv.votes, 0)::BIGINT             AS votes
    FROM parties p
    LEFT JOIN party_votes pv ON pv.party_id = p.id
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
  sp AS MATERIALIZED (
    SELECT pu.state_id, p.abbreviation, SUM(cpr.votes)::BIGINT AS votes
    FROM canonical_pu_results c
    JOIN canonical_party_results cpr ON cpr.canonical_result_id = c.id
    JOIN parties p ON p.id = cpr.party_id
    JOIN polling_units pu ON pu.id = c.polling_unit_id
    CROSS JOIN scoping s
    WHERE s.eid IS NOT NULL
      AND c.election_id = s.eid
      AND c.status = 'PUBLISHED'
    GROUP BY pu.state_id, p.abbreviation
  ),
  state_leaders AS (
    SELECT state_id, abbreviation, votes,
           ROW_NUMBER() OVER (PARTITION BY state_id ORDER BY votes DESC, abbreviation ASC) AS rn
    FROM sp
  ),
  -- PU universe per state, index-only over idx_polling_units_state.
  pu_by_state AS MATERIALIZED (
    SELECT state_id, COUNT(*)::INT AS total_pus
    FROM polling_units
    GROUP BY state_id
  ),
  state_pus AS (
    SELECT s.id AS state_id, s.name AS state_name, s.code AS state_code,
           COALESCE(pbs.total_pus, 0)::INT AS total_pus
    FROM states s
    LEFT JOIN pu_by_state pbs ON pbs.state_id = s.id
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

-- ------------------------------------------------- published party totals
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
  party_votes AS MATERIALIZED (
    SELECT cpr.party_id, SUM(cpr.votes)::BIGINT AS votes
    FROM canonical_pu_results c
    JOIN canonical_party_results cpr ON cpr.canonical_result_id = c.id
    CROSS JOIN scoping s
    WHERE s.eid IS NOT NULL
      AND c.election_id = s.eid
      AND c.status = 'PUBLISHED'
    GROUP BY cpr.party_id
  ),
  agg AS (
    SELECT
      p.abbreviation,
      COALESCE(p.official_name, p.abbreviation) AS official_name,
      COALESCE(p.color, '#666666')              AS color,
      COALESCE(pv.votes, 0)::BIGINT             AS votes
    FROM parties p
    LEFT JOIN party_votes pv ON pv.party_id = p.id
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
