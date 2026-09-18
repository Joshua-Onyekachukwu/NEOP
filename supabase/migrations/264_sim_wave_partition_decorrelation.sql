-- ============================================================
-- NEOP 264 — DE-CORRELATE SIMULATION PARTITION HASHES
-- ============================================================
--
-- SYMPTOM
--   Simulations never progressed: wave steps reported
--   `subs_this_wave: 0` and published nothing while still burning
--   27-100 s each, so a run sat at "0 published" indefinitely.
--
-- ROOT CAUSE
--   neop_sim_wave bucketed polling units into waves, coverage and
--   chunks using THREE DIFFERENT MODULI OF THE SAME HASH:
--
--       hashtext(pu.id::text) % v_waves      = v_wave
--       hashtext(pu.id::text) % 100          < v_cov
--       hashtext(pu.id::text) % p_data_chunks = p_data_chunk
--
--   Because the residues come from one number, they are coupled by
--   CRT: gcd(v_waves, p_data_chunks) = gcd(6,22) = 2 and
--   gcd(p_data_chunks, 100) = 2, so only parity-compatible
--   (wave, chunk) pairs can ever match. Measured against the live
--   176,846-PU universe:
--
--       step (wave 1, chunk 3) selected exactly 1 PU
--       healthy combos selected 343..476 PUs
--       only 66 of 132 step combinations were non-empty at all
--
--   Half the queue's steps therefore inserted nothing, paired
--   nothing and published nothing, yet still paid the cost of
--   scanning polling_units three times.
--
-- FIX
--   Give each PARTITION dimension its own salted hash. The function
--   already uses exactly this idiom for disruption selection
--   (`hashtext('dis:' || pu.id::text)`), so this restores internal
--   consistency rather than inventing a new scheme:
--
--       wave  -> hashtext('w:' || pu.id::text)
--       chunk -> hashtext('k:' || pu.id::text)
--
--   The COVERAGE dimension is deliberately left UNSALTED. It is a
--   cross-function contract: assign_simulation_outcomes derives the
--   same set with the same unsalted expression (its own comment
--   reads "-- exactly the PUs neop_sim_wave"). Salting it here alone
--   would desynchronise the ledger from the wave and let a wave
--   publish polling units the ledger never marked publishable.
--
-- IDEMPOTENT: the replacements are no-ops once applied, because the
-- salted patterns no longer match the old text.
-- ============================================================

