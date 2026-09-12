-- ============================================================
-- NEOP DEMO CONSISTENT SEED
-- 1 SUPER_ADMIN + 250 Volunteers + 500 Assignments +
-- 250 Submissions + 2,250 Party Results + 80 Incidents
-- All referentially consistent; varied statuses; deterministic where possible.
-- ============================================================

-- ── 1. Ensure Parties (idempotent — schema already seeded, re-assert)
INSERT INTO parties (official_name, abbreviation, color) VALUES
  ('Nigeria Democratic Congress', 'NDC', '#1B5E20'),
  ('All Progressives Congress', 'APC', '#00A859'),
  ('Peoples Democratic Party', 'PDP', '#000080'),
  ('Labour Party', 'LP', '#FF0000'),
  ('New Nigeria Peoples Party', 'NNPP', '#E53935'),
  ('All Progressives Grand Alliance', 'APGA', '#FFD600'),
  ('Social Democratic Party', 'SDP', '#1565C0'),
  ('Young Progressives Party', 'YPP', '#6A1B9A'),
  ('African Democratic Congress', 'ADC', '#00838F')
ON CONFLICT (abbreviation) DO UPDATE SET
  official_name = EXCLUDED.official_name,
  color = EXCLUDED.color;

-- ── 2. Ensure Elections (2 elections — PRESIDENTIAL + GOVERNORSHIP)
INSERT INTO elections (name, type, scheduled_start, scheduled_end, status, is_active) VALUES
  ('Presidential & National Assembly Election', 'PRESIDENTIAL',
   '2027-02-20 07:00:00+00', '2027-02-20 17:00:00+00', 'IN_PROGRESS', true),
  ('Governorship & State Assembly Election', 'GOVERNORSHIP',
   '2027-03-06 07:00:00+00', '2027-03-06 17:00:00+00', 'PLANNED', false)
ON CONFLICT DO NOTHING;

-- ── 3. Ensure Simulation Config
INSERT INTO simulation_config (id, election_type, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'PRESIDENTIAL', 'IDLE')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. SUPER ADMIN + 250 VOLUNTEERS  (user_accounts → volunteers)
-- ============================================================
DO $$
DECLARE
  v_super_admin_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_presidential_id UUID;
  v_governorship_id UUID;
  v_volunteer_ids UUID[] := ARRAY[]::UUID[];
  v_user_ids UUID[] := ARRAY[]::UUID[];
  v_pu_ids UUID[];
  v_pu_count INTEGER;
  v_state_ids UUID[];
  v_lga_ids UUID[];
  v_lga_count INTEGER;
  i INTEGER;
  v_user_id UUID;
  v_volunteer_id UUID;
  v_status TEXT;
  v_verification_status TEXT;
  v_training_status TEXT;
  v_phone TEXT;
  v_full_name TEXT;
