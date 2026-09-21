-- ============================================================
-- NEOP 277 — THE CLOSE SCENARIO'S DRIFT MUST ACTUALLY FLIP
-- ============================================================
--
-- SYMPTOM
--   Run 5 (scenario `close`, 12 waves) finished with the leaderboard
--   still APC-first:
--
--       live /api/public/party-results -> APC 480,314 (29.7%)
--                                         NDC 458,318 (28.4%)
--
--   Every wave had executed, so the drift in migration 272 was running
--   exactly as written. It simply cannot produce the requested
--   narrative.
--
-- ROOT CAUSE
--   Migration 272 preserved the MEAN of each party's weight across the
--   waves (`1 - 0.35 + 0.7*p` and `1 + 0.35 - 0.7*p` both average to
--   1.0). A mean-preserving drift can tilt each wave, but the CUMULATIVE
--   national total is the wave-average of those weights — i.e. the mean.
--   So the final result is decided entirely by the base rates, and the
--   base rates lose to the regional multipliers:
--
--       neop_state_mult averages 0.972 for NDC but 1.070 for APC
--       (weighted by each state's polling-unit count), because APC's
--       strong regions — Lagos 13,325 PUs, the North-West 41,671 PUs,
--       the North-East 24,006 PUs — carry far more polling units than
--       NDC's South-East/South-South base.
--
--       close base rates 0.30 NDC vs 0.28 APC give effective weights
--           0.30 x 0.972 = 0.292   vs   0.28 x 1.070 = 0.300
--
--   APC therefore ends ahead no matter how large the drift is, while
--   the drift only reorders the race wave by wave. Measured against the
--   live 176,846-PU universe the model reproduces production almost
--   exactly (predicted 29.2% / 27.9% vs observed 29.7% / 28.4%).
--
-- FIX
--   Two changes, both confined to the `close` scenario:
--
--   1. Re-base close to NDC 0.34 / APC 0.26, so the effective weights
--      put NDC ~19% ahead of APC once the multipliers are applied.
--
--   2. Replace the symmetric ±0.35 drift with an asymmetric one —
--      NDC 0.85 -> 1.55, APC 1.25 -> 0.70. A symmetric drift with a
--      base-rate edge still needs the accumulated APC lead to be repaid
--      before the cumulative lines cross, which on a 12-wave run only
--      happens at wave 10 of 11 (a flip nobody watching would see).
--      The asymmetric drift front-loads the APC tilt and back-loads the
--      NDC surge, so the CUMULATIVE leaderboard changes hands early:
--
--        wave  0  NDC 27.2%  APC 33.6%   -> APC leads
--        wave  4  NDC 30.8%  APC 31.5%   -> APC, closing
--        wave  5  NDC 31.8%  APC 30.9%   -> NDC takes the lead
--        wave 11  NDC 37.4%  APC 27.5%   -> NDC wins
--
--   (Modelled with the real per-state polling-unit counts and the real
--   neop_state_mult table; the same model reproduces Run 5's published
--   outcome to within half a point, which is why the new parameters are
--   trusted rather than guessed.)
--
-- SCOPE
--   `landslide` and `sweep` already put NDC ahead on their own (0.42/0.22
--   and 0.37/0.25) and are deliberately untouched. The minors' rescale
--   factor `1 - v_ndc - v_apc` stays positive at every point of the new
--   close curve (0.386 at wave 0, 0.291 at wave 11), so no party weight
--   can go negative.
--
-- IDEMPOTENT: the replacements are no-ops once applied, because the
-- original literals no longer appear in the function body.
-- ============================================================

DO $do$
DECLARE
  v_def text;
  v_hits int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'neop_sim_wave';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'neop_sim_wave not found — aborting';
  END IF;

  -- Pre-image census: every literal must appear exactly once.
  v_hits := (length(v_def) - length(replace(v_def, 'WHEN ''close'' THEN 0.30 ELSE 0.37 END', '')))
            / length('WHEN ''close'' THEN 0.30 ELSE 0.37 END');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'expected 1 close NDC base rate, found % — aborting (already patched?)', v_hits;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, 'WHEN ''close'' THEN 0.28 ELSE 0.25 END', '')))
            / length('WHEN ''close'' THEN 0.28 ELSE 0.25 END');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'expected 1 close APC base rate, found % — aborting (already patched?)', v_hits;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, 'v_ndc := v_ndc * (1 - 0.35 + 0.7 * v_prog);', '')))
            / length('v_ndc := v_ndc * (1 - 0.35 + 0.7 * v_prog);');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'expected 1 symmetric NDC drift line, found % — aborting (already patched?)', v_hits;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, 'v_apc := v_apc * (1 + 0.35 - 0.7 * v_prog);', '')))
            / length('v_apc := v_apc * (1 + 0.35 - 0.7 * v_prog);');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'expected 1 symmetric APC drift line, found % — aborting (already patched?)', v_hits;
  END IF;

  -- 1. Re-base close: NDC 0.34 / APC 0.26.
  v_def := replace(v_def,
    'WHEN ''close'' THEN 0.30 ELSE 0.37 END',
    'WHEN ''close'' THEN 0.34 ELSE 0.37 END');
  v_def := replace(v_def,
    'WHEN ''close'' THEN 0.28 ELSE 0.25 END',
    'WHEN ''close'' THEN 0.26 ELSE 0.25 END');

  -- 2. Asymmetric drift.
  v_def := replace(v_def,
    'v_ndc := v_ndc * (1 - 0.35 + 0.7 * v_prog);',
    'v_ndc := v_ndc * (0.85 + 0.70 * v_prog);');
  v_def := replace(v_def,
    'v_apc := v_apc * (1 + 0.35 - 0.7 * v_prog);',
    'v_apc := v_apc * (1.25 - 0.55 * v_prog);');

  -- Post-image assertions.
  IF position('WHEN ''close'' THEN 0.34 ELSE 0.37 END' IN v_def) = 0
     OR position('WHEN ''close'' THEN 0.26 ELSE 0.25 END' IN v_def) = 0
     OR position('v_ndc := v_ndc * (0.85 + 0.70 * v_prog);' IN v_def) = 0
     OR position('v_apc := v_apc * (1.25 - 0.55 * v_prog);' IN v_def) = 0 THEN
    RAISE EXCEPTION 'close-scenario rewrite incomplete — aborting';
  END IF;

  -- No symmetric drift may survive anywhere.
  IF position('1 - 0.35 + 0.7 * v_prog' IN v_def) <> 0
     OR position('1 + 0.35 - 0.7 * v_prog' IN v_def) <> 0 THEN
    RAISE EXCEPTION 'a symmetric drift term survived — aborting';
  END IF;

  EXECUTE v_def;
  RAISE NOTICE 'neop_sim_wave close scenario re-based and asymmetrically drifted';
