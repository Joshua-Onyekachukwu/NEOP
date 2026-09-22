# NEOP — FINAL SYSTEM REPORT (September 21, 2026)

## Verdict

**Run 5 completed and is published; the two display defects the user reported
are now root-caused and fixed, but the last-mile data correction could not be
applied to the live dataset because the free-tier Supabase instance cannot
execute multi-row writes any more.**

The system is not broken and no data was lost. Every defect found this session
has either been fixed in place or has a tested migration waiting to run.

---

## 1. What was actually happening

Three separate defects, all confirmed against production data.

### 1.1 The leaderboard never flipped — *the drift could not have flipped it*

Run 5 (`5828…`, scenario `close`, 12 waves) finished with **APC 29.7% vs NDC
28.4%** — APC still first, exactly the opposite of what was asked for.

Migration 272 added wave drift so "early waves over-weight APC, late waves
over-weight NDC, mean preserved". The drift was running correctly. It simply
cannot produce the requested outcome, for a reason that is invisible unless you
look at the regional multipliers:

- `neop_state_mult` averages **0.972 for NDC** but **1.070 for APC**, weighted
  by each state's polling-unit count — APC's strong regions (Lagos 13,325 PUs,
  North-West 41,671 PUs, North-East 24,006 PUs) carry far more polling units
  than NDC's South-East / South-South base.
- With `close` base rates of 0.30 / 0.28 the *effective* weights are
  `0.30 × 0.972 = 0.292` vs `0.28 × 1.070 = 0.300`.
- A mean-preserving drift reorders the race wave by wave but leaves the
  **cumulative** total equal to the mean. So the base rates decided the
  election, and the base rates lost to the multipliers.

A drift model built from the real per-state polling-unit counts (and the real
`neop_state_mult` table) reproduces production to within half a point:

| | predicted | actual (production) |
|---|---|---|
| NDC | 27.9% | 28.4% |
| APC | 29.2% | 29.7% |

**Fix — migration 277** (`supabase/migrations/277_sim_close_drift_flip.sql`,
applied): re-base `close` to NDC 0.34 / APC 0.26 and replace the symmetric
±0.35 drift with an asymmetric one (NDC `0.85→1.55`, APC `1.25→0.70`). Modelled
outcome: APC leads waves 0–4, **NDC takes the lead at wave 5 of 12**, finishing
NDC 37.4% vs APC 27.5%. `landslide` and `sweep` are untouched.

### 1.2 "Verified 83%" — the disputed results were being *erased*, not resolved

`verified = published ÷ (published + disputed + disrupted)`. Run 5 reported
`published 35,901` with `6,460` disputes — **and those 6,460 polling units had
no canonical result at all.** Ledger census of Run 5:

```
UNAVAILABLE    132,853
PUBLISHED       35,901
HUMAN_REVIEW     6,460     <- no canonical row exists for any of them
DISRUPTED          868
AWAITING           764
```

Cause — two guards in `publish_simulation_run` contradicting each other:

1. When two agent submissions disagree, `neop_sim_wave` writes a canonical row
   with `status = 'HUMAN_REVIEW'` so the disagreement is visible.
2. The finalizer's reconciliation pass is meant to resolve exactly those PUs
   (`WHERE sim_status = 'HUMAN_REVIEW'`) but also carries
   `AND NOT EXISTS (… canonical_pu_results … polling_unit_id = …)`. Because
   step 1 already created a row, the guard is false for all 6,460 — the pass
   resolves nothing.
3. The function then ends with `DELETE … WHERE sim_status <> 'PUBLISHED'`,
   which deletes the very rows the pass declined to upgrade.

Net effect: disputed polling units vanish. They drag the public "verified"
headline down permanently and the admin dispute queue is empty too, because
the row it would display was deleted.

**Fix — migration 280**
(`supabase/migrations/280_publish_simulation_run_resolves_disputes.sql`,
applied): both passes now only skip a PU that already has a **PUBLISHED** row,
so an existing `HUMAN_REVIEW` row is upgraded instead of blocking the repair,
and the trailing cleanup keeps `HUMAN_REVIEW` rows so a genuinely unresolved
dispute stays visible. Resolution remains audited (`RESOLVED_ADMIN` /
`ADMIN_OVERRIDE_MATCH`), never silent.

### 1.3 The instance was starving itself

The public site intermittently served **zeros** for the whole run. The data was
never gone — `system_config` still points at Run 5's election
(`b5a9662b…`, `data_mode = SIMULATED`), and the ledger is fully intact. The
Postgres logs showed `57014 statement_timeout` on statements that cannot be
slow:

```
SET client_encoding = 'UTF8'; SET client_min_messages TO WARNING;
SELECT setting FROM pg_settings WHERE name = 'max_connections';
SELECT name FROM pg_timezone_names;          -- 23 s
```

Two independent causes:

- **Migration 275's autovacuum settings.** It set
  `autovacuum_vacuum_threshold = 50, autovacuum_vacuum_scale_factor = 0.0` on
  five multi-million-row tables. That means "vacuum after 50 dead tuples,
  whatever the size" — so autovacuum ran essentially continuously on
  `party_results` and starved the instance.
- **A duty cycle above 100%.** The sim driver was scheduled at 30 s with a 75 s
  budget, so the instance was permanently inside a wave.

**Fix — migration 278**
(`supabase/migrations/278_revert_aggressive_autovacuum.sql`): an
eager-but-bounded profile (5% dead tuples, never before 1,000 rows) and a
45 s / 40 s driver. The five `ALTER TABLE … SET` statements were applied live;
`275` was corrected on disk so a fresh apply cannot reintroduce it.

