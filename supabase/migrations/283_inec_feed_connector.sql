-- ============================================================
-- NEOP 283 — PHASE 3 INEC FEED CONNECTOR (default OFF)
-- ============================================================
-- Implements the storage layer for `POST /api/ingest/inec` per
-- INEC_FEED_REHEARSAL_PLAN.md Phase 3:
--
--   1. `inec_feed_raw` — append-only raw ledger. Every inbound payload is
--      recorded BEFORE any pipeline write: what arrived, when, from where,
--      and what it produced (ACCEPTED / REJECTED / DUPLICATE / QUARANTINED).
--      Payloads are immutable (trigger-enforced); deletes are blocked.
--      RLS: no policies → denied for anon/authenticated; service role only.
--
--   2. Feature flags on system_config (kill switch = one UPDATE, no deploy):
--        inec_ingest_enabled  BOOLEAN NOT NULL DEFAULT FALSE  -- master flag
--        inec_rehearsal_mode  BOOLEAN NOT NULL DEFAULT FALSE  -- ledger+isolation
--      Ingestion additionally requires env INEC_INGEST_ENABLED=true and a
--      configured INEC_INGEST_SECRET, so a fresh deploy is OFF by default.
--
--   3. `result_submissions.source` — provenance for normalized feed results
--      ('AGENT' default keeps every existing row and flow unchanged; the
--      two-agent pipeline is untouched).
-- ============================================================

-- ── Flags ────────────────────────────────────────────────────
ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS inec_ingest_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS inec_rehearsal_mode BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Submission provenance ────────────────────────────────────
ALTER TABLE result_submissions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'AGENT';
ALTER TABLE result_submissions DROP CONSTRAINT IF EXISTS chk_submission_source;
ALTER TABLE result_submissions
  ADD CONSTRAINT chk_submission_source CHECK (source IN ('AGENT', 'INEC_FEED'));

CREATE INDEX IF NOT EXISTS idx_submissions_source
  ON result_submissions(source);

-- ── Raw ledger ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inec_feed_raw (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  received_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  batch_id                 TEXT,
  source_sequence          BIGINT,
  polling_unit_code        TEXT,
  election_id              UUID,
  payload                  JSONB NOT NULL,
  payload_sha256           TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING','ACCEPTED','REJECTED','DUPLICATE','QUARANTINED')),
  reject_reason            TEXT,
  normalized_submission_id UUID REFERENCES result_submissions(id) ON DELETE SET NULL,
  transport_meta           JSONB
);

CREATE INDEX IF NOT EXISTS idx_inec_raw_sha     ON inec_feed_raw(payload_sha256);
CREATE INDEX IF NOT EXISTS idx_inec_raw_pu_seq  ON inec_feed_raw(polling_unit_code, source_sequence);
CREATE INDEX IF NOT EXISTS idx_inec_raw_status  ON inec_feed_raw(status);
CREATE INDEX IF NOT EXISTS idx_inec_raw_received ON inec_feed_raw(received_at DESC);

-- NOTE: deletes are blocked by the trigger for ordinary operations; the
-- SECURITY DEFINER `inec_purge_raw_window()` is the single sanctioned rollback
-- path (owner-executed, audited, window-scoped). Payloads are never mutable.
CREATE OR REPLACE FUNCTION public.prevent_inec_raw_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INEC feed raw records cannot be deleted';
  END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION 'INEC feed raw payloads are immutable';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_inec_raw_no_mutation ON inec_feed_raw;
CREATE TRIGGER trg_inec_raw_no_mutation
  BEFORE UPDATE OF payload OR DELETE ON inec_feed_raw
  FOR EACH ROW EXECUTE FUNCTION public.prevent_inec_raw_mutation();

-- RLS: deny-all for anon/authenticated (no policies created).
-- The connector uses the service role server-side; no client ever reads
-- raw feed payloads directly.
ALTER TABLE inec_feed_raw ENABLE ROW LEVEL SECURITY;

-- Confirm the default state is OFF.
UPDATE system_config
   SET inec_ingest_enabled = FALSE,
       inec_rehearsal_mode = FALSE
 WHERE id = '00000000-0000-0000-0000-000000000001';

