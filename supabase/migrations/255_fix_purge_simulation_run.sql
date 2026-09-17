-- ============================================================
-- NEOP 255 — FIX purge_simulation_run
--
-- The live function referenced canonical_party_results.election_id,
-- which does not exist (that table reaches elections through its
-- parent canonical_pu_results) — every purge failed with
-- "column election_id does not exist".
--
-- Fixes:
--   • canonical_party_results deleted via parent join (no election_id there)
--   • system_config pointers (active_election_id / simulation_election_id)
--     detached BEFORE deleting the election — else FK violation
--   • also clears sim_run_steps (new step queue, migration 251)
--   • statement_timeout raised to 300s (purging a full run's
--     submissions takes longer than 120s)
-- ============================================================

CREATE OR REPLACE FUNCTION public.purge_simulation_run(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE v_eid uuid; v_ledger bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM simulation_runs WHERE id = p_run) THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'unknown run');
  END IF;
  SELECT election_id INTO v_eid FROM simulation_runs WHERE id = p_run;

  IF v_eid IS NOT NULL THEN
    -- Detach config pointers first (both FK columns reference elections)
    UPDATE system_config
      SET active_election_id = NULL,
          simulation_election_id = NULL,
          data_mode = 'AWAITING_DATA'
      WHERE active_election_id = v_eid OR simulation_election_id = v_eid;
    DELETE FROM dead_letter_jobs WHERE context_election_id = v_eid;
    DELETE FROM verifications WHERE election_id = v_eid;
    DELETE FROM canonical_party_results
      WHERE canonical_result_id IN (SELECT id FROM canonical_pu_results WHERE election_id = v_eid);
    DELETE FROM canonical_pu_results WHERE election_id = v_eid;
    DELETE FROM result_submissions WHERE election_id = v_eid;
    DELETE FROM agent_assignments WHERE election_id = v_eid;
    DELETE FROM user_accounts WHERE email LIKE 'sim_obs_%';
    DELETE FROM elections WHERE id = v_eid;
  END IF;

  DELETE FROM pu_simulation_status WHERE run_id = p_run;
  GET DIAGNOSTICS v_ledger = ROW_COUNT;
  DELETE FROM sim_run_steps WHERE run_id = p_run;
  DELETE FROM simulation_runs WHERE id = p_run;
  UPDATE simulation_lock SET locked_at = NULL, run_id = NULL WHERE id = 1 AND run_id = p_run;

  RETURN jsonb_build_object('purged', true, 'run_id', p_run, 'election_id', v_eid, 'ledger_rows', v_ledger);
END $function$;
