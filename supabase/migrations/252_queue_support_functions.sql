-- ============================================================
-- NEOP 252 — SUPPLEMENTARY QUEUE SUPPORT FUNCTIONS
--
-- Captures in version control two SECURITY DEFINER helpers that
-- were applied directly to the live database during the queue
-- build (they were missing from migration 251):
--
--   • reclaim_stale_steps: returns steps stuck in RUNNING (executor
--     died mid-flight — cold start, crash) to PENDING so the next
--     tick retries them. Every step is idempotent, so a re-run
--     cannot double-publish.
--   • materialize_ledger_hash_chunk: hash-partitioned ledger chunk
--     inserter. Unlike the cursor-based materialize_ledger_chunk,
--     each call is self-contained (no server-side cursor state),
--     so it is safe under cold starts and concurrent ticks.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reclaim_stale_steps(
  p_older_than_seconds INT DEFAULT 180
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $fn$
DECLARE v_n INT;
BEGIN
  UPDATE sim_run_steps
     SET status = 'PENDING', claimed_at = NULL
   WHERE status = 'RUNNING'
     AND claimed_at < NOW() - make_interval(secs => p_older_than_seconds);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- ------------------------------------------------------------
-- Hash-partitioned ledger chunk: (hashtext(pu_id) & 2147483647)
-- % p_chunks == p_chunk. Matches the engine scope predicate used
-- by assign_simulation_outcomes and neop_sim_wave, so the ledger
-- universe and the engine's publishable set are identical.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.materialize_ledger_hash_chunk(
  p_run UUID,
  p_chunk INT,
  p_chunks INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $fn$
DECLARE v_inserted INT;
BEGIN
  INSERT INTO pu_simulation_status (run_id, polling_unit_id, state_id, lga_id, sim_status)
  SELECT p_run, pu.id, pu.state_id, pu.lga_id, 'AWAITING'
  FROM polling_units pu
  WHERE ((hashtext(pu.id::text) & 2147483647) % GREATEST(1, p_chunks)) = p_chunk
  ON CONFLICT (run_id, polling_unit_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$fn$;

-- ------------------------------------------------------------
-- retry_failed_steps: return FAILED steps to PENDING so the next
-- tick retries them (bounded by attempts). Steps are idempotent,
-- so a retry cannot double-publish. Covers transient failures
-- such as gateway timeouts or races with reset_first.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_failed_steps(
  p_max_attempts INT DEFAULT 4
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $fn$
DECLARE v_n INT;
BEGIN
  UPDATE sim_run_steps
     SET status = 'PENDING', claimed_at = NULL, result = NULL
   WHERE status = 'FAILED'
     AND attempts < p_max_attempts;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.reclaim_stale_steps(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_failed_steps(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.materialize_ledger_hash_chunk(UUID, INT, INT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reclaim_stale_steps(INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.retry_failed_steps(INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.materialize_ledger_hash_chunk(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
