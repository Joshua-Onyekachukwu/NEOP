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

CREATE TRIGGER trg_dead_letter_timeline
AFTER INSERT OR UPDATE OF retry_count ON dead_letter_jobs
FOR EACH ROW
EXECUTE FUNCTION fn_trg_dead_letter_timeline();

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
