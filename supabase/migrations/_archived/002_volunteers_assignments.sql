-- ============================================================
-- Migration 002: Volunteers, Assignments, Training
-- ============================================================

-- ============================================================
-- VOLUNTEERS
-- ============================================================

CREATE TABLE volunteers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  status volunteer_status NOT NULL DEFAULT 'REGISTERED',

  phone TEXT,
  state_id UUID REFERENCES states(id),
  lga_id UUID REFERENCES lgas(id),

  verification_status verification_status NOT NULL DEFAULT 'NOT_REQUESTED',
  verification_method TEXT, -- 'SELF_DECLARATION', 'DOCUMENT', 'MANUAL'
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES admin_users(id),

  training_status training_status NOT NULL DEFAULT 'NOT_STARTED',
  training_completed_at TIMESTAMPTZ,
  training_deadline TIMESTAMPTZ,

  -- Self-selected polling unit
  selected_polling_unit_id UUID REFERENCES polling_units(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One volunteer per user
  UNIQUE(user_id)
);

CREATE INDEX idx_volunteers_status ON volunteers(status);
CREATE INDEX idx_volunteers_state ON volunteers(state_id);
CREATE INDEX idx_volunteers_polling_unit ON volunteers(selected_polling_unit_id);
CREATE INDEX idx_volunteers_user ON volunteers(user_id);

-- ============================================================
-- VOLUNTEER VERIFICATION EVIDENCE
-- ============================================================

CREATE TABLE volunteer_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  method TEXT NOT NULL, -- 'SELF_DECLARATION', 'VOTER_CARD', 'DOCUMENT', 'MANUAL'
  status verification_status NOT NULL DEFAULT 'PENDING',
  evidence_file_id UUID, -- reference to storage
  evidence_hash TEXT,
  reviewer_id UUID REFERENCES admin_users(id),
  reviewer_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TRAINING MODULES & COMPLETION
-- ============================================================

CREATE TABLE training_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  module_type TEXT NOT NULL, -- 'SYSTEM', 'OBSERVATION', 'NEUTRALITY', 'SAFETY', 'EVIDENCE'
  content_url TEXT,
  order_index INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE training_completions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES training_modules(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score INT, -- optional quiz score
  UNIQUE(volunteer_id, module_id)
);

-- ============================================================
-- ASSIGNMENTS
-- ============================================================

CREATE TABLE agent_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id),
  election_id UUID NOT NULL REFERENCES elections(id),

  status assignment_status NOT NULL DEFAULT 'ASSIGNED',
  observer_number INT NOT NULL DEFAULT 1, -- 1 or 2 for two-observer model

  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One assignment per volunteer per election
  UNIQUE(volunteer_id, election_id),
  -- Prevent assigning more observers than capacity (enforced via trigger/function)
  UNIQUE(polling_unit_id, election_id, observer_number)
);

CREATE INDEX idx_assignments_volunteer ON agent_assignments(volunteer_id);
CREATE INDEX idx_assignments_polling_unit ON agent_assignments(polling_unit_id);
CREATE INDEX idx_assignments_election ON agent_assignments(election_id);
CREATE INDEX idx_assignments_status ON agent_assignments(status);

-- ============================================================
-- ASSIGNMENT CAPACITY ENFORCEMENT
-- ============================================================

CREATE OR REPLACE FUNCTION check_polling_unit_capacity()
RETURNS TRIGGER AS $$
DECLARE
  current_count INT;
  max_capacity INT;
BEGIN
  SELECT COUNT(*) INTO current_count
  FROM agent_assignments
  WHERE polling_unit_id = NEW.polling_unit_id
    AND election_id = NEW.election_id
    AND status IN ('ASSIGNED', 'ACTIVATED', 'CHECKED_IN');

  SELECT capacity INTO max_capacity
  FROM polling_units
  WHERE id = NEW.polling_unit_id;

  IF current_count >= max_capacity THEN
    RAISE EXCEPTION 'Polling unit capacity exceeded. Max observers: %, Current: %', max_capacity, current_count;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_capacity
  BEFORE INSERT OR UPDATE ON agent_assignments
  FOR EACH ROW
  EXECUTE FUNCTION check_polling_unit_capacity();
