-- INEC Migration Step 6: Finish
CREATE INDEX IF NOT EXISTS idx_polling_units_state ON polling_units(state_id);
CREATE INDEX IF NOT EXISTS idx_polling_units_lga ON polling_units(lga_id);
CREATE INDEX IF NOT EXISTS idx_polling_units_ward ON polling_units(ward_id);
CREATE INDEX IF NOT EXISTS idx_polling_units_code ON polling_units(official_code);
CREATE INDEX IF NOT EXISTS idx_wards_lga ON wards(lga_id);
CREATE INDEX IF NOT EXISTS idx_lgas_state ON lgas(state_id);
SELECT 'States: ' || (SELECT count(*) FROM states) || ', LGAs: ' || (SELECT count(*) FROM lgas) || ', Wards: ' || (SELECT count(*) FROM wards) || ', PUs: ' || (SELECT count(*) FROM polling_units) AS result;
