-- INEC Migration Step 1: Setup
-- Run this FIRST in the Supabase SQL Editor
ALTER TABLE polling_units DISABLE TRIGGER ALL;
ALTER TABLE wards DISABLE TRIGGER ALL;
ALTER TABLE lgas DISABLE TRIGGER ALL;
TRUNCATE TABLE polling_units CASCADE;
TRUNCATE TABLE wards CASCADE;
TRUNCATE TABLE lgas CASCADE;
TRUNCATE TABLE states CASCADE;
SELECT 'Setup complete - tables truncated' AS result;
