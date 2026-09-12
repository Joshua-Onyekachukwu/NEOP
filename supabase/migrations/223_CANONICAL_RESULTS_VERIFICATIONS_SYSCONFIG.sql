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
