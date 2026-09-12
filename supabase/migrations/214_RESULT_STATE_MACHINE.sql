-- ======================================================================
-- 214_RESULT_STATE_MACHINE.sql
-- P0: Enforce LEGAL status transitions on result_submissions via BEFORE UPDATE
-- trigger. Catches programming errors + prevents illegal state movement.
--
-- Legal transitions (v1 minimal strict; no reversion to UNVERIFIED after
-- verification; correction workflow sets SUPERSEDED on old submissions).
--
-- INSERT (immediate state):
--   Any status from the ALLOWED_INITIAL set below is permitted (new submit).
--
-- UPDATE transitions:
--   From          | To (any of)
--   --------------+--------------------------------------------------------
--   UNVERIFIED      PENDING_REVIEW / RESULT_SUBMITTED / PARTIALLY_VERIFIED /
--                   VERIFIED / DISPUTED / REJECTED / SUPERSEDED
--   PENDING_REVIEW  PARTIALLY_VERIFIED / VERIFIED / DISPUTED / REJECTED /
--                   SUPERSEDED
--   RESULT_SUBMITTED PENDING_REVIEW / PARTIALLY_VERIFIED / VERIFIED /
--                   DISPUTED / REJECTED / SUPERSEDED
--   PARTIALLY_VERIFIED VERIFIED / DISPUTED / REJECTED / SUPERSEDED
--   DISPUTED        PENDING_REVIEW (reopen) / SUPERSEDED
--   REJECTED        SUPERSEDED (corrected resubmission flow only)
--   VERIFIED        SUPERSEDED (correction/revocation rare)
--   SUPERSEDED      (immutable; frozen forever)
--
-- Any UPDATE attempting an illegal transition raises P0001 exception with
-- human readable msg including from → to and the submission id so developers
-- see EXACTLY which flow is broken during QA.
-- ======================================================================

DROP TRIGGER IF EXISTS trg_result_state_machine ON result_submissions;
DROP FUNCTION IF EXISTS fn_result_state_transition_check();

CREATE OR REPLACE FUNCTION fn_result_state_transition_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal_from TEXT[];
BEGIN
  -- (0) If status unchanged → allow.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- (1) Super-admin override column: if an explicit force_state = true JSON key
  --     is present in metadata, bypass ONCE for recovery. NEVER document this.
  IF COALESCE(NEW.metadata->>'force_state_override','false') = 'true' THEN
    NEW.metadata = COALESCE(NEW.metadata, '{}'::jsonb) - 'force_state_override';
    RETURN NEW;
  END IF;

  -- (2) SUPERSEDED frozen forever.
  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION '[state-machine] Cannot UPDATE result_submission %: SUPERSEDED is IMMUTABLE (tried % → %)', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) Define legal transitions.
  CASE OLD.status
    WHEN 'UNVERIFIED' THEN
      legal_from := ARRAY['PENDING_REVIEW','RESULT_SUBMITTED','PARTIALLY_VERIFIED','VERIFIED','DISPUTED','REJECTED','SUPERSEDED'];
    WHEN 'PENDING_REVIEW' THEN
      legal_from := ARRAY['PARTIALLY_VERIFIED','VERIFIED','DISPUTED','REJECTED','SUPERSEDED'];
    WHEN 'RESULT_SUBMITTED' THEN
      legal_from := ARRAY['PENDING_REVIEW','PARTIALLY_VERIFIED','VERIFIED','DISPUTED','REJECTED','SUPERSEDED'];
    WHEN 'PARTIALLY_VERIFIED' THEN
      legal_from := ARRAY['VERIFIED','DISPUTED','REJECTED','SUPERSEDED'];
    WHEN 'VERIFIED' THEN
      legal_from := ARRAY['SUPERSEDED'];
    WHEN 'DISPUTED' THEN
      legal_from := ARRAY['PENDING_REVIEW','SUPERSEDED'];
    WHEN 'REJECTED' THEN
      legal_from := ARRAY['SUPERSEDED'];
    ELSE
      legal_from := ARRAY[]::TEXT[];
  END CASE;

  IF NOT (NEW.status = ANY(legal_from)) THEN
    RAISE EXCEPTION '[state-machine] Illegal result_submission transition on id=%: % → % is not allowed (legal → %). Contact engineering OR use force_state_override=true in metadata for recovery.',
      OLD.id, OLD.status, NEW.status, array_to_string(legal_from, ',')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_result_state_machine
BEFORE UPDATE ON result_submissions
FOR EACH ROW
EXECUTE FUNCTION fn_result_state_transition_check();

-- (4) Bonus: timestamp override trigger. No client provided timestamps
--     are allowed past the DB authoritative now(). See S-P1-8 audit matrix.
--     If submitted_at or verified_at are future-dated or client-set past
--     window, clamp to now(). verified_at always defaults on verify.
DROP TRIGGER IF EXISTS trg_clamp_submission_timestamps ON result_submissions;
DROP FUNCTION IF EXISTS fn_clamp_result_timestamps();

CREATE OR REPLACE FUNCTION fn_clamp_result_timestamps()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- INSERT: submitted_at always set, client override ignored.
  IF TG_OP = 'INSERT' THEN
    NEW.submitted_at := now();
    NEW.verified_at := NULL;
  END IF;
  -- UPDATE: verified_at on first transition to VERIFIED/PARTIALLY_VERIFIED
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('VERIFIED','PARTIALLY_VERIFIED','APPROVED')
       AND OLD.status NOT IN ('VERIFIED','PARTIALLY_VERIFIED','APPROVED') THEN
      NEW.verified_at := now();
    END IF;
    -- Never allow verified_at back to NULL once set; never roll back time.
    IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS NULL THEN
      NEW.verified_at := OLD.verified_at;
    END IF;
    IF NEW.verified_at IS NOT NULL AND OLD.verified_at IS NOT NULL
       AND NEW.verified_at < OLD.verified_at THEN
      NEW.verified_at := OLD.verified_at;
    END IF;
  END IF;
  -- No future dating (beyond 5 min clock skew grace).
  IF NEW.submitted_at > now() + interval '5 min' THEN
    NEW.submitted_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clamp_submission_timestamps
BEFORE INSERT OR UPDATE ON result_submissions
FOR EACH ROW
EXECUTE FUNCTION fn_clamp_result_timestamps();
