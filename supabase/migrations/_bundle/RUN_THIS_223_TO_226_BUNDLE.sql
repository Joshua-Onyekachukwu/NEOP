-- ==============================================================
-- NEOP Phase 2 MIGRATIONS BUNDLE — RUN THIS FILE AS-IS ONCE
-- Project Supabase dashboard:
--   https://supabase.com/dashboard/project/muwocrmdcyzmwqjvvjfj
-- HOW TO APPLY:
--   1. Open URL above → SQL Editor → New query
--   2. DELETE any text in the editor, PASTE this ENTIRE file (Ctrl+A → Ctrl+V)
--   3. Click "Run" (▶). It runs 4 migrations in correct numeric order
--      (223 → 224 → 225 → 226) automatically — no manual steps needed.
--   4. You should see "Success. No rows returned" or similar. No errors.
--      (If you see an error, copy the EXACT message and reply with it.)
--
-- ORDER enforced:
--   223 — creates canonical_pu_results / verifications / system_config
--   224 — creates dead_letter_jobs + IDOR/RLS audit views
--   225 — idempotency E2E 6-scenario PL/pgSQL matrix function
--   226 — verification_timeline_events + triggers (226's dead_letter
--         trigger wrapped IF EXISTS so running this single concatenated
--         paste OR running 226 standalone alone both succeed)
-- ==============================================================


-- ########## START MIGRATION 1/4 223_CANONICAL_RESULTS_VERIFICATIONS_SYSCONFIG.sql ##########

-- ====================================================================
-- ORDER 1/4 — RUN THIS FIRST
-- Creates: system_config, canonical_pu_results (with EXCLUDE 1-PU constraint),
--          canonical_party_results, verifications pairing table,
--          RLS policies (anon PUBLISHED only, volunteer self, admin ALL),
--          RPC publish_canonical_result, VIEW mv_public_published_results,
--          publish audit trigger
-- Prereqs: 222 and earlier migrations (elections, polling_units, parties,
--          result_submissions, volunteers, agent_assignments, admin_users, audit_log)
-- ====================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE TABLE IF NOT EXISTS system_config (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001',
  data_mode TEXT NOT NULL DEFAULT 'AWAITING_DATA' CHECK(data_mode IN('AWAITING_DATA','SIMULATED','LIVE_ELECTION')),
  active_election_id UUID REFERENCES elections(id) ON DELETE SET NULL,
  simulation_election_id UUID REFERENCES elections(id) ON DELETE SET NULL,
  last_published_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_config(id) VALUES ('00000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS canonical_pu_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  polling_unit_id UUID NOT NULL REFERENCES polling_units(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'AWAITING_AGENTS' CHECK(status IN('AWAITING_AGENTS','ONE_SUBMISSION','VERIFYING','VERIFIED','FLAGGED','HUMAN_REVIEW','PUBLISHED','SUPERSEDED','REJECTED')),
  valid_votes INT NOT NULL DEFAULT 0 CHECK(valid_votes>=0),
  rejected_votes INT NOT NULL DEFAULT 0 CHECK(rejected_votes>=0),
  total_votes INT NOT NULL DEFAULT 0 CHECK(total_votes>=0),
  source_submission_1 UUID REFERENCES result_submissions(id) ON DELETE SET NULL,
  source_submission_2 UUID REFERENCES result_submissions(id) ON DELETE SET NULL,
  published_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE canonical_pu_results DROP CONSTRAINT IF EXISTS uq_canonical_exclude;
ALTER TABLE canonical_pu_results ADD CONSTRAINT uq_canonical_exclude EXCLUDE (election_id WITH =, polling_unit_id WITH =) WHERE (status NOT IN ('SUPERSEDED','REJECTED'));

CREATE INDEX IF NOT EXISTS idx_canonical_elec_pu ON canonical_pu_results(election_id, polling_unit_id);
CREATE INDEX IF NOT EXISTS idx_canonical_status ON canonical_pu_results(status);

CREATE TABLE IF NOT EXISTS canonical_party_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_result_id UUID NOT NULL REFERENCES canonical_pu_results(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  votes INT NOT NULL DEFAULT 0 CHECK(votes>=0),
  UNIQUE(canonical_result_id, party_id)
);

CREATE TABLE IF NOT EXISTS verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID REFERENCES elections(id) ON DELETE SET NULL,
  polling_unit_id UUID REFERENCES polling_units(id) ON DELETE SET NULL,
  submission_id_1 UUID REFERENCES result_submissions(id) ON DELETE CASCADE,
  submission_id_2 UUID REFERENCES result_submissions(id) ON DELETE SET NULL,
  canonical_result_id UUID REFERENCES canonical_pu_results(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'AWAITING_DATA' CHECK(status IN('AWAITING_DATA','DETERMINISTIC_RUNNING','DETERMINISTIC_PASSED','DETERMINISTIC_FAILED','NVIDIA_RUNNING','FLAGGED_AI','NVIDIA_FAILED','MATCH','DISCREPANCY','RESOLVED_ADMIN')),
  deterministic_checks JSONB,
  submissions_identical BOOLEAN,
  math_consistent BOOLEAN,
  nvidia_ocr JSONB,
  nvidia_evidence JSONB,
  nvidia_anomaly JSONB,
  nvidia_consistency JSONB,
  nvidia_aggregate JSONB,
  final_decision TEXT CHECK(final_decision IN('MATCH','DISCREPANCY','ADMIN_OVERRIDE_MATCH','ADMIN_OVERRIDE_DISCREPANCY','AI_ONLY_REVIEW')),
  decided_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v_status ON verifications(status);
CREATE INDEX IF NOT EXISTS idx_v_pair ON verifications(submission_id_1, submission_id_2);
CREATE INDEX IF NOT EXISTS idx_v_canonical ON verifications(canonical_result_id);
CREATE INDEX IF NOT EXISTS idx_v_updated ON verifications(updated_at DESC);

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_pu_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_party_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_config_anon_select" ON system_config;
CREATE POLICY "system_config_anon_select" ON system_config
  FOR SELECT USING (data_mode IN('SIMULATED','LIVE_ELECTION'));
DROP POLICY IF EXISTS "system_config_admin_all" ON system_config;
CREATE POLICY "system_config_admin_all" ON system_config
  FOR ALL USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.is_active = true));

DROP POLICY IF EXISTS "canonical_pu_anon_select" ON canonical_pu_results;
CREATE POLICY "canonical_pu_anon_select" ON canonical_pu_results
  FOR SELECT USING (status = 'PUBLISHED');
DROP POLICY IF EXISTS "canonical_pu_volunteer_select" ON canonical_pu_results;
CREATE POLICY "canonical_pu_volunteer_select" ON canonical_pu_results
  FOR SELECT USING (EXISTS(SELECT 1 FROM result_submissions rs WHERE rs.id IN(source_submission_1,source_submission_2) AND EXISTS (SELECT 1 FROM volunteers v WHERE v.id = rs.volunteer_id AND v.user_id = auth.uid())));
DROP POLICY IF EXISTS "canonical_pu_admin_all" ON canonical_pu_results;
CREATE POLICY "canonical_pu_admin_all" ON canonical_pu_results
  FOR ALL USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.is_active = true));

