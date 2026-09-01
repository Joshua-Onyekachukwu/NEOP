-- ============================================================
-- NIGERIA ELECTION OBSERVATION PLATFORM (NEOP)
-- Complete Database Schema — Single Consolidated File
-- ============================================================
-- Run this ONE file in Supabase SQL Editor to set up a fresh database.
-- Includes: tables, indexes, functions, RLS policies, triggers, seed data.
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SECTION 1: TABLES
-- ============================================================

-- ── 1.1 Electoral Geography ─────────────────────────────────

CREATE TABLE states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lgas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_id UUID NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(state_id, code)
);

CREATE TABLE wards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lga_id UUID NOT NULL REFERENCES lgas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lga_id, code)
);

CREATE TABLE polling_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  official_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  state_id UUID NOT NULL REFERENCES states(id),
  lga_id UUID NOT NULL REFERENCES lgas(id),
  ward_id UUID NOT NULL REFERENCES wards(id),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  registered_voters INT,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 1.2 Elections & Parties ─────────────────────────────────

CREATE TABLE elections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE parties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  official_name TEXT NOT NULL,
  abbreviation TEXT,
  color TEXT,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parties_abbreviation_unique UNIQUE (abbreviation)
);

-- ── 1.3 Auth & Users ────────────────────────────────────────

CREATE TABLE user_accounts (
  id UUID PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'google',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_accounts(id),
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 1.4 Volunteers & Assignments ────────────────────────────

CREATE TABLE volunteers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'REGISTERED',
  phone TEXT,
  state_id UUID REFERENCES states(id),
  lga_id UUID REFERENCES lgas(id),
  verification_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  training_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  training_completed_at TIMESTAMPTZ,
  selected_polling_unit_id UUID REFERENCES polling_units(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE agent_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  election_id UUID NOT NULL REFERENCES elections(id),
  status TEXT NOT NULL DEFAULT 'ASSIGNED',
  observer_number INT NOT NULL DEFAULT 1,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  check_in_lat DOUBLE PRECISION,
  check_in_lng DOUBLE PRECISION,
  check_in_accuracy DOUBLE PRECISION,
  distance_from_pu DOUBLE PRECISION,
  location_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(volunteer_id, election_id),
  UNIQUE(polling_unit_id, election_id, observer_number)
);

-- ── 1.5 Observations & Results ──────────────────────────────

CREATE TABLE observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  assignment_id UUID NOT NULL REFERENCES agent_assignments(id),
  observation_type TEXT NOT NULL,
  description TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE result_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  volunteer_id UUID REFERENCES volunteers(id),
  assignment_id UUID REFERENCES agent_assignments(id),
  valid_votes INT NOT NULL,
  rejected_votes INT DEFAULT 0,
  total_votes INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  idempotency_key TEXT UNIQUE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_votes_math CHECK (valid_votes + rejected_votes = total_votes),
  CONSTRAINT chk_non_negative CHECK (valid_votes >= 0 AND rejected_votes >= 0 AND total_votes >= 0)
);

CREATE TABLE party_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  result_submission_id UUID NOT NULL REFERENCES result_submissions(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id),
  votes INT NOT NULL,
  CONSTRAINT chk_party_votes_non_negative CHECK (votes >= 0),
  UNIQUE(result_submission_id, party_id)
);

-- ── 1.6 Evidence & Incidents ────────────────────────────────

