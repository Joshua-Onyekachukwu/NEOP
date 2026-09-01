-- ============================================================
-- 100_redistribute_votes_v3.sql
-- TRUNCATE all party_results, then INSERT fresh data for all 9 parties
-- This is the definitive fix — no more unique constraint errors
-- Run this ONE file in Supabase SQL Editor
-- ============================================================

-- STEP 1: Wipe ALL existing party_results (instant, no lock)
TRUNCATE TABLE party_results RESTART IDENTITY;

-- STEP 2: Insert fresh party_results for ALL 9 parties per result
DO $$
DECLARE
  v_ndc UUID; v_apc UUID; v_pdp UUID; v_lp UUID;
  v_nnpp UUID; v_apga UUID; v_sdp UUID; v_ypp UUID; v_adc UUID;
  v_row RECORD;
  v_valid_votes INTEGER;
  v_remaining INTEGER;
  v_count INTEGER := 0;
  v_total INTEGER;
  v_ndc_share NUMERIC := 0.38;
  v_apc_share NUMERIC := 0.25;
  v_pdp_share NUMERIC := 0.10;
  v_lp_share NUMERIC := 0.08;
  v_nnpp_share NUMERIC := 0.06;
  v_apga_share NUMERIC := 0.04;
  v_sdp_share NUMERIC := 0.04;
  v_ypp_share NUMERIC := 0.03;
  v_adc_share NUMERIC := 0.02;
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

  SELECT count(*) INTO v_total FROM result_submissions WHERE valid_votes > 0;

  RAISE NOTICE 'Processing % results with 9 parties each...', v_total;

  FOR v_row IN
    SELECT rs.id AS result_id, rs.valid_votes
    FROM result_submissions rs
    WHERE rs.valid_votes > 0
  LOOP
    v_valid_votes := v_row.valid_votes;
    v_remaining := v_valid_votes;

    -- Calculate votes per party with randomness
    DECLARE
      v_ndc_v INTEGER; v_apc_v INTEGER; v_pdp_v INTEGER;
      v_lp_v INTEGER; v_nnpp_v INTEGER; v_apga_v INTEGER;
      v_sdp_v INTEGER; v_ypp_v INTEGER; v_adc_v INTEGER;
    BEGIN
      v_ndc_v := GREATEST(0, ROUND(v_valid_votes * v_ndc_share * (0.85 + random() * 0.30))::INTEGER);
      v_remaining := v_remaining - v_ndc_v;
      v_apc_v := GREATEST(0, ROUND(v_valid_votes * v_apc_share * (0.85 + random() * 0.30))::INTEGER);
      v_remaining := v_remaining - v_apc_v;
      v_pdp_v := GREATEST(0, ROUND(v_valid_votes * v_pdp_share * (0.7 + random() * 0.6))::INTEGER);
      v_remaining := v_remaining - v_pdp_v;
      v_lp_v := GREATEST(0, ROUND(v_valid_votes * v_lp_share * (0.7 + random() * 0.6))::INTEGER);
      v_remaining := v_remaining - v_lp_v;
      v_nnpp_v := GREATEST(0, ROUND(v_valid_votes * v_nnpp_share * (0.7 + random() * 0.6))::INTEGER);
      v_remaining := v_remaining - v_nnpp_v;
      v_apga_v := GREATEST(0, ROUND(v_valid_votes * v_apga_share * (0.7 + random() * 0.6))::INTEGER);
      v_remaining := v_remaining - v_apga_v;
      v_sdp_v := GREATEST(0, ROUND(v_valid_votes * v_sdp_share * (0.7 + random() * 0.6))::INTEGER);
      v_remaining := v_remaining - v_sdp_v;
      v_ypp_v := GREATEST(0, ROUND(v_valid_votes * v_ypp_share * (0.7 + random() * 0.6))::INTEGER);
      v_remaining := v_remaining - v_ypp_v;
      v_adc_v := GREATEST(0, v_remaining);

      INSERT INTO party_results (result_submission_id, party_id, votes) VALUES
        (v_row.result_id, v_ndc, v_ndc_v),
        (v_row.result_id, v_apc, v_apc_v),
        (v_row.result_id, v_pdp, v_pdp_v),
        (v_row.result_id, v_lp, v_lp_v),
        (v_row.result_id, v_nnpp, v_nnpp_v),
        (v_row.result_id, v_apga, v_apga_v),
        (v_row.result_id, v_sdp, v_sdp_v),
        (v_row.result_id, v_ypp, v_ypp_v),
        (v_row.result_id, v_adc, v_adc_v);
    END;

    v_count := v_count + 1;
    IF v_count % 10000 = 0 THEN
      RAISE NOTICE 'Progress: % / % results', v_count, v_total;
    END IF;
  END LOOP;

  RAISE NOTICE '=== DONE: Inserted % party result rows across 9 parties ===', v_count * 9;

  -- STEP 3: Clean up duplicate elections
  DELETE FROM elections
  WHERE id NOT IN (
    SELECT DISTINCT ON (type) id FROM elections ORDER BY type, created_at ASC
  );
  RAISE NOTICE 'Elections cleaned: % remaining', (SELECT count(*) FROM elections);
END $$;

-- Final verification
SELECT p.abbreviation, COUNT(*) as rows, SUM(pr.votes) as total_votes, 
       ROUND(SUM(pr.votes) * 100.0 / NULLIF((SELECT SUM(votes) FROM party_results), 0), 1) as pct
FROM party_results pr
JOIN parties p ON p.id = pr.party_id
GROUP BY p.abbreviation
ORDER BY total_votes DESC;

SELECT 'Elections remaining:' as info, count(*) as count FROM elections;
