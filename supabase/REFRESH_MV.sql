-- ============================================================
-- REFRESH MATERIALIZED VIEW
-- Run this in Supabase SQL Editor after running the simulation
-- ============================================================

-- Step 1: Create a refresh function
CREATE OR REPLACE FUNCTION refresh_mv_party_totals()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_party_totals;
  RETURN jsonb_build_object('success', true, 'message', 'Materialized view refreshed');
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_mv_party_totals() TO service_role, anon, authenticated;

-- Step 2: Refresh the view
SELECT refresh_mv_party_totals();

-- Step 3: Verify the refresh worked
SELECT 
  (SELECT count(*) FROM mv_party_totals) AS party_count,
  (SELECT sum(total_votes) FROM mv_party_totals) AS grand_total;
