-- ============================================================
-- 100_redistribute_votes.sql
-- Redistributes existing NDC-only party_results across all 9 parties
-- Run this ONE file in Supabase SQL Editor
-- ============================================================

-- STEP 1: Get party IDs
DO $$
DECLARE
  v_ndc UUID; v_apc UUID; v_pdp UUID; v_lp UUID;
  v_nnpp UUID; v_apga UUID; v_sdp UUID; v_ypp UUID; v_adc UUID;
  v_total_rows INTEGER;
  v_batch_size INTEGER := 5000;
  v_offset INTEGER := 0;
  v_updated INTEGER := 0;
BEGIN
  SELECT id INTO v_ndc FROM parties WHERE abbreviation = 'NDC' LIMIT 1;
  SELECT id INTO v_apc FROM parties WHERE abbreviation = 'APC' LIMIT 1;
  SELECT id INTO v_pdp FROM parties WHERE abbreviation = 'PDP' LIMIT 1;
  SELECT id INTO v_lp FROM parties WHERE abbreviation = 'LP' LIMIT 1;
  SELECT id INTO v_nnpp FROM parties WHERE abbreviation = 'NNPP' LIMIT 1;
  SELECT id INTO v_apga FROM parties WHERE abbreviation = 'APGA' LIMIT 1;
  SELECT id INTO v_sdp FROM parties WHERE abbreviation = 'SDP' LIMIT 1;
  SELECT id INTO v_ypp FROM parties WHERE abbreviation = 'YPP' LIMIT 1;
  SELECT id INTO v_adc FROM parties WHERE abbreviation = 'ADC' LIMIT 1;

  SELECT count(*) INTO v_total_rows FROM party_results WHERE party_id = v_ndc;

  -- STEP 2: Update the existing NDC rows to be APC (take 25%)
  UPDATE party_results
  SET party_id = v_apc
  WHERE id IN (
    SELECT id FROM party_results
    WHERE party_id = v_ndc
    ORDER BY random()
    LIMIT (v_total_rows * 0.25)::INTEGER
  );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Updated % rows to APC', v_updated;

  -- STEP 3: Update existing NDC rows to be PDP (take 8%)
  UPDATE party_results
  SET party_id = v_pdp
  WHERE id IN (
    SELECT id FROM party_results
    WHERE party_id = v_ndc
    ORDER BY random()
    LIMIT (v_total_rows * 0.08)::INTEGER
  );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Updated % rows to PDP', v_updated;

  -- STEP 4: Update existing NDC rows to be LP (take 6%)
  UPDATE party_results
  SET party_id = v_lp
  WHERE id IN (
    SELECT id FROM party_results
    WHERE party_id = v_ndc
    ORDER BY random()
    LIMIT (v_total_rows * 0.06)::INTEGER
  );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Updated % rows to LP', v_updated;

  -- STEP 5: Update remaining NDC rows to be smaller parties
  UPDATE party_results
  SET party_id = v_nnpp
  WHERE id IN (
    SELECT id FROM party_results WHERE party_id = v_ndc ORDER BY random()
    LIMIT (v_total_rows * 0.04)::INTEGER
  );
  UPDATE party_results
  SET party_id = v_apga
  WHERE id IN (
    SELECT id FROM party_results WHERE party_id = v_ndc ORDER BY random()
    LIMIT (v_total_rows * 0.03)::INTEGER
  );
  UPDATE party_results
  SET party_id = v_sdp
  WHERE id IN (
    SELECT id FROM party_results WHERE party_id = v_ndc ORDER BY random()
    LIMIT (v_total_rows * 0.03)::INTEGER
  );
  UPDATE party_results
  SET party_id = v_ypp
  WHERE id IN (
    SELECT id FROM party_results WHERE party_id = v_ndc ORDER BY random()
    LIMIT (v_total_rows * 0.03)::INTEGER
  );
  UPDATE party_results
  SET party_id = v_adc
  WHERE id IN (
    SELECT id FROM party_results WHERE party_id = v_ndc ORDER BY random()
    LIMIT (v_total_rows * 0.02)::INTEGER
  );
  RAISE NOTICE 'All party redistribution complete';

  -- STEP 6: Verify
  RAISE NOTICE 'Final party_results count: %', (SELECT count(*) FROM party_results);
  RAISE NOTICE 'Distinct party_ids: %', (SELECT count(DISTINCT party_id) FROM party_results);
END $$;

-- STEP 7: Clean up duplicate elections — keep only 1 PRESIDENTIAL + 1 GOVERNORSHIP
DO $$
DECLARE
  v_keep_pres UUID;
  v_keep_gov UUID;
BEGIN
  SELECT id INTO v_keep_pres FROM elections WHERE type = 'PRESIDENTIAL' AND is_active = true LIMIT 1;
  IF v_keep_pres IS NULL THEN
    SELECT id INTO v_keep_pres FROM elections WHERE type = 'PRESIDENTIAL' ORDER BY created_at LIMIT 1;
  END IF;

  SELECT id INTO v_keep_gov FROM elections WHERE type = 'GOVERNORSHIP' ORDER BY created_at LIMIT 1;

  -- Delete all duplicates
  DELETE FROM elections WHERE id != COALESCE(v_keep_pres, '00000000-0000-0000-0000-000000000001') AND type = 'PRESIDENTIAL';
  DELETE FROM elections WHERE id != COALESCE(v_keep_gov, '00000000-0000-0000-0000-000000000001') AND type = 'GOVERNORSHIP';
  -- Delete any non-standard types
  DELETE FROM elections WHERE type NOT IN ('PRESIDENTIAL', 'GOVERNORSHIP');
  RAISE NOTICE 'Elections cleaned: % remaining', (SELECT count(*) FROM elections);
END $$;

-- Final verification
SELECT p.abbreviation, COUNT(*) as rows, SUM(pr.votes) as total_votes
FROM party_results pr
JOIN parties p ON p.id = pr.party_id
GROUP BY p.abbreviation
ORDER BY total_votes DESC;

SELECT 'Elections remaining:' as info, count(*) as count FROM elections;
