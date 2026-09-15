-- ============================================================
-- NEOP 245 — FULL POLLING-UNIT COVERAGE LEDGER
--
-- Principle: EVERY polling unit must be represented and accounted
-- for by a simulation run, but NOT every PU must successfully
-- produce a verified/countable result.
--
--   pu_simulation_status  — one row per (run, PU): the complete universe.
--   simulation_runs       — one row per simulation run (lifecycle).
--   simulation_lock       — single-active-simulation guarantee.
--
-- PU states (mutually exclusive final states reconcile to total):
--   AWAITING              — sim hasn't reached it yet
--   PUBLISHED             — matched, published through the REAL pipeline
--   HUMAN_REVIEW          — agents disagreed (disputed) -> admin queue
--   FAILED_VERIFICATION   — failed verification; votes are NOT countable
--   DISRUPTED             — zero votes recorded (engine models this)
--   UNAVAILABLE           — never reached / no data available
--
-- The outcome assignment mirrors neop_sim_wave's DETERMINISTIC
-- discrepancy pick: hashtext(pu_id || 'd1') & 2147483647 % 1000
-- < dispute_rate*1000 — so ledger counts and engine publishes agree
-- exactly (no double-source drift).
--
-- Failure modes are configurable percentages passed by the admin
-- route; nothing is hard-coded in UI components.
-- ============================================================

-- ── 1. Ledger table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pu_simulation_status (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL,
  polling_unit_id    uuid NOT NULL REFERENCES public.polling_units(id) ON DELETE CASCADE,
  state_id           uuid,
  lga_id             uuid,
  sim_status         text NOT NULL DEFAULT 'AWAITING'
      CHECK (sim_status IN ('AWAITING','SUBMITTED','VERIFICATION_PENDING','PUBLISHED',
                            'HUMAN_REVIEW','FAILED_VERIFICATION','DISRUPTED','UNAVAILABLE','ARCHIVED')),
  planned_published  boolean NOT NULL DEFAULT false,
  outcome_assigned   boolean NOT NULL DEFAULT false,
  published_result_id uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, polling_unit_id)
);
CREATE INDEX IF NOT EXISTS idx_pss_run_status ON public.pu_simulation_status (run_id, sim_status);
CREATE INDEX IF NOT EXISTS idx_pss_state ON public.pu_simulation_status (run_id, state_id);
ALTER TABLE public.pu_simulation_status ENABLE ROW LEVEL SECURITY;

-- ── 2. Run registry ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.simulation_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label              text,
  scenario           text NOT NULL DEFAULT 'landslide',
  status             text NOT NULL DEFAULT 'RUNNING'
      CHECK (status IN ('RUNNING','COMPLETED','STOPPED','FAILED','ARCHIVED')),
  election_id        uuid,
  total_pus          bigint NOT NULL DEFAULT 0,
  published_pus      bigint NOT NULL DEFAULT 0,
  dispute_pus        bigint NOT NULL DEFAULT 0,
  failed_pus         bigint NOT NULL DEFAULT 0,
  disrupted_pus      bigint NOT NULL DEFAULT 0,
  unavailable_pus    bigint NOT NULL DEFAULT 0,
  awaiting_pus       bigint NOT NULL DEFAULT 0,
  other_pus          bigint NOT NULL DEFAULT 0,
  total_votes        bigint NOT NULL DEFAULT 0,
  display_multiplier numeric NOT NULL DEFAULT 1,
  duration_seconds   integer,
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.simulation_runs ENABLE ROW LEVEL SECURITY;

