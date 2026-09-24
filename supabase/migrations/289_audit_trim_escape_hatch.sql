-- ============================================================
-- NEOP 289 — SCOPED ESCAPE HATCH FOR SIMULATION AUDIT CHURN
-- ============================================================
--
-- Migration 288 taught simulation_release_published() to trim
-- RESULT_PUBLISHED audit churn (275,203 rows / 107 MB, one row per published
-- polling unit). It could not actually run: audit_log carries
-- trg_prevent_audit_update (BEFORE DELETE OR UPDATE FOR EACH ROW), whose
-- function raises unconditionally. The trim raised, the whole release aborted
-- and rolled back.
--
-- The immutability guard is correct and must stay. What follows is the
-- narrowest possible opening:
--
--   • only on DELETE (never UPDATE),
--   • only when the caller set the transaction-local GUC
--     neop.sim_audit_trim = 'on' — set by exactly one function,
--     simulation_release_published(), and re-cleared immediately after,
--   • only for rows that are provably simulated publication churn:
--     action = 'RESULT_PUBLISHED' AND resource_type = 'CANONICAL_RESULT'
--     (the [SIM]-election check is enforced by the caller's DELETE predicate).
--
-- A real election's audit trail cannot satisfy all three, and nothing else in
-- the codebase sets the GUC.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('neop.sim_audit_trim', true) = 'on'
     AND OLD.action = 'RESULT_PUBLISHED'
     AND OLD.resource_type = 'CANONICAL_RESULT' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Audit log records cannot be modified or deleted';
END;
$function$;

-- ── Release sets/clears the flag around its scoped trim ─────
CREATE OR REPLACE FUNCTION public.simulation_release_published()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET lock_timeout TO '30s'
AS $function$
DECLARE
  v_mode text;
  v_released_election uuid;
  v_runs int := 0;
  v_failures int := 0;
  v_non_sim bigint := 0;
  v_audit_trimmed int := 0;
  r record;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  SELECT data_mode INTO v_mode FROM system_config
  WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_mode = 'LIVE_ELECTION' THEN
    RETURN jsonb_build_object('released', false,
      'reason', 'refusing: system is in LIVE_ELECTION mode');
  END IF;

  SELECT active_election_id INTO v_released_election
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_released_election IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM elections
      WHERE id = v_released_election
        AND (left(name, 5) = '[SIM]' OR left(name, 6) = '[TEST]')
    ) THEN
      RETURN jsonb_build_object('released', false,
        'reason', 'refusing: the active election is not a simulated dataset');
    END IF;
  END IF;

  SELECT count(*) INTO v_non_sim
  FROM result_submissions s
  WHERE s.election_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM elections e
       WHERE e.id = s.election_id
         AND (left(e.name, 5) = '[SIM]' OR left(e.name, 6) = '[TEST]'));
  IF v_non_sim > 0 THEN
    RETURN jsonb_build_object('released', false,
      'reason', 'refusing: non-simulated submissions present',
      'non_sim_submissions', v_non_sim);
  END IF;

  UPDATE system_config
  SET active_election_id = NULL,
      simulation_election_id = NULL,
      last_updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  -- Scoped audit-churn trim (migration 288/289). BOTH the GUC flag AND the
  -- row shape must match; the [SIM]/[TEST] join keeps real elections out.
  -- Must run BEFORE the purge loop deletes the [SIM] elections.
  PERFORM set_config('neop.sim_audit_trim', 'on', true);
  DELETE FROM public.audit_log a
   WHERE a.action = 'RESULT_PUBLISHED'
     AND a.resource_type = 'CANONICAL_RESULT'
     AND a.metadata ? 'election_id'
     AND EXISTS (
       SELECT 1 FROM public.elections e
        WHERE e.id = NULLIF(a.metadata->>'election_id', '')::uuid
          AND (left(e.name, 5) = '[SIM]' OR left(e.name, 6) = '[TEST]'));
  GET DIAGNOSTICS v_audit_trimmed = ROW_COUNT;
  PERFORM set_config('neop.sim_audit_trim', 'off', true);

  TRUNCATE pu_simulation_status;
  TRUNCATE result_submissions, canonical_pu_results, canonical_party_results,
           party_results, verifications, verification_timeline_events
    CASCADE;

  FOR r IN SELECT id FROM simulation_runs WHERE status <> 'RUNNING' LOOP
    BEGIN
      PERFORM purge_simulation_run(r.id);
      v_runs := v_runs + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failures := v_failures + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'released', v_failures = 0,
    'method', 'truncate',
    'released_election', v_released_election,
    'runs_purged', v_runs,
    'purge_failures', v_failures,
    'audit_rows_trimmed', v_audit_trimmed,
    'ledger_cleared', true,
    'data_mode', v_mode
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.simulation_release_published() TO service_role;
