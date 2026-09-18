-- ============================================================
-- NEOP 267 — HARD INTERLOCK: THE PUBLIC DATASET IS UNPURGEABLE
--
-- Observed loss: a freshly published dataset (canonical results +
-- submissions) was destroyed minutes after a successful publish.
-- Every historical path that deletes sim data — preflight cleanup,
-- superseded-run purge, the legacy reset sweep — resolves "what is
-- debris" independently, and they disagreed with the publisher.
--
-- Fix: move the invariant into the deleter itself.
--   1. purge_simulation_run REFUSES to purge a run whose election is
--      the currently active public dataset (system_config.active_
--      election_id), no matter who calls it or when. Callers already
--      tolerate a refused purge (exception-guarded loops), and the
--      refusal is idempotent: a later call after the dataset moves
--      can reclaim the space.
--   2. sim_preflight_cleanup drops its unconditional
--      neop_reset_live_data() sweep, which ignored migration 262's
--      retention rules entirely (it deletes ALL sim submissions and
--      canonical results, then resets config to AWAITING_DATA —
--      exactly the "new launch blanks the site" failure §3/§46
--      forbid). Scoped purging of non-retained runs already covers
--      real debris; the sweep was a redundant sledgehammer.
-- ============================================================

CREATE OR REPLACE FUNCTION public.purge_simulation_run(p_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '900s'
AS $function$
DECLARE
  v_eid    uuid;
  v_active uuid;
  v_ledger bigint := 0;
  v_users  bigint := 0;
  v_vols   bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM simulation_runs WHERE id = p_run) THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'unknown run');
  END IF;

  SELECT election_id INTO v_eid FROM simulation_runs WHERE id = p_run;

  -- ── HARD INTERLOCK ──────────────────────────────────────────
  -- Never purge the dataset the public site is currently rendering.
  -- This is the invariant every caller previously had to enforce
  -- itself (and some did not). Refusal is reported, not raised, so
  -- exception-guarded cleanup loops keep working.
  SELECT active_election_id INTO v_active
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';
  IF v_eid IS NOT NULL AND v_eid = v_active THEN
    RETURN jsonb_build_object(
      'purged', false,
      'reason', 'refusing to purge the ACTIVE public dataset',
      'run_id', p_run,
      'election_id', v_eid
    );
  END IF;
  -- ────────────────────────────────────────────────────────────

  CREATE TEMP TABLE _sim_users ON COMMIT DROP AS
    SELECT id FROM user_accounts WHERE email LIKE 'sim_obs_%';
  CREATE INDEX ON _sim_users (id);

  CREATE TEMP TABLE _sim_vols ON COMMIT DROP AS
    SELECT v.id FROM volunteers v WHERE v.user_id IN (SELECT id FROM _sim_users)
    UNION
    SELECT v.id FROM volunteers v WHERE v.id IN (SELECT id FROM _sim_users);
  CREATE INDEX ON _sim_vols (id);

  CREATE TEMP TABLE _sim_subs ON COMMIT DROP AS
    SELECT s.id FROM result_submissions s
     WHERE (v_eid IS NOT NULL AND s.election_id = v_eid)
        OR s.volunteer_id IN (SELECT id FROM _sim_vols);
  CREATE INDEX ON _sim_subs (id);

  CREATE TEMP TABLE _sim_canon ON COMMIT DROP AS
    SELECT c.id FROM canonical_pu_results c
     WHERE (v_eid IS NOT NULL AND c.election_id = v_eid)
        OR c.source_submission_1 IN (SELECT id FROM _sim_subs)
        OR c.source_submission_2 IN (SELECT id FROM _sim_subs);
  CREATE INDEX ON _sim_canon (id);

  SELECT count(*) INTO v_users FROM _sim_users;
  SELECT count(*) INTO v_vols  FROM _sim_vols;

  IF v_eid IS NOT NULL THEN
    UPDATE system_config
       SET active_election_id = NULL,
           simulation_election_id = NULL,
           data_mode = 'AWAITING_DATA'
     WHERE active_election_id = v_eid OR simulation_election_id = v_eid;
  END IF;

  DELETE FROM canonical_party_results
   WHERE canonical_result_id IN (SELECT id FROM _sim_canon);
  DELETE FROM verifications
   WHERE canonical_result_id IN (SELECT id FROM _sim_canon);

  DELETE FROM party_results
   WHERE result_submission_id IN (SELECT id FROM _sim_subs);
  DELETE FROM verifications
   WHERE submission_id_1 IN (SELECT id FROM _sim_subs)
      OR submission_id_2 IN (SELECT id FROM _sim_subs);

  DELETE FROM canonical_pu_results WHERE id IN (SELECT id FROM _sim_canon);
  DELETE FROM result_submissions    WHERE id IN (SELECT id FROM _sim_subs);

  IF v_eid IS NOT NULL THEN
    DELETE FROM dead_letter_jobs WHERE context_election_id = v_eid;
    DELETE FROM verifications     WHERE election_id = v_eid;
    DELETE FROM incidents         WHERE election_id = v_eid;
    DELETE FROM observations      WHERE election_id = v_eid;
    DELETE FROM evidence_records  WHERE election_id = v_eid;
    DELETE FROM agent_assignments WHERE election_id = v_eid;
  END IF;

  DELETE FROM incidents        WHERE volunteer_id IN (SELECT id FROM _sim_vols)
     OR assignment_id IN (SELECT a.id FROM agent_assignments a WHERE a.volunteer_id IN (SELECT id FROM _sim_vols));
  DELETE FROM observations     WHERE volunteer_id IN (SELECT id FROM _sim_vols)
     OR assignment_id IN (SELECT a.id FROM agent_assignments a WHERE a.volunteer_id IN (SELECT id FROM _sim_vols));
  DELETE FROM result_submissions WHERE volunteer_id IN (SELECT id FROM _sim_vols);
  DELETE FROM evidence_records WHERE volunteer_id IN (SELECT id FROM _sim_vols);
  DELETE FROM agent_assignments WHERE volunteer_id IN (SELECT id FROM _sim_vols);
  DELETE FROM volunteers        WHERE id IN (SELECT id FROM _sim_vols);

  DELETE FROM verifications WHERE decided_by IN (SELECT id FROM _sim_users);
  DELETE FROM admin_users   WHERE user_id   IN (SELECT id FROM _sim_users);
  DELETE FROM user_accounts WHERE id        IN (SELECT id FROM _sim_users);

  DELETE FROM elections WHERE id = v_eid;

  DELETE FROM pu_simulation_status WHERE run_id = p_run;
  GET DIAGNOSTICS v_ledger = ROW_COUNT;
  DELETE FROM sim_run_steps WHERE run_id = p_run;
  DELETE FROM simulation_runs WHERE id = p_run;
  UPDATE simulation_lock SET locked_at = NULL, run_id = NULL WHERE id = 1 AND run_id = p_run;

  RETURN jsonb_build_object(
    'purged', true,
    'run_id', p_run,
    'election_id', v_eid,
    'ledger_rows', v_ledger,
    'sim_accounts', v_users,
    'sim_volunteers', v_vols
  );