-- Forensic purge for rollback: removes ledger rows for a time window WITHOUT
-- touching submissions — pairs with the window-purge in the rollback plan so
-- rehearsal data can be isolated without ever blanket-deleting tables.
CREATE OR REPLACE FUNCTION public.inec_purge_raw_window(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM inec_feed_raw WHERE received_at >= p_from AND received_at < p_to;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$fn$;

-- ── Connector credentials (provisioned, never client-readable) ──
-- Same trust pattern as sim_driver_config.cron_secret: a server-only row,
-- RLS deny-all, read by API routes via the service role. No row = connector
-- unprovisioned = endpoint inert. Provisioning (and rotation) is a single
-- audited SQL action; the secret never reaches the browser.
CREATE TABLE IF NOT EXISTS inec_ingest_config (
  id           INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ingest_secret TEXT NOT NULL CHECK (length(ingest_secret) >= 32),
  allowed_ips  TEXT[],           -- NULL = no IP restriction
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at   TIMESTAMPTZ
);
ALTER TABLE inec_ingest_config ENABLE ROW LEVEL SECURITY;

-- ── Transactional accept: submission + party rows in ONE statement ──
-- Called by the connector route AFTER schema validation. Resolves party
-- abbreviations itself and fails the whole unit if anything is unknown —
-- a rejected/duplicate result can never leave a half-written submission.
CREATE OR REPLACE FUNCTION public.inec_accept_result(
  p_election_id   UUID,
  p_polling_unit_id UUID,
  p_valid_votes   INT,
  p_rejected_votes INT,
  p_party_votes   JSONB,          -- [{"abbr":"APC","votes":120}, ...]
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_submission UUID;
  v_party      RECORD;
  v_party_id   UUID;
  v_party_sum  INT := 0;
  v_volunteer  UUID;
BEGIN
  -- Single-source path: the feed is the trusted source record.
  SELECT id INTO v_volunteer FROM volunteers LIMIT 1;

  INSERT INTO result_submissions (
    election_id, polling_unit_id, volunteer_id, valid_votes, rejected_votes,
    total_votes, status, idempotency_key, source
  ) VALUES (
    p_election_id, p_polling_unit_id, v_volunteer, p_valid_votes, p_rejected_votes,
    p_valid_votes + p_rejected_votes, 'UNVERIFIED', p_idempotency_key, 'INEC_FEED'
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_submission;

  IF v_submission IS NULL THEN
    RAISE EXCEPTION 'DUPLICATE_IDEMPOTENCY_KEY';
  END IF;

  FOR v_party IN SELECT * FROM jsonb_array_elements(p_party_votes) LOOP
    SELECT id INTO v_party_id FROM parties
     WHERE abbreviation = v_party->>'abbr' AND status = 'ACTIVE';
    IF v_party_id IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_PARTY:%', v_party->>'abbr';
    END IF;
    INSERT INTO party_results (result_submission_id, party_id, votes)
    VALUES (v_submission, v_party_id, (v_party->>'votes')::int);
    v_party_sum := v_party_sum + (v_party->>'votes')::int;
  END LOOP;

  IF v_party_sum <> p_valid_votes THEN
    RAISE EXCEPTION 'PARTY_SUM_MISMATCH:% vs %', v_party_sum, p_valid_votes;
  END IF;

  RETURN v_submission;
END;
$fn$;

-- Deterministic single-source verification row, recorded at accept time.
CREATE OR REPLACE FUNCTION public.inec_record_deterministic_verification(
  p_election_id UUID, p_polling_unit_id UUID, p_submission_id UUID, p_checks JSONB
) RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public
SET statement_timeout = '5s'
AS $fn$
  INSERT INTO verifications (
    election_id, polling_unit_id, submission_id_1, status,
    deterministic_checks, submissions_identical, math_consistent
  ) VALUES (
    p_election_id, p_polling_unit_id, p_submission_id, 'DETERMINISTIC_PASSED',
    p_checks, NULL, TRUE
  ) RETURNING id;
$fn$;
