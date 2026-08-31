-- ============================================================
-- 100_redistribute_votes_v2.sql
-- Redistributes existing NDC-only party_results across all 9 parties
-- Handles unique constraint on (result_submission_id, party_id)
-- Run this ONE file in Supabase SQL Editor
-- ============================================================

-- STEP 1: Get party IDs and set vote shares
DO $$
DECLARE
  v_ndc UUID; v_apc UUID; v_pdp UUID; v_lp UUID;
  v_nnpp UUID; v_apga UUID; v_sdp UUID; v_ypp UUID; v_adc UUID;
  v_total_rows INTEGER;
  v_batch_size INTEGER := 10000;
  v_offset INTEGER := 0;
  v_row RECORD;
  v_valid_votes INTEGER;
  v_remaining INTEGER;
  v_ndc_votes INTEGER; v_apc_votes INTEGER; v_pdp_votes INTEGER;
  v_lp_votes INTEGER; v_nnpp_votes INTEGER; v_apga_votes INTEGER;
  v_sdp_votes INTEGER; v_ypp_votes INTEGER; v_adc_votes INTEGER;
  v_ndc_share NUMERIC := 0.38;
  v_apc_share NUMERIC := 0.25;
  v_pdp_share NUMERIC := 0.10;
  v_lp_share NUMERIC := 0.08;
  v_nnpp_share NUMERIC := 0.06;
  v_apga_share NUMERIC := 0.04;
  v_sdp_share NUMERIC := 0.04;
  v_ypp_share NUMERIC := 0.03;
  v_adc_share NUMERIC := 0.02;
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

  RAISE NOTICE 'Found % NDC rows to redistribute across 9 parties', v_total_rows;

  -- STEP 2: For each NDC row, replace it with all 9 parties
  -- First delete all NDC rows
  DELETE FROM party_results WHERE party_id = v_ndc;
  RAISE NOTICE 'Deleted % NDC rows', v_total_rows;

  -- STEP 3: Insert new party_results for all 9 parties per result
  -- We need to get the result_submission_id and valid_votes from result_submissions
  FOR v_row IN
    SELECT rs.id AS result_id, rs.valid_votes
    FROM result_submissions rs
    WHERE rs.valid_votes > 0
    ORDER BY rs.id
  LOOP
    v_valid_votes := v_row.valid_votes;
    v_remaining := v_valid_votes;

    -- Calculate votes per party with randomness
    v_ndc_votes := GREATEST(0, ROUND(v_valid_votes * v_ndc_share * (0.85 + random() * 0.30))::INTEGER);
    v_remaining := v_remaining - v_ndc_votes;

    v_apc_votes := GREATEST(0, ROUND(v_valid_votes * v_apc_share * (0.85 + random() * 0.30))::INTEGER);
    v_remaining := v_remaining - v_apc_votes;

    v_pdp_votes := GREATEST(0, ROUND(v_valid_votes * v_pdp_share * (0.7 + random() * 0.6))::INTEGER);
    v_remaining := v_remaining - v_pdp_votes;

    v_lp_votes := GREATEST(0, ROUND(v_valid_votes * v_lp_share * (0.7 + random() * 0.6))::INTEGER);
    v_remaining := v_remaining - v_lp_votes;

    v_nnpp_votes := GREATEST(0, ROUND(v_valid_votes * v_nnpp_share * (0.7 + random() * 0.6))::INTEGER);
    v_remaining := v_remaining - v_nnpp_votes;

    v_apga_votes := GREATEST(0, ROUND(v_valid_votes * v_apga_share * (0.7 + random() * 0.6))::INTEGER);
    v_remaining := v_remaining - v_apga_votes;

    v_sdp_votes := GREATEST(0, ROUND(v_valid_votes * v_sdp_share * (0.7 + random() * 0.6))::INTEGER);
    v_remaining := v_remaining - v_sdp_votes;

    v_ypp_votes := GREATEST(0, ROUND(v_valid_votes * v_ypp_share * (0.7 + random() * 0.6))::INTEGER);
    v_remaining := v_remaining - v_ypp_votes;

    -- ADC gets the remainder
    v_adc_votes := GREATEST(0, v_remaining);

    -- Insert all 9 parties for this result
    INSERT INTO party_results (result_submission_id, party_id, votes) VALUES
      (v_row.result_id, v_ndc, v_ndc_votes),
      (v_row.result_id, v_apc, v_apc_votes),
      (v_row.result_id, v_pdp, v_pdp_votes),
      (v_row.result_id, v_lp, v_lp_votes),
      (v_row.result_id, v_nnpp, v_nnpp_votes),
      (v_row.result_id, v_apga, v_apga_votes),
      (v_row.result_id, v_sdp, v_sdp_votes),
      (v_row.result_id, v_ypp, v_ypp_votes),
      (v_row.result_id, v_adc, v_adc_votes);

    v_updated := v_updated + 1;

    -- Progress logging every 10000 rows
    IF v_updated % 10000 = 0 THEN
      RAISE NOTICE 'Processed % / % results', v_updated, (SELECT count(*) FROM result_submissions WHERE valid_votes > 0);
    END IF;
  END LOOP;

  RAISE NOTICE '=== Redistributed votes for % results across 9 parties ===', v_updated;

  -- STEP 4: Clean up duplicate elections (keep 1 PRESIDENTIAL + 1 GOVERNORSHIP)
  DELETE FROM elections
  WHERE id NOT IN (
    SELECT DISTINCT ON (type) id FROM elections ORDER BY type, created_at ASC
  );
  RAISE NOTICE 'Elections cleaned: % remaining', (SELECT count(*) FROM elections);

  -- STEP 5: Final verification
  RAISE NOTICE '=== FINAL VERIFICATION ===';
END $$;

-- Show results
SELECT p.abbreviation, COUNT(*) as rows, SUM(pr.votes) as total_votes
FROM party_results pr
JOIN parties p ON p.id = pr.party_id
GROUP BY p.abbreviation
ORDER BY total_votes DESC;

SELECT 'Elections remaining:' as info, count(*) as count FROM elections;
