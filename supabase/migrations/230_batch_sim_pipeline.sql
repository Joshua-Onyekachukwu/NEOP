-- ============================================================
-- NEOP 230 — BATCH PIPELINE SIMULATION ENGINE + LIVE-DATA RESET
--
-- What this gives NEOP:
--   1. neop_reset_live_data(): one-call reset of all [SIM]/[TEST]
--      debris (elections + submissions + verifications + canonicals
--      + sim volunteers + config), leaving the seeded real-election
--      data untouched.
--   2. neop_sim_wave(): ONE wave of a set-based simulation that runs
--      the REAL pipeline entirely inside Postgres:
--        result_submissions INSERT
--          -> trg_rs_timeline pairs both agents into verifications
--          -> deterministic comparison (set-based)
--          -> MATCH rows published via the REAL publish_canonical_result RPC
--          -> DISCREPANCY rows parked as HUMAN_REVIEW canonicals
--      Because published rows land in canonical_pu_results /
--      canonical_party_results (what the live site reads through
--      mv_public_published_results), the simulation ACTUALLY RENDERS
--      on the public site — the legacy run_sim_upgraded() never did
--      (it wrote a phantom party_votes column on result_submissions).
--
-- Why waves: each wave is its own transaction (called once per RPC
-- from the admin route), so a long 20M-vote run commits progressively
-- instead of one giant all-or-nothing statement, and the dashboard
-- progress bar moves between waves.
--
-- Vote model: Dirichlet-style weights x regional multipliers +
-- largest-remainder allocation, so sum(party_results.votes) ==
-- valid_votes EXACTLY on every submission (S5 invariant). NDC leads
-- in every scenario (landslide / sweep / close).
-- ============================================================

