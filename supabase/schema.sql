-- ============================================================
-- NIGERIA ELECTION OBSERVATION PLATFORM
-- Complete Database Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ELECTORAL GEOGRAPHY
-- ============================================================

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

CREATE INDEX idx_polling_units_state ON polling_units(state_id);
CREATE INDEX idx_polling_units_lga ON polling_units(lga_id);
CREATE INDEX idx_polling_units_ward ON polling_units(ward_id);
CREATE INDEX idx_polling_units_code ON polling_units(official_code);

-- ============================================================
-- ELECTIONS & PARTIES
-- ============================================================

CREATE TABLE elections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PLANNED',
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AUTH & USERS
-- ============================================================

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

-- ============================================================
-- VOLUNTEERS & ASSIGNMENTS
-- ============================================================

CREATE TABLE volunteers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'REGISTERED',
  phone TEXT,
  state_id UUID REFERENCES states(id),
  lga_id UUID REFERENCES lgas(id),
  verification_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  training_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(volunteer_id, election_id),
  UNIQUE(polling_unit_id, election_id, observer_number)
);

-- ============================================================
-- OBSERVATIONS & RESULTS
-- ============================================================

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
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  assignment_id UUID NOT NULL REFERENCES agent_assignments(id),
  valid_votes INT NOT NULL,
  rejected_votes INT NOT NULL DEFAULT 0,
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

-- ============================================================
-- EVIDENCE & INCIDENTS
-- ============================================================

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
  agent_safe BOOLEAN DEFAULT true,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AUDIT LOG (append-only)
-- ============================================================

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

CREATE INDEX idx_audit_log_timestamp ON audit_log(created_at);

-- Prevent updates/deletes on audit log
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

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables with updated_at column
DO $$
DECLARE
  tbl TEXT;
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
-- ROW LEVEL SECURITY
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

-- Public read policies for geographic data
CREATE POLICY "Public can read states" ON states FOR SELECT USING (true);
CREATE POLICY "Public can read LGAs" ON lgas FOR SELECT USING (true);
CREATE POLICY "Public can read wards" ON wards FOR SELECT USING (true);
CREATE POLICY "Public can read polling units" ON polling_units FOR SELECT USING (true);
CREATE POLICY "Public can read elections" ON elections FOR SELECT USING (true);
CREATE POLICY "Public can read parties" ON parties FOR SELECT USING (true);

-- Public read for results and observations (for the live dashboard)
CREATE POLICY "Public can read observations" ON observations FOR SELECT USING (true);
CREATE POLICY "Public can read results" ON result_submissions FOR SELECT USING (true);
CREATE POLICY "Public can read party results" ON party_results FOR SELECT USING (true);
CREATE POLICY "Public can read incidents" ON incidents FOR SELECT USING (true);
CREATE POLICY "Public can read evidence" ON evidence_records FOR SELECT USING (is_public = true);

-- User policies
CREATE POLICY "Users can read own account" ON user_accounts FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own account" ON user_accounts FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own account" ON user_accounts FOR INSERT WITH CHECK (auth.uid() = id);

-- Volunteer policies
CREATE POLICY "Volunteers can read own profile" ON volunteers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Volunteers can update own profile" ON volunteers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Volunteers can insert own profile" ON volunteers FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admin policies
CREATE POLICY "Admins can read all volunteers" ON volunteers FOR SELECT USING (
  EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

-- Assignment policies
CREATE POLICY "Volunteers can read own assignments" ON agent_assignments FOR SELECT USING (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can read all assignments" ON agent_assignments FOR SELECT USING (
  EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);

-- Result submission policies
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

-- Evidence policies
CREATE POLICY "Volunteers can insert own evidence" ON evidence_records FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);
CREATE POLICY "Volunteers can read own evidence" ON evidence_records FOR SELECT USING (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);

-- Incident policies
CREATE POLICY "Volunteers can insert own incidents" ON incidents FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);
CREATE POLICY "Volunteers can read own incidents" ON incidents FOR SELECT USING (
  EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
);

-- Audit log policies
CREATE POLICY "System can insert audit logs" ON audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can read audit logs" ON audit_log FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = auth.uid() 
      AND is_active = true 
      AND role IN ('SUPER_ADMIN', 'OPERATIONS_ADMIN')
  )
);
