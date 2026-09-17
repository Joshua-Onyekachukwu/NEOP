-- ============================================================
-- NEOP 258 — THE COVERAGE LEDGER AND THE RESULTS ENGINE MUST AGREE
--
-- Problem found during the 2026-09-17 production run: the ledger and
-- the published results disagreed by a factor of five.
--
--   assign_simulation_outcomes() planned the published set as a RANKED
--   slice — row_number() OVER (ORDER BY hashtext(pu||'pub')) <= pct*n.
--
--   neop_sim_wave() publishes a MODULO slice —
--   (hashtext(pu.id) & 0x7fffffff) % 100 < coverage_pct.
--
-- Two different subsets of the same 176,846 polling units, so a run that
-- really published 32,188 PUs reported "6,679 published" from the ledger.
-- Every surface derived from the ledger (reporting %, verified count,
-- reconciliation) then contradicted the results the user could see.
--
-- Fixes:
--   1. The ledger classifies PUs with the SAME predicates the wave uses,
--      so the two subsystems cannot drift:
--        disrupted  → (hashtext('dis:'||pu) % 100)  < disrupted_rate
--        discrepancy→ (hashtext(pu||'d1') % 1000)   < discrepancy_rate*1000
--        published  → covered, and neither of the above
--      Failed-verification / unavailable are modelled OUTSIDE the covered
--      set so a modelled status can never contradict a real result.
--   2. The published share is driven by p_coverage_pct alone (the same
--      lever the wave uses). p_max_published_pct remains an optional
--      upper bound and defaults to 1.0 (no demotion).
--   3. sync_simulation_progress() derives PUBLISHED and HUMAN_REVIEW from
--      canonical_pu_results — the single source of truth — instead of a
--      pre-computed flag. A run can no longer finish with a ledger that
--      disagrees with its own results.
-- ============================================================