BEGIN
  -- ── Lookup election ids ──────────────────────────────────
  SELECT id INTO v_presidential_id FROM elections WHERE type = 'PRESIDENTIAL' LIMIT 1;
  SELECT id INTO v_governorship_id FROM elections WHERE type = 'GOVERNORSHIP' LIMIT 1;

  -- ── Pre-cache PU pool (for realistic geographic assignments) ─────
  SELECT array_agg(id ORDER BY id) INTO v_pu_ids FROM (
    SELECT id FROM polling_units TABLESAMPLE SYSTEM(1) LIMIT 600
  ) sub;
  v_pu_count := coalesce(array_length(v_pu_ids, 1), 0);

  IF v_pu_count < 550 THEN
    SELECT array_agg(id ORDER BY id) INTO v_pu_ids FROM (
      SELECT id FROM polling_units ORDER BY id LIMIT 600
    ) sub;
    v_pu_count := coalesce(array_length(v_pu_ids, 1), 0);
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_state_ids FROM states LIMIT 37;
  SELECT array_agg(id ORDER BY id) INTO v_lga_ids FROM lgas LIMIT 200;
  v_lga_count := coalesce(array_length(v_lga_ids, 1), 1);

  -- ── SUPER ADMIN user_account ────────────────────────────
  INSERT INTO user_accounts (id, email, full_name, auth_provider)
  VALUES (v_super_admin_id, 'admin@neop.ng', 'Dr. Amina Okafor', 'email')
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email, full_name = EXCLUDED.full_name;

  INSERT INTO admin_users (user_id, role, is_active)
  VALUES (v_super_admin_id, 'SUPER_ADMIN', true)
  ON CONFLICT DO NOTHING;

  -- ── 250 VOLUNTEERS + user_accounts ─────────────────────
  FOR i IN 1..250 LOOP
    v_user_id := ('bbbbbbbb-0000-0000-0000-' || lpad(i::text, 12, '0'))::UUID;
    v_volunteer_id := ('cccccccc-0000-0000-0000-' || lpad(i::text, 12, '0'))::UUID;
    v_user_ids := array_append(v_user_ids, v_user_id);
    v_volunteer_ids := array_append(v_volunteer_ids, v_volunteer_id);

    CASE (i % 10)
      WHEN 0 THEN v_status := 'REGISTERED';
      WHEN 1 THEN v_status := 'VERIFICATION_REQUESTED';
      WHEN 2 THEN v_status := 'VERIFIED';
      WHEN 3 THEN v_status := 'TRAINING';
      WHEN 4 THEN v_status := 'TRAINED';
      WHEN 5 THEN v_status := 'ACTIVE';
      WHEN 6 THEN v_status := 'ACTIVE';
      WHEN 7 THEN v_status := 'ACTIVE';
      WHEN 8 THEN v_status := 'INACTIVE';
      ELSE       v_status := 'SUSPENDED';
    END CASE;

    CASE (i % 7)
      WHEN 0 THEN v_verification_status := 'NOT_REQUESTED';
      WHEN 1 THEN v_verification_status := 'REQUESTED';
      WHEN 2 THEN v_verification_status := 'PENDING';
      WHEN 3 THEN v_verification_status := 'VERIFIED';
      WHEN 4 THEN v_verification_status := 'VERIFIED';
      WHEN 5 THEN v_verification_status := 'VERIFIED';
      ELSE       v_verification_status := 'REJECTED';
    END CASE;

    CASE (i % 6)
      WHEN 0 THEN v_training_status := 'NOT_STARTED';
      WHEN 1 THEN v_training_status := 'IN_PROGRESS';
      WHEN 2 THEN v_training_status := 'COMPLETED';
      WHEN 3 THEN v_training_status := 'COMPLETED';
      WHEN 4 THEN v_training_status := 'COMPLETED';
      ELSE       v_training_status := 'COMPLETED';
    END CASE;

    v_phone := '+234' || lpad((800000000 + i)::text, 10, '0');

    CASE (i % 10)
      WHEN 0 THEN v_full_name := 'Ahmed Musa';
      WHEN 1 THEN v_full_name := 'Blessing Eze';
      WHEN 2 THEN v_full_name := 'Chinedu Okafor';
      WHEN 3 THEN v_full_name := 'Damilola Adeyemi';
      WHEN 4 THEN v_full_name := 'Fatima Ibrahim';
      WHEN 5 THEN v_full_name := 'Grace Nwosu';
      WHEN 6 THEN v_full_name := 'Hassan Bello';
      WHEN 7 THEN v_full_name := 'Ifeoma Okonkwo';
      WHEN 8 THEN v_full_name := 'Jibrin Suleiman';
      ELSE       v_full_name := 'Kemi Balogun';
    END CASE;
    v_full_name := v_full_name || ' ' || i::text;

    INSERT INTO user_accounts (id, email, full_name, auth_provider) VALUES
      (v_user_id, 'agent' || i || '@neop.ng', v_full_name, 'google')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO volunteers (id, user_id, status, phone, state_id, lga_id,
                          verification_status, training_status,
                          training_completed_at, selected_polling_unit_id) VALUES
      (v_volunteer_id,
       v_user_id,
       v_status,
       v_phone,
       v_state_ids[1 + ((i - 1) % 37)],
       v_lga_ids[1 + ((i * 3) % v_lga_count)],
       v_verification_status,
       v_training_status,
       CASE WHEN v_training_status = 'COMPLETED'
            THEN now() - (random() * interval '60 days') ELSE NULL END,
       CASE WHEN v_pu_count > 0 THEN v_pu_ids[1 + ((i * 7) % v_pu_count)] ELSE NULL END)
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- ============================================================
  -- 5. 500 ASSIGNMENTS  (250 per election)
  -- ============================================================
  DECLARE
    v_assignment_id UUID;
    v_pu_id UUID;
    v_vol_idx INTEGER;
    v_a_status TEXT;
    v_obs_num INTEGER;
    v_checked_in_at TIMESTAMPTZ;
    v_checked_out_at TIMESTAMPTZ;
    v_released_at TIMESTAMPTZ;
    v_lat DOUBLE PRECISION;
    v_lng DOUBLE PRECISION;
    v_dist DOUBLE PRECISION;
    v_acc DOUBLE PRECISION;
    a INTEGER;
    v_pu_lat DOUBLE PRECISION;
    v_pu_lng DOUBLE PRECISION;
  BEGIN
    -- ── PRESIDENTIAL: 250 assignments ────────────────────
    FOR a IN 1..250 LOOP
      v_vol_idx := a;
      v_pu_id := v_pu_ids[1 + ((a * 13) % v_pu_count)];
      v_assignment_id := ('dddddddd-0000-0001-0000-' || lpad(a::text, 12, '0'))::UUID;

      CASE (a % 10)
        WHEN 0,1 THEN v_a_status := 'ASSIGNED';
        WHEN 2,3 THEN v_a_status := 'ACTIVATED';
        WHEN 4,5,6 THEN v_a_status := 'CHECKED_IN';
        WHEN 7,8 THEN v_a_status := 'COMPLETED';
        WHEN 9 THEN v_a_status := 'RELEASED';
        ELSE v_a_status := 'CANCELLED';
      END CASE;
      v_obs_num := 1 + ((a * 5) % 3);

      SELECT latitude, longitude INTO v_pu_lat, v_pu_lng
      FROM polling_units WHERE id = v_pu_id LIMIT 1;

      IF v_a_status IN ('CHECKED_IN', 'COMPLETED', 'RELEASED') THEN
        v_lat := coalesce(v_pu_lat, 9.0) + (random() - 0.5) * 0.01;
        v_lng := coalesce(v_pu_lng, 8.0) + (random() - 0.5) * 0.01;
        v_dist := haversine_distance(v_lat, v_lng,
                                coalesce(v_pu_lat, 9.0), coalesce(v_pu_lng, 8.0));
        v_acc := 5 + random() * 20;
        v_checked_in_at := now() - (random() * interval '8 hours');
        IF v_a_status = 'COMPLETED' THEN
          v_checked_out_at := v_checked_in_at + (random() * interval '10 hours');
          v_released_at := v_checked_out_at;
        ELSIF v_a_status = 'RELEASED' THEN
          v_checked_out_at := NULL;
          v_released_at := v_checked_in_at + (random() * interval '10 hours');
        ELSE
          v_checked_out_at := NULL;
          v_released_at := NULL;
        END IF;
      ELSE
        v_lat := NULL; v_lng := NULL; v_dist := NULL; v_acc := NULL;
        v_checked_in_at := NULL; v_checked_out_at := NULL; v_released_at := NULL;
      END IF;

      INSERT INTO agent_assignments (id, volunteer_id, polling_unit_id, election_id,
        status, observer_number, assigned_at, checked_in_at, checked_out_at, released_at,
        check_in_lat, check_in_lng, check_in_accuracy, distance_from_pu, location_verified)
      VALUES (v_assignment_id,
              v_volunteer_ids[v_vol_idx], v_pu_id, v_presidential_id,
              v_a_status, v_obs_num,
              now() - (random() * interval '30 days'),
              v_checked_in_at, v_checked_out_at, v_released_at,
              v_lat, v_lng, v_acc, v_dist,
              CASE WHEN v_dist IS NOT NULL AND v_dist < 150 THEN true
                   WHEN v_dist IS NOT NULL THEN false ELSE NULL END)
      ON CONFLICT (id) DO NOTHING;
    END LOOP;

    -- ── GOVERNORSHIP: 250 assignments ────────────────────────
    FOR a IN 1..250 LOOP
      v_vol_idx := a;
      v_pu_id := v_pu_ids[1 + ((a * 19 + 77) % v_pu_count)];
      v_assignment_id := ('dddddddd-0000-0002-0000-' || lpad(a::text, 12, '0'))::UUID;
      CASE (a % 12)
        WHEN 0,1,2,3 THEN v_a_status := 'ASSIGNED';
        WHEN 4,5 THEN v_a_status := 'ACTIVATED';
        WHEN 6 THEN v_a_status := 'CHECKED_IN';
        WHEN 7 THEN v_a_status := 'COMPLETED';
        ELSE v_a_status := 'RELEASED';
      END CASE;
      v_obs_num := 1 + ((a * 3) % 3);

      INSERT INTO agent_assignments (id, volunteer_id, polling_unit_id, election_id,
        status, observer_number, assigned_at)
      VALUES (v_assignment_id,
              v_volunteer_ids[v_vol_idx], v_pu_id, v_governorship_id,
              v_a_status, v_obs_num,
              now() - (random() * interval '60 days'))
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END;

  -- ============================================================
  -- 6. 250 RESULT SUBMISSIONS + 9 PARTY RESULTS EACH (2,250)
  -- ============================================================
  DECLARE
    v_rs_id UUID;
    v_ndc UUID; v_apc UUID; v_pdp UUID; v_lp UUID; v_nnpp UUID;
    v_apga UUID; v_sdp UUID; v_ypp UUID; v_adc UUID;
    v_assignment RECORD;
    v_cursor CURSOR FOR
      SELECT aa.id AS asgn_id, aa.polling_unit_id, aa.volunteer_id,
             aa.election_id, pu.registered_voters
      FROM agent_assignments aa
      JOIN polling_units pu ON pu.id = aa.polling_unit_id
      WHERE aa.election_id = v_presidential_id
        AND aa.status IN ('CHECKED_IN', 'COMPLETED', 'RELEASED')
      ORDER BY aa.id
      LIMIT 125;
    v_cursor2 CURSOR FOR
      SELECT aa.id AS asgn_id, aa.polling_unit_id, aa.volunteer_id,
             aa.election_id, pu.registered_voters
      FROM agent_assignments aa
      JOIN polling_units pu ON pu.id = aa.polling_unit_id
      WHERE aa.election_id = v_governorship_id
        AND aa.status IN ('CHECKED_IN', 'COMPLETED', 'RELEASED')
      ORDER BY aa.id
      LIMIT 125;
    v_r INTEGER;
    v_valid INT; v_rej INT; v_tot INT;
    v_status TEXT;
    v_idem TEXT;
    v_verified_at TIMESTAMPTZ;
  BEGIN
    SELECT id INTO v_ndc  FROM parties WHERE abbreviation = 'NDC'  LIMIT 1;
    SELECT id INTO v_apc  FROM parties WHERE abbreviation = 'APC'  LIMIT 1;
    SELECT id INTO v_pdp  FROM parties WHERE abbreviation = 'PDP'  LIMIT 1;
    SELECT id INTO v_lp   FROM parties WHERE abbreviation = 'LP'   LIMIT 1;
    SELECT id INTO v_nnpp FROM parties WHERE abbreviation = 'NNPP' LIMIT 1;
    SELECT id INTO v_apga FROM parties WHERE abbreviation = 'APGA' LIMIT 1;
    SELECT id INTO v_sdp  FROM parties WHERE abbreviation = 'SDP'  LIMIT 1;
    SELECT id INTO v_ypp  FROM parties WHERE abbreviation = 'YPP'  LIMIT 1;
    SELECT id INTO v_adc  FROM parties WHERE abbreviation = 'ADC'  LIMIT 1;

    v_r := 0;
    FOR v_assignment IN v_cursor LOOP
      v_r := v_r + 1;
      v_rs_id := ('eeeeeeee-0001-0000-0000-' || lpad(v_r::text, 12, '0'))::UUID;
      v_tot := greatest(80, (coalesce(v_assignment.registered_voters, 500) * (0.3 + random() * 0.5))::INT);
      v_rej := greatest(0, round(v_tot * (0.01 + random() * 0.04))::INT);
      v_valid := v_tot - v_rej;

      CASE (v_r % 8)
        WHEN 0,1,2   THEN v_status := 'UNVERIFIED';
        WHEN 3,4     THEN v_status := 'PENDING_VERIFICATION';
        WHEN 5,6     THEN v_status := 'VERIFIED';
        WHEN 7       THEN v_status := 'DISPUTED';
        ELSE              v_status := 'REJECTED';
      END CASE;
      v_idem := 'idem-pres-' || v_r::text;
      v_verified_at := CASE WHEN v_status = 'VERIFIED'
                            THEN now() - (random() * interval '5 days') ELSE NULL END;

      INSERT INTO result_submissions (id, election_id, polling_unit_id, volunteer_id,
        assignment_id, valid_votes, rejected_votes, total_votes, status,
        idempotency_key, submitted_at, verified_at)
      VALUES (v_rs_id, v_assignment.election_id, v_assignment.polling_unit_id,
              v_assignment.volunteer_id, v_assignment.asgn_id,
              v_valid, v_rej, v_tot, v_status, v_idem,
              now() - (random() * interval '10 days'), v_verified_at)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO party_results (result_submission_id, party_id, votes) VALUES
        (v_rs_id, v_ndc,  greatest(0, round(v_valid * (0.30 + random()*0.15))::INT)),
        (v_rs_id, v_apc,  greatest(0, round(v_valid * (0.22 + random()*0.10))::INT)),
        (v_rs_id, v_pdp,  greatest(0, round(v_valid * (0.14 + random()*0.08))::INT)),
        (v_rs_id, v_lp,   greatest(0, round(v_valid * (0.10 + random()*0.06))::INT)),
        (v_rs_id, v_nnpp, greatest(0, round(v_valid * (0.07 + random()*0.05))::INT)),
        (v_rs_id, v_apga, greatest(0, round(v_valid * (0.05 + random()*0.04))::INT)),
        (v_rs_id, v_sdp,  greatest(0, round(v_valid * (0.04 + random()*0.03))::INT)),
        (v_rs_id, v_ypp,  greatest(0, round(v_valid * (0.04 + random()*0.03))::INT)),
        (v_rs_id, v_adc,  greatest(0, round(v_valid * (0.04 + random()*0.03))::INT));
    END LOOP;

    FOR v_assignment IN v_cursor2 LOOP
      v_r := v_r + 1;
      v_rs_id := ('eeeeeeee-0002-0000-0000-' || lpad((v_r - 125)::text, 12, '0'))::UUID;
      v_tot := greatest(80, (coalesce(v_assignment.registered_voters, 500) * (0.3 + random() * 0.5))::INT);
      v_rej := greatest(0, round(v_tot * (0.01 + random() * 0.04))::INT);
      v_valid := v_tot - v_rej;

      CASE (v_r % 8)
        WHEN 0,1,2   THEN v_status := 'UNVERIFIED';
        WHEN 3,4     THEN v_status := 'PENDING_VERIFICATION';
        WHEN 5,6     THEN v_status := 'VERIFIED';
        WHEN 7       THEN v_status := 'DISPUTED';
        ELSE              v_status := 'REJECTED';
      END CASE;
      v_idem := 'idem-gov-' || (v_r - 125)::text;
      v_verified_at := CASE WHEN v_status = 'VERIFIED'
                            THEN now() - (random() * interval '5 days') ELSE NULL END;

      INSERT INTO result_submissions (id, election_id, polling_unit_id, volunteer_id,
        assignment_id, valid_votes, rejected_votes, total_votes, status,
        idempotency_key, submitted_at, verified_at)
      VALUES (v_rs_id, v_assignment.election_id, v_assignment.polling_unit_id,
              v_assignment.volunteer_id, v_assignment.asgn_id,
              v_valid, v_rej, v_tot, v_status, v_idem,
              now() - (random() * interval '10 days'), v_verified_at)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO party_results (result_submission_id, party_id, votes) VALUES
        (v_rs_id, v_ndc,  greatest(0, round(v_valid * (0.28 + random()*0.14))::INT)),
        (v_rs_id, v_apc,  greatest(0, round(v_valid * (0.23 + random()*0.10))::INT)),
        (v_rs_id, v_pdp,  greatest(0, round(v_valid * (0.15 + random()*0.08))::INT)),
        (v_rs_id, v_lp,   greatest(0, round(v_valid * (0.11 + random()*0.06))::INT)),
        (v_rs_id, v_nnpp, greatest(0, round(v_valid * (0.07 + random()*0.05))::INT)),
        (v_rs_id, v_apga, greatest(0, round(v_valid * (0.06 + random()*0.04))::INT)),
        (v_rs_id, v_sdp,  greatest(0, round(v_valid * (0.04 + random()*0.03))::INT)),
        (v_rs_id, v_ypp,  greatest(0, round(v_valid * (0.04 + random()*0.03))::INT)),
        (v_rs_id, v_adc,  greatest(0, round(v_valid * (0.04 + random()*0.03))::INT));
    END LOOP;
  END;

  -- ============================================================
  -- 7. 80 INCIDENTS (from presidential assignments)
  -- ============================================================
  DECLARE
    v_inc_id UUID;
    v_categories TEXT[] := ARRAY[
      'BALLOT_BOX_SNIFFING', 'OVERVOTING', 'UNDERAGED_VOTING',
      'MATERIAL_SHORTAGE', 'VIOLENCE', 'HARASSMENT',
      'BIAS_OFFICIAL', 'TECHNICAL_ISSUES', 'BUYING',
      'INTIMIDATION', 'LOGISTICS_DELAY', 'FRAUD_SUSPICION'
    ];
    v_severities TEXT[] := ARRAY['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'CRITICAL'];
    v_cat_len INTEGER := array_length(v_categories, 1);
    v_sev_len INTEGER := array_length(v_severities, 1);
    v_asgn RECORD;
    v_inc_cursor CURSOR FOR
      SELECT aa.id AS asgn_id, aa.polling_unit_id, aa.volunteer_id,
             aa.election_id
      FROM agent_assignments aa
      WHERE aa.election_id = v_presidential_id
      ORDER BY random()
      LIMIT 80;
    n INTEGER := 0;
    v_cat TEXT;
    v_sev TEXT;
    v_what TEXT;
    v_when TIMESTAMPTZ;
    v_inc_status TEXT;
    v_details JSONB;
    v_safe BOOLEAN;
    v_reviewed_at TIMESTAMPTZ;
    v_review_notes TEXT;
  BEGIN
    FOR v_asgn IN v_inc_cursor LOOP
      n := n + 1;
      v_inc_id := ('ffffffff-0000-0000-0000-' || lpad(n::text, 12, '0'))::UUID;
      v_cat := v_categories[1 + ((n * 7) % v_cat_len)];
      v_sev := v_severities[1 + ((n * 3) % v_sev_len)];
      v_when := now() - (random() * interval '12 hours');

      CASE (n % 6)
        WHEN 0,1   THEN v_inc_status := 'REPORTED';
        WHEN 2,3   THEN v_inc_status := 'UNDER_REVIEW';
        WHEN 4     THEN v_inc_status := 'RESOLVED';
        ELSE            v_inc_status := 'ESCALATED';
      END CASE;
      v_safe := CASE WHEN v_sev IN ('LOW', 'MEDIUM') THEN true ELSE random() < 0.65 END;

      CASE v_cat
        WHEN 'BALLOT_BOX_SNIFFING'  THEN v_what := 'Ballot box tampering observed at the PU location';
        WHEN 'OVERVOTING'           THEN v_what := 'Reported overvoting: ballots exceeding registered count';
        WHEN 'UNDERAGED_VOTING'     THEN v_what := 'Minors observed voting without proper ID verification';
        WHEN 'MATERIAL_SHORTAGE'    THEN v_what := 'Shortage of result sheets and ballot papers reported';
        WHEN 'VIOLENCE'             THEN v_what := 'Physical altercation between party agents';
        WHEN 'HARASSMENT'           THEN v_what := 'Voters being harassed by party thugs';
        WHEN 'BIAS_OFFICIAL'        THEN v_what := 'Presiding officer showing partisan behavior';
        WHEN 'TECHNICAL_ISSUES'     THEN v_what := 'Card reader / BVAS malfunction';
        WHEN 'BUYING'               THEN v_what := 'Vote-buying observed near premises';
        WHEN 'INTIMIDATION'         THEN v_what := 'Voter intimidation by unidentified persons';
        WHEN 'LOGISTICS_DELAY'      THEN v_what := 'Materials arrived 3+ hours late';
        ELSE                              v_what := 'Suspicious activity at PU';
      END CASE;
      v_what := v_what || ' (Incident #' || n::text || ')';

      v_details := jsonb_build_object(
        'category', v_cat,
        'severity', v_sev,
        'incident_number', n,
        'reported_by', 'Agent_' || n::text
      );

      IF v_inc_status != 'REPORTED' THEN
        v_reviewed_at := now() - (random() * interval '1 hour');
      ELSE
        v_reviewed_at := NULL;
      END IF;

      IF v_inc_status = 'RESOLVED' THEN
        v_review_notes := 'Incident verified and closed by admin review';
      ELSIF v_inc_status = 'ESCALATED' THEN
        v_review_notes := 'Escalated to security agencies';
      ELSE
        v_review_notes := NULL;
      END IF;

      INSERT INTO incidents (id, election_id, polling_unit_id, volunteer_id,
        assignment_id, category, severity, what_observed, when_observed,
        details, status, reviewed_by, review_notes, reviewed_at,
        agent_safe, submitted_at)
      VALUES (v_inc_id, v_asgn.election_id, v_asgn.polling_unit_id, v_asgn.volunteer_id,
              v_asgn.asgn_id, v_cat, v_sev, v_what, v_when,
              v_details, v_inc_status,
              CASE WHEN v_inc_status != 'REPORTED' THEN v_super_admin_id ELSE NULL END,
              v_review_notes, v_reviewed_at,
              v_safe, now() - (random() * interval '2 hours'))
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END;

  -- ============================================================
  -- 8. AUDIT TRAIL — seed actions written
  -- ============================================================
  INSERT INTO audit_log (actor_id, actor_type, action, resource_type, metadata)
  VALUES
    (v_super_admin_id, 'SUPER_ADMIN', 'SEED_RUN', 'DEMO_DATA',
     jsonb_build_object('volunteers_created', 250, 'assignments', 500,
                        'submissions', 250, 'incidents', 80));

END $$;

-- ============================================================
-- FINAL COUNT VERIFICATION
-- ============================================================
DO $$
DECLARE
  v_parties BIGINT;
  v_elections BIGINT;
  v_admins BIGINT;
  v_users BIGINT;
  v_vols BIGINT;
  v_asgn BIGINT;
  v_rs BIGINT;
  v_pr BIGINT;
  v_inc BIGINT;
BEGIN
  SELECT count(*) INTO v_parties FROM parties;
  SELECT count(*) INTO v_elections FROM elections;
  SELECT count(*) INTO v_admins FROM admin_users;
  SELECT count(*) INTO v_users FROM user_accounts;
  SELECT count(*) INTO v_vols FROM volunteers;
  SELECT count(*) INTO v_asgn FROM agent_assignments;
  SELECT count(*) INTO v_rs FROM result_submissions;
  SELECT count(*) INTO v_pr FROM party_results;
  SELECT count(*) INTO v_inc FROM incidents;

  RAISE NOTICE '=== DEMO SEED COMPLETE =======';
  RAISE NOTICE 'Parties: %  (expect 9)', v_parties;
  RAISE NOTICE 'Elections: %  (expect 2)', v_elections;
  RAISE NOTICE 'Admin users: %  (expect 1)', v_admins;
  RAISE NOTICE 'User accounts: % (expect 251)', v_users;
  RAISE NOTICE 'Volunteers: %  (expect 250)', v_vols;
  RAISE NOTICE 'Assignments: % (expect 500)', v_asgn;
  RAISE NOTICE 'Result Submissions: % (expect 250)', v_rs;
  RAISE NOTICE 'Party Results: % (expect ~2250)', v_pr;
  RAISE NOTICE 'Incidents: %  (expect 80)', v_inc;
END $$;
