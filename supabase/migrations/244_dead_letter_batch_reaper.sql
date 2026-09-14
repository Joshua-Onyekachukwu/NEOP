-- ============================================================
-- NEOP 244 — DEAD-LETTER BATCH REAPER + pg_cron SCHEDULE
--
-- Migration 224 shipped the dead_letter_jobs table, enqueue_dead_letter()
-- and per-job process_dead_letter_retry(p_id uuid) — but no batch
-- processor. The intended hourly Vercel cron called an RPC with the
-- wrong signature (batch_size) and has been erroring 500 since it
-- shipped; and Vercel Hobby plans reject hourly crons at deploy time.
--
-- This migration ships the missing batch reaper:
--   process_dead_letter_batch(p_limit int) → jsonb
--   • claims due PENDING/RETRYING jobs (FOR UPDATE SKIP LOCKED)
--   • per job: mark RETRYING → re-enqueue payload via
--     enqueue_dead_letter (fresh backoff + retries) → process the new
--     job id → on success mark COMPLETED; on failure mark FAILED when
--     retries exhausted (inherits backoff/retry semantics from 224)
--   • never raises; returns {processed, completed, failed, results}
--
-- Scheduling lives in-database via pg_cron (present on Supabase,
-- plan-independent) — the Vercel cron in apps/web/vercel.json was
-- removed as Hobby-incompatible and redundant.
-- ============================================================

CREATE OR REPLACE FUNCTION process_dead_letter_batch(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed int := 0;
  v_completed int := 0;
  v_failed int := 0;
  v_row record;
  v_res jsonb;
  v_new_id uuid;
  v_exhausted boolean;
BEGIN
  FOR v_row IN
    SELECT id, job_type, payload
    FROM dead_letter_jobs
    WHERE status IN ('PENDING','RETRYING')
      AND next_retry_at <= now()
    ORDER BY next_retry_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;
    v_new_id := NULL;

    BEGIN
      UPDATE dead_letter_jobs
      SET status = 'RETRYING'
      WHERE id = v_row.id;

      -- Re-enqueue a fresh attempt: applies fresh backoff + retry budget
      -- and returns the new job's id (284: enqueue_dead_letter RETURNS uuid).
      SELECT dl.id INTO v_new_id
      FROM enqueue_dead_letter(
        v_row.job_type,
        COALESCE(v_row.payload, '{}'::jsonb),
        'batch reaper retry (prev: ' || COALESCE(v_row.id::text, '?') || ')',
        3,
        NULL::uuid, NULL::uuid, NULL::uuid
      ) AS dl(id);

      -- Immediately advance the fresh job one attempt.
      IF v_new_id IS NOT NULL THEN
        v_res := process_dead_letter_retry(v_new_id);
      END IF;

      -- FAILED only when the retry budget is now exhausted.
      SELECT (retry_count >= max_retries) INTO v_exhausted
      FROM dead_letter_jobs WHERE id = COALESCE(v_new_id, v_row.id);
      v_exhausted := COALESCE(v_exhausted, false);

      IF COALESCE(v_res ->> 'status', '') = 'COMPLETED' THEN
        v_completed := v_completed + 1;
        UPDATE dead_letter_jobs SET status = 'COMPLETED'
        WHERE id = v_row.id;
      ELSIF v_exhausted THEN
        v_failed := v_failed + 1;
        UPDATE dead_letter_jobs SET status = 'FAILED'
        WHERE id = v_row.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE dead_letter_jobs
      SET last_error = left(SQLERRM, 500)
      WHERE id = v_row.id;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'completed', v_completed,
    'failed', v_failed
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION process_dead_letter_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_dead_letter_batch(integer) TO service_role, postgres;

-- Idempotent pg_cron schedule (the original 227 design, now with a real
-- batch function to call). Runs every 10 minutes in the postgres DB.
DO $outer$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'dead-letter-reaper-10min';
  IF v_count = 0 THEN
    PERFORM cron.schedule(
      'dead-letter-reaper-10min',
      '*/10 * * * *',
      $$SELECT public.process_dead_letter_batch(50)$$
    );
  END IF;
END $outer$;
