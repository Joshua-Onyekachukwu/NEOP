-- ============================================================
-- NEOP 268 — publish_simulation_run enforces the one-canonical-
-- public-result guarantee at the publish boundary.
--
-- Defect: waves write canonical rows for every planned PU, but PUs whose
-- sim outcome is DISPUTED are parked in HUMAN_REVIEW by the finalize
-- ledger pass. The public table kept those rows, so disputed polling
-- units were publicly counted: canonical rows (8,404) exceeded ledger
-- PUBLISHED (7,982) by exactly the 422 disputed PUs, inflating national
-- totals in violation of "one canonical PUBLIC result per PU" — a
-- disputed PU must go to admin review, not onto the public site.
--
-- Fix: before switching the pointer, publish deletes canonical rows for
-- PUs whose ledger status is not PUBLISHED (archive semantics live in
-- pu_simulation_status; admin review re-canonicalizes through the normal
-- resolve flow). The reported count is then rows actually public.
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_simulation_run(p_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_election uuid;
  v_status   text;
  v_canon    bigint;
  v_removed  bigint := 0;
  v_previous uuid;
  v_mult     numeric := 1;
  v_archived int := 0;
BEGIN
  SELECT election_id, status INTO v_election, v_status
  FROM simulation_runs WHERE id = p_run;

  IF v_election IS NULL THEN
    RETURN jsonb_build_object('published', false, 'reason', 'run has no election yet');
  END IF;

  BEGIN
    SELECT COALESCE((params->>'display_multiplier')::numeric, 1) INTO v_mult
    FROM simulation_runs WHERE id = p_run;
  EXCEPTION WHEN OTHERS THEN
    v_mult := 1;
  END;

  -- One canonical PUBLIC result per PU: drop rows for PUs the ledger did
  -- not clear for publication (disputed -> HUMAN_REVIEW, failed, etc.).
  -- The ledger retains the outcome; admin review re-publishes explicitly.
  WITH del AS (
    DELETE FROM canonical_pu_results c
    USING pu_simulation_status l
    WHERE l.run_id = p_run
      AND l.polling_unit_id = c.polling_unit_id
      AND l.sim_status <> 'PUBLISHED'
      AND c.election_id = v_election
    RETURNING 1
  )
  SELECT count(*) INTO v_removed FROM del;

  SELECT count(*) INTO v_canon FROM canonical_pu_results WHERE election_id = v_election;

  IF v_canon = 0 THEN
    RETURN jsonb_build_object('published', false, 'reason', 'no canonical results to publish', 'canonical_rows', 0);
  END IF;

  SELECT simulation_election_id INTO v_previous
  FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001';

  UPDATE system_config SET
    data_mode = 'SIMULATED',
    active_election_id = v_election,
    simulation_election_id = v_election,
    display_multiplier = CASE WHEN v_mult > 0 THEN v_mult ELSE display_multiplier END,
    last_updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  UPDATE simulation_runs
  SET status = 'PUBLISHED', completed_at = COALESCE(completed_at, now())
  WHERE id = p_run;

  IF v_previous IS NOT NULL AND v_previous <> v_election THEN
    WITH archived AS (
      UPDATE simulation_runs
      SET status = 'ARCHIVED'
      WHERE election_id = v_previous
        AND id <> p_run
        AND status IN ('COMPLETED','PUBLISHED','STOPPED','FAILED','CANCELLED')
      RETURNING 1
    )
    SELECT count(*) INTO v_archived FROM archived;
  END IF;

  RETURN jsonb_build_object(
    'published', true,
    'election_id', v_election,
    'canonical_rows', v_canon,
    'nonpublic_removed', v_removed,
    'superseded_archived', v_archived,
    'previous_election_id', v_previous,
    'cleanup_deferred', v_archived > 0
  );
END;
$function$;