CREATE OR REPLACE FUNCTION public.assign_simulation_outcomes(
  p_run uuid,
  p_dispute_rate numeric DEFAULT 0.05,
  p_failed_rate numeric DEFAULT 0.015,
  p_disrupted_rate numeric DEFAULT 0.02,
  p_unavailable_rate numeric DEFAULT 0.01,
  p_max_published_pct numeric DEFAULT 1.0,
  p_coverage_pct integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '600s'
AS $function$
DECLARE
  v_cov      int := GREATEST(1, LEAST(100, COALESCE(p_coverage_pct, 50)));
  v_dis_pct  int := GREATEST(0, LEAST(100, ROUND(COALESCE(p_disrupted_rate, 0.02) * 100)::int));
  v_fail_bp  int := GREATEST(0, LEAST(1000, ROUND(COALESCE(p_failed_rate, 0.015) * 1000)::int));
  v_unav_bp  int := GREATEST(0, LEAST(1000, ROUND(COALESCE(p_unavailable_rate, 0.01) * 1000)::int));
  v_disc_bp  int := GREATEST(0, LEAST(1000, ROUND(COALESCE(p_dispute_rate, 0.05) * 1000)::int));
  v_planned  bigint := 0;
  v_cap      numeric := LEAST(1.0, GREATEST(0.0, COALESCE(p_max_published_pct, 1.0)));
BEGIN
  -- Idempotent re-run: reset anything not already published by the engine.
  UPDATE pu_simulation_status
     SET sim_status = 'AWAITING', planned_published = false, outcome_assigned = false, updated_at = now()
   WHERE run_id = p_run AND sim_status <> 'PUBLISHED';

  -- ── Inside the covered set (the exact set neop_sim_wave touches) ──
  -- Disrupted: the wave's 'dis:' hash yields a lone submission and no result.
  UPDATE pu_simulation_status s
     SET sim_status = 'DISRUPTED', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND s.sim_status = 'AWAITING'
     AND ((hashtext(s.polling_unit_id::text) & 2147483647) % 100) < v_cov
     AND ((hashtext('dis:' || s.polling_unit_id::text) & 2147483647) % 100) < v_dis_pct;

  -- Discrepancy: the wave's pu||'d1' hash produces mismatched pairs, which it
  -- publishes as canonical HUMAN_REVIEW rather than as a counted result.
  UPDATE pu_simulation_status s
     SET sim_status = 'HUMAN_REVIEW', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND s.sim_status = 'AWAITING'
     AND ((hashtext(s.polling_unit_id::text) & 2147483647) % 100) < v_cov
     AND ((hashtext(s.polling_unit_id::text || 'd1') & 2147483647) % 1000) < v_disc_bp;

  -- Everything else in the covered set is planned to publish.
  UPDATE pu_simulation_status s
     SET planned_published = true, outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND s.sim_status = 'AWAITING'
     AND ((hashtext(s.polling_unit_id::text) & 2147483647) % 100) < v_cov;

  -- ── Outside the covered set: model the tail honestly ──
  -- These PUs never reported, so no published result can ever contradict them.
  UPDATE pu_simulation_status s
     SET sim_status = 'FAILED_VERIFICATION', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND s.sim_status = 'AWAITING'
     AND ((hashtext(s.polling_unit_id::text) & 2147483647) % 100) >= v_cov
     AND ((hashtext(s.polling_unit_id::text || 'fv') & 2147483647) % 1000) < v_fail_bp;

  UPDATE pu_simulation_status s
     SET sim_status = 'UNAVAILABLE', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND s.sim_status = 'AWAITING'
     AND ((hashtext(s.polling_unit_id::text) & 2147483647) % 100) >= v_cov
     AND ((hashtext(s.polling_unit_id::text || 'un') & 2147483647) % 1000) < v_unav_bp;

  -- Optional upper bound on the published share (default 1.0 = no demotion).
  IF v_cap < 1.0 THEN
    WITH plan AS (
      SELECT id,
             row_number() OVER (ORDER BY (hashtext(polling_unit_id::text || 'pub') & 2147483647)) AS rn,
             count(*) OVER () AS n
        FROM pu_simulation_status
       WHERE run_id = p_run AND planned_published
    )
    UPDATE pu_simulation_status s
       SET planned_published = false, updated_at = now()
      FROM plan x
     WHERE s.id = x.id AND x.rn > floor(x.n * v_cap);
  END IF;

  SELECT count(*) INTO v_planned
    FROM pu_simulation_status WHERE run_id = p_run AND planned_published;

  RETURN jsonb_build_object(
    'run_id', p_run, 'coverage_pct', v_cov, 'planned_published', v_planned,
    'disrupted', (SELECT count(*) FROM pu_simulation_status WHERE run_id = p_run AND sim_status = 'DISRUPTED'),
    'human_review', (SELECT count(*) FROM pu_simulation_status WHERE run_id = p_run AND sim_status = 'HUMAN_REVIEW'),
    'failed', (SELECT count(*) FROM pu_simulation_status WHERE run_id = p_run AND sim_status = 'FAILED_VERIFICATION'),
    'unavailable', (SELECT count(*) FROM pu_simulation_status WHERE run_id = p_run AND sim_status = 'UNAVAILABLE'),
    'awaiting', (SELECT count(*) FROM pu_simulation_status WHERE run_id = p_run AND sim_status = 'AWAITING')
  );
END $function$;

CREATE OR REPLACE FUNCTION public.sync_simulation_progress(p_run uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '600s'
AS $function$
DECLARE
  v_run uuid := COALESCE(p_run, (SELECT run_id FROM simulation_lock WHERE id = 1 AND locked_at IS NOT NULL));
  v_eid uuid;
  v_rec simulation_runs%ROWTYPE;
BEGIN
  IF v_run IS NULL THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT * INTO v_rec FROM simulation_runs WHERE id = v_run;
  IF NOT FOUND THEN RETURN jsonb_build_object('active', false); END IF;
  v_eid := v_rec.election_id;

  IF v_eid IS NOT NULL THEN
    -- PUBLISHED is defined by the results themselves, not by a plan flag.
    -- (The previous version gated on planned_published and therefore reported
    -- a different subset than the one actually rendered on the site.)
    UPDATE pu_simulation_status s
       SET sim_status = 'PUBLISHED', published_result_id = c.id, updated_at = now()
      FROM canonical_pu_results c
     WHERE s.run_id = v_run
       AND s.sim_status <> 'PUBLISHED'
       AND c.election_id = v_eid AND c.polling_unit_id = s.polling_unit_id
       AND c.status = 'PUBLISHED';

    -- Verified pairs that disagreed surface as human review, again straight
    -- from the results table.
    UPDATE pu_simulation_status s
       SET sim_status = 'HUMAN_REVIEW', published_result_id = c.id, outcome_assigned = true, updated_at = now()
      FROM canonical_pu_results c
     WHERE s.run_id = v_run
       AND s.sim_status = 'AWAITING'
       AND c.election_id = v_eid AND c.polling_unit_id = s.polling_unit_id
       AND c.status = 'HUMAN_REVIEW';
  END IF;

  UPDATE simulation_runs r SET
    published_pus   = COALESCE(a.pub, 0),
    dispute_pus     = COALESCE(a.hr, r.dispute_pus),
    failed_pus      = COALESCE(a.fv, r.failed_pus),
    disrupted_pus   = COALESCE(a.dz, r.disrupted_pus),
    unavailable_pus = COALESCE(a.un, r.unavailable_pus),
    awaiting_pus    = COALESCE(a.aw, 0),
    other_pus       = COALESCE(a.ot, 0),
    total_votes     = COALESCE(v.votes, 0)
  FROM (SELECT 1) _(x),
  LATERAL (
    SELECT
      count(*) FILTER (WHERE sim_status = 'PUBLISHED') pub,
      count(*) FILTER (WHERE sim_status = 'HUMAN_REVIEW') hr,
      count(*) FILTER (WHERE sim_status = 'FAILED_VERIFICATION') fv,
      count(*) FILTER (WHERE sim_status = 'DISRUPTED') dz,
      count(*) FILTER (WHERE sim_status = 'UNAVAILABLE') un,
      count(*) FILTER (WHERE sim_status = 'AWAITING') aw,
      count(*) FILTER (WHERE sim_status NOT IN ('PUBLISHED','HUMAN_REVIEW','FAILED_VERIFICATION','DISRUPTED','UNAVAILABLE','AWAITING')) ot
    FROM pu_simulation_status WHERE run_id = v_run
  ) a,
  LATERAL (
    SELECT COALESCE(SUM(total_votes), 0) votes FROM canonical_pu_results
    WHERE v_eid IS NOT NULL AND election_id = v_eid AND status = 'PUBLISHED'
  ) v
  WHERE r.id = v_run;

  SELECT * INTO v_rec FROM simulation_runs WHERE id = v_run;

  -- The run is complete once no planned PU is still AWAITING. Since the wave
  -- engine finalizes every planned PU (published or human review) this is the
  -- honest end-of-run condition; counting only 'PUBLISHED' would never finish.
  IF v_rec.status = 'RUNNING' AND v_rec.awaiting_pus = 0
     AND (SELECT count(*) FROM pu_simulation_status
          WHERE run_id = v_run AND planned_published AND sim_status = 'AWAITING') = 0 THEN
    UPDATE simulation_runs SET status = 'COMPLETED', completed_at = now() WHERE id = v_run;
    UPDATE simulation_lock SET locked_at = NULL, run_id = NULL WHERE id = 1 AND run_id = v_run;
    SELECT * INTO v_rec FROM simulation_runs WHERE id = v_run;
  END IF;

  RETURN jsonb_build_object(
    'active', true, 'run_id', v_run, 'status', v_rec.status,
    'total_pus', v_rec.total_pus, 'published_pus', v_rec.published_pus,
    'dispute_pus', v_rec.dispute_pus, 'failed_pus', v_rec.failed_pus,
    'disrupted_pus', v_rec.disrupted_pus, 'unavailable_pus', v_rec.unavailable_pus,
    'awaiting_pus', v_rec.awaiting_pus, 'other_pus', v_rec.other_pus,
    'total_votes', v_rec.total_votes,
    'accounted_pus', v_rec.total_pus - v_rec.awaiting_pus
  );
END $function$;
