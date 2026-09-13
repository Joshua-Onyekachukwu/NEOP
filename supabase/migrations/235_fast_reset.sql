-- ============================================================
-- NEOP 235 — FAST RESET
--
-- Two problems made neop_reset_live_data() exceed the hosted
-- gateway timeout once ~350k observers + ~600k submissions existed:
--
-- 1. Missing FK-support indexes: result_submissions.volunteer_id and
--    result_submissions.election_id had none, so every parent delete
--    (volunteers, elections-cascade checks) forced full scans.
-- 2. Per-row AFTER DELETE triggers (timeline/audit) firing for each
--    of ~1M deleted rows dominate runtime.
--
-- Fixes: add both indexes; run the reset body under
-- session_replication_role = replica so row triggers and FK
-- re-checks are skipped (the delete order below already keeps
-- referential integrity; SET LOCAL scope ends with the call).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_rs_election
  ON public.result_submissions (election_id);

CREATE INDEX IF NOT EXISTS idx_rs_volunteer
  ON public.result_submissions (volunteer_id);

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
  v_obs BIGINT; v_ev BIGINT; v_orphan_assign BIGINT; v_orphan_subs BIGINT;
  v_orphan_tmp BIGINT;
BEGIN
  -- Skip per-row triggers (audit/timeline) and FK re-checks during the
  -- bulk sim cleanup. The explicit child-first order below preserves
  -- referential integrity. SECURITY DEFINER owner (postgres) permits it;
  -- SET LOCAL expires with this call's transaction.
  SET LOCAL session_replication_role = replica;

  CREATE TEMP TABLE _sim_elec_ids ON COMMIT DROP AS
    SELECT id FROM elections
    WHERE left(name, 5) = '[SIM]' OR left(name, 6) = '[TEST]';

  SELECT count(*) INTO v_elec_count FROM _sim_elec_ids;

  UPDATE system_config
  SET data_mode = 'AWAITING_DATA',
      active_election_id = NULL,
      simulation_election_id = NULL,
      last_updated_at = NOW()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  -- FK-safe order: children first. verifications.canonical_result_id
  -- references canonical_pu_results, so verifications (and their
  -- timeline events) MUST go before canonical rows.
  DELETE FROM canonical_party_results cpr
  USING canonical_pu_results c
  WHERE cpr.canonical_result_id = c.id
    AND c.election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_cparty = ROW_COUNT;

  DELETE FROM verification_timeline_events e
  USING verifications v
  WHERE e.verification_id = v.id
    AND v.election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_tl = ROW_COUNT;

  DELETE FROM verifications
  WHERE election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_ver = ROW_COUNT;

  DELETE FROM canonical_pu_results c
  WHERE c.election_id IN (SELECT id FROM _sim_elec_ids);
  GET DIAGNOSTICS v_can = ROW_COUNT;

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

  -- Orphan mop-up: assignments/submissions belonging to sim observers
  -- whose election did not match the prefixes above (defensive; keeps
  -- the volunteer delete FK-safe in every case).
  DELETE FROM party_results pr
  USING result_submissions rs
  JOIN user_accounts ua ON ua.id = rs.volunteer_id
  WHERE pr.result_submission_id = rs.id
    AND ua.email LIKE 'sim_%@neop.ng';
  GET DIAGNOSTICS v_orphan_subs = ROW_COUNT;

  DELETE FROM result_submissions rs
  USING user_accounts ua
  WHERE rs.volunteer_id = ua.id
    AND ua.email LIKE 'sim_%@neop.ng';
  GET DIAGNOSTICS v_orphan_tmp = ROW_COUNT;
  v_orphan_subs := v_orphan_subs + v_orphan_tmp;

  DELETE FROM agent_assignments aa
  USING user_accounts ua
  WHERE aa.volunteer_id = ua.id
    AND ua.email LIKE 'sim_%@neop.ng';
  GET DIAGNOSTICS v_orphan_assign = ROW_COUNT;

  -- simulated observers: sim_obs_<pu>-N/S@neop.ng and legacy sim_batch_*
  DELETE FROM volunteers v
  USING user_accounts ua
  WHERE v.user_id = ua.id
    AND (ua.email LIKE 'sim_%@neop.ng');
  GET DIAGNOSTICS v_vol = ROW_COUNT;

  DELETE FROM user_accounts ua
  WHERE ua.email LIKE 'sim_%@neop.ng'
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
    'orphan_assignments_deleted', v_orphan_assign,
    'orphan_submissions_deleted', v_orphan_subs,
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

GRANT EXECUTE ON FUNCTION public.neop_reset_live_data() TO service_role;
