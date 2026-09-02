-- Aggregate party totals from party_votes JSONB column
CREATE OR REPLACE FUNCTION get_party_totals_fast()
RETURNS TABLE (
  party_abbreviation TEXT,
  party_name TEXT,
  party_color TEXT,
  total_votes BIGINT,
  percentage NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH party_votes AS (
    SELECT
      (jsonb_each_text(rs.party_votes)).key AS abbr,
      (jsonb_each_text(rs.party_votes)).value::BIGINT AS votes
    FROM result_submissions rs
    WHERE rs.party_votes IS NOT NULL
  ),
  party_info AS (
    SELECT abbreviation, official_name, color FROM parties
  )
  SELECT
    pv.abbr,
    COALESCE(pi.official_name, pv.abbr),
    COALESCE(pi.color, '#666666'),
    SUM(pv.votes),
    CASE WHEN SUM(SUM(pv.votes)) OVER () > 0
      THEN ROUND(SUM(pv.votes)::NUMERIC / SUM(SUM(pv.votes)) OVER () * 100, 1)
      ELSE 0
    END
  FROM party_votes pv
  LEFT JOIN party_info pi ON pi.abbreviation = pv.abbr
  GROUP BY pv.abbr, pi.official_name, pi.color
  ORDER BY SUM(pv.votes) DESC;
$$;

GRANT EXECUTE ON FUNCTION get_party_totals_fast() TO service_role;
GRANT EXECUTE ON FUNCTION get_party_totals_fast() TO anon;

-- Also create state breakdown from JSONB
CREATE OR REPLACE FUNCTION get_state_breakdown_fast()
RETURNS TABLE (
  state_name TEXT,
  state_id UUID,
  total_polling_units BIGINT,
  covered_polling_units BIGINT,
  verified_polling_units BIGINT,
  coverage_percent NUMERIC,
  verification_percent NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    st.name,
    st.id,
    COUNT(*),
    COUNT(*),
    COUNT(*) FILTER (WHERE rs.status = 'VERIFIED'),
    CASE WHEN COUNT(*) > 0 THEN 100.0 ELSE 0 END,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE rs.status = 'VERIFIED')::NUMERIC / COUNT(*) * 100, 1)
      ELSE 0
    END
  FROM result_submissions rs
  INNER JOIN polling_units pu ON pu.id = rs.polling_unit_id
  INNER JOIN states st ON st.id = pu.state_id
  GROUP BY st.id, st.name
  ORDER BY COUNT(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION get_state_breakdown_fast() TO service_role;
GRANT EXECUTE ON FUNCTION get_state_breakdown_fast() TO anon;
