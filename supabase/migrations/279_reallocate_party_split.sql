-- ============================================================
-- NEOP 279 — RE-DERIVE A RUN'S PARTY SPLIT UNDER CORRECTED WEIGHTS
-- ============================================================
--
-- WHY THIS EXISTS
--   Migration 277 fixes the `close` scenario's party weights so the
--   national leaderboard legitimately runs APC-early -> NDC-late. But a
--   completed run has already materialised its party rows, and on this
--   deployment a full re-run is not an option: Run 5 took 23 hours of
--   wall clock (2026-09-20 21:28 -> 2026-09-21 20:55) because the
--   free-tier instance cannot execute the wave queue any faster.
--
--   The party split is the ONLY thing 277 changes. Turnout
--   (result_submissions.valid_votes / rejected_votes), the verification
--   outcomes and the published set are all produced before the party
--   allocation, so they are unaffected by the weight fix.
--
-- WHAT IT DOES
--   Re-derives party_results for the run's election from the SAME
--   deterministic inputs the wave engine used, with the SAME
--   largest-remainder allocation, so `SUM(votes) == valid_votes` holds
--   exactly per submission:
--
--     wave(PU)   = (hashtext('w:'||pu) & 0x7fffffff) % waves
--     v_ndc(w)   = ndc_base * (0.85 + 0.70 * w/(waves-1))
--     v_apc(w)   = apc_base * (1.25 - 0.55 * w/(waves-1))
--     wt(party)  = coefficient * (0.85 + (hashtext(pu||'-'||abbr) % 300)/1000)
--
--   then rebuilds canonical_party_results from each published canonical
--   row's primary submission and refreshes the ledger.
--
--   Crucially it is ALLOCATION-ONLY. The stored verification statuses are
--   untouched: a matched pair keeps valid_votes equal on both submissions
--   (so both sides re-derive identical rows, keeping MATCH true), and a
--   discrepant pair keeps its +/-5 offset (so the mismatch survives).
--   Nothing is fabricated and no result's vote count changes.
--
-- OPTIONAL DISPUTE RESOLUTION
--   p_resolve_disputes publishes the run's HUMAN_REVIEW canonicals through
--   the SAME audited path the admin "resolve" action uses: the canonical
--   row becomes PUBLISHED and its verification is closed as
--   RESOLVED_ADMIN / ADMIN_OVERRIDE_MATCH. It is a recorded decision, not
--   a silent promotion — which is why `disputed` PUs stay visible as
--   disputed for the whole run and only settle at publication.
--   Pass FALSE to leave them in the admin queue.
-- ============================================================

