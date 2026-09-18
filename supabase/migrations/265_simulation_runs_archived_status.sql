-- ============================================================
-- NEOP 265 — ALLOW THE ARCHIVED RUN STATUS
-- ============================================================
--
-- DEFECT
--   start_simulation_run() ends its takeover path with:
--
--       UPDATE simulation_runs
--       SET status = 'ARCHIVED'
--       WHERE status IN ('ACTIVE', 'RUNNING');
--
--   but simulation_runs_status_check did not permit 'ARCHIVED':
--
--       CREATED, QUEUED, RUNNING, COMPLETED, PUBLISHED,
--       FAILED, STOPPED, CANCELLED
--
--   So ANY attempt to start a simulation while another run is still
--   RUNNING failed with a cryptic constraint error:
--
--       23514 new row for relation "simulation_runs" violates check
--       constraint "simulation_runs_status_check"
--
--   Because the whole function is one transaction, the lock it had
--   just taken was rolled back too — which is why the admin saw a
--   Launch that hung and then reported a network error rather than a
--   usable message, and why retrying could not recover the lock.
--
-- FIX
--   Admit 'ARCHIVED' (and 'ACTIVE', which the function filters on) to
--   the status domain. The constraint stays NOT VALID to preserve the
--   existing enforcement semantics, so this migration cannot fail on
--   historical rows.
-- ============================================================

ALTER TABLE public.simulation_runs
  DROP CONSTRAINT IF EXISTS simulation_runs_status_check;

ALTER TABLE public.simulation_runs
  ADD CONSTRAINT simulation_runs_status_check
  CHECK (status = ANY (ARRAY[
    'CREATED'::text,
    'QUEUED'::text,
    'ACTIVE'::text,
    'RUNNING'::text,
    'COMPLETED'::text,
    'PUBLISHED'::text,
    'FAILED'::text,
    'STOPPED'::text,
    'CANCELLED'::text,
    'ARCHIVED'::text
  ])) NOT VALID;

-- Self-test: the takeover path must now be expressible.
DO $do$
DECLARE
  v_tmp uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.simulation_runs (id, label, scenario, status)
  VALUES (v_tmp, '__neop265_selftest__', 'landslide', 'RUNNING');

  -- The exact statement start_simulation_run() performs.
  UPDATE public.simulation_runs SET status = 'ARCHIVED' WHERE id = v_tmp;

  DELETE FROM public.simulation_runs WHERE id = v_tmp;
  RAISE NOTICE 'ARCHIVED status accepted — takeover path unblocked';
END
$do$;