DO $do$
DECLARE
  v_def       text;
  v_unsalted_pu_wave  int;
  v_unsalted_pu_chunk int;
  v_unsalted_rs_chunk int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'neop_sim_wave';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'neop_sim_wave not found — aborting';
  END IF;

  -- Pre-image census (expected 1 / 3 / 1 respectively).
  v_unsalted_pu_wave := (length(v_def) - length(replace(v_def,
      '((hashtext(pu.id::text) & 2147483647) % v_waves) = v_wave', '')))
      / length('((hashtext(pu.id::text) & 2147483647) % v_waves) = v_wave');
  v_unsalted_pu_chunk := (length(v_def) - length(replace(v_def,
      '((hashtext(pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk', '')))
      / length('((hashtext(pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk');
  v_unsalted_rs_chunk := (length(v_def) - length(replace(v_def,
      '((hashtext(rs.polling_unit_id::text) & 2147483647) % p_data_chunks) = p_data_chunk', '')))
      / length('((hashtext(rs.polling_unit_id::text) & 2147483647) % p_data_chunks) = p_data_chunk');

  RAISE NOTICE 'pre-image: pu_wave=% pu_chunk=% rs_chunk=%',
    v_unsalted_pu_wave, v_unsalted_pu_chunk, v_unsalted_rs_chunk;

  -- 1. Wave partition -> own hash.
  v_def := replace(v_def,
    '((hashtext(pu.id::text) & 2147483647) % v_waves) = v_wave',
    '((hashtext(''w:'' || pu.id::text) & 2147483647) % v_waves) = v_wave');

  -- 2. Chunk partition -> own hash (three blocks on polling_units,
  --    one on result_submissions).
  v_def := replace(v_def,
    '((hashtext(pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk',
    '((hashtext(''k:'' || pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk');
  v_def := replace(v_def,
    '((hashtext(rs.polling_unit_id::text) & 2147483647) % p_data_chunks) = p_data_chunk',
    '((hashtext(''k:'' || rs.polling_unit_id::text) & 2147483647) % p_data_chunks) = p_data_chunk');

  -- Post-image assertions: no unsalted partition filter may survive.
  --
  -- NOTE: these use literal replace() arithmetic, NOT LIKE. A LIKE
  -- pattern treats '%' as "match anything", so a check written as
  --   v_def LIKE '%hashtext(pu.id::text) ... % v_waves%'
  -- silently matches across thousands of characters (the wave-variable
  -- declaration to the return payload), reporting "still unsalted".
  -- Counting exact substrings is the only trustworthy form here.
  IF (length(v_def) - length(replace(v_def,
        '((hashtext(pu.id::text) & 2147483647) % v_waves) = v_wave', '')))
     / length('((hashtext(pu.id::text) & 2147483647) % v_waves) = v_wave') <> 0 THEN
    RAISE EXCEPTION 'wave partition still unsalted — aborting';
  END IF;
  IF (length(v_def) - length(replace(v_def,
        '((hashtext(pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk', '')))
     / length('((hashtext(pu.id::text) & 2147483647) % p_data_chunks) = p_data_chunk') <> 0 THEN
    RAISE EXCEPTION 'pu chunk partition still unsalted — aborting';
  END IF;
  IF (length(v_def) - length(replace(v_def,
        '((hashtext(rs.polling_unit_id::text) & 2147483647) % p_data_chunks) = p_data_chunk', '')))
     / length('((hashtext(rs.polling_unit_id::text) & 2147483647) % p_data_chunks) = p_data_chunk') <> 0 THEN
    RAISE EXCEPTION 'rs chunk partition still unsalted — aborting';
  END IF;

  -- The salted replacements must all be present: 1 wave + 4 pu-chunk + 1 rs-chunk.
  -- (Four, not three: the wave-0 setup blocks at lines 54/64/78 AND the pick
  --  block at line 106 each carry a chunk filter.)
  IF (length(v_def) - length(replace(v_def,
        'hashtext(''k:'' || pu.id::text)', '')))
     / length('hashtext(''k:'' || pu.id::text)') <> 4 THEN
    RAISE EXCEPTION 'expected 4 salted pu-chunk filters — aborting';
  END IF;

  -- The coverage contract must be preserved verbatim, in every block.
  IF (length(v_def) - length(replace(v_def,
        '((hashtext(pu.id::text) & 2147483647) % 100) < v_cov', '')))
     / length('((hashtext(pu.id::text) & 2147483647) % 100) < v_cov') <> 4 THEN
    RAISE EXCEPTION 'coverage contract changed — aborting (expected 4 unsalted coverage filters)';
  END IF;

  EXECUTE v_def;
  RAISE NOTICE 'neop_sim_wave partition hashes de-correlated';
END
$do$;

-- ------------------------------------------------------------
-- Self-test: every (wave, chunk) step must now receive a
-- comparable share of the coverage set. Before this migration the
-- worst combination held exactly 1 polling unit.
-- ------------------------------------------------------------
DO $do$
DECLARE
  v_worst int;
  v_best  int;
BEGIN
  WITH coverage AS (
    SELECT id FROM polling_units
    WHERE ((hashtext(id::text) & 2147483647) % 100) < 15
  ), combos AS (
    SELECT (hashtext('w:' || id::text) & 2147483647) % 6 AS w,
           (hashtext('k:' || id::text) & 2147483647) % 22 AS k
    FROM coverage
  )
  SELECT min(n), max(n) INTO v_worst, v_best
  FROM (SELECT w, k, count(*) AS n FROM combos GROUP BY w, k) g;

  RAISE NOTICE 'salted spread: worst combo=% best combo=%', v_worst, v_best;

  -- Measured on the live universe at 15% coverage / 6 waves / 22 chunks:
  --   before: 66/132 combos non-empty, worst combo = 1 PU
  --   after : 132/132 combos non-empty, range 175..238
  IF COALESCE(v_worst, 0) < 50 THEN
    RAISE EXCEPTION 'a (wave, chunk) combination is still starved (worst=%) — fix incomplete', v_worst;
  END IF;
  IF COALESCE(v_best, 0) > COALESCE(v_worst, 0) * 3 THEN
    RAISE EXCEPTION 'salted spread still unbalanced (worst=% best=%)', v_worst, v_best;
  END IF;
END
$do$;
