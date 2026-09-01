-- Fast admin stats: single function replaces 8 COUNT queries
-- Admin dashboard was running 8 separate COUNT queries on load — this returns everything in one call

CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_volunteers', (SELECT count(*) FROM volunteers),
    'active_volunteers', (SELECT count(*) FROM volunteers WHERE status = 'ACTIVE'),
    'total_assignments', (SELECT count(*) FROM agent_assignments),
    'checked_in_assignments', (SELECT count(*) FROM agent_assignments WHERE status = 'CHECKED_IN'),
    'total_results', (SELECT count(*) FROM result_submissions),
    'verified_results', (SELECT count(*) FROM result_submissions WHERE status = 'VERIFIED'),
    'pending_verification', (SELECT count(*) FROM result_submissions WHERE status = 'UNVERIFIED'),
    'total_incidents', (SELECT count(*) FROM incidents)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_stats() TO anon;