CREATE TABLE evidence_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_type TEXT NOT NULL,
  parent_id UUID NOT NULL,
  election_id UUID NOT NULL REFERENCES elections(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  file_id TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  captured_at TIMESTAMPTZ,
  is_public BOOLEAN NOT NULL DEFAULT false,
  access_level TEXT NOT NULL DEFAULT 'PRIVATE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  assignment_id UUID REFERENCES agent_assignments(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  what_observed TEXT NOT NULL,
  when_observed TIMESTAMPTZ NOT NULL,
  details JSONB,
  status TEXT NOT NULL DEFAULT 'REPORTED',
  reviewed_by UUID,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  agent_safe BOOLEAN DEFAULT true,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 1.7 Audit Log (append-only) ─────────────────────────────

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 1.8 Simulation ──────────────────────────────────────────

CREATE TABLE simulation_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_type TEXT NOT NULL DEFAULT 'PRESIDENTIAL',
  status TEXT NOT NULL DEFAULT 'IDLE',
  scenario TEXT,
  speed INT NOT NULL DEFAULT 3,
  target_states TEXT[] DEFAULT '{}',
  total_results_submitted INT NOT NULL DEFAULT 0,
  total_incidents_submitted INT NOT NULL DEFAULT 0,
  total_assignments_created INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  last_tick_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE simulation_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario TEXT NOT NULL,
  election_type TEXT NOT NULL DEFAULT 'PRESIDENTIAL',
  status TEXT NOT NULL DEFAULT 'RUNNING',
  total_polling_units INTEGER DEFAULT 0,
  results_created INTEGER DEFAULT 0,
  party_results_created INTEGER DEFAULT 0,
  total_votes BIGINT DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  ndc_wins BOOLEAN DEFAULT true,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SECTION 2: INDEXES
-- ============================================================

-- Polling units
CREATE INDEX idx_polling_units_state ON polling_units(state_id);
CREATE INDEX idx_polling_units_lga ON polling_units(lga_id);
CREATE INDEX idx_polling_units_ward ON polling_units(ward_id);
CREATE INDEX idx_polling_units_code ON polling_units(official_code);
CREATE INDEX idx_pu_status ON polling_units(status);

-- Result submissions
CREATE INDEX idx_rs_status ON result_submissions(status);
CREATE INDEX idx_rs_pu ON result_submissions(polling_unit_id);
CREATE INDEX idx_rs_submitted ON result_submissions(submitted_at DESC);

-- Party results
CREATE INDEX idx_pr_submission ON party_results(result_submission_id);
CREATE INDEX idx_pr_party ON party_results(party_id);

-- Audit log
CREATE INDEX idx_audit_log_timestamp ON audit_log(created_at);

-- Simulation
CREATE INDEX idx_simulation_config_status ON simulation_config(status);
CREATE INDEX idx_sim_history_started ON simulation_history(started_at DESC);
CREATE INDEX idx_sim_history_status ON simulation_history(status);

-- ============================================================
-- SECTION 3: FUNCTIONS (RPC)
-- ============================================================

-- ── 3.1 Haversine Distance ──────────────────────────────────

CREATE OR REPLACE FUNCTION haversine_distance(
  lat1 DOUBLE PRECISION, lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lon2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
DECLARE
  R DOUBLE PRECISION := 6371000;
  dlat DOUBLE PRECISION;
  dlon DOUBLE PRECISION;
  a DOUBLE PRECISION;
  c DOUBLE PRECISION;
BEGIN
  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);
  a := sin(dlat / 2) ^ 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ^ 2;
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  RETURN R * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 3.2 Agent Locations ─────────────────────────────────────

CREATE OR REPLACE FUNCTION get_agent_locations()
RETURNS TABLE (
  assignment_id UUID,
  volunteer_name TEXT,
  polling_unit_name TEXT,
  polling_unit_code TEXT,
  state_name TEXT,
  check_in_lat DOUBLE PRECISION,
  check_in_lng DOUBLE PRECISION,
  check_in_accuracy DOUBLE PRECISION,
  distance_from_pu DOUBLE PRECISION,
  location_verified BOOLEAN,
  checked_in_at TIMESTAMPTZ,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    aa.id as assignment_id,
    COALESCE(ua.full_name, 'Unknown') as volunteer_name,
    COALESCE(pu.name, 'Unknown') as polling_unit_name,
    COALESCE(pu.official_code, '—') as polling_unit_code,
    COALESCE(st.name, 'Unknown') as state_name,
    aa.check_in_lat,
    aa.check_in_lng,
    aa.check_in_accuracy,
    aa.distance_from_pu,
    aa.location_verified,
    aa.checked_in_at,
    aa.status
  FROM agent_assignments aa
  LEFT JOIN volunteers v ON v.id = aa.volunteer_id
  LEFT JOIN user_accounts ua ON ua.id = v.user_id
  LEFT JOIN polling_units pu ON pu.id = aa.polling_unit_id
  LEFT JOIN states st ON st.id = pu.state_id
  WHERE aa.status = 'CHECKED_IN'
    AND aa.check_in_lat IS NOT NULL
    AND aa.check_in_lng IS NOT NULL
  ORDER BY aa.checked_in_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 3.3 Party Totals ────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_party_totals()
RETURNS TABLE (
  party_name TEXT,
  party_abbreviation TEXT,
  party_color TEXT,
  total_votes BIGINT,
  percentage NUMERIC
) AS $$
DECLARE gt BIGINT;
BEGIN
  SELECT COALESCE(SUM(pr.votes), 0) INTO gt FROM party_results pr;
  RETURN QUERY
  WITH ps AS (
    SELECT p.official_name, p.abbreviation, p.color, COALESCE(SUM(pr.votes), 0) AS votes
    FROM parties p
    LEFT JOIN party_results pr ON pr.party_id = p.id
    GROUP BY p.id, p.official_name, p.abbreviation, p.color
  )
  SELECT ps.official_name, ps.abbreviation, ps.color, ps.votes,
    CASE WHEN gt > 0 THEN ROUND((ps.votes::NUMERIC / gt) * 100, 1) ELSE 0 END
  FROM ps ORDER BY ps.votes DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 3.4 State Breakdown From Results ────────────────────────

CREATE OR REPLACE FUNCTION get_state_breakdown_from_results()
RETURNS TABLE (
  state_name TEXT,
  state_id UUID,
  total_pus BIGINT,
  verified BIGINT,
  submitted BIGINT,
  disputed BIGINT,
  disrupted BIGINT
) LANGUAGE sql STABLE AS $$
  SELECT
    s.name AS state_name,
    s.id AS state_id,
    COUNT(*) AS total_pus,
    COUNT(*) FILTER (WHERE rs.status = 'VERIFIED') AS verified,
    COUNT(*) FILTER (WHERE rs.status = 'RESULT_SUBMITTED') AS submitted,
    COUNT(*) FILTER (WHERE rs.status = 'DISPUTED') AS disputed,
    COUNT(*) FILTER (WHERE rs.status = 'DISRUPTED') AS disrupted
  FROM result_submissions rs
  INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id
  INNER JOIN states s ON s.id = pu.state_id
  GROUP BY s.id, s.name
  ORDER BY total_pus DESC;
$$;

-- ── 3.5 Admin Stats ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
DECLARE v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_volunteers', (SELECT count(*) FROM volunteers),
    'active_volunteers', (SELECT count(*) FROM volunteers WHERE status = 'ACTIVE'),
    'total_assignments', (SELECT count(*) FROM agent_assignments),
    'checked_in_assignments', (SELECT count(*) FROM agent_assignments WHERE status = 'CHECKED_IN'),
    'total_results', (SELECT count(*) FROM result_submissions),
    'verified_results', (SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED'),
    'pending_verification', (SELECT count(*) FROM result_submissions WHERE status = 'UNVERIFIED'),
    'total_incidents', (SELECT count(*) FROM incidents)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ── 3.6 Fast Stats ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_fast_stats()
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'inec_total_polling_units', (SELECT count(*) FROM polling_units),
      'total_polling_units', (SELECT count(*) FROM polling_units),
      'covered_polling_units', (SELECT count(*) FROM result_submissions),
      'verified_polling_units', (SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED'),
      'active_observers', (SELECT count(*) FROM agent_assignments WHERE status = 'CHECKED_IN'),
      'total_incidents', (SELECT count(*) FROM incidents),
      'coverage_percent', 100.0,
      'verification_percent', CASE WHEN (SELECT count(*) FROM result_submissions) > 0
        THEN ROUND((SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED')::NUMERIC /
             (SELECT count(*) FROM result_submissions) * 100, 1) ELSE 0 END,
      'last_updated', now(),
      'disclaimer', 'These are independently collected field observations and are not official INEC election results.'
    )
  );
END;
$$;

-- ── 3.7 Polling Unit Rows (for GeoJSON) ─────────────────────

CREATE OR REPLACE FUNCTION get_polling_unit_rows()
RETURNS TABLE (
  id UUID,
  official_code TEXT,
  name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  status TEXT,
  state_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pu.id,
    pu.official_code,
    pu.name,
    pu.latitude,
    pu.longitude,
    pu.status,
    COALESCE(st.name, 'Unknown') as state_name
  FROM polling_units pu
  LEFT JOIN states st ON st.id = pu.state_id
  WHERE pu.latitude IS NOT NULL AND pu.longitude IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 3.8 Simulation Tick ─────────────────────────────────────

CREATE OR REPLACE FUNCTION simulation_tick()
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '60s'
AS $$
DECLARE
  v_changed INTEGER := 0;
  v_config_id UUID := '00000000-0000-0000-0000-000000000001';
  v_config_status TEXT;
BEGIN
  SELECT status INTO v_config_status FROM simulation_config WHERE id = v_config_id;
  IF v_config_status IS NULL OR v_config_status != 'RUNNING' THEN
    RETURN jsonb_build_object('ticked', false, 'reason', 'No active simulation');
  END IF;

  WITH eligible AS (
    SELECT id, status FROM polling_units
    WHERE status NOT IN ('VERIFIED', 'DISPUTED', 'DISRUPTED', 'ELECTION_NOT_HELD')
    ORDER BY random()
    LIMIT (SELECT count(*) * 0.30 FROM polling_units
           WHERE status NOT IN ('VERIFIED', 'DISPUTED', 'DISRUPTED', 'ELECTION_NOT_HELD'))
  ),
  advanced AS (
    UPDATE polling_units pu SET status = CASE
      WHEN e.status = 'NOT_STARTED' AND random() < 0.85 THEN 'VOTING'
      WHEN e.status = 'NOT_STARTED' THEN 'DISRUPTED'
      WHEN e.status = 'VOTING' AND random() < 0.88 THEN 'COUNTING'
      WHEN e.status = 'VOTING' AND random() < 0.04 THEN 'DISPUTED'
      WHEN e.status = 'VOTING' THEN 'VOTING'
      WHEN e.status = 'COUNTING' AND random() < 0.90 THEN 'RESULT_ANNOUNCED'
      WHEN e.status = 'COUNTING' AND random() < 0.05 THEN 'DISPUTED'
      WHEN e.status = 'COUNTING' THEN 'COUNTING'
      WHEN e.status = 'RESULT_ANNOUNCED' AND random() < 0.92 THEN 'RESULT_SUBMITTED'
      WHEN e.status = 'RESULT_ANNOUNCED' THEN 'RESULT_ANNOUNCED'
      WHEN e.status = 'RESULT_SUBMITTED' AND random() < 0.88 THEN 'VERIFICATION_PENDING'
      WHEN e.status = 'RESULT_SUBMITTED' AND random() < 0.05 THEN 'VERIFIED'
      WHEN e.status = 'RESULT_SUBMITTED' THEN 'RESULT_SUBMITTED'
      WHEN e.status = 'VERIFICATION_PENDING' AND random() < 0.80 THEN 'VERIFIED'
      WHEN e.status = 'VERIFICATION_PENDING' AND random() < 0.10 THEN 'DISPUTED'
      WHEN e.status = 'VERIFICATION_PENDING' THEN 'VERIFICATION_PENDING'
      ELSE pu.status
    END
    FROM eligible e
    WHERE pu.id = e.id
    RETURNING pu.id
  )
  SELECT count(*) INTO v_changed FROM advanced;

  UPDATE simulation_config SET last_tick_at = now(), updated_at = now() WHERE id = v_config_id;
  RETURN jsonb_build_object('ticked', true, 'changed', v_changed);
END;
$$;

-- ── 3.9 Fast Simulation ─────────────────────────────────────

CREATE OR REPLACE FUNCTION run_fast_simulation(
  p_scenario TEXT DEFAULT 'random',
  p_duration_minutes INTEGER DEFAULT 5,
  p_total_voters BIGINT DEFAULT 100000000,
  p_election_type TEXT DEFAULT 'PRESIDENTIAL'
)
RETURNS JSONB
LANGUAGE plpgsql
SET statement_timeout = '300s'
SET lock_timeout = '120s'
AS $$
DECLARE
  v_scenario TEXT;
  v_total_pus INTEGER;
  v_avg_votes_per_pu INTEGER;
  v_results_created INTEGER := 0;
  v_pr_created INTEGER := 0;
  v_election_id UUID;
  v_config_id UUID := '00000000-0000-0000-0000-000000000001';
  v_start_time TIMESTAMPTZ := clock_timestamp();
  v_total_votes BIGINT;
  v_ndc UUID; v_apc UUID; v_pdp UUID; v_lp UUID;
  v_nnpp UUID; v_apga UUID; v_sdp UUID; v_ypp UUID; v_adc UUID;
  v_ndc_share NUMERIC; v_apc_share NUMERIC;
BEGIN
  IF p_scenario = 'random' OR p_scenario IS NULL THEN
    v_scenario := (ARRAY['landslide', 'sweep', 'close'])[floor(random() * 3 + 1)];
  ELSE v_scenario := p_scenario; END IF;

  v_ndc_share := CASE v_scenario
    WHEN 'landslide' THEN 0.42 WHEN 'sweep' THEN 0.37
    WHEN 'close' THEN 0.30 ELSE 0.37 END;
  v_apc_share := CASE v_scenario
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

  TRUNCATE TABLE party_results, result_submissions, incidents RESTART IDENTITY;

  UPDATE simulation_config SET
    status = 'RUNNING', speed = 3, election_type = p_election_type,
    started_at = now(), last_tick_at = now(), total_results_submitted = 0
  WHERE id = v_config_id;

  SELECT count(*) INTO v_total_pus FROM polling_units;
  v_avg_votes_per_pu := GREATEST(50, (p_total_voters / v_total_pus)::INTEGER);

  UPDATE polling_units SET status = CASE
    WHEN random() < 0.05 THEN 'VERIFIED'
    WHEN random() < 0.12 THEN 'RESULT_SUBMITTED'
    WHEN random() < 0.20 THEN 'RESULT_ANNOUNCED'
    WHEN random() < 0.30 THEN 'COUNTING'
    WHEN random() < 0.40 THEN 'VOTING'
    ELSE 'NOT_STARTED'
  END WHERE id IS NOT NULL;

  INSERT INTO elections (name, type) VALUES ('Presidential Election 2027', 'PRESIDENTIAL')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_election_id FROM elections WHERE type = 'PRESIDENTIAL' LIMIT 1;

  WITH pu_data AS (
    SELECT pu.id AS pu_id, st.name AS state_name,
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
      END AS region,
      GREATEST(50, ROUND(v_avg_votes_per_pu * (0.5 + random()))) AS total_votes,
      (0.01 + random() * 0.04) AS reject_rate
    FROM polling_units pu LEFT JOIN states st ON st.id = pu.state_id
  ),
  result_insert AS (
    INSERT INTO result_submissions (polling_unit_id, election_id, volunteer_id, assignment_id,
      valid_votes, rejected_votes, total_votes, status, submitted_at, verified_at)
    SELECT pd.pu_id, v_election_id, NULL, NULL,
      pd.total_votes - ROUND(pd.total_votes * pd.reject_rate)::INTEGER,
      ROUND(pd.total_votes * pd.reject_rate)::INTEGER,
      pd.total_votes,
      CASE WHEN random() < 0.05 THEN 'VERIFIED' ELSE 'RESULT_SUBMITTED' END,
      now() - (random() * interval '60 days'),
      CASE WHEN random() < 0.05 THEN now() - (random() * interval '30 days') ELSE NULL END
    FROM pu_data pd RETURNING id, polling_unit_id, total_votes, valid_votes
  ),
  vote_data AS (
    SELECT ri.id AS result_id, pd.region, ri.valid_votes,
      GREATEST(0, ROUND(ri.valid_votes * v_ndc_share *
        CASE pd.region WHEN 'SE' THEN 1.9 WHEN 'SS' THEN 1.6 WHEN 'FC' THEN 1.2
          WHEN 'NC' THEN 1.0 WHEN 'NE' THEN 0.7 WHEN 'NW' THEN 0.6 WHEN 'SW' THEN 0.5
          ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER AS ndc_votes,
      GREATEST(0, ROUND(ri.valid_votes * v_apc_share *
        CASE pd.region WHEN 'SW' THEN 1.5 WHEN 'NW' THEN 1.4 WHEN 'NE' THEN 1.3
          WHEN 'NC' THEN 1.1 WHEN 'FC' THEN 1.0 WHEN 'SS' THEN 0.4 WHEN 'SE' THEN 0.3
          ELSE 1.0 END * (0.85 + random() * 0.30)))::INTEGER AS apc_votes,
      ri.valid_votes AS valid_total
    FROM result_insert ri JOIN pu_data pd ON pd.pu_id = ri.polling_unit_id
  )
  INSERT INTO party_results (result_submission_id, party_id, votes)
  SELECT result_id, v_ndc, ndc_votes FROM vote_data WHERE ndc_votes > 0
  UNION ALL
  SELECT result_id, v_apc, apc_votes FROM vote_data WHERE apc_votes > 0
  UNION ALL
  SELECT result_id, v_pdp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.30 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_lp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.20 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_nnpp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.12 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_apga, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.10 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_sdp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.08 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_ypp, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.10 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0
  UNION ALL
  SELECT result_id, v_adc, GREATEST(0, ROUND((valid_total - ndc_votes - apc_votes) * 0.10 * (0.7 + random() * 0.6)))::INTEGER FROM vote_data WHERE (valid_total - ndc_votes - apc_votes) > 0;

  GET DIAGNOSTICS v_pr_created = ROW_COUNT;
  SELECT count(*) INTO v_results_created FROM result_submissions;
  SELECT sum(total_votes) INTO v_total_votes FROM result_submissions;

  UPDATE simulation_config SET
    status = 'COMPLETED', last_tick_at = now(),
    total_results_submitted = v_results_created, updated_at = now()
  WHERE id = v_config_id;

  RETURN jsonb_build_object(
    'success', true, 'scenario', v_scenario, 'election_type', p_election_type,
    'total_polling_units', v_total_pus, 'results_created', v_results_created,
    'party_results_created', v_pr_created, 'total_votes', v_total_votes,
    'duration_ms', extract(milliseconds from clock_timestamp() - v_start_time)::INTEGER,
    'ndc_wins', true
  );
END;
$$;

-- ── 3.10 Simulation History Functions ────────────────────────

CREATE OR REPLACE FUNCTION log_simulation_start(
  p_scenario TEXT,
  p_election_type TEXT DEFAULT 'PRESIDENTIAL'
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO simulation_history (scenario, election_type, status, started_at)
  VALUES (p_scenario, p_election_type, 'RUNNING', now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_simulation_complete(
  p_id UUID, p_total_polling_units INTEGER, p_results_created INTEGER,
  p_party_results_created INTEGER, p_total_votes BIGINT,
  p_duration_seconds INTEGER, p_ndc_wins BOOLEAN DEFAULT true
) RETURNS VOID AS $$
BEGIN
  UPDATE simulation_history SET
    status = 'COMPLETED', total_polling_units = p_total_polling_units,
    results_created = p_results_created, party_results_created = p_party_results_created,
    total_votes = p_total_votes, duration_seconds = p_duration_seconds,
    ndc_wins = p_ndc_wins, completed_at = now()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_simulation_failure(
  p_id UUID, p_error_message TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE simulation_history SET
    status = 'FAILED', error_message = p_error_message, completed_at = now()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECTION 4: TRIGGERS
-- ============================================================

-- ── 4.1 Audit Log Protection (append-only) ───────────────────

CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_audit_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_mutation();

-- ── 4.2 Updated_at Auto-Update ──────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'updated_at'
      AND table_schema = 'public'
      AND table_name != 'audit_log'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- ============================================================
-- SECTION 5: ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE states ENABLE ROW LEVEL SECURITY;
ALTER TABLE lgas ENABLE ROW LEVEL SECURITY;
ALTER TABLE wards ENABLE ROW LEVEL SECURITY;
ALTER TABLE polling_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_history ENABLE ROW LEVEL SECURITY;

-- ── Public Read Policies ────────────────────────────────────

CREATE POLICY "Public can read states" ON states FOR SELECT USING (true);
CREATE POLICY "Public can read LGAs" ON lgas FOR SELECT USING (true);
CREATE POLICY "Public can read wards" ON wards FOR SELECT USING (true);
CREATE POLICY "Public can read polling units" ON polling_units FOR SELECT USING (true);
CREATE POLICY "Public can read elections" ON elections FOR SELECT USING (true);
CREATE POLICY "Public can read parties" ON parties FOR SELECT USING (true);
CREATE POLICY "Public can read observations" ON observations FOR SELECT USING (true);
CREATE POLICY "Public can read results" ON result_submissions FOR SELECT USING (true);
CREATE POLICY "Public can read party results" ON party_results FOR SELECT USING (true);
CREATE POLICY "Public can read incidents" ON incidents FOR SELECT USING (true);
CREATE POLICY "Public can read evidence" ON evidence_records FOR SELECT USING (is_public = true);
CREATE POLICY "Public can view simulation history" ON simulation_history FOR SELECT USING (true);

-- ── User Policies ───────────────────────────────────────────

CREATE POLICY "Users can read own account" ON user_accounts FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own account" ON user_accounts FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own account" ON user_accounts FOR INSERT WITH CHECK (auth.uid() = id);

-- ── Volunteer Policies ──────────────────────────────────────

CREATE POLICY "Volunteers can read own profile" ON volunteers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Volunteers can update own profile" ON volunteers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Volunteers can insert own profile" ON volunteers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can read all volunteers" ON volunteers FOR SELECT USING (
  EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

-- ── Assignment Policies ─────────────────────────────────────

CREATE POLICY "Volunteers can read own assignments" ON agent_assignments FOR SELECT USING (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can read all assignments" ON agent_assignments FOR SELECT USING (
  EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

-- ── Result Submission Policies ──────────────────────────────

CREATE POLICY "Volunteers can insert own results" ON result_submissions FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM agent_assignments a
    JOIN volunteers v ON v.id = a.volunteer_id
    WHERE v.user_id = auth.uid()
      AND a.id = assignment_id
      AND a.polling_unit_id = result_submissions.polling_unit_id
      AND a.election_id = result_submissions.election_id
      AND a.status IN ('ACTIVATED', 'CHECKED_IN')
  )
);
CREATE POLICY "Volunteers can read own results" ON result_submissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);

-- ── Evidence Policies ───────────────────────────────────────

CREATE POLICY "Volunteers can insert own evidence" ON evidence_records FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);
CREATE POLICY "Volunteers can read own evidence" ON evidence_records FOR SELECT USING (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);

-- ── Incident Policies ───────────────────────────────────────

CREATE POLICY "Volunteers can insert own incidents" ON incidents FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);
CREATE POLICY "Volunteers can read own incidents" ON incidents FOR SELECT USING (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);

-- ── Audit Log Policies ──────────────────────────────────────

CREATE POLICY "System can insert audit logs" ON audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can read audit logs" ON audit_log FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE user_id = auth.uid()
      AND is_active = true
      AND role IN ('SUPER_ADMIN', 'OPERATIONS_ADMIN')
  )
);

-- ── Simulation Policies ─────────────────────────────────────

CREATE POLICY "Service role can manage simulation config" ON simulation_config FOR ALL
  USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage simulation history" ON simulation_history FOR ALL
  USING (auth.role() = 'service_role');
CREATE POLICY "Authenticated users can insert simulation history" ON simulation_history FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- SECTION 6: GRANT PERMISSIONS
-- ============================================================

GRANT EXECUTE ON FUNCTION haversine_distance(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, service_role;
GRANT EXECUTE ON FUNCTION get_agent_locations() TO service_role;
GRANT EXECUTE ON FUNCTION get_party_totals() TO anon, service_role;
GRANT EXECUTE ON FUNCTION get_state_breakdown_from_results() TO anon, service_role;
GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_fast_stats() TO anon, service_role;
GRANT EXECUTE ON FUNCTION get_polling_unit_rows() TO anon, service_role;
GRANT EXECUTE ON FUNCTION simulation_tick() TO service_role, anon;
GRANT EXECUTE ON FUNCTION run_fast_simulation(TEXT, INTEGER, BIGINT, TEXT) TO service_role, anon;
GRANT EXECUTE ON FUNCTION log_simulation_start TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_simulation_complete TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_simulation_failure TO authenticated, service_role;
GRANT SELECT ON simulation_history TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON simulation_history TO authenticated, service_role;

-- ============================================================
-- SECTION 7: SEED DATA
-- ============================================================

-- ── 7.1 Parties (9 parties) ─────────────────────────────────

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

-- ── 7.2 Simulation Config ───────────────────────────────────

INSERT INTO simulation_config (id, election_type, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'PRESIDENTIAL', 'IDLE')
ON CONFLICT (id) DO NOTHING;

-- ── 7.3 Elections ───────────────────────────────────────────

INSERT INTO elections (name, type, is_active) VALUES
  ('Presidential & National Assembly Election', 'PRESIDENTIAL', true),
  ('Governorship & State Assembly Election', 'GOVERNORSHIP', false)
ON CONFLICT DO NOTHING;

-- ============================================================
-- DONE
-- ============================================================
SELECT '=== NEOP Complete Schema Applied ===' AS status,
       (SELECT count(*) FROM parties) AS parties,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS total_tables;
