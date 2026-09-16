-- ============================================================
-- NEOP 251 — DB-BASED SIMULATION STEP QUEUE (Vercel-safe engine)
--
-- Problem: the wave loop lived in a Vercel serverless function. The
-- platform reclaims the function after ~60s of wall time, so multi-
-- minute production simulations always died mid-run ("run stuck at 0
-- published" on the live site).
--
-- Fix: move the loop's state INTO the database.
--   • sim_run_steps: one row per unit of engine work (init chunk,
--     ledger chunk, wave data chunk), parameters included.
--   • claim_simulation_step(): atomically claims the next step
--     (SKIP LOCKED => two ticks never grab the same step).
--   • complete_simulation_step(): records the outcome.
--   • The route (/api/admin/simulate/tick) claims one step per
--     invocation, runs it, completes it. Vercel cron hits the tick
--     endpoint every minute; each HTTP call is short-lived. A run
--     therefore survives ANY number of cold starts, because every
--     step is idempotent and the queue state is durable.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sim_run_steps (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id       UUID NOT NULL REFERENCES public.simulation_runs(id) ON DELETE CASCADE,
  seq          INT  NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('INIT','LEDGER','WAVE')),
  wave_index   INT,
  chunk_index  INT,
  chunk_count  INT,
  coverage_pct INT,
  status       TEXT NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
  attempts     INT  NOT NULL DEFAULT 0,
  claimed_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  result       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_sim_run_steps_claim
  ON public.sim_run_steps (status, run_id, seq);

-- ------------------------------------------------------------
-- claim_simulation_step: atomically move the oldest PENDING step of
-- the ACTIVE run to RUNNING. Returns NULL if nothing to claim.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_simulation_step(p_run UUID DEFAULT NULL)
RETURNS public.sim_run_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $fn$
DECLARE
  v_run  UUID := p_run;
  v_step public.sim_run_steps;
BEGIN
  IF v_run IS NULL THEN
    SELECT id INTO v_run FROM simulation_runs
     WHERE status = 'RUNNING' ORDER BY started_at DESC LIMIT 1;
    IF v_run IS NULL THEN RETURN NULL; END IF;
  END IF;

  SELECT * INTO v_step FROM sim_run_steps
   WHERE run_id = v_run AND status = 'PENDING'
   ORDER BY seq LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE sim_run_steps
     SET status = 'RUNNING', attempts = attempts + 1,
         claimed_at = NOW(), result = NULL
   WHERE id = v_step.id;

  RETURN v_step;
END;
$fn$;

-- ------------------------------------------------------------
-- complete_simulation_step
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_simulation_step(
  p_step_id BIGINT,
  p_ok BOOLEAN,
  p_result JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $fn$
BEGIN
  UPDATE sim_run_steps
     SET status = CASE WHEN p_ok THEN 'DONE' ELSE 'FAILED' END,
         finished_at = NOW(),
         result = CASE WHEN p_ok THEN p_result ELSE result END
   WHERE id = p_step_id;
END;
$fn$;

-- ------------------------------------------------------------
-- enqueue_simulation_run: build the full step plan for a new run.
-- Ledger chunks are derived from the actual universe size.
-- NOTE: reuse of neop_sim_wave per step keeps every step idempotent —
-- a step that runs twice (retry after cold start) cannot double-
-- publish because publish_canonical_result is guarded per PU.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_simulation_run(
  p_run UUID,
  p_scenario TEXT,
  p_target_voters BIGINT,
  p_waves INT,
  p_discrepancy_rate NUMERIC,
  p_coverage_pct INT,
  p_ledger_chunks INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $fn$
DECLARE
  v_seq INT := 0;
  v_data_chunks CONSTANT INT := 24;
  v_ledger_i INT;
  v_wave_i INT;
  v_chunk_i INT;
BEGIN
  DELETE FROM sim_run_steps WHERE run_id = p_run;

  -- Ledger materialization chunks (route counts ~9 needed for 176,846 PUs)
  FOR v_ledger_i IN 0 .. GREATEST(0, p_ledger_chunks - 1) LOOP
    v_seq := v_seq + 1;
    INSERT INTO sim_run_steps (run_id, seq, kind, chunk_index, chunk_count, coverage_pct)
    VALUES (p_run, v_seq, 'LEDGER', v_ledger_i, p_ledger_chunks, p_coverage_pct);
  END LOOP;

  -- Wave data chunks
  FOR v_wave_i IN 0 .. p_waves - 1 LOOP
    FOR v_chunk_i IN 0 .. v_data_chunks - 1 LOOP
      v_seq := v_seq + 1;
      INSERT INTO sim_run_steps (run_id, seq, kind, wave_index, chunk_index, chunk_count, coverage_pct)
      VALUES (p_run, v_seq, 'WAVE', v_wave_i, v_chunk_i, v_data_chunks, p_coverage_pct);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('run_id', p_run, 'steps', v_seq);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.claim_simulation_step(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_simulation_step(BIGINT, BOOLEAN, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_simulation_run(UUID, TEXT, BIGINT, INT, NUMERIC, INT, INT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_simulation_step(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_simulation_step(BIGINT, BOOLEAN, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_simulation_run(UUID, TEXT, BIGINT, INT, NUMERIC, INT, INT) FROM PUBLIC, anon, authenticated;