DROP POLICY IF EXISTS "canonical_party_anon_select" ON canonical_party_results;
CREATE POLICY "canonical_party_anon_select" ON canonical_party_results
  FOR SELECT USING (EXISTS(SELECT 1 FROM canonical_pu_results cr WHERE cr.id = canonical_result_id AND cr.status = 'PUBLISHED'));
DROP POLICY IF EXISTS "canonical_party_admin_all" ON canonical_party_results;
CREATE POLICY "canonical_party_admin_all" ON canonical_party_results
  FOR ALL USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.is_active = true));

DROP POLICY IF EXISTS "verifications_admin_all" ON verifications;
CREATE POLICY "verifications_admin_all" ON verifications
  FOR ALL USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.is_active = true));
DROP POLICY IF EXISTS "verifications_volunteer_select" ON verifications;
CREATE POLICY "verifications_volunteer_select" ON verifications
  FOR SELECT USING (EXISTS(SELECT 1 FROM result_submissions rs WHERE (rs.id=submission_id_1 OR rs.id=submission_id_2) AND EXISTS (SELECT 1 FROM volunteers v WHERE v.id = rs.volunteer_id AND v.user_id = auth.uid())));

DROP FUNCTION IF EXISTS publish_canonical_result(p_election_id UUID, p_polling_unit_id UUID, p_status TEXT, p_valid_votes INT, p_rejected_votes INT, p_total_votes INT, p_source_1 UUID, p_source_2 UUID, p_party_votes JSONB, p_created_by UUID);
CREATE OR REPLACE FUNCTION publish_canonical_result(
  p_election_id UUID,
  p_polling_unit_id UUID,
  p_status TEXT,
  p_valid_votes INT,
  p_rejected_votes INT,
  p_total_votes INT,
  p_source_1 UUID,
  p_source_2 UUID,
  p_party_votes JSONB,
  p_created_by UUID DEFAULT NULL
) RETURNS TABLE(
  out_canonical_id UUID,
  out_status TEXT,
  out_was_superseded_count INT,
  out_party_count INT
) AS $$
DECLARE
  v_superseded INT := 0;
  v_party_cnt INT := 0;
  v_cid UUID;
  v_row RECORD;
  v_pv JSONB;
  v_pid UUID;
  v_votes INT;
BEGIN
  UPDATE canonical_pu_results
  SET status = 'SUPERSEDED', updated_at = NOW()
  WHERE election_id = p_election_id
    AND polling_unit_id = p_polling_unit_id
    AND status NOT IN('SUPERSEDED','REJECTED');
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  INSERT INTO canonical_pu_results (
    election_id, polling_unit_id, status,
    valid_votes, rejected_votes, total_votes,
    source_submission_1, source_submission_2,
    published_by, published_at
  ) VALUES (
    p_election_id, p_polling_unit_id,
    CASE WHEN p_status IS NULL THEN 'PUBLISHED' ELSE p_status END,
    p_valid_votes, p_rejected_votes, p_total_votes,
    p_source_1, p_source_2,
    p_created_by,
    CASE WHEN (CASE WHEN p_status IS NULL THEN 'PUBLISHED' ELSE p_status END) = 'PUBLISHED' THEN NOW() ELSE NULL END
  ) RETURNING id INTO v_cid;

  out_canonical_id := v_cid;
  out_status := p_status;
  out_was_superseded_count := v_superseded;

  IF p_party_votes IS NOT NULL AND jsonb_typeof(p_party_votes) = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_party_votes) LOOP
      v_pv := v_row.value;
      v_pid := (v_pv->>'party_id')::UUID;
      v_votes := COALESCE((v_pv->>'votes')::INT, 0);
      IF v_pid IS NOT NULL AND v_votes >= 0 THEN
        INSERT INTO canonical_party_results (canonical_result_id, party_id, votes)
        VALUES (v_cid, v_pid, v_votes) ON CONFLICT DO NOTHING;
        v_party_cnt := v_party_cnt + 1;
      END IF;
    END LOOP;
  END IF;

  UPDATE system_config SET last_published_at = NOW(), last_updated_at = NOW()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  out_party_count := v_party_cnt;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION publish_canonical_result TO service_role;
