-- ============================================================
-- NEOP Phase 3 — DOCUMENTED INEC REHEARSAL ROLLBACK (compensating, ledger-driven)
-- ============================================================
-- Use when a rehearsal/drill must be undone (INEC_FEED_REHEARSAL_PLAN.md §8).
-- This is NOT "delete everything from the table":
--
--   * The set of rows to remove is derived EXCLUSIVELY from the immutable raw
--     ledger (`inec_feed_raw` ACCEPTED rows) — nothing that an agent or the
--     simulation created can be touched, even if it shares a polling unit.
--   * The ledger itself is NEVER deleted: it is the forensic record of what
--     arrived, why it was rejected, and what it produced. Before the FK is
--     cleared by ON DELETE SET NULL, the pointer is copied into
--     `transport_meta`, so "which normalized result did this feed row produce"
--     survives the rollback.
--   * Idempotent and safe to re-run.
--
-- Order of operations (child → parent):
--   verification_timeline_events → verifications → party_results
--   → result_submissions
--
-- Rehearsal data can never reach the public site unless the canonical pipeline
-- promoted it, so this script also REPORTS any canonical row that a drill
-- produced (expected: zero — the connector writes no canonical rows).
-- ============================================================

DO $$
DECLARE
  v_targets   UUID[];
  v_ledger    INT;
  v_ver_ev    INT;
  v_ver       INT;
  v_party     INT;
  v_subs      INT;
  v_canonical INT;
BEGIN
  -- 1. Targets: normalized submissions named by an ACCEPTED ledger row.
  SELECT array_agg(DISTINCT normalized_submission_id)
    INTO v_targets
    FROM inec_feed_raw
   WHERE status = 'ACCEPTED' AND normalized_submission_id IS NOT NULL;

  IF v_targets IS NULL THEN
    RAISE NOTICE 'rollback: nothing to roll back (no ACCEPTED ledger row points at a submission)';
    RETURN;
  END IF;

  SELECT count(*) INTO v_ledger FROM inec_feed_raw
   WHERE status = 'ACCEPTED' AND normalized_submission_id = ANY(v_targets);

  -- 2. Preserve provenance in the ledger BEFORE the FK is cleared.
  UPDATE inec_feed_raw
     SET transport_meta = COALESCE(transport_meta, '{}'::jsonb)
         || jsonb_build_object(
              'rolled_back_at', to_jsonb(now()),
              'rolled_back_submission_id', normalized_submission_id,
              'rollback_procedure', 'p3-inec-rollback.sql'
            )
   WHERE status = 'ACCEPTED' AND normalized_submission_id = ANY(v_targets);

  -- 3. Child rows first.
  DELETE FROM verification_timeline_events
   WHERE verification_id IN (
     SELECT id FROM verifications
      WHERE submission_id_1 = ANY(v_targets) OR submission_id_2 = ANY(v_targets));
  GET DIAGNOSTICS v_ver_ev = ROW_COUNT;

  DELETE FROM verifications
   WHERE submission_id_1 = ANY(v_targets) OR submission_id_2 = ANY(v_targets);
  GET DIAGNOSTICS v_ver = ROW_COUNT;

  DELETE FROM party_results WHERE result_submission_id = ANY(v_targets);
  GET DIAGNOSTICS v_party = ROW_COUNT;

  DELETE FROM result_submissions WHERE id = ANY(v_targets) AND source = 'INEC_FEED';
  GET DIAGNOSTICS v_subs = ROW_COUNT;

  -- 4. Report any canonical promotion (should always be zero).
  SELECT count(*) INTO v_canonical
    FROM canonical_pu_results c JOIN polling_units pu ON pu.id = c.polling_unit_id
   WHERE c.updated_at >= now() - interval '7 days'
     AND pu.id IN (SELECT polling_unit_id FROM inec_feed_raw
                    WHERE status = 'ACCEPTED');

  RAISE NOTICE 'rollback: ledger_rows=% submissions_removed=% party_rows=% verifications=% timeline_events=% canonical_promoted=%',
    v_ledger, v_subs, v_party, v_ver, v_ver_ev, v_canonical;

  IF v_canonical > 0 THEN
    RAISE WARNING 'rollback: % canonical row(s) touched a feed polling unit in the last 7 days — inspect manually before declaring the dataset clean', v_canonical;
  END IF;
END $$;

-- ── Post-rollback verification: normalized impurity must be zero ──
SELECT
  (SELECT count(*) FROM result_submissions WHERE source = 'INEC_FEED')            AS inec_submissions,
  (SELECT count(*) FROM inec_feed_raw)                                            AS ledger_rows,
  (SELECT count(*) FROM inec_feed_raw WHERE status = 'ACCEPTED'
     AND normalized_submission_id IS NOT NULL)                                    AS ledger_still_pointing_at_submission,
  (SELECT count(*) FROM inec_feed_raw WHERE status = 'ACCEPTED'
     AND transport_meta ? 'rolled_back_at')                                       AS ledger_marked_rolled_back;
