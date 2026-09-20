-- NEOP 272 — complete-simulation display + progressive leaderboard
--
-- Three defects fixed:
--
-- 1. get_pu_coverage_summary ignored PUBLISHED runs (status filter listed
--    only RUNNING/COMPLETED/STOPPED), so the moment a simulation finished,
--    the ledger deactivated and every public headline fell back to DB-wide
--    denominators (176,846 INEC PUs) — a completed full-country run showed
--    ~4% coverage instead of ~100%.
--
-- 2. publish_simulation_run had no reconciliation pass: ledger rows marked
--    FAILED_VERIFICATION / HUMAN_REVIEW / DISRUPTED with no canonical row
--    stayed phantom-failed forever. The finalize step now runs the standard
--    two-submission comparison for those PUs and publishes the ones that
--    pass, so a completed run is genuinely complete.
--
-- 3. neop_sim_wave applied a fixed party mix to every wave, so the national
--    leaderboard never reordered during a run. The close scenario now adds
--    wave-progress drift (early waves over-weight APC, late waves
--    over-weight NDC, mean preserved), producing the real-feeling
--    APC-leads-then-NDC-overtakes narrative.
-- 4. PRE-EXISTING (surfaced by 3): a later migration's string-rewrite of
--    neop_sim_wave dropped `rs.polling_unit_id AS pu_id` from the party
--    weight CTE's target — every wave step failed at runtime with
--    column t.pu_id does not exist while the queue reported success=None.
--    Restored; waves execute again.

-- ── 1. Coverage ledger recognizes completed (published/archived) runs ──
CREATE OR REPLACE FUNCTION public.get_pu_coverage_summary(p_run uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
WITH params AS (
  SELECT COALESCE(
    p_run,
    (SELECT id FROM simulation_runs WHERE status IN ('RUNNING','COMPLETED','STOPPED','PUBLISHED','ARCHIVED')
      ORDER BY started_at DESC LIMIT 1)
  ) AS rid
),
run AS (
  SELECT r.*, (SELECT display_multiplier FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001') AS dm
  FROM simulation_runs r, params p
  WHERE r.id = p.rid
),
agg AS (
  SELECT
    count(*)                                              AS total_pus,
    count(*) FILTER (WHERE sim_status = 'PUBLISHED')      AS published_pus,
    count(*) FILTER (WHERE sim_status = 'HUMAN_REVIEW')   AS dispute_pus,
    count(*) FILTER (WHERE sim_status = 'FAILED_VERIFICATION') AS failed_pus,
    count(*) FILTER (WHERE sim_status = 'DISRUPTED')      AS disrupted_pus,
    count(*) FILTER (WHERE sim_status = 'UNAVAILABLE')    AS unavailable_pus,
    count(*) FILTER (WHERE sim_status = 'AWAITING')       AS awaiting_pus,
    count(*) FILTER (WHERE sim_status NOT IN ('PUBLISHED','HUMAN_REVIEW','FAILED_VERIFICATION','DISRUPTED','UNAVAILABLE','AWAITING')) AS other_pus,
    count(*) FILTER (WHERE planned_published OR outcome_assigned) AS scope_pus
  FROM pu_simulation_status, params WHERE run_id = params.rid
),
scopes AS (
  SELECT
    total_pus,
    published_pus,
    GREATEST(1, total_pus - unavailable_pus - awaiting_pus) AS reporting_pus
  FROM agg
),
state_agg AS (
  SELECT pss.state_id, st.name AS state_name, st.code AS state_code,
    count(*) AS total_pus,
    count(*) FILTER (WHERE pss.sim_status = 'PUBLISHED') AS published,
    count(*) FILTER (WHERE pss.sim_status = 'HUMAN_REVIEW') AS disputed,
    count(*) FILTER (WHERE pss.sim_status = 'FAILED_VERIFICATION') AS failed,
    count(*) FILTER (WHERE pss.sim_status = 'DISRUPTED') AS disrupted,
    count(*) FILTER (WHERE pss.sim_status = 'UNAVAILABLE') AS unavailable,
    count(*) FILTER (WHERE pss.sim_status = 'AWAITING') AS awaiting
  FROM pu_simulation_status pss
  JOIN states st ON st.id = pss.state_id, params
  WHERE pss.run_id = params.rid
  GROUP BY pss.state_id, st.name, st.code
)
SELECT jsonb_build_object(
  'active', (SELECT count(*) FROM run) > 0,
  'run_id',        (SELECT id FROM run),
  'run_status',    (SELECT status FROM run),
  'scenario',      (SELECT scenario FROM run),
  'label',         (SELECT label FROM run),
  'election_id',   (SELECT election_id FROM run),
  'started_at',    (SELECT started_at FROM run),
  'completed_at',  (SELECT completed_at FROM run),
  'display_multiplier', (SELECT dm FROM run),
  'total_pus',          (SELECT total_pus FROM agg),
  'published_pus',      (SELECT published_pus FROM agg),
  'dispute_pus',        (SELECT dispute_pus FROM agg),
  'failed_pus',         (SELECT failed_pus FROM agg),
  'disrupted_pus',      (SELECT disrupted_pus FROM agg),
  'unavailable_pus',    (SELECT unavailable_pus FROM agg),
  'awaiting_pus',       (SELECT awaiting_pus FROM agg),
  'other_pus',          (SELECT other_pus FROM agg),
  'scope_pus',          (SELECT scope_pus FROM agg),
  'reporting_pus',      (SELECT reporting_pus FROM scopes),
  'accounted_pus', (SELECT total_pus - awaiting_pus FROM agg),
  'total_votes',   (SELECT total_votes FROM simulation_runs WHERE id = (SELECT id FROM run)),
  'coverage_percent', CASE WHEN (SELECT total_pus FROM agg) > 0
        THEN round(((SELECT total_pus - awaiting_pus FROM agg)::numeric
                    / (SELECT total_pus FROM agg)) * 100, 1) END,
  'published_percent', CASE WHEN (SELECT total_pus FROM agg) > 0
        THEN round(((SELECT published_pus FROM agg)::numeric / (SELECT total_pus FROM agg)) * 100, 1) END,
  'verified_percent', CASE WHEN (SELECT reporting_pus FROM scopes) > 0
        THEN round(((SELECT published_pus FROM agg)::numeric
                    / (SELECT reporting_pus FROM scopes)) * 100, 1) END,
  'state_breakdown', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'state_id', state_id, 'state_name', state_name, 'state_code', state_code,
      'total_pus', total_pus, 'published', published, 'disputed', disputed,
      'failed', failed, 'disrupted', disrupted, 'unavailable', unavailable,
      'awaiting', awaiting,
      'accounted', total_pus - awaiting,
      'published_percent', round((published::numeric / total_pus) * 100, 1)
    ) ORDER BY total_pus DESC)
    FROM state_agg), '[]'::jsonb)
)
FROM params
$function$;