REVOKE EXECUTE ON FUNCTION publish_canonical_result FROM PUBLIC, anon, authenticated;

DROP VIEW IF EXISTS mv_public_published_results;
CREATE VIEW mv_public_published_results AS
SELECT
  cr.id,
  cr.election_id,
  pu.id AS polling_unit_id,
  pu.official_code AS polling_unit_code,
  pu.name AS polling_unit_name,
  pu.state_id,
  s.name AS state_name,
  pu.lga_id,
  lg.name AS lga_name,
  pu.ward_id,
  w.name AS ward_name,
  pu.latitude,
  pu.longitude,
  pu.registered_voters,
  cr.status,
  cr.valid_votes,
  cr.rejected_votes,
  cr.total_votes,
  cr.published_at,
  cr.source_submission_1,
  cr.source_submission_2
FROM canonical_pu_results cr
JOIN polling_units pu ON pu.id = cr.polling_unit_id
LEFT JOIN states s ON s.id = pu.state_id
LEFT JOIN lgas lg ON lg.id = pu.lga_id
LEFT JOIN wards w ON w.id = pu.ward_id
WHERE cr.status = 'PUBLISHED';

DROP TRIGGER IF EXISTS trg_canonical_publish_audit ON canonical_pu_results;
DROP FUNCTION IF EXISTS fn_trg_canonical_publish_audit();
CREATE OR REPLACE FUNCTION fn_trg_canonical_publish_audit()
RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_log (
    action, actor_id, actor_type, resource_type, resource_id, metadata, created_at
  ) VALUES (
    'RESULT_PUBLISHED',
    NEW.published_by,
    CASE WHEN NEW.published_by IS NOT NULL THEN 'ADMIN' ELSE 'SYSTEM' END,
    'CANONICAL_RESULT',
    NEW.id,
    jsonb_build_object(
      'canonical_id', NEW.id,
      'election_id', NEW.election_id,
      'pu_id', NEW.polling_unit_id,
      'valid_votes', NEW.valid_votes,
      'total_votes', NEW.total_votes
    ),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_canonical_publish_audit
AFTER INSERT OR UPDATE OF status ON canonical_pu_results
FOR EACH ROW
WHEN (NEW.status = 'PUBLISHED')
EXECUTE FUNCTION fn_trg_canonical_publish_audit();

-- ########## END MIGRATION 1/4 ##########


-- ########## START MIGRATION 2/4 224_PHASE2_DEAD_LETTER_RLS_IDOR.sql ##########

-- ====================================================================
-- DEPENDENCY ORDER: Run AFTER 223_CANONICAL_RESULTS_VERIFICATIONS_SYSCONFIG.sql
-- Requires tables: canonical_pu_results, verifications, admin_users
-- ====================================================================
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
       COALESCE((SELECT jsonb_agg(q.id ORDER BY q.created_at)
                 FROM (SELECT aa_inner.id, aa_inner.created_at FROM agent_assignments aa_inner
                       LEFT JOIN volunteers v_inner ON v_inner.id = aa_inner.volunteer_id
                       LEFT JOIN result_submissions rs_inner ON rs_inner.assignment_id = aa_inner.id AND rs_inner.volunteer_id = v_inner.id
                       WHERE v_inner.id IS NULL
                          OR (rs_inner.id IS NOT NULL AND rs_inner.volunteer_id <> v_inner.id)
                       ORDER BY aa_inner.created_at LIMIT 5) q), '[]'::JSONB) AS sample_ids
FROM agent_assignments aa
LEFT JOIN volunteers v ON v.id = aa.volunteer_id
LEFT JOIN result_submissions rs ON rs.assignment_id = aa.id AND rs.volunteer_id = v.id
WHERE v.id IS NULL
   OR (rs.id IS NOT NULL AND rs.volunteer_id <> v.id)
UNION ALL
SELECT 'result_submissions' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       COALESCE((SELECT jsonb_agg(q.id ORDER BY q.created_at)
                 FROM (SELECT rs_inner.id, rs_inner.created_at FROM result_submissions rs_inner
                       LEFT JOIN agent_assignments aa_inner ON aa_inner.id = rs_inner.assignment_id
                       WHERE aa_inner.id IS NULL
                          OR rs_inner.volunteer_id <> aa_inner.volunteer_id
                          OR rs_inner.election_id <> aa_inner.election_id
                          OR rs_inner.polling_unit_id <> aa_inner.polling_unit_id
                       ORDER BY rs_inner.created_at LIMIT 5) q), '[]'::JSONB) AS sample_ids
FROM result_submissions rs
LEFT JOIN agent_assignments aa ON aa.id = rs.assignment_id
WHERE aa.id IS NULL
   OR rs.volunteer_id <> aa.volunteer_id
   OR rs.election_id <> aa.election_id
   OR rs.polling_unit_id <> aa.polling_unit_id
UNION ALL
SELECT 'canonical_pu_results' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       COALESCE((SELECT jsonb_agg(q.id ORDER BY q.created_at)
                 FROM (SELECT cr_inner.id, cr_inner.created_at FROM canonical_pu_results cr_inner
                       WHERE cr_inner.status NOT IN ('PUBLISHED','SUPERSEDED','REJECTED')
                         AND (cr_inner.source_submission_1 IS NOT NULL OR cr_inner.source_submission_2 IS NOT NULL)
                         AND EXISTS (
                           SELECT 1 FROM result_submissions rs1
                           LEFT JOIN agent_assignments aa1 ON aa1.id = rs1.assignment_id
                           WHERE rs1.id = cr_inner.source_submission_1
                             AND (aa1.id IS NULL OR rs1.volunteer_id <> aa1.volunteer_id)
                         )
                       ORDER BY cr_inner.created_at LIMIT 5) q), '[]'::JSONB) AS sample_ids
FROM canonical_pu_results cr
WHERE cr.status NOT IN ('PUBLISHED','SUPERSEDED','REJECTED')
  AND (cr.source_submission_1 IS NOT NULL OR cr.source_submission_2 IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM result_submissions rs1
    LEFT JOIN agent_assignments aa1 ON aa1.id = rs1.assignment_id
    WHERE rs1.id = cr.source_submission_1
      AND (aa1.id IS NULL OR rs1.volunteer_id <> aa1.volunteer_id)
  )
UNION ALL
SELECT 'verifications' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       COALESCE((SELECT jsonb_agg(q.id ORDER BY q.created_at)
                 FROM (SELECT v_inner.id, v_inner.created_at FROM verifications v_inner
                       WHERE v_inner.status IN ('MATCH','DISCREPANCY','RESOLVED_ADMIN')
                         AND v_inner.decided_by IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = v_inner.decided_by AND au.is_active = true)
                       ORDER BY v_inner.created_at LIMIT 5) q), '[]'::JSONB) AS sample_ids
