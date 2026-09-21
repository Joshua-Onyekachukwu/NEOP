-- ============================================================
-- NEOP 280 — publish_simulation_run must RESOLVE disputes, not erase them
-- ============================================================
--
-- SYMPTOM
--   A completed run reports `verified` = published / (published + disputed
--   + disrupted). Run 5 finished PUBLISHED yet the live site read
--   "Verified 83.0%" with 6,460 polling units stuck in dispute — and those
--   units had NO canonical result at all, so they were neither visible as
--   disputed results nor counted as published. They simply vanished.
--
-- ROOT CAUSE — two guards in migration 272 that contradict each other
--
--   1. When a PU's two agent submissions disagree, neop_sim_wave inserts a
--      canonical row with status = 'HUMAN_REVIEW' so the disagreement is
--      visible and auditable.
--
--   2. publish_simulation_run's reconciliation PASS 2 is meant to resolve
--      exactly those PUs (`WHERE l.sim_status = 'HUMAN_REVIEW'`) — but it
--      also carries `AND NOT EXISTS (SELECT 1 FROM canonical_pu_results ...
--      WHERE ... polling_unit_id = s.polling_unit_id)`. Since step 1 has
--      already created a HUMAN_REVIEW row for every one of them, the guard
--      is false for all 6,460 and the pass resolves nothing.
--
--   3. The function then finishes with
--        DELETE FROM canonical_pu_results c USING pu_simulation_status l
--         WHERE ... AND l.sim_status <> 'PUBLISHED'
--      which DELETES the very HUMAN_REVIEW rows the pass declined to
--      upgrade.
--
--   Net effect: disputed polling units end the run with no canonical result,
--   keep a ledger status of HUMAN_REVIEW, and permanently drag the public
--   "verified" headline down by their share of the reporting set. The
--   admin-visible dispute queue is empty too, because the row it would show
--   was deleted.
--
-- FIX — three surgical changes to the guards
--
--   a) PASS 1 and PASS 2 only skip a PU when it already has a PUBLISHED
--      canonical row. An existing HUMAN_REVIEW row is now upgraded instead
--      of blocking the repair.
--
--   b) The trailing DELETE keeps canonical rows for PUBLISHED *and*
--      HUMAN_REVIEW ledger rows, so a genuinely unresolved dispute stays
--      visible instead of being erased.
--
--   c) The "ledger follows reality" UPDATE that already flips any PU with a
--      PUBLISHED canonical row to PUBLISHED is left as-is — it is what
--      moves the resolved disputes out of the verified denominator's
--      numerator gap.
--
--   Resolution remains AUDITED, not silent: PASS 2 publishes through
--   publish_canonical_result and closes the verification as
--   RESOLVED_ADMIN / ADMIN_OVERRIDE_MATCH, which is exactly what the admin
--   "resolve" action records. Disagreement is therefore still detectable
--   after the fact; it just no longer leaves an unreportable hole in the
--   national totals.
--
-- IDEMPOTENT: re-running the migration is a no-op (the old literals are
-- gone), and re-running publish_simulation_run on an already-published run
-- changes nothing because every guard is a no-op when no repair is due.
-- ============================================================

DO $do$
DECLARE
  v_def  text;
  v_hits int;

  -- The two guards differ only in the alias they use.
  v_pass1_old text :=
    'AND NOT EXISTS (
      SELECT 1 FROM canonical_pu_results c
      WHERE c.election_id = v_election AND c.polling_unit_id = v.polling_unit_id)';
  v_pass1_new text :=
    'AND NOT EXISTS (
      SELECT 1 FROM canonical_pu_results c
      WHERE c.election_id = v_election AND c.polling_unit_id = v.polling_unit_id
        AND c.status = ''PUBLISHED'')';

  v_pass2_old text :=
    'AND NOT EXISTS (
      SELECT 1 FROM canonical_pu_results c
      WHERE c.election_id = v_election AND c.polling_unit_id = s.polling_unit_id)';
  v_pass2_new text :=
    'AND NOT EXISTS (
      SELECT 1 FROM canonical_pu_results c
      WHERE c.election_id = v_election AND c.polling_unit_id = s.polling_unit_id
        AND c.status = ''PUBLISHED'')';

  v_del_old text := 'AND l.sim_status <> ''PUBLISHED''
      AND c.election_id = v_election';
  v_del_new text := 'AND l.sim_status NOT IN (''PUBLISHED'', ''HUMAN_REVIEW'')
      AND c.election_id = v_election';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'publish_simulation_run';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'publish_simulation_run not found — aborting';
  END IF;

  -- Pre-image census (expected 1 each).
  v_hits := (length(v_def) - length(replace(v_def, v_pass1_old, ''))) / length(v_pass1_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'pass-1 guard not found exactly once (found %) — aborting (already patched?)', v_hits;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_pass2_old, ''))) / length(v_pass2_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'pass-2 guard not found exactly once (found %) — aborting (already patched?)', v_hits;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_del_old, ''))) / length(v_del_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'trailing-delete guard not found exactly once (found %) — aborting (already patched?)', v_hits;
  END IF;

  v_def := replace(v_def, v_pass1_old, v_pass1_new);
  v_def := replace(v_def, v_pass2_old, v_pass2_new);
  v_def := replace(v_def, v_del_old, v_del_new);

  -- Post-image assertions.
  IF position('AND c.status = ''PUBLISHED'')' IN v_def) < 1 THEN
    RAISE EXCEPTION 'publish guards not updated — aborting';
  END IF;
  IF position('NOT IN (''PUBLISHED'', ''HUMAN_REVIEW'')' IN v_def) = 0 THEN
    RAISE EXCEPTION 'trailing delete not relaxed — aborting';
  END IF;

  EXECUTE v_def;
  RAISE NOTICE 'publish_simulation_run now resolves disputed PUs and keeps unresolved ones visible';
END
$do$;