END $function$;

-- sim_preflight_cleanup: same body as migration 262's definition minus the
-- unconditional neop_reset_live_data() sweep (see header).
CREATE OR REPLACE FUNCTION public.sim_preflight_cleanup(p_keep_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '600s'
SET lock_timeout TO '30s'
AS $function$
DECLARE
  r record;
  v_purged int := 0;
  v_failed int := 0;
  v_refused int := 0;
  v_published_run uuid;
  v_published_election uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM simulation_runs
             WHERE id <> p_keep_run AND status = 'RUNNING') THEN
    RETURN jsonb_build_object('purged_runs', 0, 'skipped', true,
      'reason', 'another run is active');
  END IF;

  SELECT simulation_election_id INTO v_published_election
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_published_election IS NOT NULL THEN
    SELECT id INTO v_published_run
    FROM simulation_runs
    WHERE election_id = v_published_election AND status IN ('COMPLETED','PUBLISHED')
    ORDER BY completed_at DESC NULLS LAST LIMIT 1;
  END IF;

  FOR r IN SELECT id FROM simulation_runs
           WHERE id <> p_keep_run AND id IS DISTINCT FROM v_published_run
  LOOP
    BEGIN
      DECLARE
        res jsonb;
      BEGIN
        res := purge_simulation_run(r.id);
        IF (res->>'purged')::boolean THEN
          v_purged := v_purged + 1;
        ELSE
          v_refused := v_refused + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failed := v_failed + 1;
      END;
    END;
  END LOOP;

  DELETE FROM pu_simulation_status
  WHERE run_id IS DISTINCT FROM p_keep_run AND run_id IS DISTINCT FROM v_published_run;

  RETURN jsonb_build_object('purged_runs', v_purged, 'purge_failed', v_failed,
    'purge_refused', v_refused,
    'retained_published_run', v_published_run, 'retained_published_election', v_published_election);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.purge_simulation_run(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sim_preflight_cleanup(uuid) TO service_role;