FROM verifications v
WHERE v.status IN ('MATCH','DISCREPANCY','RESOLVED_ADMIN')
  AND v.decided_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = v.decided_by AND au.is_active = true)
UNION ALL
SELECT 'dead_letter_jobs' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       COALESCE((SELECT jsonb_agg(q.id ORDER BY q.created_at)
                 FROM (SELECT dl_inner.id, dl_inner.created_at FROM dead_letter_jobs dl_inner
                       WHERE dl_inner.status NOT IN ('COMPLETED','FAILED','CANCELLED')
                       ORDER BY dl_inner.created_at LIMIT 5) q), '[]'::JSONB) AS sample_ids
FROM dead_letter_jobs dl
WHERE dl.status NOT IN ('COMPLETED','FAILED','CANCELLED')
UNION ALL
SELECT 'audit_log' AS table_name,
       COUNT(*)::BIGINT AS potential_idor_rows,
       COALESCE((SELECT jsonb_agg(q.id ORDER BY q.created_at)
                 FROM (SELECT al_inner.id, al_inner.created_at FROM audit_log al_inner
                       WHERE al_inner.actor_type = 'ADMIN'
                         AND al_inner.actor_id IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = al_inner.actor_id AND au.is_active = true)
                       ORDER BY al_inner.created_at LIMIT 5) q), '[]'::JSONB) AS sample_ids
FROM audit_log al
WHERE al.actor_type = 'ADMIN'
  AND al.actor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = al.actor_id AND au.is_active = true);

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

-- ########## END MIGRATION 2/4 ##########


-- ########## START MIGRATION 3/4 225_PHASE2_IDEMPOTENCY_E2E_MATRIX.sql ##########

-- ====================================================================
-- DEPENDENCY ORDER: Run AFTER 223_CANONICAL_RESULTS_VERIFICATIONS_SYSCONFIG.sql
--                    Run AFTER 224_PHASE2_DEAD_LETTER_RLS_IDOR.sql
-- Requires tables: canonical_pu_results, canonical_party_results, verifications,
--                  elections, polling_units, parties, volunteers, agent_assignments,
--                  user_accounts, admin_users, result_submissions
-- Diagnostic-only — audit tool: run_idempotency_matrix_simulation() 6-scenario E2E
-- ====================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP FUNCTION IF EXISTS run_idempotency_matrix_simulation();
CREATE OR REPLACE FUNCTION run_idempotency_matrix_simulation()
RETURNS TABLE(scenario TEXT, passed BOOLEAN, detail TEXT) AS $$
DECLARE
  v_test_pu UUID;
  v_test_elec UUID;
  v_vol UUID;
  v_assign UUID;
  v_test_party1 UUID;
  v_test_party2 UUID;
  v_test_user UUID;
  v_test_admin UUID;
  v_result_1 UUID;
  v_result_2 UUID;
  v_idem_key TEXT;
  v_out_id UUID;
  v_out_idem TEXT;
  v_out_status TEXT;
  v_out_repeat BOOLEAN;
  v_out_party_rows BIGINT;
  v_out_cid UUID;
  v_out_cstatus TEXT;
  v_out_sup INT;
  v_out_party_cnt INT;
  v_sum1 BIGINT;
  v_sum2 BIGINT;
  v_original_votes INT;
  v_actual_votes INT;
  v_err TEXT;
