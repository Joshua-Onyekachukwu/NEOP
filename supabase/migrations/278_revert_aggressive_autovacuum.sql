-- ============================================================
-- NEOP 278 — REVERT THE AUTOVACUUM THRASH INTRODUCED BY 275
-- ============================================================
--
-- SYMPTOM
--   2026-09-21, after the queue had drained and the run was PUBLISHED:
--   the instance stopped answering even trivial statements. The Postgres
--   logs show `57014 statement_timeout` on queries that cannot possibly
--   be slow:
--
--     SET client_encoding = 'UTF8'; SET client_min_messages TO WARNING;
--     SELECT setting FROM pg_settings WHERE name = 'max_connections';
--     select set_config('search_path', $1, true), set_config('role', ...)
--
--   and every public RPC (get_election_summary, get_pu_coverage_summary,
--   get_map_status_changes, get_fast_stats) timed out. The public site
--   then correctly degraded to zeros, which reads as "the results
--   vanished" even though nothing touched the data.
--
-- ROOT CAUSE
--   Migration 275 added, as an aside to fixing the stale visibility map:
--
--     ALTER TABLE party_results SET (
--       autovacuum_vacuum_threshold = 50,
--       autovacuum_vacuum_scale_factor = 0.0, ...);
--
--   `threshold = 50` with `scale_factor = 0` means "vacuum after 50 dead
--   tuples, whatever the table's size". party_results holds millions of
--   rows and is the single hottest write target of the wave engine
--   (every submission allocates ~9 party rows and every re-derivation
--   rewrites them), so autovacuum was launching a full-table vacuum
--   roughly continuously. On a micro-tier instance that consumes the
--   entire I/O and CPU budget: the vacuum never finishes before the next
--   threshold is crossed, and unrelated client statements queue behind it
--   until they hit their statement timeout.
--
--   The visibility-map problem 275 was actually trying to solve is real
--   (a stale VM turned a 176k-row count(*) into 155k heap fetches), but
--   the cure has to keep autovacuum on its normal scale factor so it runs
--   occasionally rather than constantly.
--
-- FIX
--   Reset all five tables to the instance defaults, then re-apply only the
--   part that was genuinely useful: a modest scale factor so these tables
--   are vacuumed somewhat more eagerly than the default 0.20 — not after
--   50 rows.
-- ============================================================

DO $do$
DECLARE
  t text;
  v_tables text[] := ARRAY[
    'polling_units',
    'pu_simulation_status',
    'party_results',
    'canonical_party_results',
    'result_submissions'
  ];
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t
    ) THEN
      -- Back to instance defaults first, so a table that was never touched
      -- by 275 is also normalised.
      EXECUTE format(
        'ALTER TABLE public.%I RESET (autovacuum_vacuum_threshold, '
        'autovacuum_vacuum_scale_factor, autovacuum_analyze_threshold, '
        'autovacuum_analyze_scale_factor)', t);

      -- Eager, but bounded: vacuum at 5% dead tuples (vs the 20% default)
      -- and never before 1000 rows. analyze at 2%.
      EXECUTE format(
        'ALTER TABLE public.%I SET (autovacuum_vacuum_scale_factor = 0.05, '
        'autovacuum_vacuum_threshold = 1000, '
        'autovacuum_analyze_scale_factor = 0.02, '
        'autovacuum_analyze_threshold = 1000)', t);

      RAISE NOTICE 'autovacuum normalised on public.%', t;
    ELSE
      RAISE NOTICE 'skipped (absent): public.%', t;
    END IF;
  END LOOP;
END
$do$;

-- ------------------------------------------------------------
-- The simulation driver must never be able to starve the public API
-- again. 275 scheduled it at `30 seconds` with a 75 s budget, i.e. a
-- duty cycle above 100%: each invocation runs longer than the gap to
-- the next, so the instance is permanently inside a wave. The queue is
-- durable and every step is idempotent, so a slower cadence costs only
-- wall-clock time on a run — it cannot lose work.
--
-- 45 s cadence with a 40 s budget keeps the duty cycle under 100% and
-- leaves the API room to answer.
-- ------------------------------------------------------------
DO $do$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'neop-sim-driver' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'pg_cron not installed — skipping driver reschedule';
END
$do$;

DO $do$
BEGIN
  PERFORM cron.schedule('neop-sim-driver', '45 seconds',
                        'SELECT public.neop_sim_tick_local(2, 40000)');
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'pg_cron not installed — driver not scheduled';
END
$do$;
