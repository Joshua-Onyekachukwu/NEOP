-- ============================================================
-- NEOP 293 — SEARCH_PATH-INDEPENDENT UUID GENERATION
-- ============================================================
-- DEFECT (found by the Phase D INEC write-path drill, root-caused in-DB):
--
--   `inec_accept_result()` is SECURITY DEFINER with `SET search_path = public`.
--   Its INSERT into `result_submissions` failed with
--       ERROR: function uuid_generate_v4() does not exist
--   because:
--     • `result_submissions.id` DEFAULT uuid_generate_v4() — and 21 other
--       public columns — call the function from the **`extensions`** schema,
--       which is not on that function's restricted search_path; and
--     • `fn_trg_rs_timeline` (AFTER INSERT trigger on result_submissions)
--       also calls the unqualified `uuid_generate_v4()`.
--
--   The simulated pipeline was unaffected only because PostgREST sessions run
--   with search_path `"$user", public, extensions`. Any SECURITY DEFINER
--   function that hardens search_path (as ours correctly do) would hit it.
--   Proven with two in-DB probes: the same call fails under
--   `search_path=public` AND under `"$user", public, extensions` (the
--   function's own SET clause overrides the caller), i.e. the failure is
--   structural, not caller-dependent.
--
-- FIX: generate UUIDs with `gen_random_uuid()` (pg_catalog — always resolvable
-- regardless of search_path). It is the same RFC 4122 v4 UUID, so no data or
-- contract change; existing rows and ids are untouched. Table defaults change
-- is metadata-only (no rewrite of 600k+ rows).
--
-- Applied as both (a) a sweep of every non-system column default that still
-- calls uuid_generate_v4(), and (b) a rewrite of the trigger that calls it.
-- ============================================================

-- ── (a) Trigger function: uuid_generate_v4() → gen_random_uuid() ──
CREATE OR REPLACE FUNCTION public.fn_trg_rs_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_vid UUID;
  v_existing_sub_count INT;
BEGIN
  SELECT v.id,
         CASE WHEN v.submission_id_1 IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN v.submission_id_2 IS NOT NULL THEN 1 ELSE 0 END
    INTO v_vid, v_existing_sub_count
  FROM verifications v
  WHERE v.election_id = NEW.election_id
    AND v.polling_unit_id = NEW.polling_unit_id
  ORDER BY v.created_at DESC
  LIMIT 1;

  IF v_vid IS NULL THEN
    INSERT INTO verifications (id, election_id, polling_unit_id, submission_id_1, status)
    VALUES (gen_random_uuid(), NEW.election_id, NEW.polling_unit_id, NEW.id, 'AWAITING_DATA')
    RETURNING id INTO v_vid;
    v_existing_sub_count := 0;
  END IF;

  IF v_existing_sub_count = 0 THEN
    UPDATE verifications
    SET submission_id_1 = NEW.id,
        updated_at = NOW()
    WHERE id = v_vid AND submission_id_1 IS NULL;
    INSERT INTO verification_timeline_events (
      verification_id, event_type, actor_type, actor_id, metadata, created_at
    ) VALUES (
      v_vid, 'SUBMISSION_1_RECEIVED', 'OBSERVER', NEW.volunteer_id,
      jsonb_build_object('submission_id', NEW.id, 'volunteer_id', NEW.volunteer_id),
      NOW()
    );
  ELSIF v_existing_sub_count = 1 THEN
    UPDATE verifications
    SET submission_id_2 = NEW.id,
        updated_at = NOW()
    WHERE id = v_vid AND submission_id_2 IS NULL;
    INSERT INTO verification_timeline_events (
      verification_id, event_type, actor_type, actor_id, metadata, created_at
    ) VALUES (
      v_vid, 'SUBMISSION_2_RECEIVED', 'OBSERVER', NEW.volunteer_id,
      jsonb_build_object('submission_id', NEW.id, 'volunteer_id', NEW.volunteer_id),
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$fn$;

-- ── (b) Sweep every remaining uuid_generate_v4() column default ──
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tbl, a.attname AS col
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    JOIN pg_class c ON c.oid = d.adrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%uuid_generate_v4%'
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I SET DEFAULT gen_random_uuid()', r.tbl, r.col);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'migration 293: rewrote % uuid_generate_v4() column defaults', v_count;
END $$;

-- ── Verify no default/function body still depends on uuid_generate_v4 ──
DO $$
DECLARE
  v_defaults INT;
  v_procs INT;
BEGIN
  SELECT count(*) INTO v_defaults
    FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%uuid_generate_v4%';

  SELECT count(*) INTO v_procs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname <> 'uuid_generate_v4'
     AND p.prosrc ILIKE '%uuid_generate_v4%';

  IF v_defaults > 0 OR v_procs > 0 THEN
    RAISE EXCEPTION '293 incomplete: % defaults / % functions still use uuid_generate_v4()', v_defaults, v_procs;
  END IF;
END $$;