END
$do$;

-- ------------------------------------------------------------
-- Self-test: the rewrite must reproduce the modelled curve.
-- Evaluates the NEW arithmetic for every wave and asserts the
-- cumulative NDC line crosses APC mid-run and ends ahead.
--
-- Uses the same per-state polling-unit weighting the engine sees,
-- so a change to neop_state_mult that breaks the narrative fails
-- loudly here rather than silently on the live site.
-- ------------------------------------------------------------
DO $do$
DECLARE
  v_waves   constant int := 12;
  v_w       int;
  v_p       numeric;
  v_ndc     numeric;
  v_apc     numeric;
  v_minors  numeric;
  v_cn      numeric := 0;
  v_ca      numeric := 0;
  v_cross   int := NULL;
  v_states  text[] := ARRAY['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa',
    'Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Fct','Gombe',
    'Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa',
    'Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];
  v_n       bigint;
  v_denom   bigint;
  v_sn      numeric;
  v_sa      numeric;
  v_tn      numeric := 0;
  v_ta      numeric := 0;
BEGIN
  SELECT COALESCE(SUM(n), 1) INTO v_denom
  FROM (SELECT count(*) AS n FROM polling_units GROUP BY state_id) g;

  FOR v_w IN 0 .. v_waves - 1 LOOP
    v_p := CASE WHEN v_waves > 1 THEN v_w::numeric / (v_waves - 1) ELSE 0 END;
    v_ndc := 0.34 * (0.85 + 0.70 * v_p);
    v_apc := 0.26 * (1.25 - 0.55 * v_p);
    v_minors := 1.05 * (1 - v_ndc - v_apc);

    v_sn := 0; v_sa := 0;
    SELECT COALESCE(SUM(
             (v_ndc * public.neop_state_mult(s.name, 'NDC')) /
             NULLIF((v_ndc * public.neop_state_mult(s.name, 'NDC'))
                  + (v_apc * public.neop_state_mult(s.name, 'APC'))
                  + v_minors, 0) * g.n), 0),
           COALESCE(SUM(
             (v_apc * public.neop_state_mult(s.name, 'APC')) /
             NULLIF((v_ndc * public.neop_state_mult(s.name, 'NDC'))
                  + (v_apc * public.neop_state_mult(s.name, 'APC'))
                  + v_minors, 0) * g.n), 0)
      INTO v_sn, v_sa
      FROM states s
      JOIN (SELECT state_id, count(*) AS n FROM polling_units GROUP BY state_id) g
        ON g.state_id = s.id;

    v_tn := v_tn + (v_sn / v_denom);
    v_ta := v_ta + (v_sa / v_denom);

    IF v_cross IS NULL AND v_tn >= v_ta THEN v_cross := v_w; END IF;
  END LOOP;

  RAISE NOTICE 'close-scenario final cumulative: NDC %%% APC %%% (crossover at wave %)',
    ROUND(v_tn / v_waves * 100, 1), ROUND(v_ta / v_waves * 100, 1), v_cross;

  IF v_cross IS NULL THEN
    RAISE EXCEPTION 'close scenario never flips — NDC stays behind APC';
  END IF;
  IF v_cross > 7 THEN
    RAISE EXCEPTION 'close scenario flips too late (wave % of %) — narrative not visible', v_cross, v_waves - 1;
  END IF;
  IF v_tn <= v_ta THEN
    RAISE EXCEPTION 'close scenario ends with APC ahead (NDC %% vs APC %%)',
      ROUND(v_tn / v_waves * 100, 1), ROUND(v_ta / v_waves * 100, 1);
  END IF;
END
$do$;