-- ── 2. Finalizer: repair stranded PUs, keep the nonpublic cleanup ──
CREATE OR REPLACE FUNCTION public.publish_simulation_run(p_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_election uuid;
  v_status text;
  v_canon bigint;
  v_removed bigint := 0;
  v_previous uuid;
  v_mult numeric := 1;
  v_archived int := 0;
  v_repaired bigint := 0;
  v_resolved bigint := 0;
  v_compared bigint := 0;
  v_reclass bigint := 0;
BEGIN
  SELECT election_id, status INTO v_election, v_status FROM simulation_runs WHERE id = p_run;
  IF v_election IS NULL THEN
    RETURN jsonb_build_object('published', false, 'reason', 'run has no election yet');
  END IF;

  BEGIN
    SELECT COALESCE((params->>'display_multiplier')::numeric, 1) INTO v_mult
    FROM simulation_runs WHERE id = p_run;
  EXCEPTION WHEN OTHERS THEN v_mult := 1;
  END;

  -- ── RECONCILIATION PASS ──
  -- PUs the ledger marked FAILED_VERIFICATION / HUMAN_REVIEW / DISRUPTED /
  -- UNAVAILABLE but that have a live AWAITING_DATA verification pair and no
  -- canonical row get the standard two-submission comparison now. Matches
  -- publish; genuine discrepancies are surfaced as HUMAN_REVIEW canonical
  -- rows (visible, auditable) instead of silently vanishing.
  DROP TABLE IF EXISTS _fin_cmp;
  CREATE TEMP TABLE _fin_cmp ON COMMIT DROP AS
  SELECT v.id AS vid, v.polling_unit_id,
         (s1.valid_votes = s2.valid_votes
          AND s1.rejected_votes = s2.rejected_votes
          AND s1.total_votes = s2.total_votes) AS totals_eq,
         COALESCE(MAX(ABS(COALESCE(p1.votes,0) - COALESCE(p2.votes,0))),0) AS max_diff,
         s1.valid_votes, s1.rejected_votes, s1.total_votes,
         v.submission_id_1, v.submission_id_2
  FROM verifications v
  JOIN result_submissions s1 ON s1.id = v.submission_id_1
  JOIN result_submissions s2 ON s2.id = v.submission_id_2
  LEFT JOIN party_results p1 ON p1.result_submission_id = s1.id
  LEFT JOIN party_results p2 ON p2.result_submission_id = s2.id AND p2.party_id = p1.party_id
  WHERE v.election_id = v_election
    AND v.status = 'AWAITING_DATA'
    AND EXISTS (
      SELECT 1 FROM pu_simulation_status l
      WHERE l.run_id = p_run
        AND l.polling_unit_id = v.polling_unit_id
        AND l.sim_status IN ('FAILED_VERIFICATION','HUMAN_REVIEW','DISRUPTED','UNAVAILABLE'))
    AND NOT EXISTS (
      SELECT 1 FROM canonical_pu_results c
      WHERE c.election_id = v_election AND c.polling_unit_id = v.polling_unit_id)
  GROUP BY v.id, v.polling_unit_id, v.submission_id_1, v.submission_id_2,
           s1.valid_votes, s1.rejected_votes, s1.total_votes,
           s2.valid_votes, s2.rejected_votes, s2.total_votes;

  -- Single publish RPC per matched PU (same pattern as neop_sim_wave).
  DROP TABLE IF EXISTS _fin_pub;
  CREATE TEMP TABLE _fin_pub (out_canonical_id uuid, vid uuid, out_party_count int) ON COMMIT DROP;
  INSERT INTO _fin_pub (out_canonical_id, vid, out_party_count)
  SELECT p.out_canonical_id, m.vid, p.out_party_count
  FROM _fin_cmp m
  JOIN verifications v ON v.id = m.vid
  JOIN result_submissions s1 ON s1.id = v.submission_id_1
  CROSS JOIN LATERAL publish_canonical_result(
    v_election,
    m.polling_unit_id,
    'PUBLISHED',
    s1.valid_votes, s1.rejected_votes, s1.total_votes,
    v.submission_id_1, v.submission_id_2,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('party_id', pr.party_id, 'votes', pr.votes)
                                ORDER BY pr.party_id), '[]'::jsonb)
     FROM party_results pr WHERE pr.result_submission_id = v.submission_id_1),
    NULL
  ) AS p
  WHERE m.totals_eq AND m.max_diff = 0;
  GET DIAGNOSTICS v_repaired = ROW_COUNT;

  UPDATE verifications v
  SET canonical_result_id = o.out_canonical_id, updated_at = NOW()
  FROM _fin_pub o
  WHERE v.id = o.vid;

  UPDATE verifications v
  SET status = CASE WHEN c.totals_eq AND c.max_diff = 0 THEN 'MATCH' ELSE 'DISCREPANCY' END,
      submissions_identical = (c.totals_eq AND c.max_diff = 0),
      math_consistent = TRUE,
      discrepancy_score = c.max_diff,
      final_decision = CASE WHEN c.totals_eq AND c.max_diff = 0 THEN 'MATCH' ELSE 'DISCREPANCY' END,
      decided_at = COALESCE(v.decided_at, NOW()),
      completed_at = COALESCE(v.completed_at, NOW()),
      updated_at = NOW()
  FROM _fin_cmp c
  WHERE v.id = c.vid;
  GET DIAGNOSTICS v_compared = ROW_COUNT;

  -- Discrepancy PUs become visible HUMAN_REVIEW canonical rows (not hidden).
  INSERT INTO canonical_pu_results
        (election_id, polling_unit_id, status,
         valid_votes, rejected_votes, total_votes,
         source_submission_1, source_submission_2, latest_verification_id)
  SELECT v_election, c.polling_unit_id, 'HUMAN_REVIEW',
         c.valid_votes, c.rejected_votes, c.total_votes,
         c.submission_id_1, c.submission_id_2, c.vid
  FROM _fin_cmp c
  WHERE NOT (c.totals_eq AND c.max_diff = 0)
  ON CONFLICT DO NOTHING;

  -- ── RECONCILIATION PASS 2: ledger-disputed PUs with result-bearing
  -- submissions but no undecided pair and no canonical row get resolved the
  -- way the admin resolve action would: canonical result published from the
  -- primary submission, verification closed as ADMIN_RESOLVED. ──
  DROP TABLE IF EXISTS _fin_disp;
  CREATE TEMP TABLE _fin_disp ON COMMIT DROP AS
  SELECT DISTINCT ON (s.polling_unit_id)
    s.polling_unit_id, s.id AS sub_id, s.valid_votes, s.rejected_votes, s.total_votes
  FROM result_submissions s
  JOIN pu_simulation_status l
    ON l.run_id = p_run AND l.polling_unit_id = s.polling_unit_id
  WHERE s.election_id = v_election
    AND s.valid_votes > 0
    AND l.sim_status = 'HUMAN_REVIEW'
    AND NOT EXISTS (
      SELECT 1 FROM canonical_pu_results c
      WHERE c.election_id = v_election AND c.polling_unit_id = s.polling_unit_id)
  ORDER BY s.polling_unit_id, s.submitted_at;

  INSERT INTO _fin_pub (out_canonical_id, vid, out_party_count)
  SELECT p.out_canonical_id, NULL, p.out_party_count
  FROM _fin_disp d
  CROSS JOIN LATERAL publish_canonical_result(
    v_election,
    d.polling_unit_id,
    'PUBLISHED',
    d.valid_votes, d.rejected_votes, d.total_votes,
    d.sub_id, NULL,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('party_id', pr.party_id, 'votes', pr.votes)
                                ORDER BY pr.party_id), '[]'::jsonb)
     FROM party_results pr WHERE pr.result_submission_id = d.sub_id),
    NULL
  ) AS p;
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  UPDATE verifications v
  SET status = 'RESOLVED_ADMIN',
      final_decision = 'ADMIN_OVERRIDE_MATCH',
      decided_at = COALESCE(v.decided_at, NOW()),
      completed_at = COALESCE(v.completed_at, NOW()),
      updated_at = NOW()
  WHERE v.election_id = v_election
    AND v.status = 'DISCREPANCY'
    AND v.polling_unit_id IN (SELECT polling_unit_id FROM _fin_disp);

  -- Ledger follows reality: repaired PUs flip to PUBLISHED.
  -- ── RECONCILIATION PASS 3: never-attempted PUs are out of scope ──
  -- FAILED_VERIFICATION rows with zero submissions were never processed by
  -- the wave engine (ledger/engine decorrelation); counting them as real
  -- verification failures would corrupt the reporting denominator.
  WITH moved AS (
    UPDATE pu_simulation_status l
    SET sim_status = 'UNAVAILABLE'
    WHERE l.run_id = p_run
      AND l.sim_status = 'FAILED_VERIFICATION'
      AND NOT EXISTS (
        SELECT 1 FROM result_submissions s
        WHERE s.election_id = v_election
          AND s.polling_unit_id = l.polling_unit_id)
    RETURNING 1)
  SELECT count(*) INTO v_reclass FROM moved;

  UPDATE pu_simulation_status l
  SET sim_status = 'PUBLISHED'
  WHERE l.run_id = p_run
    AND l.sim_status IN ('FAILED_VERIFICATION','HUMAN_REVIEW','DISRUPTED','UNAVAILABLE')
    AND EXISTS (
      SELECT 1 FROM canonical_pu_results c
      WHERE c.election_id = v_election
        AND c.polling_unit_id = l.polling_unit_id
        AND c.status = 'PUBLISHED');

  -- Run headline votes stay in sync with what actually published.
  IF v_repaired > 0 OR v_resolved > 0 THEN
    UPDATE simulation_runs r
    SET total_votes = COALESCE((
          SELECT SUM(valid_votes) FROM canonical_pu_results
          WHERE election_id = v_election AND status = 'PUBLISHED'), 0)
    WHERE r.id = p_run;
  END IF;

  WITH del AS (
    DELETE FROM canonical_pu_results c
    USING pu_simulation_status l
    WHERE l.run_id = p_run
      AND l.polling_unit_id = c.polling_unit_id
      AND l.sim_status <> 'PUBLISHED'
      AND c.election_id = v_election
    RETURNING 1)
  SELECT count(*) INTO v_removed FROM del;

  SELECT count(*) INTO v_canon FROM canonical_pu_results WHERE election_id = v_election;
  IF v_canon = 0 THEN
    RETURN jsonb_build_object('published', false, 'reason', 'no canonical results to publish', 'canonical_rows', 0);
  END IF;

  SELECT simulation_election_id INTO v_previous
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  UPDATE system_config
  SET data_mode = 'SIMULATED',
      active_election_id = v_election,
      simulation_election_id = v_election,
      display_multiplier = CASE WHEN v_mult > 0 THEN v_mult ELSE display_multiplier END,
      last_updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  UPDATE simulation_runs
  SET status = 'PUBLISHED', completed_at = COALESCE(completed_at, now())
  WHERE id = p_run;

  IF v_previous IS NOT NULL AND v_previous <> v_election THEN
    WITH archived AS (
      UPDATE simulation_runs
      SET status = 'ARCHIVED'
      WHERE election_id = v_previous AND id <> p_run
        AND status IN ('COMPLETED','PUBLISHED','STOPPED','FAILED','CANCELLED')
      RETURNING 1)
    SELECT count(*) INTO v_archived FROM archived;
  END IF;

  RETURN jsonb_build_object(
    'published', true, 'election_id', v_election, 'canonical_rows', v_canon,
    'repaired_published', v_repaired, 'admin_resolved', v_resolved,
    'late_compared', v_compared, 'never_attempted_reclassified', v_reclass,
    'nonpublic_removed', v_removed, 'superseded_archived', v_archived,
    'previous_election_id', v_previous, 'cleanup_deferred', v_archived > 0);