BEGIN
  v_test_user := '00000000-0000-0000-0000-000000000099';

  SELECT id INTO v_test_elec FROM elections LIMIT 1;
  IF v_test_elec IS NULL THEN
    INSERT INTO elections (id, name, type, status, is_active)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Test Election', 'PRESIDENTIAL', 'ACTIVE', true)
    RETURNING id INTO v_test_elec;
  END IF;

  SELECT id INTO v_test_pu FROM polling_units LIMIT 1;
  IF v_test_pu IS NULL THEN
    SELECT id INTO v_test_pu FROM states LIMIT 1;
    IF v_test_pu IS NULL THEN
      INSERT INTO states (id, name, code) VALUES ('00000000-0000-0000-0000-000000000001', 'Test State', 'TS') RETURNING id INTO v_test_pu;
    END IF;
    SELECT id INTO v_test_pu FROM lgas LIMIT 1;
    IF v_test_pu IS NULL THEN
      INSERT INTO lgas (id, state_id, name, code) VALUES ('00000000-0000-0000-0000-000000000002', (SELECT id FROM states LIMIT 1), 'Test LGA', 'TL') RETURNING id INTO v_test_pu;
    END IF;
    SELECT id INTO v_test_pu FROM wards LIMIT 1;
    IF v_test_pu IS NULL THEN
      INSERT INTO wards (id, lga_id, name, code) VALUES ('00000000-0000-0000-0000-000000000003', (SELECT id FROM lgas LIMIT 1), 'Test Ward', 'TW') RETURNING id INTO v_test_pu;
    END IF;
    INSERT INTO polling_units (id, official_code, name, state_id, lga_id, ward_id)
    VALUES ('00000000-0000-0000-0000-000000000010', 'TEST-PU-001', 'Test PU', (SELECT id FROM states LIMIT 1), (SELECT id FROM lgas LIMIT 1), (SELECT id FROM wards LIMIT 1))
    RETURNING id INTO v_test_pu;
  END IF;

  SELECT id INTO v_test_party1 FROM parties LIMIT 1;
  IF v_test_party1 IS NULL THEN
    INSERT INTO parties (id, official_name, abbreviation, color)
    VALUES ('00000000-0000-0000-0000-000000000004', 'Party A', 'PA', '#FF0000')
    RETURNING id INTO v_test_party1;
  END IF;
  SELECT id INTO v_test_party2 FROM parties OFFSET 1 LIMIT 1;
  IF v_test_party2 IS NULL THEN
    INSERT INTO parties (id, official_name, abbreviation, color)
    VALUES ('00000000-0000-0000-0000-000000000005', 'Party B', 'PB', '#0000FF')
    RETURNING id INTO v_test_party2;
  END IF;

  SELECT id INTO v_vol FROM volunteers LIMIT 1;
  IF v_vol IS NULL THEN
    INSERT INTO user_accounts (id, email, full_name)
    VALUES (v_test_user, 'test@neop.local', 'Test User')
    ON CONFLICT DO NOTHING;
    INSERT INTO volunteers (id, user_id, status)
    VALUES ('00000000-0000-0000-0000-000000000011', v_test_user, 'VERIFIED')
    RETURNING id INTO v_vol;
  END IF;

  SELECT id INTO v_assign FROM agent_assignments LIMIT 1;
  IF v_assign IS NULL THEN
    INSERT INTO agent_assignments (id, volunteer_id, polling_unit_id, election_id, status, observer_number)
    VALUES ('00000000-0000-0000-0000-000000000012', v_vol, v_test_pu, v_test_elec, 'CHECKED_IN', 1)
    RETURNING id INTO v_assign;
  END IF;

  SELECT id INTO v_test_admin FROM admin_users LIMIT 1;
  IF v_test_admin IS NULL THEN
    INSERT INTO admin_users (id, user_id, role, is_active)
    VALUES ('00000000-0000-0000-0000-000000000013', v_test_user, 'SUPER_ADMIN', true)
    RETURNING id INTO v_test_admin;
  END IF;

  v_idem_key := 'IDEM-S1-' || v_assign::TEXT;
  BEGIN
    DELETE FROM result_submissions WHERE idempotency_key = v_idem_key;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      v_idem_key, v_assign, v_vol, v_test_elec, v_test_pu,
      100, 10, 110,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 60),
        jsonb_build_object('party_id', v_test_party2, 'votes', 40)
      )
    );
    v_result_1 := v_out_id;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      v_idem_key, v_assign, v_vol, v_test_elec, v_test_pu,
      999, 99, 9999,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 999),
        jsonb_build_object('party_id', v_test_party2, 'votes', 999)
      )
    );
    v_result_2 := v_out_id;

    IF v_result_1 = v_result_2 AND v_out_repeat = true THEN
      scenario := 'S1_DOUBLE_SUBMIT_IDEM';
      passed := true;
      detail := 'Same submission id on repeat: ' || v_result_1::TEXT;
    ELSE
      scenario := 'S1_DOUBLE_SUBMIT_IDEM';
      passed := false;
      detail := 'MISMATCH: id1=' || v_result_1::TEXT || ' id2=' || v_result_2::TEXT || ' repeat=' || v_out_repeat::TEXT;
    END IF;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S1_DOUBLE_SUBMIT_IDEM';
    passed := false;
    detail := 'EXCEPTION: ' || v_err;
    RETURN NEXT;
  END;

  v_idem_key := 'IDEM-S2-' || v_assign::TEXT;
  BEGIN
    DELETE FROM result_submissions WHERE idempotency_key = v_idem_key;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      v_idem_key, v_assign, v_vol, v_test_elec, v_test_pu,
      100, 10, 110,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 60),
        jsonb_build_object('party_id', v_test_party2, 'votes', 40)
      )
    );
    v_result_1 := v_out_id;

    UPDATE result_submissions SET status = 'VERIFIED' WHERE id = v_result_1;
    UPDATE result_submissions SET status = 'REJECTED' WHERE id = v_result_1;

    scenario := 'S2_VERIFIED_TO_REJECTED';
    passed := false;
    detail := 'EXPECTED RAISE BUT SUCCEEDED: id=' || v_result_1::TEXT;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S2_VERIFIED_TO_REJECTED';
    passed := true;
    detail := 'Correctly raised: ' || v_err;
    RETURN NEXT;
  END;

  BEGIN
    DELETE FROM canonical_pu_results WHERE election_id = v_test_elec AND polling_unit_id = v_test_pu;

    SELECT * INTO v_out_cid, v_out_cstatus, v_out_sup, v_out_party_cnt
    FROM publish_canonical_result(
      v_test_elec, v_test_pu, 'PUBLISHED',
      100, 10, 110,
      v_result_1, NULL,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 60),
        jsonb_build_object('party_id', v_test_party2, 'votes', 40)
      ),
      v_test_admin
    );

    SELECT * INTO v_out_cid, v_out_cstatus, v_out_sup, v_out_party_cnt
    FROM publish_canonical_result(
      v_test_elec, v_test_pu, 'PUBLISHED',
      105, 5, 110,
      v_result_1, NULL,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 63),
        jsonb_build_object('party_id', v_test_party2, 'votes', 42)
      ),
      v_test_admin
    );

    IF v_out_sup >= 1 AND v_out_party_cnt = 2 THEN
      scenario := 'S3_PUBLISH_CANONICAL_TWICE';
      passed := true;
      detail := 'Superseded count=' || v_out_sup || ', parties=' || v_out_party_cnt;
    ELSE
      scenario := 'S3_PUBLISH_CANONICAL_TWICE';
      passed := false;
      detail := 'EXPECTED sup>=1+parties=2. Got sup=' || v_out_sup || ', parties=' || v_out_party_cnt;
    END IF;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S3_PUBLISH_CANONICAL_TWICE';
    passed := false;
    detail := 'EXCEPTION: ' || v_err;
    RETURN NEXT;
  END;

  BEGIN
    DELETE FROM canonical_pu_results WHERE election_id = v_test_elec AND polling_unit_id = v_test_pu;

    INSERT INTO canonical_pu_results (
      election_id, polling_unit_id, status,
      valid_votes, rejected_votes, total_votes,
      published_by, published_at
    ) VALUES (
      v_test_elec, v_test_pu, 'PUBLISHED',
      100, 10, 110, v_test_admin, NOW()
    );

    INSERT INTO canonical_pu_results (
      election_id, polling_unit_id, status,
      valid_votes, rejected_votes, total_votes,
      published_by, published_at
    ) VALUES (
      v_test_elec, v_test_pu, 'PUBLISHED',
      100, 10, 110, v_test_admin, NOW()
    );

    scenario := 'S4_EXCLUDE_CONSTRAINT_2_PUBLISHED';
    passed := false;
    detail := 'EXPECTED RAISE BUT SUCCEEDED: uq_canonical_exclude failed';
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S4_EXCLUDE_CONSTRAINT_2_PUBLISHED';
    passed := true;
    detail := 'Correctly raised: ' || v_err;
    RETURN NEXT;
  END;

  BEGIN
    DELETE FROM result_submissions WHERE idempotency_key IN ('IDEM-S5-A', 'IDEM-S5-B');
    DELETE FROM canonical_pu_results WHERE election_id = v_test_elec AND polling_unit_id = v_test_pu;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      'IDEM-S5-A', v_assign, v_vol, v_test_elec, v_test_pu,
      200, 20, 220,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 120),
        jsonb_build_object('party_id', v_test_party2, 'votes', 80)
      )
    );
    v_result_1 := v_out_id;

    SELECT COALESCE(SUM(votes), 0)::BIGINT INTO v_sum1
    FROM party_results WHERE result_submission_id = v_result_1;

    SELECT COALESCE(SUM(cpr.votes), 0)::BIGINT INTO v_sum2
    FROM canonical_party_results cpr
    JOIN canonical_pu_results cr ON cr.id = cpr.canonical_result_id
    WHERE cr.election_id = v_test_elec AND cr.polling_unit_id = v_test_pu;

    IF v_sum1 = 200 THEN
      scenario := 'S5_SUM_PARTY_MATCH_VALID';
      passed := true;
      detail := 'party_results SUM=' || v_sum1 || ' === valid_votes=200, canonical_SUM=' || v_sum2;
    ELSE
      scenario := 'S5_SUM_PARTY_MATCH_VALID';
      passed := false;
      detail := 'SUM(party_results.votes)=' || v_sum1 || ' !== valid_votes=200';
    END IF;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S5_SUM_PARTY_MATCH_VALID';
    passed := false;
    detail := 'EXCEPTION: ' || v_err;
    RETURN NEXT;
  END;

  BEGIN
    v_idem_key := 'IDEM-S6-AI-' || v_assign::TEXT;
    DELETE FROM result_submissions WHERE idempotency_key = v_idem_key;

    SELECT * INTO v_out_id, v_out_idem, v_out_status, v_out_repeat, v_out_party_rows
    FROM submit_result_atomic(
      v_idem_key, v_assign, v_vol, v_test_elec, v_test_pu,
      500, 50, 550,
      jsonb_build_array(
        jsonb_build_object('party_id', v_test_party1, 'votes', 300),
        jsonb_build_object('party_id', v_test_party2, 'votes', 200)
      )
    );
    v_result_1 := v_out_id;

    SELECT votes INTO v_original_votes
    FROM party_results WHERE result_submission_id = v_result_1 AND party_id = v_test_party1;

    v_original_votes := COALESCE(v_original_votes, 0);

    DELETE FROM verifications WHERE submission_id_1 = v_result_1;
    INSERT INTO verifications (
      election_id, polling_unit_id, submission_id_1, status,
      nvidia_ocr, nvidia_aggregate, final_decision
    ) VALUES (
      v_test_elec, v_test_pu, v_result_1, 'MATCH',
      jsonb_build_object('party_' || v_test_party1, 99999),
      jsonb_build_object('parties', jsonb_build_array()),
      'MATCH'
    );

    SELECT votes INTO v_actual_votes
    FROM party_results WHERE result_submission_id = v_result_1 AND party_id = v_test_party1;

    IF v_actual_votes = v_original_votes AND v_actual_votes = 300 THEN
      scenario := 'S6_AI_NEVER_ALTERS_ORIGINAL';
      passed := true;
      detail := 'Original party1 votes=' || v_original_votes || ', post-verification=' || v_actual_votes;
    ELSE
      scenario := 'S6_AI_NEVER_ALTERS_ORIGINAL';
      passed := false;
      detail := 'MUTATION DETECTED: original=' || v_original_votes || ' post=' || v_actual_votes;
    END IF;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    scenario := 'S6_AI_NEVER_ALTERS_ORIGINAL';
    passed := false;
    detail := 'EXCEPTION: ' || v_err;
    RETURN NEXT;
  END;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION run_idempotency_matrix_simulation TO service_role;