-- Regional strength multipliers (mirrors legacy geography table)
CREATE OR REPLACE FUNCTION public.neop_state_mult(p_state TEXT, p_party TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_party
    WHEN 'NDC' THEN CASE p_state
      WHEN 'Abia' THEN 1.9 WHEN 'Anambra' THEN 1.9 WHEN 'Ebonyi' THEN 1.9
      WHEN 'Enugu' THEN 1.9 WHEN 'Imo' THEN 1.9
      WHEN 'Rivers' THEN 1.6 WHEN 'Delta' THEN 1.6 WHEN 'Bayelsa' THEN 1.6
      WHEN 'Akwa Ibom' THEN 1.6 WHEN 'Cross River' THEN 1.6 WHEN 'Edo' THEN 1.6
      WHEN 'FCT' THEN 1.2
      WHEN 'Borno' THEN 0.7 WHEN 'Yobe' THEN 0.7 WHEN 'Adamawa' THEN 0.7
      WHEN 'Gombe' THEN 0.7 WHEN 'Taraba' THEN 0.7 WHEN 'Bauchi' THEN 0.7
      WHEN 'Kano' THEN 0.6 WHEN 'Katsina' THEN 0.6 WHEN 'Sokoto' THEN 0.6
      WHEN 'Zamfara' THEN 0.6 WHEN 'Kebbi' THEN 0.6 WHEN 'Jigawa' THEN 0.6
      WHEN 'Kaduna' THEN 0.6
      WHEN 'Lagos' THEN 0.5 WHEN 'Ogun' THEN 0.5 WHEN 'Oyo' THEN 0.5
      WHEN 'Ondo' THEN 0.5 WHEN 'Osun' THEN 0.5 WHEN 'Ekiti' THEN 0.5
      ELSE 1.0 END
    WHEN 'APC' THEN CASE p_state
      WHEN 'Lagos' THEN 1.5 WHEN 'Ogun' THEN 1.5 WHEN 'Oyo' THEN 1.5
      WHEN 'Ondo' THEN 1.5 WHEN 'Osun' THEN 1.5 WHEN 'Ekiti' THEN 1.5
      WHEN 'Kano' THEN 1.4 WHEN 'Katsina' THEN 1.4 WHEN 'Sokoto' THEN 1.4
      WHEN 'Zamfara' THEN 1.4 WHEN 'Kebbi' THEN 1.4 WHEN 'Jigawa' THEN 1.4
      WHEN 'Kaduna' THEN 1.4
      WHEN 'Borno' THEN 1.3 WHEN 'Yobe' THEN 1.3 WHEN 'Adamawa' THEN 1.3
      WHEN 'Gombe' THEN 1.3 WHEN 'Taraba' THEN 1.3 WHEN 'Bauchi' THEN 1.3
      WHEN 'Niger' THEN 1.1 WHEN 'Kwara' THEN 1.1 WHEN 'Kogi' THEN 1.1
      WHEN 'Benue' THEN 1.1 WHEN 'Plateau' THEN 1.1 WHEN 'Nasarawa' THEN 1.1
      WHEN 'Rivers' THEN 0.4 WHEN 'Delta' THEN 0.4 WHEN 'Bayelsa' THEN 0.4
      WHEN 'Akwa Ibom' THEN 0.4 WHEN 'Cross River' THEN 0.4 WHEN 'Edo' THEN 0.4
      WHEN 'Abia' THEN 0.3 WHEN 'Anambra' THEN 0.3 WHEN 'Ebonyi' THEN 0.3
      WHEN 'Enugu' THEN 0.3 WHEN 'Imo' THEN 0.3
      ELSE 1.0 END
    ELSE 1.0
  END;
$$;

-- ------------------------------------------------------------
-- Speed up the route-side anti-join used by init/assignments
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_aa_elec_pu_obs
  ON public.agent_assignments (election_id, polling_unit_id, observer_number);

-- ============================================================
-- PART A — RESET LIVE DATA
-- ============================================================
CREATE OR REPLACE FUNCTION public.neop_reset_live_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '240s'
SET lock_timeout = '30s'
AS $fn$
DECLARE
  v_elec_count INT;
  v_sub BIGINT; v_party_rows BIGINT; v_ver BIGINT; v_can BIGINT; v_cparty BIGINT;
  v_vol BIGINT; v_ua BIGINT; v_assign BIGINT; v_tl BIGINT; v_dl BIGINT; v_inc BIGINT;
  v_obs BIGINT; v_ev BIGINT;
BEGIN
  CREATE TEMP TABLE _sim_elec_ids ON COMMIT DROP AS
    SELECT id FROM elections WHERE name LIKE '[SIM]%' OR name LIKE '[TEST]%';

  SELECT count(*) INTO v_elec_count FROM _sim_elec_ids;

  -- config first so FKs to elections can be dropped
  UPDATE system_config
  SET data_mode = 'AWAITING_DATA',
      active_election_id = NULL,
      simulation_election_id = NULL,
      last_updated_at = NOW()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  DELETE FROM canonical_party_results cpr
  USING canonical_pu_results c
  WHERE cpr.canonical_result_id = c.id
    AND c.election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_cparty = ROW_COUNT;

  DELETE FROM canonical_pu_results c
  WHERE c.election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_can = ROW_COUNT;

  DELETE FROM verification_timeline_events e
  USING verifications v
  WHERE e.verification_id = v.id
    AND v.election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_tl = ROW_COUNT;

  DELETE FROM verifications
  WHERE election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_ver = ROW_COUNT;

  DELETE FROM party_results pr
  USING result_submissions rs
  WHERE pr.result_submission_id = rs.id
    AND rs.election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_party_rows = ROW_COUNT;

  DELETE FROM result_submissions
  WHERE election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_sub = ROW_COUNT;

  DELETE FROM incidents
  WHERE election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_inc = ROW_COUNT;

  DELETE FROM observations
  WHERE election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_obs = ROW_COUNT;

  DELETE FROM evidence_records
  WHERE election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_ev = ROW_COUNT;

  DELETE FROM agent_assignments
  WHERE election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_assign = ROW_COUNT;

  -- sim volunteers + their user_accounts (sim_batch_* and sim_observer_*)
  DELETE FROM volunteers v
  USING user_accounts ua
  WHERE v.user_id = ua.id
    AND (ua.email LIKE 'sim_batch_%@neop.ng' OR ua.email LIKE 'sim_%@neop.ng');
  GET DIAGNOSTICS v_vol = ROW_COUNT;

  DELETE FROM user_accounts ua
  WHERE (ua.email LIKE 'sim_batch_%@neop.ng' OR ua.email LIKE 'sim_%@neop.ng')
    AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE v.user_id = ua.id);
  GET DIAGNOSTICS v_ua = ROW_COUNT;

  DELETE FROM dead_letter_jobs
  WHERE context_election_id IN (SELECT id FROM _sim_elec_ids)
     OR (payload->>'election_id') IN (SELECT id::text FROM _sim_elec_ids);
  GET DIAGNOSTICS v_dl = ROW_COUNT;

  DELETE FROM elections WHERE id IN (SELECT id FROM _sim_elec_ids);

  UPDATE simulation_config
  SET status = 'IDLE',
      total_results_submitted = 0,
      total_incidents_submitted = 0,
      total_assignments_created = 0,
      started_at = NULL,
      last_tick_at = NULL,
      updated_at = NOW()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  UPDATE polling_units SET status = 'NOT_STARTED', updated_at = NOW()
  WHERE status <> 'NOT_STARTED';

  RETURN jsonb_build_object(
    'success', TRUE,
    'sim_elections_deleted', v_elec_count,
    'submissions_deleted', v_sub,
    'party_results_deleted', v_party_rows,
    'verifications_deleted', v_ver,
    'canonical_deleted', v_can,
    'canonical_party_deleted', v_cparty,
    'assignments_deleted', v_assign,
    'volunteers_deleted', v_vol,
    'user_accounts_deleted', v_ua,
    'timeline_deleted', v_tl,
    'dead_letter_deleted', v_dl,
    'incidents_deleted', v_inc,
    'observations_deleted', v_obs,
    'evidence_deleted', v_ev,
    'data_mode', 'AWAITING_DATA'
  );
