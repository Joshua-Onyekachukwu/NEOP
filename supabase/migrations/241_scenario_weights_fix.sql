-- ============================================================
-- NEOP 241 — SCENARIO WEIGHT FIX
--
-- The party allocation CASE used absolute weights: NDC 0.42 + APC 0.22
-- + all minor parties 1.00 = 1.64, then normalized by the sum — so NDC
-- rendered at 0.42/1.64 ≈ 25% instead of the intended 42% (the
-- "landslide" looked like a 6-point plurality). Minor-party weights are
-- now rescaled by (1 - v_ndc - v_apc) so the scenario targets hold:
-- landslide → NDC 42% / APC 22% / others 36% (20-point win).
-- ============================================================

CREATE OR REPLACE FUNCTION public.neop_sim_wave(p_scenario text DEFAULT 'landslide'::text, p_total_voters bigint DEFAULT 20000000, p_waves integer DEFAULT 6, p_wave_index integer DEFAULT 0, p_duration_seconds integer DEFAULT 0, p_discrepancy_rate numeric DEFAULT 0.05, p_admin_user_id uuid DEFAULT NULL::uuid, p_election_id uuid DEFAULT NULL::uuid, p_init_chunk integer DEFAULT NULL::integer, p_init_chunks integer DEFAULT NULL::integer, p_data_chunk integer DEFAULT NULL::integer, p_data_chunks integer DEFAULT NULL::integer, p_coverage_pct integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '120s'
 SET lock_timeout TO '30s'
AS $function$
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
  v_ns        CONSTANT uuid := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  v_cfg       JSONB;
  v_assign_n  BIGINT := 0;
  v_cov       INT;
BEGIN
  v_cov := GREATEST(1, LEAST(100, COALESCE(p_coverage_pct, 100)));

  -- Self-init: wave 0 may create the [SIM] election; later waves need it.
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

  -- Wave-0 init: mint the sim agents for THIS data chunk's PUs at coverage.
  -- Deterministic uuids + ON CONFLICT make repeat calls idempotent.
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
           OR ((hashtext(pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO volunteers (id, user_id, status, verification_status, training_status)
    SELECT x.uid, x.uid, 'ACTIVE', 'VERIFIED', 'COMPLETED'
    FROM (
      SELECT uuid_generate_v5(v_ns, 'neop-sim-obs-' || pu.id::text || '-' || a.role) AS uid
      FROM polling_units pu
      CROSS JOIN LATERAL (VALUES ('N'), ('S')) AS a(role)
      WHERE ((hashtext(pu.id::text) & 2147483647) % 100) < v_cov
        AND (p_data_chunks IS NULL
             OR ((hashtext(pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
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
           OR ((hashtext(pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
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

  SELECT count(*) INTO v_pus_total FROM polling_units;

  DROP TABLE IF EXISTS wave_subs;
  CREATE TEMP TABLE wave_subs ON COMMIT DROP AS
  WITH pick AS (
    SELECT pu.id AS pu_id,
           ((hashtext(pu.id::text) & 2147483647) % 100) < 4 AS disrupted,
           GREATEST(50, ROUND(
             (p_total_voters::numeric / GREATEST(1, v_pus_total * v_cov / 100.0))
             * (0.75 + ((hashtext(pu.id::text || 'tv') & 2147483647) % 1000) / 2000.0)
           ))::int AS tv,
           (0.05 + ((hashtext(pu.id::text || 'rj') & 2147483647) % 100) / 1000.0) AS rr
    FROM polling_units pu
    WHERE ((hashtext(pu.id::text) & 2147483647) % v_waves) = v_wave
      AND ((hashtext(pu.id::text) & 2147483647) % 100) < v_cov
      AND (p_data_chunks IS NULL
           OR ((hashtext(pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
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
    SELECT rs.id AS sub_id, rs.polling_unit_id AS pu_id, rs.valid_votes, st.name AS state_name
    FROM result_submissions rs
    JOIN polling_units pu ON pu.id = rs.polling_unit_id
    JOIN states st ON st.id = pu.state_id
    WHERE rs.election_id = v_elec
      AND rs.valid_votes > 0
      AND (p_data_chunks IS NULL
           OR ((hashtext(rs.polling_unit_id::text) & 2147483647) % p_data_chunks) = p_data_chunk)
      AND NOT EXISTS (SELECT 1 FROM party_results pr WHERE pr.result_submission_id = rs.id)
  ),
  w AS (
    SELECT t.sub_id, t.valid_votes, p.id AS party_id,
           CASE p.abbreviation
             WHEN 'NDC' THEN v_ndc * neop_state_mult(t.state_name, 'NDC')
             WHEN 'APC' THEN v_apc * neop_state_mult(t.state_name, 'APC')
             WHEN 'PDP' THEN 0.30 * (1 - v_ndc - v_apc)
             WHEN 'LP' THEN 0.20 * (1 - v_ndc - v_apc)
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