-- ── 3. Single-active lock ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.simulation_lock (
  id        integer PRIMARY KEY,
  locked_at timestamptz,
  run_id    uuid
);
INSERT INTO public.simulation_lock (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- start_simulation_run: acquire lock, archive stale actives,
-- create the run, and materialize the FULL PU universe ledger.
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_simulation_run(
  p_label     text DEFAULT NULL,
  p_scenario  text DEFAULT 'landslide'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run    uuid;
  v_locked integer;
BEGIN
  -- Release locks abandoned by crashed runs (>2h stale)
  UPDATE simulation_lock SET locked_at = NULL, run_id = NULL
   WHERE id = 1 AND locked_at < now() - interval '2 hours';

  UPDATE simulation_lock SET locked_at = now(), run_id = NULL
   WHERE id = 1 AND locked_at IS NULL
   RETURNING 1 INTO v_locked;

  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'Another simulation is active (lock held). Stop or archive it first.';
  END IF;

  -- Archive any lingering ACTIVE/RUNNING runs (never delete history)
  UPDATE simulation_runs SET status = 'ARCHIVED' WHERE status IN ('ACTIVE', 'RUNNING');

  INSERT INTO simulation_runs (label, scenario, status)
  VALUES (p_label, p_scenario, 'RUNNING')
  RETURNING id INTO v_run;

  UPDATE simulation_lock SET run_id = v_run WHERE id = 1;

  -- Ledger materialization is done in chunks by the caller via
  -- materialize_ledger_chunk() so no single statement exceeds even the
  -- tightest role statement_timeout (8s on pooled PostgREST).

  RETURN v_run;
END $fn$;

-- ============================================================
-- materialize_ledger_chunk: copy one slice of the PU universe
-- into the run ledger (AWAITING). Idempotent — already-copied
-- PUs are skipped, so a retried chunk never duplicates rows.
-- Returns how many rows this chunk inserted; the caller loops
-- until 0.
-- ============================================================
CREATE OR REPLACE FUNCTION public.materialize_ledger_chunk(
  p_run        uuid,
  p_after_id   uuid DEFAULT NULL,
  p_chunk      int DEFAULT 20000
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inserted int;
BEGIN
  INSERT INTO pu_simulation_status (run_id, polling_unit_id, state_id, lga_id, sim_status)
  SELECT p_run, pu.id, pu.state_id, pu.lga_id, 'AWAITING'
  FROM polling_units pu
  WHERE (p_after_id IS NULL OR pu.id > p_after_id)
  ORDER BY pu.id
  LIMIT p_chunk
  ON CONFLICT (run_id, polling_unit_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END $fn$;

-- ============================================================
-- assign_simulation_outcomes: configure every PU's realistic fate.
-- Dispute selection mirrors neop_sim_wave EXACTLY (same hash +
-- salt 'd1'), so ledger HUMAN_REVIEW count == engine discrepancy
-- count. Non-covered PU states are FINAL immediately (the engine
-- never touches them); covered PUs are capped at max_published_pct
-- via planned_published (applied progressively by sync).
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_simulation_outcomes(
  p_run                uuid,
  p_dispute_rate       numeric DEFAULT 0.05,
  p_failed_rate        numeric DEFAULT 0.015,
  p_disrupted_rate     numeric DEFAULT 0.02,
  p_unavailable_rate   numeric DEFAULT 0.01,
  p_max_published_pct  numeric DEFAULT 0.95
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_disp int; v_fail int; v_disr int; v_un int; v_covered int;
BEGIN
  -- 1. Disputed (engine-identical pick)
  UPDATE pu_simulation_status s
     SET sim_status = 'HUMAN_REVIEW', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND NOT s.outcome_assigned
     AND ((hashtext(s.polling_unit_id::text || 'd1') & 2147483647) % 1000)
         < ROUND(p_dispute_rate * 1000);
  GET DIAGNOSTICS v_disp = ROW_COUNT;

  -- 2. Failed verification
  UPDATE pu_simulation_status s
     SET sim_status = 'FAILED_VERIFICATION', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND NOT s.outcome_assigned
     AND ((hashtext(s.polling_unit_id::text || 'fv') & 2147483647) % 1000)
         < ROUND(p_failed_rate * 1000);
  GET DIAGNOSTICS v_fail = ROW_COUNT;

  -- 3. Disrupted (engine zeroes these PUs' votes at submission time)
  UPDATE pu_simulation_status s
     SET sim_status = 'DISRUPTED', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND NOT s.outcome_assigned
     AND ((hashtext(s.polling_unit_id::text || 'dz') & 2147483647) % 1000)
         < ROUND(p_disrupted_rate * 1000);
  GET DIAGNOSTICS v_disr = ROW_COUNT;

  -- 4. Unavailable
  UPDATE pu_simulation_status s
     SET sim_status = 'UNAVAILABLE', outcome_assigned = true, updated_at = now()
   WHERE s.run_id = p_run AND NOT s.outcome_assigned
     AND ((hashtext(s.polling_unit_id::text || 'un') & 2147483647) % 1000)
         < ROUND(p_unavailable_rate * 1000);
  GET DIAGNOSTICS v_un = ROW_COUNT;

  -- 5. Publishable set = remainder, capped at max_published_pct
  --    (deterministic pick: hash-salted order, stable across runs)
  WITH pool AS (
    SELECT id, polling_unit_id,
           row_number() OVER (ORDER BY (hashtext(polling_unit_id::text || 'pub') & 2147483647)) AS rn,
           count(*) OVER () AS n
    FROM pu_simulation_status
    WHERE run_id = p_run AND sim_status = 'AWAITING'
  )
  UPDATE pu_simulation_status s
     SET planned_published = true
    FROM pool x
   WHERE s.id = x.id
     AND x.rn <= floor(x.n * LEAST(1.0, GREATEST(0.0, p_max_published_pct)));

  SELECT count(*) INTO v_covered FROM pu_simulation_status
   WHERE run_id = p_run AND (planned_published OR outcome_assigned);

  UPDATE simulation_runs
     SET dispute_pus = v_disp, failed_pus = v_fail,
         disrupted_pus = v_disr, unavailable_pus = v_un
   WHERE id = p_run;

  RETURN jsonb_build_object(
    'run_id', p_run, 'disputed', v_disp, 'failed', v_fail,
    'disrupted', v_disr, 'unavailable', v_un, 'in_engine_scope', v_covered);
END $fn$;

-- ============================================================
-- sync_simulation_progress: called by the engine route each wave;
-- promotes ledger rows whose canonical PUBLISHED result now exists
-- (planned_published), recomputes run counters, flips COMPLETED
-- when nothing is awaiting, releases the lock.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_simulation_progress(
  p_run uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run  uuid := COALESCE(p_run, (SELECT run_id FROM simulation_lock WHERE id = 1 AND locked_at IS NOT NULL));
  v_eid  uuid;
  v_rec  simulation_runs%ROWTYPE;
BEGIN
  IF v_run IS NULL THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT * INTO v_rec FROM simulation_runs WHERE id = v_run;
  IF NOT FOUND THEN RETURN jsonb_build_object('active', false); END IF;
  v_eid := v_rec.election_id;

  -- Promote planned PUs whose PUBLISHED canonical now exists
  IF v_eid IS NOT NULL THEN
    UPDATE pu_simulation_status s
       SET sim_status = 'PUBLISHED', published_result_id = c.id, updated_at = now()
      FROM canonical_pu_results c
     WHERE s.run_id = v_run AND s.planned_published
       AND s.sim_status NOT IN ('PUBLISHED')
       AND c.election_id = v_eid AND c.polling_unit_id = s.polling_unit_id
       AND c.status = 'PUBLISHED';
  END IF;

  UPDATE simulation_runs r SET
    published_pus   = COALESCE(a.pub, 0),
    dispute_pus     = COALESCE(a.hr, r.dispute_pus),
    failed_pus      = COALESCE(a.fv, r.failed_pus),
    disrupted_pus   = COALESCE(a.dz, r.disrupted_pus),
    unavailable_pus = COALESCE(a.un, r.unavailable_pus),
    awaiting_pus    = COALESCE(a.aw, 0),
    other_pus       = COALESCE(a.ot, 0),
    total_votes     = COALESCE(v.votes, 0)
  FROM (SELECT 1) _(x),
  LATERAL (
    SELECT
      count(*) FILTER (WHERE sim_status = 'PUBLISHED') pub,
      count(*) FILTER (WHERE sim_status = 'HUMAN_REVIEW') hr,
      count(*) FILTER (WHERE sim_status = 'FAILED_VERIFICATION') fv,
      count(*) FILTER (WHERE sim_status = 'DISRUPTED') dz,
      count(*) FILTER (WHERE sim_status = 'UNAVAILABLE') un,
      count(*) FILTER (WHERE sim_status = 'AWAITING') aw,
      count(*) FILTER (WHERE sim_status NOT IN ('PUBLISHED','HUMAN_REVIEW','FAILED_VERIFICATION','DISRUPTED','UNAVAILABLE','AWAITING')) ot
    FROM pu_simulation_status WHERE run_id = v_run
  ) a,
  LATERAL (
    SELECT COALESCE(SUM(total_votes), 0) votes FROM canonical_pu_results
    WHERE v_eid IS NOT NULL AND election_id = v_eid AND status = 'PUBLISHED'
  ) v
  WHERE r.id = v_run;

  SELECT * INTO v_rec FROM simulation_runs WHERE id = v_run;

  -- Completion: nothing awaiting and everything planned is published
  IF v_rec.status = 'RUNNING' AND v_rec.awaiting_pus = 0
     AND (SELECT count(*) FROM pu_simulation_status
          WHERE run_id = v_run AND planned_published AND sim_status <> 'PUBLISHED') = 0 THEN
    UPDATE simulation_runs SET status = 'COMPLETED', completed_at = now() WHERE id = v_run;
    UPDATE simulation_lock SET locked_at = NULL, run_id = NULL WHERE id = 1 AND run_id = v_run;
    SELECT * INTO v_rec FROM simulation_runs WHERE id = v_run;
  END IF;

  RETURN jsonb_build_object(
    'active', true, 'run_id', v_run, 'status', v_rec.status,
    'total_pus', v_rec.total_pus, 'published_pus', v_rec.published_pus,
    'dispute_pus', v_rec.dispute_pus, 'failed_pus', v_rec.failed_pus,
    'disrupted_pus', v_rec.disrupted_pus, 'unavailable_pus', v_rec.unavailable_pus,
    'awaiting_pus', v_rec.awaiting_pus, 'other_pus', v_rec.other_pus,
    'total_votes', v_rec.total_votes,
    'accounted_pus', v_rec.total_pus - v_rec.awaiting_pus);
END $fn$;

-- ============================================================
-- get_pu_coverage_summary: THE single source for banner, map
-- legend, state-breakdown coverage columns and admin dashboard.
-- Returns the complete PU universe with every state accounted.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_pu_coverage_summary(
  p_run uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $fn$
WITH params AS (
  SELECT COALESCE(
    p_run,
    (SELECT id FROM simulation_runs WHERE status IN ('RUNNING','COMPLETED','STOPPED')
      ORDER BY started_at DESC LIMIT 1)
  ) AS rid
),
run AS (
  SELECT r.*, (SELECT display_multiplier FROM system_config WHERE id = '00000000-0000-0000-0000-000000000001') AS dm
  FROM simulation_runs r, params p
  WHERE r.id = p.rid
),
agg AS (
  SELECT
    count(*)                                              AS total_pus,
    count(*) FILTER (WHERE sim_status = 'PUBLISHED')      AS published_pus,
    count(*) FILTER (WHERE sim_status = 'HUMAN_REVIEW')   AS dispute_pus,
    count(*) FILTER (WHERE sim_status = 'FAILED_VERIFICATION') AS failed_pus,
    count(*) FILTER (WHERE sim_status = 'DISRUPTED')      AS disrupted_pus,
    count(*) FILTER (WHERE sim_status = 'UNAVAILABLE')    AS unavailable_pus,
    count(*) FILTER (WHERE sim_status = 'AWAITING')       AS awaiting_pus,
    count(*) FILTER (WHERE sim_status NOT IN ('PUBLISHED','HUMAN_REVIEW','FAILED_VERIFICATION','DISRUPTED','UNAVAILABLE','AWAITING')) AS other_pus
  FROM pu_simulation_status, params WHERE run_id = params.rid
),
state_agg AS (
  SELECT s.state_id, st.name AS state_name, st.code AS state_code,
    count(*) AS total_pus,
    count(*) FILTER (WHERE pss.sim_status = 'PUBLISHED') AS published,
    count(*) FILTER (WHERE pss.sim_status = 'HUMAN_REVIEW') AS disputed,
    count(*) FILTER (WHERE pss.sim_status = 'FAILED_VERIFICATION') AS failed,
    count(*) FILTER (WHERE pss.sim_status = 'DISRUPTED') AS disrupted,
    count(*) FILTER (WHERE pss.sim_status = 'UNAVAILABLE') AS unavailable,
    count(*) FILTER (WHERE pss.sim_status = 'AWAITING') AS awaiting
  FROM pu_simulation_status pss
  JOIN states st ON st.id = pss.state_id, params
  WHERE pss.run_id = params.rid
  GROUP BY s.state_id, st.name, st.code
)
SELECT jsonb_build_object(
  'active', (SELECT count(*) FROM run) > 0,
  'run_id',        (SELECT id FROM run),
  'run_status',    (SELECT status FROM run),
  'scenario',      (SELECT scenario FROM run),
  'label',         (SELECT label FROM run),
  'election_id',   (SELECT election_id FROM run),
  'started_at',    (SELECT started_at FROM run),
  'completed_at',  (SELECT completed_at FROM run),
  'display_multiplier', (SELECT dm FROM run),
  'total_pus',          (SELECT total_pus FROM agg),
  'published_pus',      (SELECT published_pus FROM agg),
  'dispute_pus',        (SELECT dispute_pus FROM agg),
  'failed_pus',         (SELECT failed_pus FROM agg),
  'disrupted_pus',      (SELECT disrupted_pus FROM agg),
  'unavailable_pus',    (SELECT unavailable_pus FROM agg),
  'awaiting_pus',       (SELECT awaiting_pus FROM agg),
  'other_pus',          (SELECT other_pus FROM agg),
  'accounted_pus', (SELECT total_pus - awaiting_pus FROM agg),
  'total_votes',   (SELECT total_votes FROM simulation_runs WHERE id = (SELECT id FROM run)),
  'coverage_percent', CASE WHEN (SELECT total_pus FROM agg) > 0
        THEN round(((SELECT total_pus - awaiting_pus FROM agg)::numeric
                    / (SELECT total_pus FROM agg)) * 100, 1) END,
  'published_percent', CASE WHEN (SELECT total_pus FROM agg) > 0
        THEN round(((SELECT published_pus FROM agg)::numeric
                    / (SELECT total_pus FROM agg)) * 100, 1) END,
  'state_breakdown', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'state_id', state_id, 'state_name', state_name, 'state_code', state_code,
      'total_pus', total_pus, 'published', published, 'disputed', disputed,
      'failed', failed, 'disrupted', disrupted, 'unavailable', unavailable,
      'awaiting', awaiting,
      'accounted', total_pus - awaiting,
      'published_percent', round((published::numeric / total_pus) * 100, 1)
    ) ORDER BY total_pus DESC)
    FROM state_agg), '[]'::jsonb)
)
FROM params
$fn$;

GRANT EXECUTE ON FUNCTION public.get_pu_coverage_summary(uuid) TO anon, authenticated;

-- ============================================================
-- stop_simulation_run: admin stop. Marks the run STOPPED and
-- records every PU the engine never reached as UNAVAILABLE so
-- the final state still accounts for 100% of the universe.
-- ============================================================
CREATE OR REPLACE FUNCTION public.stop_simulation_run(p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_run uuid := COALESCE(p_run, (SELECT run_id FROM simulation_lock WHERE id = 1 AND locked_at IS NOT NULL));
BEGIN
  IF v_run IS NULL THEN RETURN jsonb_build_object('stopped', false, 'reason', 'no active run'); END IF;
  UPDATE pu_simulation_status SET sim_status = 'UNAVAILABLE', outcome_assigned = true, updated_at = now()
   WHERE run_id = v_run AND sim_status = 'AWAITING' AND NOT outcome_assigned;
  UPDATE simulation_runs SET status = 'STOPPED', completed_at = now() WHERE id = v_run AND status = 'RUNNING';
  UPDATE simulation_lock SET locked_at = NULL, run_id = NULL WHERE id = 1 AND run_id = v_run;
  RETURN jsonb_build_object('stopped', true, 'run_id', v_run);
END $fn$;

-- ============================================================
-- purge_simulation_run: explicit admin cleanup. Deletes ONLY the
-- named run's ledger + simulation election data (submissions,
-- canonicals, party rows, verifications, agents, assignments,
-- dead-letter jobs, the [SIM] election row). Never touches real
-- elections, users, audit logs, or system_config.
-- ============================================================
CREATE OR REPLACE FUNCTION public.purge_simulation_run(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_eid uuid; v_ledger bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM simulation_runs WHERE id = p_run) THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'unknown run');
  END IF;
  SELECT election_id INTO v_eid FROM simulation_runs WHERE id = p_run;

  IF v_eid IS NOT NULL THEN
    DELETE FROM dead_letter_jobs WHERE context_election_id = v_eid;
    DELETE FROM verifications WHERE election_id = v_eid;
    DELETE FROM canonical_party_results WHERE election_id = v_eid;
    DELETE FROM canonical_pu_results WHERE election_id = v_eid;
    DELETE FROM result_submissions WHERE election_id = v_eid;
    DELETE FROM agent_assignments WHERE election_id = v_eid;
    DELETE FROM user_accounts WHERE email LIKE 'sim_obs_%';
    DELETE FROM elections WHERE id = v_eid;
  END IF;

  DELETE FROM pu_simulation_status WHERE run_id = p_run;
  GET DIAGNOSTICS v_ledger = ROW_COUNT;
  DELETE FROM simulation_runs WHERE id = p_run;
  UPDATE simulation_lock SET locked_at = NULL, run_id = NULL WHERE id = 1 AND run_id = p_run;

  RETURN jsonb_build_object('purged', true, 'run_id', p_run, 'election_id', v_eid, 'ledger_rows', v_ledger);
END $fn$;

-- Applied live 2026-09-15: server-side role timeouts. PostgREST runs every
-- request as role "authenticator" (statement_timeout=8s, set on the host
-- project) and then SET ROLEs to the request role — the 8s leaked onto
-- service-role calls, which broke heavy ledger writes (migration 245).
-- service_role is a trusted, server-only role, so it gets a generous but
-- bounded timeout; user-facing roles keep the platform defaults.
ALTER ROLE service_role SET statement_timeout = '120s';

-- Belt-and-braces: function-local timeouts so heavy ledger RPCs finish
-- even on a connection whose role default is tighter than needed.
ALTER FUNCTION public.assign_simulation_outcomes(uuid, numeric, numeric, numeric, numeric, numeric) SET statement_timeout = '60s';
ALTER FUNCTION public.sync_simulation_progress(uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.get_pu_coverage_summary(uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.materialize_ledger_chunk(uuid, uuid, int) SET statement_timeout = '60s';
ALTER FUNCTION public.stop_simulation_run(uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.purge_simulation_run(uuid) SET statement_timeout = '120s';