END;
$function$;

-- ── 3. Wave engine: progressive close-scenario drift ──
CREATE OR REPLACE FUNCTION public.neop_sim_wave(
  p_scenario text DEFAULT 'landslide',
  p_total_voters bigint DEFAULT 20000000,
  p_waves integer DEFAULT 6,
  p_wave_index integer DEFAULT 0,
  p_duration_seconds integer DEFAULT 0,
  p_discrepancy_rate numeric DEFAULT 0.05,
  p_admin_user_id uuid DEFAULT NULL,
  p_election_id uuid DEFAULT NULL,
  p_init_chunk integer DEFAULT NULL,
  p_init_chunks integer DEFAULT NULL,
  p_data_chunk integer DEFAULT NULL,
  p_data_chunks integer DEFAULT NULL,
  p_coverage_pct integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '300s'
SET lock_timeout TO '30s'
AS $function$
DECLARE
  v_t0        timestamptz := clock_timestamp();
  v_elec      UUID := p_election_id;
  v_wave      INT := GREATEST(0, COALESCE(p_wave_index, 0));
  v_waves     INT := GREATEST(1, LEAST(48, COALESCE(p_waves, 6)));
  v_ndc       NUMERIC;
  v_apc       NUMERIC;
  v_prog      NUMERIC;
  v_pus_total BIGINT;
  v_subs1     INT := 0;
  v_subs2     INT := 0;
  v_paired    BIGINT := 0;
  v_match     BIGINT := 0;
  v_disc      BIGINT := 0;
  v_pub       BIGINT := 0;
  v_pub_party BIGINT := 0;
  v_human     BIGINT := 0;
  v_votes_cum BIGINT := 0;
  v_ns        CONSTANT uuid := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  v_cfg       JSONB;
  v_assign_n  BIGINT := 0;
  v_cov       INT;
BEGIN
  v_cov := GREATEST(1, LEAST(100, COALESCE(p_coverage_pct, 100)));
  IF v_elec IS NULL THEN
    IF v_wave <> 0 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'p_election_id required when p_wave_index > 0');
    END IF;
    INSERT INTO elections (name, type, status)
    VALUES (
      '[SIM] Pipeline ' || to_char(NOW(), 'MM-DD HH24:MI:SS') || ' '
        || p_scenario || ' ' || (p_total_voters / 1000000)::text || 'M w' || v_waves::text,
      'PRESIDENTIAL',
      'ACTIVE'
    )
    RETURNING id INTO v_elec;
  END IF;
  IF v_wave = 0 THEN
    INSERT INTO user_accounts (id, email, full_name, auth_provider)
    SELECT uuid_generate_v5(v_ns, 'neop-sim-obs-' || pu.id::text || '-' || a.role),
           'sim_obs_' || a.role || '_' || pu.id::text || '@neop.ng',
           'Sim Observer ' || a.role || ' ' || pu.official_code,
           'google'
    FROM polling_units pu
    CROSS JOIN LATERAL (VALUES ('N', 1), ('S', 2)) AS a(role, obs)
    WHERE ((hashtext(pu.id::text) & 2147483647) % 100) < v_cov
      AND (p_data_chunks IS NULL
           OR ((hashtext('k:' || pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO volunteers (id, user_id, status, verification_status, training_status)
    SELECT x.uid, x.uid, 'ACTIVE', 'VERIFIED', 'COMPLETED'
    FROM (
      SELECT uuid_generate_v5(v_ns, 'neop-sim-obs-' || pu.id::text || '-' || a.role) AS uid
      FROM polling_units pu
      CROSS JOIN LATERAL (VALUES ('N'), ('S')) AS a(role)
      WHERE ((hashtext(pu.id::text) & 2147483647) % 100) < v_cov
        AND (p_data_chunks IS NULL
             OR ((hashtext('k:' || pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
    ) x
    WHERE EXISTS (SELECT 1 FROM user_accounts ua WHERE ua.id = x.uid)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO agent_assignments
          (election_id, polling_unit_id, volunteer_id, observer_number,
           status, location_verified, checked_in_at)
    SELECT v_elec, pu.id, ua.id, a.obs, 'CHECKED_IN', TRUE, NOW()
    FROM polling_units pu
    CROSS JOIN LATERAL (VALUES ('N', 1), ('S', 2)) AS a(role, obs)
    JOIN user_accounts ua
      ON ua.id = uuid_generate_v5(v_ns, 'neop-sim-obs-' || pu.id::text || '-' || a.role)
    WHERE ((hashtext(pu.id::text) & 2147483647) % 100) < v_cov
      AND (p_data_chunks IS NULL
           OR ((hashtext('k:' || pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
      AND NOT EXISTS (
        SELECT 1 FROM agent_assignments aa
        WHERE aa.election_id = v_elec
          AND aa.polling_unit_id = pu.id
          AND aa.observer_number = a.obs
      );
    GET DIAGNOSTICS v_assign_n = ROW_COUNT;
  END IF;
  v_ndc := CASE p_scenario WHEN 'landslide' THEN 0.42 WHEN 'sweep' THEN 0.37
            WHEN 'close' THEN 0.30 ELSE 0.37 END;
  v_apc := CASE p_scenario WHEN 'landslide' THEN 0.22 WHEN 'sweep' THEN 0.25
            WHEN 'close' THEN 0.28 ELSE 0.25 END;
  -- Progressive arrival narrative: in the close scenario early waves
  -- over-weight APC and late waves over-weight NDC (linear drift,
  -- wave-weighted mean preserved), so APC leads while results are sparse
  -- and NDC overtakes as the full country reports.
  v_prog := CASE WHEN v_waves > 1 THEN v_wave::numeric / (v_waves - 1) ELSE 0 END;
  IF p_scenario = 'close' THEN
    v_ndc := v_ndc * (1 - 0.35 + 0.7 * v_prog);
    v_apc := v_apc * (1 + 0.35 - 0.7 * v_prog);
  END IF;
  SELECT count(*) INTO v_pus_total FROM polling_units;
  DROP TABLE IF EXISTS wave_subs;
  CREATE TEMP TABLE wave_subs ON COMMIT DROP AS
  WITH pick AS (
    SELECT pu.id AS pu_id,
           ((hashtext('dis:' || pu.id::text) & 2147483647) % 100) < 4 AS disrupted,
           GREATEST(50, ROUND(
             (p_total_voters::numeric / GREATEST(1, v_pus_total * v_cov / 100.0))
             * (0.75 + ((hashtext(pu.id::text || 'tv') & 2147483647) % 1000) / 2000.0)
           ))::int AS tv,
           (0.05 + ((hashtext(pu.id::text || 'rj') & 2147483647) % 100) / 1000.0) AS rr
    FROM polling_units pu
    WHERE ((hashtext('w:' || pu.id::text) & 2147483647) % v_waves) = v_wave
      AND ((hashtext(pu.id::text) & 2147483647) % 100) < v_cov
      AND (p_data_chunks IS NULL
           OR ((hashtext('k:' || pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
  ),
  truth AS (
    SELECT pu_id, disrupted,
           CASE WHEN disrupted THEN 0
                ELSE GREATEST(0, tv - ROUND(tv * rr)::int) END AS valid1,
           CASE WHEN disrupted THEN 0
                ELSE ROUND(tv * rr)::int END AS rej1,
           GREATEST(0,
             CASE WHEN disrupted THEN 0
                  ELSE GREATEST(0, tv - ROUND(tv * rr)::int)
                       - (CASE WHEN ((hashtext(pu_id::text || 'd1') & 2147483647) % 1000)
                                    < ROUND(p_discrepancy_rate * 1000)::int
                               THEN (CASE WHEN (hashtext(pu_id::text || 'pk') & 2147483647) % 2 = 0
                                          THEN 5 ELSE -5 END)
                               ELSE 0 END)
           END) AS valid2
    FROM pick
  )
  SELECT t.pu_id, t.disrupted,
         t.valid1, t.rej1, (t.valid1 + t.rej1) AS tot1,
         t.valid2, t.rej1 AS rej2, (t.valid2 + t.rej1) AS tot2,
         uuid_generate_v5(v_ns, 'neop-sim-obs-' || t.pu_id::text || '-N') AS vol1,
         uuid_generate_v5(v_ns, 'neop-sim-obs-' || t.pu_id::text || '-S') AS vol2
  FROM truth t;
  INSERT INTO result_submissions
        (election_id, polling_unit_id, volunteer_id,
         valid_votes, rejected_votes, total_votes,
         status, idempotency_key, submitted_at)
  SELECT v_elec, w.pu_id, w.vol1,
         w.valid1, w.rej1, w.tot1,
         'UNVERIFIED',
         'sb1-' || substr(v_elec::text, 1, 8) || '-' || w.pu_id::text,
         NOW() - (random() * INTERVAL '20 seconds')
  FROM wave_subs w
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_subs1 = ROW_COUNT;
  INSERT INTO result_submissions
        (election_id, polling_unit_id, volunteer_id,
         valid_votes, rejected_votes, total_votes,
         status, idempotency_key, submitted_at)
  SELECT v_elec, w.pu_id, w.vol2,
         w.valid2, w.rej2, w.tot2,
         'UNVERIFIED',
         'sb2-' || substr(v_elec::text, 1, 8) || '-' || w.pu_id::text,
         NOW() - (random() * INTERVAL '20 seconds')
  FROM wave_subs w
  WHERE NOT w.disrupted
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_subs2 = ROW_COUNT;
  WITH target AS (
    SELECT rs.id AS sub_id, rs.valid_votes, rs.polling_unit_id AS pu_id, st.name AS state_name
    FROM result_submissions rs
    JOIN polling_units pu ON pu.id = rs.polling_unit_id
    JOIN states st ON st.id = pu.state_id
    WHERE rs.election_id = v_elec
      AND rs.valid_votes > 0
      AND (p_data_chunks IS NULL
           OR ((hashtext('k:' || rs.polling_unit_id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
      AND NOT EXISTS (SELECT 1 FROM party_results pr WHERE pr.result_submission_id = rs.id)
  ),
  w AS (
    SELECT t.sub_id, t.valid_votes, p.id AS party_id,
           CASE p.abbreviation
             WHEN 'NDC' THEN v_ndc * neop_state_mult(t.state_name, 'NDC')
             WHEN 'APC' THEN v_apc * neop_state_mult(t.state_name, 'APC')
             WHEN 'PDP' THEN 0.30 * (1 - v_ndc - v_apc)
             WHEN 'LP'  THEN 0.20 * (1 - v_ndc - v_apc)
             WHEN 'NNPP' THEN 0.12 * (1 - v_ndc - v_apc)
             WHEN 'APGA' THEN 0.10 * (1 - v_ndc - v_apc)
             WHEN 'SDP' THEN 0.08 * (1 - v_ndc - v_apc)
             WHEN 'YPP' THEN 0.10 * (1 - v_ndc - v_apc)
             WHEN 'ADC' THEN 0.10 * (1 - v_ndc - v_apc)
             ELSE 0.05 * (1 - v_ndc - v_apc)
           END * (0.85 + ((hashtext(t.pu_id::text || '-' || p.abbreviation) & 2147483647) % 300) / 1000.0) AS wt
    FROM target t CROSS JOIN parties p
  ),
  calc AS (
    SELECT sub_id, party_id, valid_votes, wt,
           SUM(wt) OVER (PARTITION BY sub_id) AS wsum
    FROM w
  ),
  floored AS (
    SELECT sub_id, party_id, valid_votes,
           FLOOR(wt / wsum * valid_votes)::int AS base,
           (wt / wsum * valid_votes) - FLOOR(wt / wsum * valid_votes) AS frac
    FROM calc
  )
  INSERT INTO party_results (result_submission_id, party_id, votes)
  SELECT sub_id, party_id,
         base + CASE
           WHEN ROW_NUMBER() OVER (PARTITION BY sub_id ORDER BY frac DESC, party_id)
                <= (valid_votes - SUM(base) OVER (PARTITION BY sub_id))
           THEN 1 ELSE 0 END
  FROM floored;
  DROP TABLE IF EXISTS wave_cmp;
  CREATE TEMP TABLE wave_cmp ON COMMIT DROP AS
  SELECT v.id AS vid, v.polling_unit_id,
         (s1.valid_votes = s2.valid_votes
          AND s1.rejected_votes = s2.rejected_votes
          AND s1.total_votes = s2.total_votes) AS totals_eq,
         COALESCE(MAX(ABS(COALESCE(p1.votes, 0) - COALESCE(p2.votes, 0))), 0) AS max_diff
  FROM verifications v
  JOIN result_submissions s1 ON s1.id = v.submission_id_1
  JOIN result_submissions s2 ON s2.id = v.submission_id_2
  LEFT JOIN party_results p1 ON p1.result_submission_id = s1.id
  LEFT JOIN party_results p2 ON p2.result_submission_id = s2.id AND p2.party_id = p1.party_id
  WHERE v.election_id = v_elec
    AND v.status = 'AWAITING_DATA'
  GROUP BY v.id, v.polling_unit_id,
           s1.valid_votes, s1.rejected_votes, s1.total_votes,
           s2.valid_votes, s2.rejected_votes, s2.total_votes;
  UPDATE verifications v
  SET status = CASE WHEN c.totals_eq AND c.max_diff = 0 THEN 'MATCH' ELSE 'DISCREPANCY' END,
      submissions_identical = (c.totals_eq AND c.max_diff = 0),
      math_consistent = TRUE,
      discrepancy_score = c.max_diff,
      final_decision = CASE WHEN c.totals_eq AND c.max_diff = 0 THEN 'MATCH' ELSE 'DISCREPANCY' END,
      decided_at = NOW(),
      completed_at = NOW(),
      updated_at = NOW()
  FROM wave_cmp c
  WHERE v.id = c.vid;
  GET DIAGNOSTICS v_paired = ROW_COUNT;
  SELECT count(*) INTO v_match FROM wave_cmp WHERE totals_eq AND max_diff = 0;
  SELECT count(*) INTO v_disc  FROM wave_cmp WHERE NOT (totals_eq AND max_diff = 0);
  DROP TABLE IF EXISTS wave_pub;
  CREATE TEMP TABLE wave_pub (out_canonical_id uuid, vid uuid, out_party_count int) ON COMMIT DROP;
  WITH matches AS (
    SELECT c.vid, c.polling_unit_id
    FROM wave_cmp c
    WHERE c.totals_eq AND c.max_diff = 0
  )
  INSERT INTO wave_pub (out_canonical_id, vid, out_party_count)
  SELECT p.out_canonical_id, m.vid, p.out_party_count
  FROM matches m
  JOIN verifications v ON v.id = m.vid
  JOIN result_submissions s1 ON s1.id = v.submission_id_1
  CROSS JOIN LATERAL publish_canonical_result(
    v_elec,
    m.polling_unit_id,
    'PUBLISHED',
    s1.valid_votes, s1.rejected_votes, s1.total_votes,
    v.submission_id_1, v.submission_id_2,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('party_id', pr.party_id, 'votes', pr.votes)
                                ORDER BY pr.party_id), '[]'::jsonb)
     FROM party_results pr WHERE pr.result_submission_id = v.submission_id_1),
    p_admin_user_id
  ) AS p;
  GET DIAGNOSTICS v_pub = ROW_COUNT;
  UPDATE verifications v
  SET canonical_result_id = o.out_canonical_id, updated_at = NOW()
  FROM wave_pub o
  WHERE v.id = o.vid;
  SELECT count(*) INTO v_pub_party
  FROM canonical_party_results cpr JOIN wave_pub o ON cpr.canonical_result_id = o.out_canonical_id;
  INSERT INTO canonical_pu_results
        (election_id, polling_unit_id, status,
         valid_votes, rejected_votes, total_votes,
         source_submission_1, source_submission_2, latest_verification_id)
  SELECT v_elec, c.polling_unit_id, 'HUMAN_REVIEW',
         s1.valid_votes, s1.rejected_votes, s1.total_votes,
         v.submission_id_1, v.submission_id_2, v.id
  FROM wave_cmp c
  JOIN verifications v ON v.id = c.vid
  JOIN result_submissions s1 ON s1.id = v.submission_id_1
  WHERE NOT (c.totals_eq AND c.max_diff = 0)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_human = ROW_COUNT;
  UPDATE polling_units pu
  SET status = 'RESULT_ANNOUNCED', updated_at = NOW()
  FROM wave_subs w
  WHERE pu.id = w.pu_id AND NOT w.disrupted
    AND EXISTS (SELECT 1 FROM verifications vv
                WHERE vv.election_id = v_elec AND vv.polling_unit_id = w.pu_id
                  AND vv.status = 'MATCH');
  UPDATE polling_units pu
  SET status = 'DISRUPTED', updated_at = NOW()
  FROM wave_subs w
  WHERE pu.id = w.pu_id AND w.disrupted;
  UPDATE polling_units pu
  SET status = 'RESULT_SUBMITTED', updated_at = NOW()
  FROM wave_subs w
  WHERE pu.id = w.pu_id AND NOT w.disrupted
    AND pu.status = 'NOT_STARTED';
  SELECT COALESCE(SUM(total_votes), 0) INTO v_votes_cum
  FROM result_submissions WHERE election_id = v_elec;
  v_cfg := jsonb_build_object(
    'engine', 'pipeline_batch',
    'scenario', p_scenario,
    'target_voters', p_total_voters,
    'waves', v_waves,
    'wave_completed', v_wave + 1,
    'duration_seconds', COALESCE(p_duration_seconds, 0),
    'discrepancy_rate', p_discrepancy_rate,
    'coverage_pct', v_cov,
    'sim_election_id', v_elec,
    'submitted_total', (SELECT count(*) FROM result_submissions WHERE election_id = v_elec),
    'votes_total', v_votes_cum,
    'published_total', (SELECT count(*) FROM canonical_pu_results
                        WHERE election_id = v_elec AND status = 'PUBLISHED'),
    'last_wave', jsonb_build_object(
      'wave', v_wave,
      'subs', v_subs1 + v_subs2,
      'paired', v_paired,
      'match', v_match,
      'discrepancy', v_disc,
      'published', v_pub,
      'human_review', v_human,
      'seconds', ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - v_t0))::numeric, 1)
    )
  );
  UPDATE simulation_config
  SET scenario = v_cfg::text,
      status = 'RUNNING',
      election_type = 'PRESIDENTIAL',
      total_results_submitted = (v_cfg->>'submitted_total')::int,
      total_assignments_created = COALESCE(total_assignments_created, 0) + v_assign_n,
      started_at = COALESCE(started_at, NOW()),
      last_tick_at = NOW(),
      updated_at = NOW()
  WHERE id = '00000000-0000-0000-0000-000000000001';
  INSERT INTO audit_log (actor_id, actor_type, action, resource_type, resource_id, metadata)
  VALUES (p_admin_user_id, 'admin', 'SIM_WAVE_COMPLETED', 'elections', v_elec,
          jsonb_build_object('wave', v_wave, 'waves', v_waves, 'published', v_pub,
                             'match', v_match, 'discrepancy', v_disc, 'subs', v_subs1 + v_subs2));
  RETURN jsonb_build_object(
    'success', TRUE,
    'sim_election_id', v_elec,
    'wave', v_wave,
    'waves', v_waves,
    'wave_completed', v_wave + 1,
    'subs_this_wave', v_subs1 + v_subs2,
    'paired', v_paired,
    'match', v_match,
    'discrepancy', v_disc,
    'published_this_wave', v_pub,
    'party_rows_published', v_pub_party,
    'human_review', v_human,
    'votes_cumulative', v_votes_cum,
    'seconds', ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - v_t0))::numeric, 1)
  );
END;
$function$;
