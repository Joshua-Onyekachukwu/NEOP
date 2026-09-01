-- Fix polling unit ward_id assignments (BULK — fast)
-- Currently ALL 188K PUs point to the same ward. This distributes them
-- randomly across the correct wards within each LGA.
--
-- Run this in Supabase SQL Editor.

-- Step 1: Create a mapping table with random ward assignments per LGA
CREATE TEMPORARY TABLE pu_ward_fix AS
WITH lga_wards AS (
  -- Get all wards per LGA with a row number
  SELECT
    w.lga_id,
    w.id AS ward_id,
    ROW_NUMBER() OVER (PARTITION BY w.lga_id ORDER BY random()) AS ward_idx
  FROM wards w
  WHERE w.lga_id IN (SELECT DISTINCT lga_id FROM polling_units WHERE lga_id IS NOT NULL)
),
lga_ward_counts AS (
  SELECT lga_id, COUNT(*) AS total_wards FROM lga_wards GROUP BY lga_id
),
pus_with_row AS (
  SELECT
    pu.id AS pu_id,
    pu.lga_id,
    ROW_NUMBER() OVER (PARTITION BY pu.lga_id ORDER BY random()) AS pu_idx
  FROM polling_units pu
  WHERE pu.lga_id IS NOT NULL
)
SELECT
  pw.pu_id,
  lw.ward_id AS new_ward_id
FROM pus_with_row pw
JOIN lga_ward_counts lwc ON lwc.lga_id = pw.lga_id
JOIN lga_wards lw ON lw.lga_id = pw.lga_id
  AND lw.ward_idx = ((pw.pu_idx - 1) % lwc.total_wards) + 1;

-- Step 2: Bulk update in one shot
UPDATE polling_units pu
SET ward_id = fix.new_ward_id
FROM pu_ward_fix fix
WHERE pu.id = fix.pu_id;

-- Step 3: Cleanup
DROP TABLE pu_ward_fix;

-- Step 4: Verify
DO $$
DECLARE
  v_unique_wards integer;
  v_total_pus integer;
BEGIN
  SELECT count(DISTINCT ward_id) INTO v_unique_wards
  FROM polling_units WHERE ward_id IN (SELECT id FROM wards);

  SELECT count(*) INTO v_total_pus FROM polling_units;

  RAISE NOTICE 'Verification: % of % total PUs now assigned to distinct wards', v_total_pus, v_unique_wards;
END $$;
