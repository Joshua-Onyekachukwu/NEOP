-- Materialized view for fast party totals
-- Run this in Supabase SQL Editor after simulation

DROP MATERIALIZED VIEW IF EXISTS mv_party_totals;

CREATE MATERIALIZED VIEW mv_party_totals AS
SELECT
  key AS party_abbreviation,
  COALESCE(p.official_name, key) AS party_name,
  COALESCE(p.color, '#666666') AS party_color,
  SUM(value::BIGINT) AS total_votes
FROM result_submissions,
  jsonb_each_text(result_submissions.party_votes) AS kv(key, value)
LEFT JOIN parties p ON p.abbreviation = kv.key
WHERE result_submissions.party_votes IS NOT NULL
GROUP BY kv.key, p.official_name, p.color
ORDER BY SUM(value::BIGINT) DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_party_totals_abbr ON mv_party_totals(party_abbreviation);

GRANT SELECT ON mv_party_totals TO service_role;
GRANT SELECT ON mv_party_totals TO anon;

-- Fast RPC that reads from the materialized view
CREATE OR REPLACE FUNCTION get_party_totals_mv()
RETURNS TABLE (
  party_abbreviation TEXT,
  party_name TEXT,
  party_color TEXT,
  total_votes BIGINT,
  percentage NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    party_abbreviation,
    party_name,
    party_color,
    total_votes,
    CASE WHEN SUM(total_votes) OVER () > 0
      THEN ROUND(total_votes::NUMERIC / SUM(total_votes) OVER () * 100, 1)
      ELSE 0
    END AS percentage
  FROM mv_party_totals
  ORDER BY total_votes DESC;
$$;

GRANT EXECUTE ON FUNCTION get_party_totals_mv() TO service_role;
GRANT EXECUTE ON FUNCTION get_party_totals_mv() TO anon;

SELECT 'Materialized view and fast RPC created' AS result;