END;
$fn$;

-- ============================================================
-- PART B — ONE WAVE OF THE BATCH PIPELINE SIMULATION
-- ============================================================
CREATE OR REPLACE FUNCTION public.neop_sim_wave(
  p_scenario         TEXT DEFAULT 'landslide',
  p_total_voters     BIGINT DEFAULT 20000000,
  p_waves            INT DEFAULT 6,
  p_wave_index       INT DEFAULT 0,
  p_duration_seconds INT DEFAULT 0,
  p_discrepancy_rate NUMERIC DEFAULT 0.05,
  p_admin_user_id    UUID DEFAULT NULL,
  p_election_id      UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
SET lock_timeout = '30s'
AS $fn$
DECLARE
  v_t0        timestamptz := clock_timestamp();
  v_elec      UUID := p_election_id;
  v_wave      INT := GREATEST(0, COALESCE(p_wave_index, 0));
  v_waves     INT := GREATEST(1, LEAST(48, COALESCE(p_waves, 6)));
  v_ndc       NUMERIC;
  v_apc       NUMERIC;
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
  v_ns        CONSTANT uuid := '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; -- DNS ns
  v_cfg       JSONB;
  v_elap      NUMERIC;
  v_target    NUMERIC;
  v_assign_n  BIGINT := 0;
BEGIN
  ----------------------------------------------------------------
  -- WAVE 0 = INIT: election + shared sim agents + 2 assignments/PU
  ----------------------------------------------------------------
  IF v_wave = 0 THEN
    IF v_elec IS NULL THEN
      INSERT INTO elections (name, type, status)
      VALUES (
        '[SIM] Pipeline ' || to_char(NOW(), 'MM-DD HH24:MI:SS') || ' '
          || p_scenario || ' ' || (p_total_voters / 1000000)::text || 'M w' || v_waves::text,
        'PRESIDENTIAL',
        'ACTIVE'
      )
      RETURNING id INTO v_elec;
    END IF;

    -- Shared agent pool (slots 1-60 = observer #1 role, 61-120 = #2)
    INSERT INTO user_accounts (id, email, full_name, auth_provider)
    SELECT uuid_generate_v5(v_ns, 'neop-sim-batch-' || g),
           'sim_batch_' || g || '@neop.ng',
           'Sim Batch Agent ' || g,
           'google'
    FROM generate_series(1, 120) g
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO volunteers (user_id, status, verification_status, training_status)
    SELECT id, 'ACTIVE', 'VERIFIED', 'COMPLETED'
    FROM user_accounts
    WHERE email LIKE 'sim_batch_%@neop.ng'
    ON CONFLICT (user_id) DO NOTHING;

    -- Two CHECKED_IN agents per PU (idempotent on re-init)
    INSERT INTO agent_assignments
          (election_id, polling_unit_id, volunteer_id, observer_number,
           status, location_verified, checked_in_at)
    SELECT v_elec, pu.id, ua.id, a.obs, 'CHECKED_IN', TRUE, NOW()
    FROM polling_units pu
    CROSS JOIN LATERAL (
      SELECT 1 + ((hashtext(pu.id::text || 'N') & 2147483647) % 60) AS s1,
             61 + ((hashtext(pu.id::text || 'S') & 2147483647) % 60) AS s2
    ) sl
    CROSS JOIN LATERAL (VALUES (1, sl.s1), (2, sl.s2)) AS a(obs, slot)
    JOIN user_accounts ua ON ua.email = 'sim_batch_' || a.slot || '@neop.ng'
    WHERE NOT EXISTS (
      SELECT 1 FROM agent_assignments aa
      WHERE aa.election_id = v_elec
        AND aa.polling_unit_id = pu.id
        AND aa.observer_number = a.obs
    );
    GET DIAGNOSTICS v_assign_n = ROW_COUNT;
  END IF;

  IF v_elec IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'p_election_id required when p_wave_index > 0');
  END IF;

  ----------------------------------------------------------------
  -- Scenario weights
  ----------------------------------------------------------------
  v_ndc := CASE p_scenario WHEN 'landslide' THEN 0.42 WHEN 'sweep' THEN 0.37
            WHEN 'close' THEN 0.30 ELSE 0.37 END;
  v_apc := CASE p_scenario WHEN 'landslide' THEN 0.22 WHEN 'sweep' THEN 0.25
            WHEN 'close' THEN 0.28 ELSE 0.25 END;

  SELECT count(*) INTO v_pus_total FROM polling_units;

  ----------------------------------------------------------------
  -- 1. Simulated agent submissions for this wave's national slice
  --    (slice = hash band so every wave is a national sample)
  ----------------------------------------------------------------
  CREATE TEMP TABLE wave_subs ON COMMIT DROP AS
  WITH pick AS (
    SELECT pu.id AS pu_id,
           ((hashtext(pu.id::text) & 2147483647) % 100) < 4 AS disrupted,
           GREATEST(50, ROUND(
             (p_total_voters::numeric / (v_pus_total * 0.96))
             * (0.75 + ((hashtext(pu.id::text || 'tv') & 2147483647) % 1000) / 2000.0)
           ))::int AS tv,
           (0.05 + ((hashtext(pu.id::text || 'rj') & 2147483647) % 100) / 1000.0) AS rr
    FROM polling_units pu
    WHERE ((hashtext(pu.id::text) & 2147483647) % v_waves) = v_wave
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
         1 + ((hashtext(t.pu_id::text || 'N') & 2147483647) % 60) AS slot1,
         61 + ((hashtext(t.pu_id::text || 'S') & 2147483647) % 60) AS slot2
  FROM truth t;

  -- Agent 1: every PU in the slice (disrupted PUs file a zero report)
  INSERT INTO result_submissions
        (election_id, polling_unit_id, volunteer_id,
         valid_votes, rejected_votes, total_votes,
         status, idempotency_key, submitted_at)
  SELECT v_elec, w.pu_id, ua.id,
         w.valid1, w.rej1, w.tot1,
         'UNVERIFIED',
         'sb1-' || substr(v_elec::text, 1, 8) || '-' || w.pu_id::text,
         NOW() - (random() * INTERVAL '20 seconds')
  FROM wave_subs w
  JOIN user_accounts ua ON ua.email = 'sim_batch_' || w.slot1 || '@neop.ng'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_subs1 = ROW_COUNT;

  -- Agent 2: skips disrupted PUs (that is why they never publish)
  INSERT INTO result_submissions
        (election_id, polling_unit_id, volunteer_id,
         valid_votes, rejected_votes, total_votes,
         status, idempotency_key, submitted_at)
  SELECT v_elec, w.pu_id, ua.id,
         w.valid2, w.rej2, w.tot2,
         'UNVERIFIED',
         'sb2-' || substr(v_elec::text, 1, 8) || '-' || w.pu_id::text,
         NOW() - (random() * INTERVAL '20 seconds')
  FROM wave_subs w
  JOIN user_accounts ua ON ua.email = 'sim_batch_' || w.slot2 || '@neop.ng'
  WHERE NOT w.disrupted
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_subs2 = ROW_COUNT;

  ----------------------------------------------------------------
  -- 2. party_results — largest-remainder allocation per submission
  --    (window functions, one pass; sum(party votes) == valid_votes)
  ----------------------------------------------------------------
  WITH target AS (
    SELECT rs.id AS sub_id, rs.valid_votes, st.name AS state_name
    FROM result_submissions rs
    JOIN polling_units pu ON pu.id = rs.polling_unit_id
    JOIN states st ON st.id = pu.state_id
    WHERE rs.election_id = v_elec
      AND rs.valid_votes > 0
      AND NOT EXISTS (SELECT 1 FROM party_results pr WHERE pr.result_submission_id = rs.id)
  ),
  w AS (
    SELECT t.sub_id, t.valid_votes, p.id AS party_id,
           CASE p.abbreviation
             WHEN 'NDC' THEN v_ndc * neop_state_mult(t.state_name, 'NDC')
             WHEN 'APC' THEN v_apc * neop_state_mult(t.state_name, 'APC')
             WHEN 'PDP' THEN 0.30 WHEN 'LP' THEN 0.20 WHEN 'NNPP' THEN 0.12
             WHEN 'APGA' THEN 0.10 WHEN 'SDP' THEN 0.08 WHEN 'YPP' THEN 0.10
             WHEN 'ADC' THEN 0.10 ELSE 0.05
           END * (0.85 + ((hashtext(t.sub_id::text || p.abbreviation) & 2147483647) % 300) / 1000.0) AS wt
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

  ----------------------------------------------------------------
  -- 3. Deterministic comparison — the trigger already paired both
  --    agent submissions into verifications (submission_id_1/_2)
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 4. PUBLISH through the REAL canonical RPC (set-invoked),
  --    evaluated ONLY on MATCH verifications. This is exactly what
  --    the agent pipeline does when two submissions agree. Match
  --    rows are filtered FIRST so the RPC never runs on a
  --    discrepancy row (a LATERAL would still execute for filtered
  --    rows if the filter came after the join).
  ----------------------------------------------------------------
  CREATE TEMP TABLE wave_pub (out_canonical_id uuid, vid uuid, out_party_count int);

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

  -- DISCREPANCY -> HUMAN_REVIEW canonical (admin queue), set-based
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

  ----------------------------------------------------------------
  -- 5. polling_units status (powers the admin status chips)
  ----------------------------------------------------------------
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

  ----------------------------------------------------------------
  -- 6. Progress heartbeat + pacing
  ----------------------------------------------------------------
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
      'assignments_created', v_assign_n,
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

  IF COALESCE(p_duration_seconds, 0) > 0 THEN
    v_elap := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0));
    v_target := (v_wave + 1) * (p_duration_seconds::numeric / v_waves);
    IF v_elap < v_target THEN
      PERFORM pg_sleep(LEAST(120, v_target - v_elap));
    END IF;
  END IF;

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
$fn$;

GRANT EXECUTE ON FUNCTION public.neop_reset_live_data() TO service_role;
GRANT EXECUTE ON FUNCTION public.neop_sim_wave(TEXT, BIGINT, INT, INT, INT, NUMERIC, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.neop_state_mult(TEXT, TEXT) TO service_role, authenticated, anon;
