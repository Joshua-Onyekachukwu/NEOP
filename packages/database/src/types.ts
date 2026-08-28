// ============================================================
// NIGERIA ELECTION OBSERVATION PLATFORM
// Core Database Types
// ============================================================

// ============================================================
// ENUMS
// ============================================================

export type ElectionType =
  | 'PRESIDENTIAL'
  | 'SENATE'
  | 'HOUSE_OF_REPRESENTATIVES'
  | 'GOVERNORSHIP'
  | 'STATE_HOUSE_OF_ASSEMBLY';

export type ElectionStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type PollingUnitStatus =
  | 'NOT_STARTED'
  | 'VOTING'
  | 'COUNTING'
  | 'RESULT_ANNOUNCED'
  | 'RESULT_SUBMITTED'
  | 'VERIFICATION_PENDING'
  | 'VERIFIED'
  | 'DISPUTED'
  | 'DISRUPTED'
  | 'ELECTION_NOT_HELD'
  | 'NO_REPORT';

export type VolunteerStatus =
  | 'REGISTERED'
  | 'PROFILE_INCOMPLETE'
  | 'VERIFICATION_PENDING'
  | 'PROVISIONALLY_ACCEPTED'
  | 'TRAINING_PENDING'
  | 'ACTIVE'
  | 'VERIFICATION_FAILED'
  | 'TRAINING_EXPIRED'
  | 'SUSPENDED'
  | 'WITHDRAWN'
  | 'REJECTED';

export type VerificationStatus =
  | 'NOT_REQUESTED'
  | 'PENDING'
  | 'VERIFIED'
  | 'FAILED';

export type TrainingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED';

export type AssignmentStatus =
  | 'ASSIGNED'
  | 'ACTIVATED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'RELEASED'
  | 'SUSPENDED';

export type ObservationType =
  | 'OPENING'
  | 'VOTING_STARTED'
  | 'VOTING_INTERRUPTED'
  | 'VOTING_COMPLETED'
  | 'COUNTING_STARTED'
  | 'RESULT_ANNOUNCED'
  | 'ELECTION_NOT_HELD'
  | 'DISRUPTION'
  | 'OTHER';

export type ResultVerificationStatus =
  | 'UNVERIFIED'
  | 'PENDING_REVIEW'
  | 'PARTIALLY_VERIFIED'
  | 'VERIFIED'
  | 'DISPUTED'
  | 'REJECTED'
  | 'SUPERSEDED';

export type IncidentCategory =
  | 'VIOLENCE'
  | 'INTIMIDATION'
  | 'DISRUPTION'
  | 'ELECTION_NOT_HELD'
  | 'MATERIAL_SHORTAGE'
  | 'POLLING_UNIT_RELOCATION'
  | 'ACCESS_PROBLEM'
  | 'SECURITY_INCIDENT'
  | 'OTHER';

export type AdminRole =
  | 'SUPER_ADMIN'
  | 'OPERATIONS_ADMIN'
  | 'VERIFICATION_REVIEWER'
  | 'REGIONAL_COORDINATOR'
  | 'FINANCE_ADMIN'
  | 'SUPPORT'
  | 'DATA_ANALYST';

export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNDER_REVIEW' | 'DISPUTED';

// ============================================================
// DATABASE ENTITY TYPES
// ============================================================

export interface DataSource {
  id: string;
  source_name: string;
  source_type: string;
  source_url: string | null;
  retrieved_at: string | null;
  version: string;
  checksum: string | null;
  notes: string | null;
  created_at: string;
}

export interface State {
  id: string;
  name: string;
  code: string;
  created_at: string;
  updated_at: string;
}

