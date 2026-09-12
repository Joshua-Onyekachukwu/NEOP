-- Diagnostic: Raise exception with exact current row counts so apply_migration shows them
DO $$
DECLARE
  v_states      BIGINT := (SELECT COUNT(*) FROM states);
  v_lgas        BIGINT := (SELECT COUNT(*) FROM lgas);
  v_wards       BIGINT := (SELECT COUNT(*) FROM wards);
  v_pus         BIGINT := (SELECT COUNT(*) FROM polling_units);
  v_last_pu_id  TEXT   := (SELECT official_code FROM polling_units ORDER BY official_code DESC LIMIT 1);
BEGIN
  RAISE EXCEPTION 'DB_STATE -> states=%, lgas=%, wards=%, polling_units=%, last_pu_code=%.  (This is an intentional diagnostic error, not a real failure.)',
    v_states, v_lgas, v_wards, v_pus, COALESCE(v_last_pu_id,'NULL');
END $$;
