import { z } from 'zod';

// ============================================================
// ENUMS
// ============================================================

export const ElectionTypeSchema = z.enum([
  'PRESIDENTIAL',
  'SENATE',
  'HOUSE_OF_REPRESENTATIVES',
  'GOVERNORSHIP',
  'STATE_HOUSE_OF_ASSEMBLY',
]);

export const ElectionStatusSchema = z.enum([
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
]);

export const PollingUnitStatusSchema = z.enum([
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
  'NO_REPORT',
]);

export const VolunteerStatusSchema = z.enum([
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
  'REJECTED',
]);

export const ObservationTypeSchema = z.enum([
  'OPENING',
  'VOTING_STARTED',
  'VOTING_INTERRUPTED',
  'VOTING_COMPLETED',
  'COUNTING_STARTED',
  'RESULT_ANNOUNCED',
  'ELECTION_NOT_HELD',
  'DISRUPTION',
  'OTHER',
]);

export const ResultVerificationStatusSchema = z.enum([
  'UNVERIFIED',
  'PENDING_REVIEW',
  'PARTIALLY_VERIFIED',
  'VERIFIED',
  'DISPUTED',
  'REJECTED',
  'SUPERSEDED',
]);

export const IncidentCategorySchema = z.enum([
  'VIOLENCE',
  'INTIMIDATION',
  'DISRUPTION',
  'ELECTION_NOT_HELD',
  'MATERIAL_SHORTAGE',
  'POLLING_UNIT_RELOCATION',
  'ACCESS_PROBLEM',
  'SECURITY_INCIDENT',
  'OTHER',
]);

// ============================================================
// VOLUNTEER SCHEMAS
// ============================================================

export const VolunteerProfileSchema = z.object({
  phone: z.string().regex(/^\+?[0-9]{10,14}$/, 'Invalid phone number').optional(),
  state_id: z.string().uuid().optional(),
  lga_id: z.string().uuid().optional(),
  selected_polling_unit_id: z.string().uuid().optional(),
});

export const PollingUnitSelectionSchema = z.object({
  state_id: z.string().uuid('Invalid state'),
  lga_id: z.string().uuid('Invalid LGA'),
  ward_id: z.string().uuid('Invalid ward'),
  polling_unit_id: z.string().uuid('Invalid polling unit'),
});

// ============================================================
// ASSIGNMENT SCHEMAS
// ============================================================

export const AssignmentRequestSchema = z.object({
  volunteer_id: z.string().uuid(),
  polling_unit_id: z.string().uuid(),
  election_id: z.string().uuid(),
});

// ============================================================
// OBSERVATION SCHEMAS
// ============================================================

export const ObservationSchema = z.object({
  election_id: z.string().uuid(),
  polling_unit_id: z.string().uuid(),
  observation_type: ObservationTypeSchema,
  description: z.string().max(5000).optional(),
  observed_at: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================
// RESULT SUBMISSION SCHEMAS
// ============================================================

export const PartyResultEntrySchema = z.object({
  party_id: z.string().uuid(),
  candidate_id: z.string().uuid().optional(),
  votes: z.number().int().min(0, 'Votes cannot be negative'),
});

export const ResultSubmissionSchema = z.object({
  election_id: z.string().uuid(),
  polling_unit_id: z.string().uuid(), // auto-derived from assignment
  valid_votes: z.number().int().min(0),
  rejected_votes: z.number().int().min(0),
  party_results: z.array(PartyResultEntrySchema).min(1, 'At least one party result required'),
  idempotency_key: z.string().uuid(),
  observed_at: z.string().datetime().optional(),
}).refine(
  (data) => {
    // Mathematical validation: sum of party votes must equal valid votes
    const sumPartyVotes = data.party_results.reduce((sum, pr) => sum + pr.votes, 0);
    return sumPartyVotes === data.valid_votes;
  },
  {
    message: 'Sum of party votes must equal valid votes',
    path: ['party_results'],
  }
).refine(
  (data) => {
    // Total votes validation
    return data.valid_votes + data.rejected_votes === data.valid_votes + data.rejected_votes;
  },
  {
    message: 'Total votes calculation error',
    path: ['valid_votes'],
  }
);

export const ResultCorrectionSchema = z.object({
  parent_submission_id: z.string().uuid(),
  valid_votes: z.number().int().min(0),
  rejected_votes: z.number().int().min(0),
  party_results: z.array(PartyResultEntrySchema).min(1),
  correction_reason: z.string().min(10, 'Please provide a reason for the correction'),
  idempotency_key: z.string().uuid(),
}).refine(
  (data) => {
    const sumPartyVotes = data.party_results.reduce((sum, pr) => sum + pr.votes, 0);
    return sumPartyVotes === data.valid_votes;
  },
  {
    message: 'Sum of party votes must equal valid votes',
    path: ['party_results'],
  }
);

// ============================================================
// INCIDENT SCHEMAS
// ============================================================

export const IncidentSchema = z.object({
  election_id: z.string().uuid(),
  polling_unit_id: z.string().uuid(),
  category: IncidentCategorySchema,
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  what_observed: z.string().min(10, 'Please provide more detail about what you observed').max(5000),
  when_observed: z.string().datetime(),
  details: z.record(z.unknown()).optional(),
  agent_safe: z.boolean().default(true),
  requires_emergency_response: z.boolean().default(false),
});

// ============================================================
// EVIDENCE SCHEMAS
// ============================================================

export const EvidenceUploadSchema = z.object({
  parent_type: z.enum(['RESULT_SUBMISSION', 'OBSERVATION', 'INCIDENT']),
  parent_id: z.string().uuid(),
  election_id: z.string().uuid(),
  polling_unit_id: z.string().uuid(),
  file_size_bytes: z.number().int().max(20 * 1024 * 1024, 'File too large (max 20MB)'),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  captured_at: z.string().datetime().optional(),
});

// ============================================================
// CHECK-IN SCHEMAS
// ============================================================

export const CheckInSchema = z.object({
  assignment_id: z.string().uuid(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  within_required_radius: z.boolean(),
});

export const CheckOutSchema = z.object({
  assignment_id: z.string().uuid(),
});

// ============================================================
// ADMIN SCHEMAS
// ============================================================

export const AdminAssignmentSchema = z.object({
  volunteer_id: z.string().uuid(),
  polling_unit_id: z.string().uuid(),
  election_id: z.string().uuid(),
  observer_number: z.number().int().min(1).max(2),
});

export const VerificationReviewSchema = z.object({
  result_submission_id: z.string().uuid(),
  decision: z.enum(['VERIFIED', 'DISPUTED', 'REJECTED']),
  notes: z.string().max(5000).optional(),
});

export const IncidentReviewSchema = z.object({
  incident_id: z.string().uuid(),
  decision: z.enum(['CORROBORATED', 'UNCONFIRMED']),
  review_notes: z.string().max(5000).optional(),
});

// ============================================================
// PAGINATION
// ============================================================

export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================================
// SEARCH
// ============================================================

export const PollingUnitSearchSchema = z.object({
  q: z.string().min(2).max(200), // search query
  state_id: z.string().uuid().optional(),
  lga_id: z.string().uuid().optional(),
  ward_id: z.string().uuid().optional(),
});
