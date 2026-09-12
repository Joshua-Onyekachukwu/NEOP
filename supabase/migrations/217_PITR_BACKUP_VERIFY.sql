-- 217 — DIAGNOSTIC: Backup / PITR / WAL status check
-- Verifies election-tomorrow recovery-readiness
-- Result is RAISE NOTICE output only; no schema changes

SET search_path = public;

DO $$
DECLARE
  v_archive_mode   TEXT;
  v_archive_cmd    TEXT;
  v_wal_level      TEXT;
  v_max_wal        TEXT;
  v_now            TIMESTAMPTZ := now();
  v_supa_schema    TEXT;
  v_db_size        TEXT;
  v_role           TEXT;
BEGIN
  -- 1. Archive mode = PITR on/off
  SELECT setting INTO v_archive_mode FROM pg_settings WHERE name = 'archive_mode';
  SELECT setting INTO v_archive_cmd  FROM pg_settings WHERE name = 'archive_command';
  SELECT setting INTO v_wal_level    FROM pg_settings WHERE name = 'wal_level';
  SELECT setting INTO v_max_wal      FROM pg_settings WHERE name = 'max_wal_senders';

  -- 2. Database size (sanity-check that prod-like)
  SELECT pg_size_pretty(pg_database_size(current_database())) INTO v_db_size;

  -- 3. Check if Supabase-managed internal schemas exist (indicates project fully provisioned)
  SELECT schema_name INTO v_supa_schema FROM information_schema.schemata
   WHERE schema_name IN ('extensions', 'auth', 'storage', 'graphql', 'realtime') LIMIT 1;

  -- 4. Current user & role rights
  SELECT current_user INTO v_role;

  RAISE NOTICE '========= 217  RECOVERY / PITR  DIAGNOSTIC =========';
  RAISE NOTICE 'Time:              %', v_now;
  RAISE NOTICE 'Database size:     %', v_db_size;
  RAISE NOTICE 'Current role:      %', v_role;
  RAISE NOTICE 'archive_mode:      %  (''on''=WAL archiving enabled = PITR likely on; ''off''=NO PITR)', v_archive_mode;
  RAISE NOTICE 'archive_command:   %', COALESCE(v_archive_cmd, '<NULL>');
  RAISE NOTICE 'wal_level:         %  (needs replica or logical for PITR)', v_wal_level;
  RAISE NOTICE 'max_wal_senders:   %  (0 = replication disabled)', v_max_wal;
  RAISE NOTICE 'Supabase schemas:  %  (auth/storage/realtime present?)', v_supa_schema;

  IF v_archive_mode = 'on' AND v_max_wal::INT > 0 THEN
    RAISE NOTICE 'P0_V0 PITR: OK — WAL archiving is ENABLED. 7-day or better recovery likely.';
  ELSE
    RAISE WARNING 'P0_V0 PITR: NOT ENABLED! archive_mode=% max_wal_senders=%', v_archive_mode, v_max_wal;
    RAISE WARNING 'ACTION: Enable PITR in Supabase Dashboard → Settings → Backups → Point-in-Time Recovery';
  END IF;
END $$;
