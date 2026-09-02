-- Run this first in the Supabase SQL Editor (it's small)
-- Then the Python script will use it to execute the large migration

CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE query;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERROR: ' || SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO anon;

SELECT 'exec_sql function created successfully' AS result;
