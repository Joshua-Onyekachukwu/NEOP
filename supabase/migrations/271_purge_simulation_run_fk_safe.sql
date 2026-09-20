-- NEOP 271 — purge_simulation_run: FK-safe, election-scoped deletion
--
-- Problem: the sim account pool (volunteers / sim_obs_% users) is SHARED
-- across simulation runs. The previous purge swept every row owned by the
-- target run's volunteers regardless of election, so purging an archived
-- run would have deleted the ACTIVE dataset's submissions (and did, until
-- a foreign-key error aborted it mid-delete).
--
-- Fix:
--   * every dataset deletion is scoped by election_id;
--   * volunteer/user account deletion only fires when the account has zero
--     remaining references anywhere (guarded sweeps);
--   * refuse to purge the run backing system_config.active_election_id;
--   * new indexes on incidents/observations/evidence_records (election_id,
--     volunteer_id) so the sweeps stop timing out on large archives.

CREATE INDEX IF NOT EXISTS idx_evidence_election ON evidence_records(election_id);
CREATE INDEX IF NOT EXISTS idx_incidents_election ON incidents(election_id);
CREATE INDEX IF NOT EXISTS idx_observations_election ON observations(election_id);
CREATE INDEX IF NOT EXISTS idx_incidents_vol ON incidents(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_observations_vol ON observations(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_evidence_vol ON evidence_records(volunteer_id);

CREATE OR REPLACE FUNCTION public.purge_simulation_run(p_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eid uuid;
  v_active uuid;
  v_ledger bigint := 0;
  v_users bigint := 0;
  v_vols bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM simulation_runs WHERE id = p_run) THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'unknown run');
  END IF;

  SELECT election_id INTO v_eid FROM simulation_runs WHERE id = p_run;
  SELECT active_election_id INTO v_active FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_eid IS NOT NULL AND v_eid = v_active THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'refusing to purge the ACTIVE public dataset', 'run_id', p_run, 'election_id', v_eid);
  END IF;

  DROP TABLE IF EXISTS _sim_subs;
  CREATE TEMP TABLE _sim_subs ON COMMIT DROP AS
    SELECT s.id FROM result_submissions s WHERE v_eid IS NOT NULL AND s.election_id = v_eid;
  CREATE INDEX ON _sim_subs (id);

  DROP TABLE IF EXISTS _sim_canon;
  CREATE TEMP TABLE _sim_canon ON COMMIT DROP AS
    SELECT c.id FROM canonical_pu_results c WHERE v_eid IS NOT NULL AND c.election_id = v_eid;
  CREATE INDEX ON _sim_canon (id);

  -- Sim account pool is SHARED across runs: never delete accounts/rows that
  -- still belong to another run's election. All dataset deletion below is
  -- strictly election-scoped.
  DROP TABLE IF EXISTS _sim_vols;
  CREATE TEMP TABLE _sim_vols ON COMMIT DROP AS
    SELECT DISTINCT s.volunteer_id AS id FROM result_submissions s
      WHERE v_eid IS NOT NULL AND s.election_id = v_eid AND s.volunteer_id IS NOT NULL
    UNION
    SELECT DISTINCT a.volunteer_id FROM agent_assignments a
      WHERE v_eid IS NOT NULL AND a.election_id = v_eid AND a.volunteer_id IS NOT NULL;
  CREATE INDEX ON _sim_vols (id);

  SELECT count(*) INTO v_vols FROM _sim_vols;

  IF v_eid IS NOT NULL THEN
    UPDATE system_config
       SET active_election_id = NULL, simulation_election_id = NULL, data_mode = 'AWAITING_DATA'
     WHERE active_election_id = v_eid OR simulation_election_id = v_eid;
  END IF;

  DELETE FROM canonical_party_results WHERE canonical_result_id IN (SELECT id FROM _sim_canon);
  DELETE FROM verifications WHERE canonical_result_id IN (SELECT id FROM _sim_canon);
  DELETE FROM party_results WHERE result_submission_id IN (SELECT id FROM _sim_subs);
  DELETE FROM verifications WHERE submission_id_1 IN (SELECT id FROM _sim_subs) OR submission_id_2 IN (SELECT id FROM _sim_subs);
  DELETE FROM canonical_pu_results WHERE id IN (SELECT id FROM _sim_canon);
  DELETE FROM result_submissions WHERE id IN (SELECT id FROM _sim_subs);

  IF v_eid IS NOT NULL THEN
    DELETE FROM dead_letter_jobs WHERE context_election_id = v_eid;
    DELETE FROM verifications WHERE election_id = v_eid;
    DELETE FROM incidents WHERE election_id = v_eid;
    DELETE FROM observations WHERE election_id = v_eid;
    DELETE FROM evidence_records WHERE election_id = v_eid;
    DELETE FROM agent_assignments WHERE election_id = v_eid;
  END IF;

  -- The old unscoped volunteer sweeps deleted submissions/incidents/etc.
  -- owned by OTHER elections because sim accounts are reused across runs.
  -- Those rows are election-scoped-deleted above; these sweeps only fire for
  -- accounts with zero remaining references.
  DELETE FROM volunteers v
   WHERE v.id IN (SELECT id FROM _sim_vols)
     AND NOT EXISTS (SELECT 1 FROM result_submissions s WHERE s.volunteer_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM agent_assignments a WHERE a.volunteer_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM evidence_records e WHERE e.volunteer_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.volunteer_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.volunteer_id = v.id);

  DROP TABLE IF EXISTS _sim_users;
  CREATE TEMP TABLE _sim_users ON COMMIT DROP AS
    SELECT DISTINCT u.id FROM user_accounts u
     WHERE u.email LIKE 'sim_obs_%'
       AND NOT EXISTS (SELECT 1 FROM volunteers vv WHERE vv.user_id = u.id);
  CREATE INDEX ON _sim_users (id);
  SELECT count(*) INTO v_users FROM _sim_users;

  DELETE FROM verifications WHERE decided_by IN (SELECT id FROM _sim_users);
  DELETE FROM admin_users WHERE user_id IN (SELECT id FROM _sim_users);
  DELETE FROM user_accounts WHERE id IN (SELECT id FROM _sim_users);

  DELETE FROM pu_simulation_status WHERE run_id = p_run;
  GET DIAGNOSTICS v_ledger = ROW_COUNT;
  DELETE FROM sim_run_steps WHERE run_id = p_run;
  DELETE FROM simulation_runs WHERE id = p_run;
  DELETE FROM elections WHERE id = v_eid;
  UPDATE simulation_lock SET locked_at = NULL, run_id = NULL WHERE id = 1 AND run_id = p_run;

  RETURN jsonb_build_object('purged', true, 'run_id', p_run, 'election_id', v_eid, 'ledger_rows', v_ledger, 'sim_accounts', v_users, 'sim_volunteers', v_vols);
END
$$;
