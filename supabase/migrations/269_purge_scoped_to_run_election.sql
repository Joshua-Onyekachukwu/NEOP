-- ============================================================
-- NEOP 269 — purge_simulation_run scoped to the target run's election
--
-- Defect: the purge collected its victims via a GLOBAL pattern
-- (user_accounts.email LIKE 'sim_obs_%'), matching every simulation
-- observer across ALL runs. Purging an old run therefore swept the
-- canonical rows and submissions of OTHER elections through the
-- volunteer arm — including the dataset currently published on the live
-- site. The active-dataset interlock only inspects the purge target's
-- own election, so it could not see this cross-election blast radius.
-- This destroyed Run 1's published dataset mid-Run-2.
--
-- Fix: volunteer/submission/canonical victim lists are now derived from
-- the target run's election only. A purge of run R can only touch
-- election R's data, making dataset destruction of the live site
-- structurally impossible from any purge path.
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
  SELECT active_election_id INTO v_active
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';
  IF v_eid IS NOT NULL AND v_eid = v_active THEN
    RETURN jsonb_build_object('purged', false,
      'reason', 'refusing to purge the ACTIVE public dataset',
      'run_id', p_run, 'election_id', v_eid);
  END IF;

  -- Election-scoped victims: everything this run owns, nothing else.
  CREATE TEMP TABLE _sim_subs ON COMMIT DROP AS
    SELECT s.id FROM result_submissions s
     WHERE v_eid IS NOT NULL AND s.election_id = v_eid;
  CREATE INDEX ON _sim_subs (id);

  CREATE TEMP TABLE _sim_canon ON COMMIT DROP AS
    SELECT c.id FROM canonical_pu_results c
     WHERE v_eid IS NOT NULL AND c.election_id = v_eid;
  CREATE INDEX ON _sim_canon (id);

  -- Volunteers of this election only: those who submitted results or
  -- hold assignments in v_eid. The old global 'sim_obs_%' email match
  -- crossed run boundaries and destroyed other runs' datasets.
  CREATE TEMP TABLE _sim_vols ON COMMIT DROP AS
    SELECT DISTINCT s.volunteer_id AS id FROM result_submissions s
     WHERE v_eid IS NOT NULL AND s.election_id = v_eid AND s.volunteer_id IS NOT NULL
    UNION
    SELECT DISTINCT a.volunteer_id FROM agent_assignments a
     WHERE v_eid IS NOT NULL AND a.election_id = v_eid AND a.volunteer_id IS NOT NULL;
  CREATE INDEX ON _sim_vols (id);

  CREATE TEMP TABLE _sim_users ON COMMIT DROP AS
    SELECT DISTINCT u.id FROM user_accounts u
     JOIN volunteers v ON v.user_id = u.id
     WHERE u.email LIKE 'sim_obs_%' AND v.id IN (SELECT id FROM _sim_vols)
    UNION
    SELECT DISTINCT u.id FROM user_accounts u
     JOIN volunteers v ON v.id = u.id
     WHERE u.email LIKE 'sim_obs_%' AND v.id IN (SELECT id FROM _sim_vols);
  CREATE INDEX ON _sim_users (id);

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
