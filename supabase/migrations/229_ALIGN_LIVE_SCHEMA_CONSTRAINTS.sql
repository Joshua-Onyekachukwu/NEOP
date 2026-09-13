-- ====================================================================
-- 229_ALIGN_LIVE_SCHEMA_CONSTRAINTS.sql
-- ALIGNMENT MIGRATION (additive-only) — aligns live DB constraints with
-- the application's written contract (223/226 DDL + production routes).
--
-- Root cause fixed here: the live `verifications` table predates 223 and
-- carries NARROWER check constraints than 223's contract:
--   - verifications_status_check missing 'AWAITING_DATA'
--     => 226's trg_rs_timeline (live, SECURITY DEFINER) inserts
--        status='AWAITING_DATA' on every FIRST agent submission and
--        fails with 23514 -> NO submission can ever be paired/verified.
--   - verifications_final_decision_check missing 'AI_ONLY_REVIEW'
--   - dead_letter_jobs_job_type_check missing 'AI_OCR_PAIRING' etc.
--   - canonical_pu_results missing `published_by` column (223 contract,
--     referenced by publish RPC inserts on fresh installs).
--
-- Additive-only: widens CHECKs, adds one column, backfills. Does NOT
-- drop, rename, or narrow anything. Safe to re-run.
-- ====================================================================

-- 1. Widen verifications.status to the full 223 contract (12 states).
ALTER TABLE public.verifications DROP CONSTRAINT IF EXISTS verifications_status_check;
ALTER TABLE public.verifications ADD CONSTRAINT verifications_status_check
  CHECK (status IN (
    'AWAITING_DATA','PENDING',
    'DETERMINISTIC_RUNNING','DETERMINISTIC_PASSED','DETERMINISTIC_FAILED',
    'NVIDIA_RUNNING','NVIDIA_COMPLETED','NVIDIA_FAILED','FLAGGED_AI',
    'MATCH','DISCREPANCY','RESOLVED_ADMIN'
  ));

-- 2. Widen verifications.final_decision to the full 223 contract.
ALTER TABLE public.verifications DROP CONSTRAINT IF EXISTS verifications_final_decision_check;
ALTER TABLE public.verifications ADD CONSTRAINT verifications_final_decision_check
  CHECK (final_decision IN (
    'MATCH','DISCREPANCY',
    'ADMIN_OVERRIDE_MATCH','ADMIN_OVERRIDE_DISCREPANCY','AI_ONLY_REVIEW'
  ));

-- 3. Widen dead_letter_jobs.job_type to cover every enqueue site
--    (224 contract + v2-pipeline's 'AI_OCR_PAIRING' + report's 5-value list).
ALTER TABLE public.dead_letter_jobs DROP CONSTRAINT IF EXISTS dead_letter_jobs_job_type_check;
ALTER TABLE public.dead_letter_jobs ADD CONSTRAINT dead_letter_jobs_job_type_check
  CHECK (job_type IN (
    'VERIFY_AI_CALL','VERIFY_PUBLISH','SIM_SUBMIT','CSV_IMPORT_ROW',
    'AI_OCR_PAIRING','AI_VISION_EXTRACT','PUBLISH_ATOMIC',
    'REALTIME_BROADCAST','CACHE_INVALIDATION'
  ));

-- 4. 223 contract column missing live (created by an earlier out-of-band DDL).
ALTER TABLE public.canonical_pu_results ADD COLUMN IF NOT EXISTS published_by UUID;

-- 5. Backfill published_by from audit trail where it exists (best effort).
UPDATE public.canonical_pu_results c
SET published_by = a.actor_id
FROM public.audit_log a
WHERE c.published_by IS NULL
  AND c.status = 'PUBLISHED'
  AND a.resource_type = 'canonical_pu_results'
  AND a.resource_id = c.id
  AND a.actor_id IS NOT NULL;

COMMENT ON COLUMN public.canonical_pu_results.published_by IS 'admin_users.id that authorized publication (223 contract). Backfilled from audit_log where possible.';

SELECT '229 alignment complete' AS result;
