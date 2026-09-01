-- ============================================================
-- Migration 003: Observations, Results, Evidence, Incidents
-- ============================================================

-- ============================================================
-- OBSERVATIONS
-- ============================================================

CREATE TABLE observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  assignment_id UUID NOT NULL REFERENCES agent_assignments(id),

  observation_type observation_type NOT NULL,
  description TEXT,
  metadata JSONB, -- structured additional data

  observed_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  location_verified BOOLEAN NOT NULL DEFAULT false,
  device_info JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_observations_election ON observations(election_id);
CREATE INDEX idx_observations_polling_unit ON observations(polling_unit_id);
CREATE INDEX idx_observations_volunteer ON observations(volunteer_id);
CREATE INDEX idx_observations_type ON observations(observation_type);

-- ============================================================
-- RESULT SUBMISSIONS
-- ============================================================

CREATE TABLE result_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  assignment_id UUID NOT NULL REFERENCES agent_assignments(id),

  submission_number INT NOT NULL DEFAULT 1, -- for corrections
  is_correction BOOLEAN NOT NULL DEFAULT false,
  parent_submission_id UUID REFERENCES result_submissions(id),
  correction_reason TEXT,

  valid_votes INT NOT NULL,
  rejected_votes INT NOT NULL DEFAULT 0,
  total_votes INT NOT NULL,

  status result_verification_status NOT NULL DEFAULT 'UNVERIFIED',

  idempotency_key TEXT UNIQUE, -- prevent duplicate submissions

  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Mathematical constraint: valid + rejected = total
  CONSTRAINT chk_votes_math CHECK (valid_votes + rejected_votes = total_votes),
  CONSTRAINT chk_non_negative CHECK (valid_votes >= 0 AND rejected_votes >= 0 AND total_votes >= 0)
);

CREATE INDEX idx_results_election ON result_submissions(election_id);
CREATE INDEX idx_results_polling_unit ON result_submissions(polling_unit_id);
CREATE INDEX idx_results_volunteer ON result_submissions(volunteer_id);
CREATE INDEX idx_results_status ON result_submissions(status);
CREATE INDEX idx_results_idempotency ON result_submissions(idempotency_key);

-- ============================================================
-- PARTY RESULTS
-- ============================================================

CREATE TABLE party_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  result_submission_id UUID NOT NULL REFERENCES result_submissions(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id),
  candidate_id UUID REFERENCES candidates(id),
  votes INT NOT NULL,

  CONSTRAINT chk_party_votes_non_negative CHECK (votes >= 0),
  UNIQUE(result_submission_id, party_id)
);

-- Mathematical constraint: sum of party votes must equal valid votes
CREATE OR REPLACE FUNCTION check_party_votes_sum()
RETURNS TRIGGER AS $$
DECLARE
  total_valid INT;
  sum_party INT;
BEGIN
  SELECT valid_votes INTO total_valid
  FROM result_submissions
  WHERE id = COALESCE(NEW.result_submission_id, OLD.result_submission_id);

  SELECT COALESCE(SUM(votes), 0) INTO sum_party
  FROM party_results
  WHERE result_submission_id = COALESCE(NEW.result_submission_id, OLD.result_submission_id);

  IF sum_party != total_valid THEN
    RAISE EXCEPTION 'Sum of party votes (%) does not match valid votes (%)', sum_party, total_valid;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_party_votes
  AFTER INSERT OR UPDATE OR DELETE ON party_results
  FOR EACH ROW
  EXECUTE FUNCTION check_party_votes_sum();

-- ============================================================
-- EVIDENCE (Result sheets, images, documents)
-- ============================================================

