-- ============================================================
-- NEOP 263 — DROP THE DUPLICATE "ONE CANONICAL PER PU" CONSTRAINT
--
-- canonical_pu_results carried TWO byte-identical exclusion constraints:
--
--   uq_canonical_exclude              (added by migration 223)
--   uq_active_canonical_per_pu_election  (re-added later, unreferenced)
--
-- Both are:
--   EXCLUDE USING btree (election_id WITH =, polling_unit_id WITH =)
--   WHERE (status NOT IN ('SUPERSEDED','REJECTED'))
--
-- The §26 rule ("one polling unit, one canonical public result per election
-- dataset") is still enforced — by uq_canonical_exclude, which isn't dropped
-- here. Keeping only one removes a redundant exclusion index from the hottest
-- insert path in the system (every published polling unit inserts here), so the
-- wave engine does one less index probe per result.
--
-- uq_canonical_exclude is deliberately the survivor: migration 225's self-test
-- asserts a violating insert raises against that constraint BY NAME, so dropping
-- it would invalidate a documented check.
--
-- Safe to run repeatedly.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_active_canonical_per_pu_election'
      AND conrelid = 'canonical_pu_results'::regclass
  ) THEN
    ALTER TABLE canonical_pu_results
      DROP CONSTRAINT uq_active_canonical_per_pu_election;
    RAISE NOTICE 'dropped duplicate exclusion constraint uq_active_canonical_per_pu_election';
  ELSE
    RAISE NOTICE 'duplicate constraint already absent — nothing to do';
  END IF;
END $$;

-- The surviving constraint must still be present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_canonical_exclude'
      AND conrelid = 'canonical_pu_results'::regclass
  ) THEN
    RAISE EXCEPTION 'uq_canonical_exclude is missing — the one-canonical-per-PU rule would be unenforced';
  END IF;
END $$;