REVOKE EXECUTE ON FUNCTION run_idempotency_matrix_simulation FROM PUBLIC, anon, authenticated;

-- ########## END MIGRATION 3/4 ##########


-- ########## START MIGRATION 4/4 226_PHASE2_OBSERVABILITY_TIMELINE.sql ##########

-- ====================================================================
-- DEPENDENCY ORDER: Run AFTER 223_CANONICAL_RESULTS_VERIFICATIONS_SYSCONFIG.sql
--                   AND AFTER 224_PHASE2_DEAD_LETTER_RLS_IDOR.sql
-- Requires tables: verifications, canonical_pu_results, result_submissions,
--                  dead_letter_jobs (optional — trigger wrapped IF EXISTS)
-- ====================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS verification_timeline_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  verification_id UUID REFERENCES verifications(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN(
    'SUBMISSION_1_RECEIVED','SUBMISSION_2_RECEIVED',
    'DETERMINISTIC_START','DETERMINISTIC_PASS','DETERMINISTIC_FAIL',
    'NVIDIA_CALL_START','NVIDIA_CALL_SUCCESS','NVIDIA_CALL_FAIL',
    'MATCH_CONFIRMED','DISCREPANCY_DETECTED','ADMIN_RESOLVE',
    'PUBLISH_START','PUBLISH_SUCCESS','PUBLISH_FAIL',
    'DEAD_LETTER_ENQUEUED','RETRY_SCHEDULED'
  )),
  actor_type TEXT CHECK(actor_type IN('SYSTEM','ADMIN','AI','OBSERVER')),
  actor_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vte_verification
  ON verification_timeline_events(verification_id, created_at);