Two `autovacuum: ANALYZE` workers were also caught running for **19 and 18
minutes** and finished on their own.

---

## 2. Current state of the dataset

| | |
|---|---|
| Run | `5821d9eb-f021-4eaf-a473-2a3e48cb7109` — **PUBLISHED** |
| Election | `b5a9662b-1b3a-4260-a078-9496b799cf9d` (the active one) |
| Coverage | 99.6% of the 176,846 INEC universe accounted for |
| Published PUs | 35,901 (83.0% of the 43,229 reporting set) |
| Total votes | 1,795,050 |
| Ledger | intact — 132,853 unavailable / 35,901 published / 6,460 disputed / 868 disrupted / 764 awaiting |
| Public scoping | correct (`data_mode = SIMULATED` → Run 5) |

The site reads zeros only when its summary RPCs time out; it served this
dataset correctly for hours earlier today and will again once the instance is
not saturated.

---

## 3. What could not be completed, and why

The remaining live-data step is a multi-row write, and **this instance can no
longer perform one**. Measured today:

- A 400-polling-unit resolution per `pg_cron` run: `canceling statement due to
  statement timeout` after ~120 s, three times in a row.
- A 500-unit batch via `execute_sql`: times out; PostgREST cancels the
  statement when the client disconnects, so it rolls back.
- The full finalizer (`publish_simulation_run`) and the party re-derivation
  (`neop_reallocate_party_split`): both time out and roll back cleanly.

The tables are the reason as much as the throttling:

```
party_results            914,004 rows   189 MB
pu_simulation_status     353,692 rows   157 MB
canonical_party_results  399,852 rows    83 MB
```

This is also why **Run 5 took 23 hours** (21:28 → 20:55 the next day) instead
of the expected ~2.

### The two waiting steps

**a) Raise Verified from 83% to ~98% on the existing run** — 6,460 disputed PUs
need publishing from their primary submission. The tool for this is installed
and tested for logic: `public.neop_resolve_run_disputes(run, limit)`
(migration 281), which resolves a *bounded* slice per call so it can be driven
from inside the database where no client can cancel it. It must run with a
chunk small enough to beat the ~120 s `pg_cron` statement timeout, or on a
quieter instance.

**b) Flip the leaderboard on the existing run** — `public.neop_reallocate_party_split(run)`
(migration 279) re-derives the party split from the *same* deterministic inputs
the wave engine used, with the same largest-remainder allocation, so
`SUM(votes) = valid_votes` still holds per submission. It is allocation-only:
turnout, verification outcomes and the published set are untouched, and matched
pairs stay matched because both sides re-derive from equal vote counts.

**Alternatively — preferred once the instance is healthy** — just launch a
fresh run through the admin dashboard. Both defects are now fixed at the
source, so a clean run produces the requested result by construction:

```bash
POST /api/admin/simulate/trigger-v2
{ "scenario": "close", "waves": 12, "coverage_pct": 25,
  "display_voters": 30000000, "discrepancy_rate": 0.01 }
```

---

## 4. Changes made this session

| File | What |
|---|---|
| `supabase/migrations/277_sim_close_drift_flip.sql` | **Applied.** Re-bases `close`, asymmetric drift, with an in-migration self-test that fails loudly if the cumulative curve stops crossing. |
| `supabase/migrations/278_revert_aggressive_autovacuum.sql` | **Applied** (five `ALTER TABLE`s). Reverts the 275 autovacuum thrash; duty cycle < 100%. |
| `supabase/migrations/279_reallocate_party_split.sql` | Applied (function). Allocation-only re-derivation of a completed run's party split. |
| `supabase/migrations/280_publish_simulation_run_resolves_disputes.sql` | **Applied.** Finalizer resolves disputed PUs instead of erasing them. |
| `supabase/migrations/281…` (as applied) | Applied (function). `neop_resolve_run_disputes` — bounded, client-independent dispute resolution. |
| `supabase/migrations/275_sim_tick_local_in_database.sql` | Corrected on disk (autovacuum + cadence). |
| `apps/web/src/lib/sim-engine.ts` | Outcome-profile fallbacks → `0.01 / 0.005 / 0.005 / 1.0`, so a successful run reads ~98.5% verified instead of 83%. |
| `apps/web/src/app/api/admin/simulate/trigger-v2/route.ts` | Same defaults; `discrepancy_rate` default `0.05 → 0.01`; header doc corrected. |
| `_scripts/drift-model.mjs` | The model that reproduces production and justifies the new parameters. |

Verified: `tsc --noEmit` clean (only pre-existing `.next/types` route-validator
notices). All changes committed.

---

## 5. Remaining risks

1. **Instance capacity is the binding constraint, not the code.** A 0.5 GB
   free-tier instance cannot hold 176,846 polling units plus a 353k-row ledger
   and a 914k-row party table and still execute multi-row writes. Until the
   instance is upsized (or the dataset is trimmed), every goal will be gated on
   it. This is the single most important thing to fix.
2. **No real INEC feed has ever been connected.** Everything here is the
   synthetic pipeline; the ingestion path for a real feed is unexercised.
3. **Verified/coverage semantics are a display convention.** "Coverage 99.6%"
   counts polling units the ledger marked *unavailable* as accounted for, while
   only ~25% of the country actually reported. That is deliberate (the instance
   cannot store a full-coverage run) but it should be labelled as such on the
   public site rather than left to be inferred.
