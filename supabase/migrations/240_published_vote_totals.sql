-- ============================================================
-- NEOP 240 — PUBLISHED VOTE TOTALS RPC
--
-- getCachedStats summed valid_votes + rejected_votes by selecting
-- every PUBLISHED canonical row over PostgREST. Supabase's PostgREST
-- hard-caps un-capped responses at 1000 rows (even with a larger
-- explicit limit), so once the sim dataset passed ~1000 rows the
-- national vote total silently froze on the first 1000 rows (the demo
-- data). This RPC aggregates server-side — always exact, 1 row out.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_published_vote_totals()
RETURNS TABLE(total_votes bigint, total_valid bigint, total_rejected bigint)
LANGUAGE sql STABLE
AS $function$
  SELECT
    COALESCE(SUM(valid_votes + rejected_votes), 0)::BIGINT AS total_votes,
    COALESCE(SUM(valid_votes), 0)::BIGINT                   AS total_valid,
    COALESCE(SUM(rejected_votes), 0)::BIGINT                AS total_rejected
  FROM canonical_pu_results
  WHERE status = 'PUBLISHED';
$function$;

GRANT EXECUTE ON FUNCTION public.get_published_vote_totals() TO service_role;