CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type TEXT NOT NULL CHECK(job_type IN('VERIFY_AI_CALL','VERIFY_PUBLISH','SIM_SUBMIT','CSV_IMPORT_ROW')),
  payload JSONB NOT NULL,
  last_error TEXT,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 5,
  next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'PENDING' CHECK(status IN('PENDING','RETRYING','COMPLETED','FAILED','CANCELLED')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  context_election_id UUID,
  context_pu_id UUID,
  context_submission_id UUID
);

CREATE INDEX IF NOT EXISTS idx_dl_status_next ON dead_letter_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_dl_job_type ON dead_letter_jobs(job_type);

ALTER TABLE dead_letter_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dead_letter_admin_all" ON dead_letter_jobs;
CREATE POLICY "dead_letter_admin_all" ON dead_letter_jobs
  FOR ALL USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.is_active = true));

DROP FUNCTION IF EXISTS enqueue_dead_letter(p_job_type TEXT, p_payload JSONB, p_last_error TEXT, p_max_retries INT, p_elec UUID, p_pu UUID, p_sub UUID);
CREATE OR REPLACE FUNCTION enqueue_dead_letter(
  p_job_type TEXT,
  p_payload JSONB,
  p_last_error TEXT,
  p_max_retries INT DEFAULT 5,
  p_elec UUID DEFAULT NULL,
  p_pu UUID DEFAULT NULL,
  p_sub UUID DEFAULT NULL
) RETURNS UUID AS $$
INSERT INTO dead_letter_jobs (
  job_type, payload, last_error, max_retries, next_retry_at,
  context_election_id, context_pu_id, context_submission_id
) VALUES (
  p_job_type, p_payload, p_last_error, p_max_retries,
  NOW() + INTERVAL '10 seconds', p_elec, p_pu, p_sub
) RETURNING id;
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_dead_letter TO service_role;
REVOKE EXECUTE ON FUNCTION enqueue_dead_letter FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS process_dead_letter_retry(p_id UUID);
CREATE OR REPLACE FUNCTION process_dead_letter_retry(p_id UUID)
RETURNS VOID AS $$
UPDATE dead_letter_jobs
SET retry_count = retry_count + 1,
    status = CASE WHEN retry_count + 1 >= max_retries THEN 'FAILED' ELSE 'RETRYING' END,
    next_retry_at = NOW() + (LEAST(POWER(2, retry_count), 300)::TEXT || ' seconds')::INTERVAL,
    updated_at = NOW()
WHERE id = p_id;
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION process_dead_letter_retry TO service_role;
REVOKE EXECUTE ON FUNCTION process_dead_letter_retry FROM PUBLIC, anon, authenticated;

DROP VIEW IF EXISTS mv_rls_idor_audit;
CREATE VIEW mv_rls_idor_audit AS
SELECT 'agent_assignments' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       jsonb_agg(aa.id ORDER BY aa.created_at LIMIT 5) AS sample_ids
FROM agent_assignments aa
LEFT JOIN volunteers v ON v.id = aa.volunteer_id
LEFT JOIN result_submissions rs ON rs.assignment_id = aa.id AND rs.volunteer_id = v.id
WHERE v.id IS NULL
   OR (rs.id IS NOT NULL AND rs.volunteer_id <> v.id)
UNION ALL
SELECT 'result_submissions' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       jsonb_agg(rs.id ORDER BY rs.created_at LIMIT 5) AS sample_ids
FROM result_submissions rs
LEFT JOIN agent_assignments aa ON aa.id = rs.assignment_id
WHERE aa.id IS NULL
   OR rs.volunteer_id <> aa.volunteer_id
   OR rs.election_id <> aa.election_id
   OR rs.polling_unit_id <> aa.polling_unit_id
UNION ALL
SELECT 'canonical_pu_results' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       jsonb_agg(cr.id ORDER BY cr.created_at LIMIT 5) AS sample_ids
FROM canonical_pu_results cr
WHERE cr.status NOT IN ('PUBLISHED','SUPERSEDED','REJECTED')
  AND cr.published_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.id = cr.published_by AND au.is_active = true)
UNION ALL
SELECT 'verifications' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       jsonb_agg(v.id ORDER BY v.created_at LIMIT 5) AS sample_ids
FROM verifications v
WHERE v.status IN ('MATCH','DISCREPANCY','RESOLVED_ADMIN')
  AND v.decided_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.id = v.decided_by AND au.is_active = true)
UNION ALL
SELECT 'dead_letter_jobs' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       jsonb_agg(dl.id ORDER BY dl.created_at LIMIT 5) AS sample_ids
FROM dead_letter_jobs dl
WHERE dl.status NOT IN ('COMPLETED','FAILED','CANCELLED')
UNION ALL
SELECT 'audit_log' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       jsonb_agg(al.id ORDER BY al.created_at LIMIT 5) AS sample_ids
FROM audit_log al
WHERE al.actor_type = 'ADMIN'
  AND al.actor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.id = al.actor_id AND au.is_active = true);

DROP TRIGGER IF EXISTS trg_dead_letter_immutable_completed ON dead_letter_jobs;
DROP FUNCTION IF EXISTS fn_trg_dead_letter_immutable_completed();
CREATE OR REPLACE FUNCTION fn_trg_dead_letter_immutable_completed()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'dead_letter: completed rows immutable'
    USING ERRCODE = 'P0010';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_dead_letter_immutable_completed
BEFORE DELETE OR UPDATE OF status ON dead_letter_jobs
FOR EACH ROW
WHEN (OLD.status = 'COMPLETED')
EXECUTE FUNCTION fn_trg_dead_letter_immutable_completed();