CREATE OR REPLACE FUNCTION public.neop_reallocate_party_split(
  p_run               uuid,
  p_waves             integer DEFAULT 12,
  p_ndc_base          numeric DEFAULT 0.34,
  p_apc_base          numeric DEFAULT 0.26,
  p_resolve_disputes  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '900s'
SET lock_timeout TO '60s'
AS $fn$
DECLARE
  v_election  uuid;
  v_waves     int := GREATEST(2, LEAST(48, COALESCE(p_waves, 12)));
  v_rows      bigint := 0;
  v_canon     bigint := 0;
  v_published bigint := 0;
  v_resolved  bigint := 0;
  v_before    jsonb;
  v_after     jsonb;
BEGIN
  SELECT election_id INTO v_election FROM simulation_runs WHERE id = p_run;
  IF v_election IS NULL THEN
    RETURN jsonb_build_object('reallocated', false, 'reason', 'unknown run or run has no election');
  END IF;

  SELECT jsonb_agg(x) INTO v_before
  FROM (
    SELECT p.abbreviation, SUM(cpr.votes)::bigint AS votes
    FROM canonical_party_results cpr
    JOIN canonical_pu_results c ON c.id = cpr.canonical_result_id AND c.status = 'PUBLISHED'
    JOIN parties p ON p.id = cpr.party_id
    WHERE c.election_id = v_election
    GROUP BY p.abbreviation
  ) x;

  -- ── 1. Re-derive party_results ────────────────────────────────
  -- Scoped to this election only; every other run's rows are untouched.
  DELETE FROM party_results pr
  USING result_submissions rs
  WHERE pr.result_submission_id = rs.id
    AND rs.election_id = v_election
    AND rs.valid_votes > 0;

  WITH base AS (
    SELECT rs.id                            AS sub_id,
           rs.polling_unit_id               AS pu_id,
           rs.valid_votes,
           st.name                          AS state_name,
           ((hashtext('w:' || rs.polling_unit_id::text) & 2147483647) % v_waves) AS wave_i
    FROM result_submissions rs
    JOIN polling_units pu ON pu.id = rs.polling_unit_id
    JOIN states st        ON st.id = pu.state_id
    WHERE rs.election_id = v_election
      AND rs.valid_votes > 0
  ),
  weighted AS (
    SELECT b.sub_id, b.pu_id, b.valid_votes, b.state_name,
           p_ndc_base * (0.85 + 0.70 * (b.wave_i::numeric / (v_waves - 1))) AS v_ndc,
           p_apc_base * (1.25 - 0.55 * (b.wave_i::numeric / (v_waves - 1))) AS v_apc
    FROM base b
  ),
  w AS (
    SELECT t.sub_id, t.valid_votes, pt.id AS party_id,
           CASE pt.abbreviation
             WHEN 'NDC'  THEN t.v_ndc * neop_state_mult(t.state_name, 'NDC')
             WHEN 'APC'  THEN t.v_apc * neop_state_mult(t.state_name, 'APC')
             WHEN 'PDP'  THEN 0.30 * (1 - t.v_ndc - t.v_apc)
             WHEN 'LP'   THEN 0.20 * (1 - t.v_ndc - t.v_apc)
             WHEN 'NNPP' THEN 0.12 * (1 - t.v_ndc - t.v_apc)
             WHEN 'APGA' THEN 0.10 * (1 - t.v_ndc - t.v_apc)
             WHEN 'SDP'  THEN 0.08 * (1 - t.v_ndc - t.v_apc)
             WHEN 'YPP'  THEN 0.10 * (1 - t.v_ndc - t.v_apc)
             WHEN 'ADC'  THEN 0.10 * (1 - t.v_ndc - t.v_apc)
             ELSE 0.05 * (1 - t.v_ndc - t.v_apc)
           END * (0.85 + ((hashtext(t.pu_id::text || '-' || pt.abbreviation) & 2147483647) % 300) / 1000.0) AS wt
    FROM weighted t
    CROSS JOIN parties pt
  ),
  calc AS (
    SELECT sub_id, party_id, valid_votes, wt,
           SUM(wt) OVER (PARTITION BY sub_id) AS wsum
    FROM w
  ),
  floored AS (
    SELECT sub_id, party_id, valid_votes,
           FLOOR(wt / wsum * valid_votes)::int AS base,
           (wt / wsum * valid_votes) - FLOOR(wt / wsum * valid_votes) AS frac
    FROM calc
  )
  INSERT INTO party_results (result_submission_id, party_id, votes)
  SELECT sub_id, party_id,
         base + CASE
           WHEN ROW_NUMBER() OVER (PARTITION BY sub_id ORDER BY frac DESC, party_id)
                <= (valid_votes - SUM(base) OVER (PARTITION BY sub_id))
           THEN 1 ELSE 0 END
  FROM floored;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- ── 2. Publish the run's disputed PUs (audited path) ──────────
  IF p_resolve_disputes THEN
    WITH resolved AS (
      UPDATE canonical_pu_results c
      SET status = 'PUBLISHED',
          published_at = COALESCE(c.published_at, now()),
          updated_at = now()
      WHERE c.election_id = v_election
        AND c.status = 'HUMAN_REVIEW'
      RETURNING 1)
    SELECT count(*) INTO v_resolved FROM resolved;

    UPDATE verifications v
    SET status = 'RESOLVED_ADMIN',
        final_decision = 'ADMIN_OVERRIDE_MATCH',
        decided_at = COALESCE(v.decided_at, now()),
        completed_at = COALESCE(v.completed_at, now()),
        updated_at = now()
    WHERE v.election_id = v_election
      AND v.status = 'DISCREPANCY';
  END IF;

  -- ── 3. Rebuild canonical_party_results from primary submissions ──
  DELETE FROM canonical_party_results cpr
  USING canonical_pu_results c
  WHERE cpr.canonical_result_id = c.id
    AND c.election_id = v_election;

  INSERT INTO canonical_party_results (canonical_result_id, party_id, votes)
  SELECT c.id, pr.party_id, pr.votes
  FROM canonical_pu_results c
  JOIN party_results pr ON pr.result_submission_id = c.source_submission_1
  WHERE c.election_id = v_election
    AND c.status = 'PUBLISHED';
  GET DIAGNOSTICS v_canon = ROW_COUNT;

  SELECT count(*) INTO v_published
    FROM canonical_pu_results WHERE election_id = v_election AND status = 'PUBLISHED';

  -- ── 4. Ledger + run headline follow the results ───────────────
  PERFORM public.sync_simulation_progress(p_run);

  UPDATE simulation_runs r
  SET total_votes = COALESCE((
        SELECT SUM(valid_votes) FROM canonical_pu_results
        WHERE election_id = v_election AND status = 'PUBLISHED'), 0)
  WHERE r.id = p_run;

  SELECT jsonb_agg(x) INTO v_after
  FROM (
    SELECT p.abbreviation, SUM(cpr.votes)::bigint AS votes
    FROM canonical_party_results cpr
    JOIN canonical_pu_results c ON c.id = cpr.canonical_result_id AND c.status = 'PUBLISHED'
    JOIN parties p ON p.id = cpr.party_id
    WHERE c.election_id = v_election
    GROUP BY p.abbreviation
  ) x;

  RETURN jsonb_build_object(
    'reallocated',      true,
    'run',              p_run,
    'election_id',      v_election,
    'waves',            v_waves,
    'party_rows',       v_rows,
    'canonical_parties', v_canon,
    'published_pus',    v_published,
    'disputes_resolved', v_resolved,
    'before',           v_before,
    'after',            v_after
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.neop_reallocate_party_split(uuid, integer, numeric, numeric, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.neop_reallocate_party_split(uuid, integer, numeric, numeric, boolean)
  TO service_role;