CREATE TABLE evidence_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Link to parent record (result submission, observation, etc.)
  parent_type TEXT NOT NULL, -- 'RESULT_SUBMISSION', 'OBSERVATION', 'INCIDENT'
  parent_id UUID NOT NULL,

  election_id UUID NOT NULL REFERENCES elections(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),

  file_id TEXT NOT NULL, -- Supabase Storage path
  sha256_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,

  -- Metadata
  captured_at TIMESTAMPTZ,
  exif_metadata JSONB,

  -- Verification
  ocr_status TEXT DEFAULT 'PENDING',
  ocr_result JSONB,

  -- Access control
  is_public BOOLEAN NOT NULL DEFAULT false,
  access_level TEXT NOT NULL DEFAULT 'PRIVATE', -- 'PRIVATE', 'ADMIN_ONLY', 'REVIEWER', 'PUBLIC'

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_parent ON evidence_records(parent_type, parent_id);
CREATE INDEX idx_evidence_election ON evidence_records(election_id);
CREATE INDEX idx_evidence_polling_unit ON evidence_records(polling_unit_id);
CREATE INDEX idx_evidence_hash ON evidence_records(sha256_hash);

-- ============================================================
-- VERIFICATION JOBS (for AI/OCR pipeline)
-- ============================================================

CREATE TABLE verification_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  result_submission_id UUID REFERENCES result_submissions(id),
  evidence_id UUID REFERENCES evidence_records(id),
  election_id UUID NOT NULL,
  polling_unit_id UUID NOT NULL,

  job_type TEXT NOT NULL, -- 'OCR', 'IMAGE_CHECK', 'MATH_VALIDATION', 'OBSERVER_MATCH'
  status TEXT NOT NULL DEFAULT 'QUEUED', -- 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'
  
  input_hash TEXT,
  result JSONB,
  confidence_score DOUBLE PRECISION,
  
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_jobs_status ON verification_jobs(status);
CREATE INDEX idx_verification_jobs_type ON verification_jobs(job_type);
CREATE INDEX idx_verification_jobs_result ON verification_jobs(result_submission_id);

-- ============================================================
-- INCIDENTS
-- ============================================================

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  assignment_id UUID REFERENCES agent_assignments(id),

  category incident_category NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  
  -- Structured description
  what_observed TEXT NOT NULL,
  when_observed TIMESTAMPTZ NOT NULL,
  
  -- Structured fields per category
  details JSONB,
  
  -- Verification
  status TEXT NOT NULL DEFAULT 'REPORTED', -- 'REPORTED', 'REVIEWING', 'CORROBORATED', 'UNCONFIRMED'
  reviewed_by UUID REFERENCES admin_users(id),
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  
  -- Safety
  agent_safe BOOLEAN DEFAULT true,
  requires_emergency_response BOOLEAN DEFAULT false,
  
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidents_election ON incidents(election_id);
CREATE INDEX idx_incidents_polling_unit ON incidents(polling_unit_id);
CREATE INDEX idx_incidents_category ON incidents(category);
CREATE INDEX idx_incidents_status ON incidents(status);

-- ============================================================
-- AUDIT LOG (append-only)
-- ============================================================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  actor_id UUID,
  actor_type TEXT NOT NULL, -- 'VOLUNTEER', 'ADMIN', 'SYSTEM', 'AI'
  actor_ip_hash TEXT,
  actor_user_agent_hash TEXT,

  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,

  old_value_hash TEXT,
  new_value_hash TEXT,
  metadata JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
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
-- PAYMENTS
-- ============================================================

CREATE TABLE volunteer_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  election_id UUID NOT NULL REFERENCES elections(id),
  assignment_id UUID REFERENCES agent_assignments(id),

  payment_type TEXT NOT NULL, -- 'FIELD_SUPPORT', 'STIPEND', 'TRANSPORT', 'DATA'
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',

  eligibility_status TEXT NOT NULL DEFAULT 'PENDING',
  approval_status TEXT NOT NULL DEFAULT 'PENDING',
  payment_status TEXT NOT NULL DEFAULT 'PENDING',

  approved_by UUID REFERENCES admin_users(id),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  
  reference TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_volunteer ON volunteer_payments(volunteer_id);
CREATE INDEX idx_payments_election ON volunteer_payments(election_id);

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
