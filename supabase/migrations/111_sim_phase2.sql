/**
 * Fast Simulation Phase 2 — Insert party_results + finalize
 *
 * Uses cursor-based pagination with correct batch tracking.
 * Each batch captures its own last ID before inserting.
 */

CREATE OR REPLACE FUNCTION run_sim_phase2(
  p_scenario TEXT DEFAULT 'landslide'
)
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '115s'
SET lock_timeout = '30s'
AS $$
DECLARE
  v_ndc_share NUMERIC;
  v_apc_share NUMERIC;
  v_batch_size INTEGER := 50000;
  v_last_id UUID := '00000000-0000-0000-0000-000000000000';
  v_pr_created INTEGER := 0;
  v_total_votes BIGINT;
  v_results_created INTEGER;
  v_ndc UUID; v_apc UUID; v_pdp UUID; v_lp UUID;
  v_nnpp UUID; v_apga UUID; v_sdp UUID; v_ypp UUID; v_adc UUID;
  v_batch_rows BIGINT;
  v_new_last_id UUID;
BEGIN
  v_ndc_share := CASE p_scenario
    WHEN 'landslide' THEN 0.42 WHEN 'sweep' THEN 0.37
    WHEN 'close' THEN 0.30 ELSE 0.37 END;
  v_apc_share := CASE p_scenario
    WHEN 'landslide' THEN 0.22 WHEN 'sweep' THEN 0.25
    WHEN 'close' THEN 0.28 ELSE 0.25 END;

  SELECT id INTO v_ndc FROM parties WHERE abbreviation = 'NDC' LIMIT 1;
  SELECT id INTO v_apc FROM parties WHERE abbreviation = 'APC' LIMIT 1;
  SELECT id INTO v_pdp FROM parties WHERE abbreviation = 'PDP' LIMIT 1;
  SELECT id INTO v_lp FROM parties WHERE abbreviation = 'LP' LIMIT 1;
  SELECT id INTO v_nnpp FROM parties WHERE abbreviation = 'NNPP' LIMIT 1;
  SELECT id INTO v_apga FROM parties WHERE abbreviation = 'APGA' LIMIT 1;
  SELECT id INTO v_sdp FROM parties WHERE abbreviation = 'SDP' LIMIT 1;
  SELECT id INTO v_ypp FROM parties WHERE abbreviation = 'YPP' LIMIT 1;
  SELECT id INTO v_adc FROM parties WHERE abbreviation = 'ADC' LIMIT 1;

  LOOP
    -- Capture the last ID of this batch BEFORE inserting
    SELECT id INTO v_new_last_id
    FROM result_submissions
    WHERE id > v_last_id
    ORDER BY id DESC
    LIMIT 1;

    -- No more rows to process
    EXIT WHEN v_new_last_id IS NULL;

    INSERT INTO party_results (result_submission_id, party_id, votes)
    WITH batch AS (
      SELECT ri.id AS result_id, ri.valid_votes,
        CASE COALESCE(st.name, '')
          WHEN 'Kano' THEN 'NW' WHEN 'Katsina' THEN 'NW' WHEN 'Sokoto' THEN 'NW'
          WHEN 'Zamfara' THEN 'NW' WHEN 'Kebbi' THEN 'NW' WHEN 'Jigawa' THEN 'NW'
          WHEN 'Kaduna' THEN 'NW' WHEN 'Borno' THEN 'NE' WHEN 'Yobe' THEN 'NE'
          WHEN 'Adamawa' THEN 'NE' WHEN 'Gombe' THEN 'NE' WHEN 'Taraba' THEN 'NE'
          WHEN 'Bauchi' THEN 'NE' WHEN 'Niger' THEN 'NC' WHEN 'Kwara' THEN 'NC'
          WHEN 'Kogi' THEN 'NC' WHEN 'Benue' THEN 'NC' WHEN 'Plateau' THEN 'NC'
          WHEN 'Nasarawa' THEN 'NC' WHEN 'Lagos' THEN 'SW' WHEN 'Ogun' THEN 'SW'
          WHEN 'Oyo' THEN 'SW' WHEN 'Ondo' THEN 'SW' WHEN 'Osun' THEN 'SW'
          WHEN 'Ekiti' THEN 'SW' WHEN 'Abia' THEN 'SE' WHEN 'Anambra' THEN 'SE'
          WHEN 'Ebonyi' THEN 'SE' WHEN 'Enugu' THEN 'SE' WHEN 'Imo' THEN 'SE'
          WHEN 'Rivers' THEN 'SS' WHEN 'Delta' THEN 'SS' WHEN 'Bayelsa' THEN 'SS'
          WHEN 'Akwa Ibom' THEN 'SS' WHEN 'Cross River' THEN 'SS' WHEN 'Edo' THEN 'SS'
          WHEN 'FCT' THEN 'FC' ELSE 'NC'
        END AS region
      FROM result_submissions ri
      INNER JOIN polling_units pu ON pu.id = ri.polling_unit_id
      LEFT JOIN states st ON st.id = pu.state_id
      WHERE ri.id > v_last_id AND ri.id <= v_new_last_id
      ORDER BY ri.id
    ),
    computed AS (
      SELECT result_id, valid_votes, region,
        GREATEST(0, ROUND(valid_votes * v_ndc_share *
          CASE region WHEN 'SE' THEN 1.9 WHEN 'SS' THEN 1.6 WHEN 'FC' THEN 1.2
            WHEN 'NC' THEN 1.0 WHEN 'NE' THEN 0.7 WHEN 'NW' THEN 0.6 WHEN 'SW' THEN 0.5
            ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER AS ndc_v,
        GREATEST(0, ROUND(valid_votes * v_apc_share *
          CASE region WHEN 'SW' THEN 1.5 WHEN 'NW' THEN 1.4 WHEN 'NE' THEN 1.3
            WHEN 'NC' THEN 1.1 WHEN 'FC' THEN 1.0 WHEN 'SS' THEN 0.4 WHEN 'SE' THEN 0.3
            ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER AS apc_v
      FROM batch
    ),
    final AS (
      SELECT result_id, valid_votes, region, ndc_v, apc_v,
        GREATEST(0, valid_votes - ndc_v - apc_v) AS rem
      FROM computed
    )
    SELECT result_id, v_ndc, ndc_v FROM final WHERE ndc_v > 0
    UNION ALL
    SELECT result_id, v_apc, apc_v FROM final WHERE apc_v > 0
    UNION ALL
    SELECT result_id, v_pdp, GREATEST(0, ROUND(rem * 0.30 * (0.7 + random() * 0.6)))::INTEGER FROM final WHERE rem > 0
    UNION ALL
    SELECT result_id, v_lp, GREATEST(0, ROUND(rem * 0.20 * (0.7 + random() * 0.6)))::INTEGER FROM final WHERE rem > 0
    UNION ALL
    SELECT result_id, v_nnpp, GREATEST(0, ROUND(rem * 0.12 * (0.7 + random() * 0.6)))::INTEGER FROM final WHERE rem > 0
    UNION ALL
    SELECT result_id, v_apga, GREATEST(0, ROUND(rem * 0.10 * (0.7 + random() * 0.6)))::INTEGER FROM final WHERE rem > 0
    UNION ALL
    SELECT result_id, v_sdp, GREATEST(0, ROUND(rem * 0.08 * (0.7 + random() * 0.6)))::INTEGER FROM final WHERE rem > 0
    UNION ALL
    SELECT result_id, v_ypp, GREATEST(0, ROUND(rem * 0.10 * (0.7 + random() * 0.6)))::INTEGER FROM final WHERE rem > 0
    UNION ALL
    SELECT result_id, v_adc, GREATEST(0, rem
      - GREATEST(0, ROUND(rem * 0.30 * (0.7 + random() * 0.6)))
      - GREATEST(0, ROUND(rem * 0.20 * (0.7 + random() * 0.6)))
      - GREATEST(0, ROUND(rem * 0.12 * (0.7 + random() * 0.6)))
      - GREATEST(0, ROUND(rem * 0.10 * (0.7 + random() * 0.6)))
      - GREATEST(0, ROUND(rem * 0.08 * (0.7 + random() * 0.6)))
      - GREATEST(0, ROUND(rem * 0.10 * (0.7 + random() * 0.6)))
    )::INTEGER FROM final WHERE rem > 0;

    GET DIAGNOSTICS v_batch_rows = ROW_COUNT;
    v_pr_created := v_pr_created + v_batch_rows;

    -- Advance cursor to the end of this batch
    v_last_id := v_new_last_id;
  END LOOP;

  SELECT count(*) INTO v_results_created FROM result_submissions;
  SELECT sum(total_votes) INTO v_total_votes FROM result_submissions;

  UPDATE simulation_config SET
    status = 'COMPLETED', last_tick_at = now(), updated_at = now(),
    total_results_submitted = v_results_created
  WHERE id = '00000000-0000-0000-0000-000000000001';

  RETURN jsonb_build_object(
    'phase', 2, 'success', true,
    'party_results_created', v_pr_created,
    'results_created', v_results_created,
    'total_votes', v_total_votes,
    'scenario', p_scenario
  );
END;
$$;

GRANT EXECUTE ON FUNCTION run_sim_phase2(TEXT) TO service_role;
