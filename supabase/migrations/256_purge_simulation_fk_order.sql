-- ============================================================
-- NEOP 256 — PURGE SIMULATION RUN (complete FK-safe ordering)
--
-- Problem: purge_simulation_run() deleted user_accounts (and later
-- result_submissions) before their children, so Postgres raised 23503
-- and the whole purge aborted. Because sim observers are DETERMINISTIC
-- (one per polling unit, reused by every run), their rows are also
-- referenced from OTHER sim elections' canonicals/submissions, so a
-- per-election delete alone can never satisfy the constraints.
--
-- The constraint graph this function must respect (live-derived):
--
--   party_results.result_submission_id ──┐
--   canonical_pu_results.source_submission_1/2 ─┤→ result_submissions
--   verifications.submission_id_1/2 ─────┘
--   canonical_party_results.canonical_result_id ─┐
--   verifications.canonical_result_id ───────────┴→ canonical_pu_results
--   incidents/observations/result_submissions (assignment_id) ↘
--   incidents/observations/evidence_records (volunteer_id) ───→ agent_assignments → volunteers
--   verifications.decided_by, admin_users.user_id ────────────→ user_accounts
--
-- Scoped strictly to sim debris: identification is by the sim_obs_%
-- account marker and the '[SIM]' elections those accounts belong to —
-- never by real election data.
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
  v_ledger bigint := 0;
  v_users  bigint := 0;
  v_vols   bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM simulation_runs WHERE id = p_run) THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'unknown run');
  END IF;
  SELECT election_id INTO v_eid FROM simulation_runs WHERE id = p_run;

  -- ── Stage the sim row sets once (pg_temp so they never leak).
  -- DROP first so two purges may share one transaction. ──
  DROP TABLE IF EXISTS pg_temp._sim_users, pg_temp._sim_vols, pg_temp._sim_subs, pg_temp._sim_canon;
  CREATE TEMP TABLE _sim_users ON COMMIT DROP AS
    SELECT id FROM user_accounts WHERE email LIKE 'sim_obs_%';
  CREATE INDEX ON _sim_users (id);

  CREATE TEMP TABLE _sim_vols ON COMMIT DROP AS
    SELECT v.id FROM volunteers v WHERE v.user_id IN (SELECT id FROM _sim_users)
    UNION
    SELECT v.id FROM volunteers v WHERE v.id IN (SELECT id FROM _sim_users);
  CREATE INDEX ON _sim_vols (id);

  -- Submissions owned by this election OR authored by any sim volunteer
  -- (the cross-election case that broke the original ordering).
  CREATE TEMP TABLE _sim_subs ON COMMIT DROP AS
    SELECT s.id FROM result_submissions s
     WHERE (v_eid IS NOT NULL AND s.election_id = v_eid)
        OR s.volunteer_id IN (SELECT id FROM _sim_vols);
  CREATE INDEX ON _sim_subs (id);

  -- Canonical rows for the election OR sourced from those submissions.
  CREATE TEMP TABLE _sim_canon ON COMMIT DROP AS
    SELECT c.id FROM canonical_pu_results c
     WHERE (v_eid IS NOT NULL AND c.election_id = v_eid)
        OR c.source_submission_1 IN (SELECT id FROM _sim_subs)
        OR c.source_submission_2 IN (SELECT id FROM _sim_subs);
  CREATE INDEX ON _sim_canon (id);

  SELECT count(*) INTO v_users FROM _sim_users;
  SELECT count(*) INTO v_vols  FROM _sim_vols;

  -- Detach config pointers before the elections go away.
  IF v_eid IS NOT NULL THEN
    UPDATE system_config
       SET active_election_id = NULL,
           simulation_election_id = NULL,
           data_mode = 'AWAITING_DATA'
     WHERE active_election_id = v_eid OR simulation_election_id = v_eid;
  END IF;

  -- 1. Children of canonical results.
  DELETE FROM canonical_party_results
   WHERE canonical_result_id IN (SELECT id FROM _sim_canon);
  DELETE FROM verifications
   WHERE canonical_result_id IN (SELECT id FROM _sim_canon);

  -- 2. Children of submissions.
  DELETE FROM party_results
   WHERE result_submission_id IN (SELECT id FROM _sim_subs);
  DELETE FROM verifications
   WHERE submission_id_1 IN (SELECT id FROM _sim_subs)
      OR submission_id_2 IN (SELECT id FROM _sim_subs);

  -- 3. Canonicals, then the submissions themselves.
  DELETE FROM canonical_pu_results WHERE id IN (SELECT id FROM _sim_canon);
  DELETE FROM result_submissions    WHERE id IN (SELECT id FROM _sim_subs);

  -- 4. Election-scoped debris.
  IF v_eid IS NOT NULL THEN
    DELETE FROM dead_letter_jobs WHERE context_election_id = v_eid;
    DELETE FROM verifications     WHERE election_id = v_eid;
    DELETE FROM incidents         WHERE election_id = v_eid;
    DELETE FROM observations      WHERE election_id = v_eid;
    DELETE FROM evidence_records  WHERE election_id = v_eid;
    DELETE FROM agent_assignments WHERE election_id = v_eid;
  END IF;

  -- 5. Volunteer-scoped debris (spans elections), then volunteers.
  DELETE FROM incidents        WHERE volunteer_id IN (SELECT id FROM _sim_vols)
     OR assignment_id IN (SELECT a.id FROM agent_assignments a WHERE a.volunteer_id IN (SELECT id FROM _sim_vols));
  DELETE FROM observations     WHERE volunteer_id IN (SELECT id FROM _sim_vols)
     OR assignment_id IN (SELECT a.id FROM agent_assignments a WHERE a.volunteer_id IN (SELECT id FROM _sim_vols));
  DELETE FROM result_submissions WHERE volunteer_id IN (SELECT id FROM _sim_vols);
  DELETE FROM evidence_records WHERE volunteer_id IN (SELECT id FROM _sim_vols);
  DELETE FROM agent_assignments WHERE volunteer_id IN (SELECT id FROM _sim_vols);
  DELETE FROM volunteers        WHERE id IN (SELECT id FROM _sim_vols);

  -- 6. Accounts last (verifications decided_by → admin_users → accounts).
  DELETE FROM verifications WHERE decided_by IN (SELECT id FROM _sim_users);
  DELETE FROM admin_users   WHERE user_id   IN (SELECT id FROM _sim_users);
  DELETE FROM user_accounts WHERE id        IN (SELECT id FROM _sim_users);

  -- 7. The election itself.
  DELETE FROM elections WHERE id = v_eid;

  -- 8. Run bookkeeping.
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
