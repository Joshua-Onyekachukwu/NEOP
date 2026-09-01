-- ============================================================
-- NIGERIA ELECTION OBSERVATION PLATFORM
-- Migration 001: Electoral Geography + Elections + Parties
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE election_type AS ENUM (
  'PRESIDENTIAL',
  'SENATE',
  'HOUSE_OF_REPRESENTATIVES',
  'GOVERNORSHIP',
  'STATE_HOUSE_OF_ASSEMBLY'
);

CREATE TYPE election_status AS ENUM (
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE polling_unit_status AS ENUM (
  'NOT_STARTED',
  'VOTING',
  'COUNTING',
  'RESULT_ANNOUNCED',
  'RESULT_SUBMITTED',
  'VERIFICATION_PENDING',
  'VERIFIED',
  'DISPUTED',
  'DISRUPTED',
  'ELECTION_NOT_HELD',
  'NO_REPORT'
);

CREATE TYPE volunteer_status AS ENUM (
  'REGISTERED',
  'PROFILE_INCOMPLETE',
  'VERIFICATION_PENDING',
  'PROVISIONALLY_ACCEPTED',
  'TRAINING_PENDING',
  'ACTIVE',
  'VERIFICATION_FAILED',
  'TRAINING_EXPIRED',
  'SUSPENDED',
  'WITHDRAWN',
  'REJECTED'
);

CREATE TYPE verification_status AS ENUM (
  'NOT_REQUESTED',
  'PENDING',
  'VERIFIED',
  'FAILED'
);

CREATE TYPE training_status AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'EXPIRED'
);

CREATE TYPE assignment_status AS ENUM (
  'ASSIGNED',
  'ACTIVATED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'RELEASED',
  'SUSPENDED'
);

CREATE TYPE observation_type AS ENUM (
  'OPENING',
  'VOTING_STARTED',
  'VOTING_INTERRUPTED',
  'VOTING_COMPLETED',
  'COUNTING_STARTED',
  'RESULT_ANNOUNCED',
  'ELECTION_NOT_HELD',
  'DISRUPTION',
  'OTHER'
);

CREATE TYPE result_verification_status AS ENUM (
  'UNVERIFIED',
  'PENDING_REVIEW',
  'PARTIALLY_VERIFIED',
  'VERIFIED',
  'DISPUTED',
  'REJECTED',
  'SUPERSEDED'
);

CREATE TYPE incident_category AS ENUM (
  'VIOLENCE',
  'INTIMIDATION',
  'DISRUPTION',
  'ELECTION_NOT_HELD',
  'MATERIAL_SHORTAGE',
  'POLLING_UNIT_RELOCATION',
  'ACCESS_PROBLEM',
  'SECURITY_INCIDENT',
  'OTHER'
);

CREATE TYPE admin_role AS ENUM (
  'SUPER_ADMIN',
  'OPERATIONS_ADMIN',
  'VERIFICATION_REVIEWER',
  'REGIONAL_COORDINATOR',
  'FINANCE_ADMIN',
  'SUPPORT',
  'DATA_ANALYST'
);

-- ============================================================
-- DATA SOURCES (for versioning)
-- ============================================================

CREATE TABLE data_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL, -- 'INEC_OFFICIAL', 'INEC_WEBSITE', 'MANUAL'
  source_url TEXT,
  retrieved_at TIMESTAMPTZ,
  version TEXT NOT NULL,
  checksum TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ELECTORAL GEOGRAPHY
-- ============================================================

CREATE TABLE states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE, -- e.g. 'EN', 'LA', 'AB'
  geojson GEOMETRY(MultiPolygon, 4326),
  source_id UUID REFERENCES data_sources(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lgas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_id UUID NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  lga_type TEXT, -- 'LOCAL_GOV', 'AREA_COUNCIL', 'FCT'
  geojson GEOMETRY(MultiPolygon, 4326),
  source_id UUID REFERENCES data_sources(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(state_id, code)
);

CREATE TABLE wards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lga_id UUID NOT NULL REFERENCES lgas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  geojson GEOMETRY(MultiPolygon, 4326),
  source_id UUID REFERENCES data_sources(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lga_id, code)
);

CREATE TABLE polling_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  official_code TEXT NOT NULL UNIQUE, -- MUST be unique, e.g. 'PU/12/01/001'
  name TEXT NOT NULL,
  state_id UUID NOT NULL REFERENCES states(id),
  lga_id UUID NOT NULL REFERENCES lgas(id),
  ward_id UUID NOT NULL REFERENCES wards(id),

  address TEXT,
  location GEOMETRY(Point, 4326),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  capacity INT NOT NULL DEFAULT 2, -- max observers
  status polling_unit_status NOT NULL DEFAULT 'NOT_STARTED',

  registered_voters INT, -- from INEC baseline
  source_id UUID REFERENCES data_sources(id),
  source_version TEXT,
  last_verified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spatial index for geographic queries
CREATE INDEX idx_polling_units_location ON polling_units USING GIST(location);
CREATE INDEX idx_polling_units_state ON polling_units(state_id);
CREATE INDEX idx_polling_units_lga ON polling_units(lga_id);
CREATE INDEX idx_polling_units_ward ON polling_units(ward_id);
CREATE INDEX idx_polling_units_code ON polling_units(official_code);

-- ============================================================
-- ELECTIONS, PARTIES, CANDIDATES
-- ============================================================

CREATE TABLE elections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL, -- e.g. '2027 Presidential Election'
  type election_type NOT NULL,
  description TEXT,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  status election_status NOT NULL DEFAULT 'PLANNED',
  source_id UUID REFERENCES data_sources(id),
  source_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE parties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  official_name TEXT NOT NULL,
  short_name TEXT,
  abbreviation TEXT,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  source_id UUID REFERENCES data_sources(id),
  source_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id),
  name TEXT NOT NULL,
  position TEXT NOT NULL, -- e.g. 'President', 'Governor', 'Senate', 'House'
  constituency_id UUID, -- FK to relevant constituency (state for governor, LGA for house, etc.)
  source_id UUID REFERENCES data_sources(id),
  source_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(election_id, party_id, position)
);

-- ============================================================
-- AUTH & USER ACCOUNTS
-- ============================================================

CREATE TABLE user_accounts (
  id UUID PRIMARY KEY, -- matches auth.users.id
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'google',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ADMIN USERS (separate from volunteers)
-- ============================================================

CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_accounts(id),
  role admin_role NOT NULL,
  state_id UUID REFERENCES states(id), -- optional geographic scope
  lga_id UUID REFERENCES lgas(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_users_user ON admin_users(user_id);
