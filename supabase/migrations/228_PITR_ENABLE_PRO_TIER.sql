-- ====================================================================
-- ORDER 6/4 (RUN AFTER 227_UPGRADES_PRODUCTION_HARDENING.sql)
-- PITR ENABLEMENT — PRO TIER ONLY (DO NOT RUN ON FREE TIER)
--
-- WARNING: FREE tier Supabase DISABLES PITR, pg_cron schedule retention,
-- and the `pg_switch_wal()` / `pg_create_restore_point()` superuser calls.
-- Running this on FREE tier will produce NOTICEs (not errors) for the
-- guarded sections; the commented ALTER SYSTEM and restore-point examples
-- are safe because they are never executed.
--
-- Prerequisites (Supabase Dashboard, once, before running):
--   1. Billing → Upgrade to PRO tier (paid)
--   2. Project Settings → Database → Point-In-Time Recovery → Enable
--   3. (Optional) Supabase API → confirm extension "pg_cron" is available
-- ====================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== (1) WAL LEVEL CONFIGURATION ===================================
-- NOTE: `wal_level=replica` is the Supabase default on PRO tier; this
-- ALTER SYSTEM call is shown for reference only. On hosted Supabase the
-- parameter is managed by the platform. If self-hosted, uncomment and
-- restart the PostgreSQL cluster afterward for the change to take effect.
--
-- Requires: SUPERUSER + postmaster restart (shared_preload_libraries change
-- implied). Supabase PRO handles this transparently when PITR is toggled.
--
-- ALTER SYSTEM SET wal_level = 'replica';
-- ALTER SYSTEM SET archive_mode = 'on';
-- ALTER SYSTEM SET max_wal_senders = 4;
--
-- After restart verify:
--   SELECT name, setting FROM pg_settings WHERE name IN ('wal_level','archive_mode');

-- ===== (2) PG_CRON PERIODIC WAL ARCHIVE SCHEDULE (PRO TIER) ==========
-- Guard pg_cron behind an IF EXISTS extension check so FREE tier skips
-- silently (Supabase FREE does not permit the pg_cron extension at all).
-- Every 5 minutes force a WAL segment switch so archived segments land in
-- the PITR object store promptly, bounding worst-case data loss to ~5 min
-- of in-flight transactions between segment switches.
--
-- Supabase FREE tier note: pg_cron extension is not available. The schedule
-- will not be registered; rely on the default WAL archival cadence managed
-- by Supabase infrastructure or use an external cron (Vercel / GitHub Actions)
-- to call a SQL endpoint that invokes pg_switch_wal() as a postgres role.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    PERFORM cron.schedule(
      'periodic-archive-WAL-5min',
      '*/5 * * * *',
      $$SELECT pg_switch_wal()$$
    );
    RAISE NOTICE 'pg_cron job "periodic-archive-WAL-5min" scheduled every 5 min — WAL forced archive.';
  ELSE
    RAISE NOTICE 'pg_cron extension NOT installed — periodic WAL archive schedule SKIPPED.';
    RAISE NOTICE 'Enable pg_cron extension on PRO tier, or use external cron (Vercel cron.json) as fallback.';
  END IF;
END $$;

-- ===== (3) RESTORE POINT EXAMPLE (MANUAL INVOCATION) =================
-- Before running any destructive migrations, upgrades, or bulk data
-- changes, create a named restore point so PITR can target exactly that
-- moment. The example below uses a shell command to inject a unix epoch
-- timestamp for uniqueness. Run manually via psql or Supabase SQL Editor
-- as the postgres / superuser role.
--
-- Free tier: pg_create_restore_point() is disabled. Do not attempt.
--
-- Shell one-liner (PRO tier, psql):
--   psql $DATABASE_URL -c "SELECT pg_create_restore_point('pre-upgrade-' || $(date +%s));"
--
-- Equivalent SQL (replace EPOCH manually):
--   SELECT pg_create_restore_point('pre-upgrade-1760000000');
--
-- Verify restore points in the WAL timeline:
--   SELECT name, lsn, time FROM pg_control_checkpoint(), pg_stat_replication;
-- Or list known restore points when recovering:
--   SELECT * FROM pg_catalog.pg_restore_points ORDER BY time DESC LIMIT 20;

-- ===== (4) INFORMATIONAL RECOVERY / WAL STATUS CHECK =================
-- No-op DO block — inspects server state and emits NOTICE messages with
-- the current WAL write position and recovery status. Safe to run on
-- FREE and PRO tiers alike; uses only public built-ins.
DO $$
DECLARE
  v_in_recovery BOOLEAN;
  v_wal_lsn     pg_lsn;
  v_now         TIMESTAMPTZ;
BEGIN
  SELECT pg_is_in_recovery()       INTO v_in_recovery;
  SELECT pg_current_wal_lsn()      INTO v_wal_lsn;
  SELECT clock_timestamp()         INTO v_now;

  RAISE NOTICE '============================================================';
  RAISE NOTICE ' PITR diagnostic snapshot at %', v_now;
  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE ' pg_is_in_recovery()        : %', v_in_recovery;
  IF v_in_recovery THEN
    RAISE NOTICE '  — Server is in STANDBY / recovery mode.';
    RAISE NOTICE '  — PITR replay active; check pg_last_wal_replay_lsn().';
  ELSE
    RAISE NOTICE '  — Server is the PRIMARY writer.';
    RAISE NOTICE '  — PITR restore points can be created on PRO tier.';
  END IF;
  RAISE NOTICE ' pg_current_wal_lsn()       : %', v_wal_lsn;
  RAISE NOTICE ' epoch (unix ts for labels) : %', EXTRACT(EPOCH FROM v_now)::BIGINT;
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Next steps (PRO tier checklist):';
  RAISE NOTICE '  1. Dashboard → Database → PITR: confirm "Enabled".';
  RAISE NOTICE '  2. SELECT * FROM cron.job WHERE jobname = ''periodic-archive-WAL-5min'';';
  RAISE NOTICE '  3. Before next big migration run: SELECT pg_create_restore_point(''pre-X-'');';
  RAISE NOTICE '============================================================';
END $$;