ALTER TABLE verification_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vte_admin_all" ON verification_timeline_events;
CREATE POLICY "vte_admin_all" ON verification_timeline_events
  FOR ALL USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.is_active = true));
DROP POLICY IF EXISTS "vte_volunteer_select" ON verification_timeline_events;
CREATE POLICY "vte_volunteer_select" ON verification_timeline_events
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM verifications v
    WHERE v.id = verification_id
      AND EXISTS(
        SELECT 1 FROM result_submissions rs
        WHERE (rs.id = v.submission_id_1 OR rs.id = v.submission_id_2)
          AND EXISTS (SELECT 1 FROM volunteers vol WHERE vol.id = rs.volunteer_id AND vol.user_id = auth.uid())
      )
  ));

DROP TRIGGER IF EXISTS trg_rs_timeline ON result_submissions;
DROP FUNCTION IF EXISTS fn_trg_rs_timeline();
CREATE OR REPLACE FUNCTION fn_trg_rs_timeline()
RETURNS trigger AS $$
DECLARE
  v_vid UUID;
  v_existing_sub_count INT;
BEGIN
  SELECT v.id,
         CASE WHEN v.submission_id_1 IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN v.submission_id_2 IS NOT NULL THEN 1 ELSE 0 END
    INTO v_vid, v_existing_sub_count
  FROM verifications v
  WHERE v.election_id = NEW.election_id
    AND v.polling_unit_id = NEW.polling_unit_id
  ORDER BY v.created_at DESC
  LIMIT 1;

  IF v_vid IS NULL THEN
    INSERT INTO verifications (id, election_id, polling_unit_id, submission_id_1, status)
    VALUES (uuid_generate_v4(), NEW.election_id, NEW.polling_unit_id, NEW.id, 'AWAITING_DATA')
    RETURNING id INTO v_vid;
    v_existing_sub_count := 0;
  END IF;

  IF v_existing_sub_count = 0 THEN
    UPDATE verifications
    SET submission_id_1 = NEW.id,
        updated_at = NOW()
    WHERE id = v_vid AND submission_id_1 IS NULL;
    INSERT INTO verification_timeline_events (
      verification_id, event_type, actor_type, actor_id, metadata, created_at
    ) VALUES (
      v_vid, 'SUBMISSION_1_RECEIVED', 'OBSERVER', NEW.volunteer_id,
      jsonb_build_object('submission_id', NEW.id, 'volunteer_id', NEW.volunteer_id),
      NOW()
    );
  ELSIF v_existing_sub_count = 1 THEN
    UPDATE verifications
    SET submission_id_2 = NEW.id,
        updated_at = NOW()
    WHERE id = v_vid AND submission_id_2 IS NULL;
    INSERT INTO verification_timeline_events (
      verification_id, event_type, actor_type, actor_id, metadata, created_at
    ) VALUES (
      v_vid, 'SUBMISSION_2_RECEIVED', 'OBSERVER', NEW.volunteer_id,
      jsonb_build_object('submission_id', NEW.id, 'volunteer_id', NEW.volunteer_id),
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_rs_timeline
AFTER INSERT ON result_submissions
FOR EACH ROW
EXECUTE FUNCTION fn_trg_rs_timeline();

DROP TRIGGER IF EXISTS trg_verifications_timeline ON verifications;
DROP FUNCTION IF EXISTS fn_trg_verifications_timeline();
CREATE OR REPLACE FUNCTION fn_trg_verifications_timeline()
RETURNS trigger AS $$
DECLARE
  v_event TEXT;
  v_actor_type TEXT := 'SYSTEM';
  v_meta JSONB;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.final_decision IS NOT DISTINCT FROM OLD.final_decision THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'DETERMINISTIC_RUNNING' THEN v_event := 'DETERMINISTIC_START';
    WHEN 'DETERMINISTIC_PASSED'  THEN v_event := 'DETERMINISTIC_PASS';
    WHEN 'DETERMINISTIC_FAILED'  THEN v_event := 'DETERMINISTIC_FAIL';
    WHEN 'NVIDIA_RUNNING'        THEN v_event := 'NVIDIA_CALL_START';
    WHEN 'NVIDIA_FAILED'         THEN v_event := 'NVIDIA_CALL_FAIL';
    WHEN 'FLAGGED_AI'            THEN v_event := 'NVIDIA_CALL_FAIL';
    WHEN 'MATCH'                 THEN v_event := 'MATCH_CONFIRMED';
    WHEN 'DISCREPANCY'           THEN v_event := 'DISCREPANCY_DETECTED';
    WHEN 'RESOLVED_ADMIN'        THEN v_event := 'ADMIN_RESOLVE';
    ELSE v_event := NULL;
  END CASE;

  IF NEW.status = 'RESOLVED_ADMIN' THEN
    v_actor_type := 'ADMIN';
  ELSIF NEW.status IN ('NVIDIA_RUNNING','NVIDIA_FAILED','FLAGGED_AI','MATCH','DISCREPANCY') THEN
    v_actor_type := 'AI';
  END IF;

  IF v_event IS NOT NULL THEN
    v_meta := jsonb_build_object(
      'old_status', OLD.status,
      'new_status', NEW.status,
      'final_decision', NEW.final_decision
    );
    INSERT INTO verification_timeline_events (
      verification_id, event_type, actor_type, actor_id, metadata, created_at
    ) VALUES (
      NEW.id, v_event, v_actor_type, NEW.decided_by, v_meta, NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_verifications_timeline
AFTER UPDATE OF status, final_decision ON verifications
FOR EACH ROW
EXECUTE FUNCTION fn_trg_verifications_timeline();

DROP TRIGGER IF EXISTS trg_canonical_timeline ON canonical_pu_results;
DROP FUNCTION IF EXISTS fn_trg_canonical_timeline();
CREATE OR REPLACE FUNCTION fn_trg_canonical_timeline()
RETURNS trigger AS $$
DECLARE
  v_vid UUID;
BEGIN
  SELECT v.id INTO v_vid
  FROM verifications v
  WHERE v.canonical_result_id = NEW.id
  OR (v.election_id = NEW.election_id AND v.polling_unit_id = NEW.polling_unit_id)
  ORDER BY v.updated_at DESC
  LIMIT 1;

  INSERT INTO verification_timeline_events (
    verification_id, event_type, actor_type, actor_id, metadata, created_at
  ) VALUES (
    v_vid, 'PUBLISH_SUCCESS',
    CASE WHEN NEW.published_by IS NOT NULL THEN 'ADMIN' ELSE 'SYSTEM' END,
    NEW.published_by,
    jsonb_build_object(
      'canonical_id', NEW.id,
      'election_id', NEW.election_id,
      'pu_id', NEW.polling_unit_id,
      'valid_votes', NEW.valid_votes,
      'total_votes', NEW.total_votes
    ),
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_canonical_timeline
AFTER INSERT OR UPDATE OF status ON canonical_pu_results
FOR EACH ROW
WHEN (NEW.status = 'PUBLISHED')
EXECUTE FUNCTION fn_trg_canonical_timeline();

DROP TRIGGER IF EXISTS trg_dead_letter_timeline ON dead_letter_jobs;
DROP FUNCTION IF EXISTS fn_trg_dead_letter_timeline();
CREATE OR REPLACE FUNCTION fn_trg_dead_letter_timeline()
RETURNS trigger AS $$
DECLARE
  v_vid UUID;
  v_etype TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_etype := 'DEAD_LETTER_ENQUEUED';
    v_vid := NEW.context_submission_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.retry_count > OLD.retry_count THEN
    v_etype := 'RETRY_SCHEDULED';
    v_vid := NEW.context_submission_id;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO verification_timeline_events (
    verification_id, event_type, actor_type, actor_id, metadata, created_at
  ) VALUES (
    NULL, v_etype, 'SYSTEM', NULL,
    jsonb_build_object(
      'dead_letter_id', NEW.id,
      'job_type', NEW.job_type,
      'retry_count', NEW.retry_count,
      'next_retry_at', NEW.next_retry_at,
      'last_error', NEW.last_error,
      'context_election_id', NEW.context_election_id,
      'context_pu_id', NEW.context_pu_id,
      'context_submission_id', NEW.context_submission_id
    ),
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dead_letter_jobs') THEN
    CREATE TRIGGER trg_dead_letter_timeline
    AFTER INSERT OR UPDATE OF retry_count ON dead_letter_jobs
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_dead_letter_timeline();
  END IF;
END $$;

DROP VIEW IF EXISTS mv_observability_pipeline_dashboard;
CREATE VIEW mv_observability_pipeline_dashboard AS
SELECT
  date_trunc('hour', created_at) AS hour_bucket,
  event_type,
  COUNT(*)::BIGINT AS count
FROM verification_timeline_events
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1, 2
ORDER BY 1, 2;

-- ########## END MIGRATION 4/4 ##########