export interface LGA {
  id: string;
  state_id: string;
  name: string;
  code: string;
  lga_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface Ward {
  id: string;
  lga_id: string;
  name: string;
  code: string;
  created_at: string;
  updated_at: string;
}

export interface PollingUnit {
  id: string;
  official_code: string;
  name: string;
  state_id: string;
  lga_id: string;
  ward_id: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number;
  status: PollingUnitStatus;
  registered_voters: number | null;
  source_id: string | null;
  source_version: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Election {
  id: string;
  name: string;
  type: ElectionType;
  description: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: ElectionStatus;
  created_at: string;
  updated_at: string;
}

export interface Party {
  id: string;
  official_name: string;
  short_name: string | null;
  abbreviation: string | null;
  logo_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Candidate {
  id: string;
  election_id: string;
  party_id: string;
  name: string;
  position: string;
  constituency_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserAccount {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  auth_provider: string;
  created_at: string;
  updated_at: string;
}

export interface Volunteer {
  id: string;
  user_id: string;
  status: VolunteerStatus;
  phone: string | null;
  state_id: string | null;
  lga_id: string | null;
  verification_status: VerificationStatus;
  verification_method: string | null;
  verified_at: string | null;
  verified_by: string | null;
  training_status: TrainingStatus;
  training_completed_at: string | null;
  training_deadline: string | null;
  selected_polling_unit_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentAssignment {
  id: string;
  volunteer_id: string;
  polling_unit_id: string;
  election_id: string;
  status: AssignmentStatus;
  observer_number: number;
  assigned_at: string;
  verified_at: string | null;
  activated_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Observation {
  id: string;
  election_id: string;
  polling_unit_id: string;
  volunteer_id: string;
  assignment_id: string;
  observation_type: ObservationType;
  description: string | null;
  metadata: Record<string, unknown> | null;
  observed_at: string;
  submitted_at: string;
  location_verified: boolean;
  device_info: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ResultSubmission {
  id: string;
  election_id: string;
  polling_unit_id: string;
  volunteer_id: string;
  assignment_id: string;
  submission_number: number;
  is_correction: boolean;
  parent_submission_id: string | null;
  correction_reason: string | null;
  valid_votes: number;
  rejected_votes: number;
  total_votes: number;
  status: ResultVerificationStatus;
  idempotency_key: string | null;
  submitted_at: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartyResult {
  id: string;
  result_submission_id: string;
  party_id: string;
  candidate_id: string | null;
  votes: number;
}

export interface EvidenceRecord {
  id: string;
  parent_type: string;
  parent_id: string;
  election_id: string;
  polling_unit_id: string;
  volunteer_id: string;
  file_id: string;
  sha256_hash: string;
  mime_type: string;
  file_size_bytes: number;
  captured_at: string | null;
  exif_metadata: Record<string, unknown> | null;
  ocr_status: string;
  ocr_result: Record<string, unknown> | null;
  is_public: boolean;
  access_level: string;
  created_at: string;
}

export interface Incident {
  id: string;
  election_id: string;
  polling_unit_id: string;
  volunteer_id: string;
  assignment_id: string | null;
  category: IncidentCategory;
  severity: string;
  what_observed: string;
  when_observed: string;
  details: Record<string, unknown> | null;
  status: string;
  reviewed_by: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  agent_safe: boolean;
  requires_emergency_response: boolean;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_type: string;
  actor_ip_hash: string | null;
  actor_user_agent_hash: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  old_value_hash: string | null;
  new_value_hash: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface VolunteerPayment {
  id: string;
  volunteer_id: string;
  election_id: string;
  assignment_id: string | null;
  payment_type: string;
  amount: number;
  currency: string;
  eligibility_status: string;
  approval_status: string;
  payment_status: string;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// EXTENDED / COMPOSITE TYPES
// ============================================================

/** State with LGA count */
export interface StateWithCount extends State {
  lga_count: number;
  polling_unit_count: number;
}

/** LGA with ward count */
export interface LGAWithCount extends LGA {
  ward_count: number;
  polling_unit_count: number;
  state_name: string;
}

/** Ward with PU count */
export interface WardWithCount extends Ward {
  polling_unit_count: number;
  lga_name: string;
  state_name: string;
}

/** Polling unit with full location context */
export interface PollingUnitFull extends PollingUnit {
  state_name: string;
  state_code: string;
  lga_name: string;
  ward_name: string;
  assigned_observer_count: number;
}

/** Dashboard coverage stats */
export interface CoverageStats {
  total_polling_units: number;
  covered_polling_units: number;
  verified_polling_units: number;
  reported_polling_units: number;
  disrupted_polling_units: number;
  no_report_polling_units: number;
  coverage_percentage: number;
  verification_percentage: number;
}

/** Result with party breakdown */
export interface ResultWithParties extends ResultSubmission {
  party_results: PartyResult[];
  party_details: Array<PartyResult & { party_name: string; party_abbreviation: string }>;
  polling_unit_name: string;
  polling_unit_code: string;
  observer_name: string;
}

/** Confidence assessment */
export interface ResultConfidence {
  label: ConfidenceLabel;
  has_observer_a: boolean;
  has_observer_b: boolean;
  has_image: boolean;
  ocr_match: boolean;
  math_valid: boolean;
  observers_match: boolean;
  location_verified: boolean;
}
