# NEOP Phase 3 — Supervised INEC Feed Rehearsal & Simulation Optimization

**Report date:** 2026-09-24 (updated after Run 9 + Phase D/H closure — drills, migrations 293–294, final browser QA)
**Project:** `muwocrmdcyzmwqjvvjfj` (Supabase) · production `https://ngeop.vercel.app`
**Scope:** supervised rehearsal per the Phase 3 brief (Phases A–L)

---

## 1. Executive summary

| Area | State |
|---|---|
| Real storage limit | **500 MB** (Supabase Free). Was **not** what the system enforced — see §4. |
| Quota gate | **Fixed** (migration 288) — now enforces the real 500 MB envelope. |
| Unbudgeted growth | **Found & fixed** (migrations 288/289) — 107 MB of simulation audit churn that nothing ever trimmed. |
| Driver cadence | **Fixed** (migrations 287/290/291/292) — Run 7: **101 min** → Run 8: **21.9 min** → Run 9: **15.8 min** (target band reached). |
| Post-publication compaction | **Verified live** — every run now auto-schedules 5 staggered bare-statement VACUUM FULL one-shots; the table that timed out under Run 7 now succeeds. |
| Purge-then-run lifecycle | **Working** — release verified twice (`runs_purged: 1`, `audit_rows_trimmed: 29,710`, `retained_bytes: 0` at the gate). Route change not yet committed/deployed. |
| INEC connector | **Fully rehearsed.** Write-path drill **17/17 PASS**, kill-switch drill **12/12 PASS**, rollback rehearsed twice; real uuid-generation defect found & fixed (migration 293); idempotency-hash defect found & fixed. |
| Least privilege | `inec_feed_raw`/`inec_ingest_config` default GRANTs revoked from anon/authenticated (migration 294) — anon REST now 401. |
| Public QA | Two real defects found earlier (429 storm fixed in code; headline semantics) + final desktop/mobile QA pass on public & Admin: **all surfaces healthy**. |

**Bottom line:** the system is materially safer and much faster than at the start of the
session, and the free-plan envelope is now honest. Every engineering condition for the INEC
connector is now **proven by drill evidence**; the remaining gate before pointing a real feed
at production is **committing + deploying the working-tree fixes** (connector idempotency-hash
fix, per-endpoint rate limits, pump backoff, release wiring) — see §9.

---

## 2. Benchmark — the head-line number

| | Run 7 (pre-fix) | Run 8 | Run 9 (final) |
|---|---|---|---|
| Run id | `42362bf9…` | `4a2687d0…` | `1b5b4cad…` |
| Steps | 297 | 297 (0 failed) | 297 (0 failed) |
| Wall time | **101 min** | **21.9 min** | **15.8 min** ✅ target band |
| Steady-state rate | **~3.4 steps/min** | ~14/min avg | ~19/min avg, **peaks 97.7/min** |
| Coverage | 34% (at 902 MB — over the real limit) | 15% | 12% |
| Driver drivers racing | 3 | 1 + rare backstop | 1 |

The Run 8 → Run 9 improvement is **migration 292**: the planner was full-scanning
`verifications` via its primary key (2,082 ms/chunk, ×288) because statistics were stale after
the per-run TRUNCATE/refill cycle. `EXPLAIN (ANALYZE)` before/after: **2,082 ms → 177 ms (11.7×)**
from `ANALYZE` alone. Fix: per-table autovacuum analyze thresholds tuned for churn (500 rows / 2%)
plus an explicit per-wave `ANALYZE` in the tick.
| Driver drivers racing | 3 (DB cron + legacy HTTP + JS engine) | 1 (DB cron 53) + rare HTTP backstop |

### Root cause of the old slowness (three independent bugs)

1. **`claim_simulation_step()` early-exit.** It is single-flight and returns NULL whenever any
   step is RUNNING. `neop_sim_tick_local` treated NULL as "queue drained" and *exited the whole
   tick*, losing every race to the HTTP drivers. **Fix: migration 287** — distinguish *drained*
   from *contended*, wait 0.5 s and re-claim within the same budget.
2. **`p_max` starvation.** Job 53 ran `neop_sim_tick_local(24, 50000)`, capping the fastest
   possible run at 297/24 ≈ 12.4 min even when steps cost 0.13 s each. **Fix: migration 290** —
   `p_max 24 → 60`; the 50 s wall-clock budget remains the real bound (it protects against slow
   steps without punishing fast ones).
3. **Per-chunk roll-up.** `sync_simulation_progress()` — two ~176k-row UPDATE…JOINs plus two
   aggregate scans — ran after **every** wave chunk (288×/run), consuming the whole tick budget.
   **Fix: migration 291** — run it once per wave (chunk_index = chunk_count-1), a 24× reduction.

### Residual bottleneck (identified, not yet fixed)

Measured mid-run, the tick's 50 s budget is consumed by **`neop_sim_wave`'s
`CREATE TEMP TABLE wave_cmp`** — a join of `verifications → result_submissions (×2) →
party_results (×2)` filtered on `(election_id, status)`. Observed at **20–36 s per execution**
later in the run, where early waves complete in <0.01 s. This is why Run 8 landed at ~20 min
rather than the ~12 min the tick cadence now allows. Next target: rewrite/denormalise that
comparison (e.g. resolve matches from a per-chunk key set instead of re-scanning the election).

---

## 3. What was actually executed (evidence)

* **Run 8 launched through the real Admin route** — `POST https://ngeop.vercel.app/api/admin/simulate/trigger-v2`
  with a Supabase password-grant admin JWT → **HTTP 202**, `engine: checkpoint_queue`,
  `coverage_pct: 15`, `discrepancy_rate: 0.01`, `display_multiplier: 26`.
* **Run 7 released via `simulation_release_published()`** → `{released: true, method: truncate,
  runs_purged: 1, ledger_cleared: true}`.
* **Storage reclaimed:** DB **902 MB → 121 MB** (release + audit trim + `VACUUM FULL audit_log`).
* **Cadence log:** `_logs/p3-run8-monitor.log` (detached monitor, survives session restarts).
* **Launch log:** `_logs/p3-run8-launch.log`.
* **Phase D evidence:** `_logs/p3-inec-write-drill.json` (17/17), `_logs/p3-inec-killswitch.json` (12/12),
  rollback SQL run twice; `_logs/p3-admin-smoke-prod.json` (5/5 admin gate smoke on production).

---

## 4. Storage design under a 500 MB ceiling  ← the central ask

### The defect

`simulation_quota_check()` hard-coded a **891,289,600 B (850 MB)** ceiling with a 120 MB safety
margin. The free-plan database limit is **500 MB**. Every "coverage ≤ 33%" recommendation the
gate printed was computed against the wrong envelope, and the gate was willing to green-light a
launch that would push the database ~350 MB past the real limit (into read-only mode).

**Fixed in migration 288** — ceiling `524,288,000` (500 MiB), safety `62,914,560` (60 MiB).

### Unbudgeted growth found

`audit_log` was **107 MB of 299 MB** (36% of the post-release baseline). **275,203 of its
277,116 rows were `RESULT_PUBLISHED`/`CANONICAL_RESULT`** — one row per published polling unit,
written by every run and **never trimmed by the release lifecycle**. This is exactly the
"uncontrolled growth" the brief forbids.

`audit_log` also carries `trg_prevent_audit_update`, whose function raised unconditionally, so
the new scoped trim could not run at all. **Migration 289** adds the narrowest possible escape
hatch: only on DELETE, only when `neop.sim_audit_trim = 'on'` (a transaction-local GUC set by
exactly one function), and only for rows provably shaped like simulation publication churn.

**Result:** audit rows **277,116 → 6,124**; `audit_log` **107 MB → ~1 MB**; DB **299 → 121 MB**.
`audit_log` now also joins the staggered post-publication compaction set (5 one-off `VACUUM FULL`s).

### The envelope after cleanup

```
base after cleanup ............ 121 MB
full-universe ledger .......... 143 MB   (176,846 PUs × 850 B)
safety margin .................  60 MB
                                ------
available for results ......... ~197 MB  →  max coverage ≈ 16%
```

**A 100% coverage run is physically impossible on the free plan** (it projects to ~1.37 GB).
Run 7's 34% coverage was itself over the real limit — it lived at 902 MB. **Run 8 was sized at
15%** (the gate's recommended max is 16%), which the gate approved at a projected peak of 441 MB.

> If higher coverage is required, the levers are the per-PU result cost (≈6.2 KB) and the
> full-universe ledger (143 MB fixed). Neither is a config knob today.

---

## 5. Phase 3 INEC connector — built, verified, OFF by default

`POST /api/ingest/inec` (`apps/web/src/app/api/ingest/inec/route.ts`) + storage/migration 283.

| Requirement | Implementation | Verified |
|---|---|---|
| Raw ledger first | `inec_feed_raw`, trigger-immutable payloads, deletes blocked, RLS deny-all | ✅ objects present |
| Schema validation | Zod, versioned (`schema_version: "1.0"`), machine-readable issues → **422** | ✅ |
| Idempotency | key `(election, polling_unit_code, source_sequence)` + payload SHA-256 → ACCEPTED / DUPLICATE / QUARANTINED | ✅ by inspection |
| Default OFF | DB flag **and** env (`INEC_INGEST_ENABLED`); flag is `false` today | ✅ |
| Auth | Bearer secret vs `inec_ingest_config`, constant-time compare, optional IP allowlist | ✅ |
| Feed isolation | Requires `data_mode = LIVE_ELECTION` **or** `inec_rehearsal_mode`; `election_code` must equal the active election | ✅ |
| Kill switch | One UPDATE to `system_config.inec_ingest_enabled` — no deploy | ✅ |

### Phase D — full write-path drill: **17/17 PASS** (`_logs/p3-inec-write-drill.json`)

Executed against the local dev server bound to Run 9's published dataset, via
`_scripts/p3-inec-write-drill.mjs` (retrying fetch for transient Supabase blips, JSON evidence,
fresh per-run sequence band, rollback-readiness check instead of direct deletes).

| # | Case | Observed |
|---|---|---|
| 1 | No `Authorization` | **401** `missing_bearer_token` |
| 2 | Malformed bearer | **401** `invalid_token` |
| 3 | `GET` on the endpoint | **405** |
| 4 | Valid token, flag **OFF** | **503** `inec_ingest_disabled` |
| 5 | Schema-invalid payload | **422** machine-readable issues |
| 6 | Invalid vote value | **422** |
| 7 | Unknown polling unit | REJECTED, reason recorded, no aggregation change |
| 8 | Unknown party (`unknown_party:ZZZZ`) | REJECTED |
| 9 | First valid submission | **ACCEPTED**, normalized result + verification row created |
| 10 | Exact duplicate re-send | **DUPLICATE** → maps to original submission id |
| 11 | Duplicate with different transport metadata | **DUPLICATE** (transport excluded from identity) |
| 12 | Conflicting payload (same key, different result) | **QUARANTINED** |
| 13 | Next source_sequence | **ACCEPTED** |
| 14 | Batch of mixed outcomes | per-item outcomes correct |
| 15 | Retry after network failure | idempotent — no double count |
| 16 | Ledger↔submission cardinality | exactly one submission per ACCEPTED ledger row |
| 17 | Rollback target-set check | compensating-rollback SELECT returns exactly the drill's rows |

**Two real defects found by the drill and fixed:**

1. **uuid-generation broke inside `inec_accept_result()` (migration 293).** The function is
   `SECURITY DEFINER` with `SET search_path = public`, but `result_submissions.id`'s DEFAULT and
   21 other public column defaults plus trigger `fn_trg_rs_timeline` call
   `extensions.uuid_generate_v4()` — unreachable on that search_path. Proven with in-DB probes;
   the sim pipeline was unaffected only because PostgREST sessions include `extensions`.
   Migration 293 rewrote the trigger to `gen_random_uuid()` (pg_catalog, search-path-independent)
   and swept all 22 defaults; a verification DO-block asserts zero remaining references.
2. **Idempotency hash included `observed_at`.** Re-stamped on every retry, so an exact re-send
   was QUARANTINED as a conflict. The identity hash now covers
   `schema_version, election_code, polling_unit_code, source_sequence, result` only —
   `observed_at`/`transport` are excluded (documented in the route header); the full payload is
   still ledgered verbatim.

### Kill-switch drill: **12/12 PASS** (`_scripts/p3-inec-killswitch-drill.mjs` → `_logs/p3-inec-killswitch.json`)

Data flowing → single `system_config` UPDATE kills the feed → new ingestion returns
**503 `inec_ingest_disabled`** (and outranks an idempotent re-send) → no new ledger rows →
already-accepted data intact (party sum = valid votes) → public canonical totals unchanged
(**1,725,595**) → stats endpoint 200 → connector left DISABLED.

### Rollback rehearsal: **executed twice** (`_scripts/p3-inec-rollback.sql`)

Documented, ledger-driven compensating rollback (child→parent ordering, provenance preserved in
`transport_meta.rolled_back_at`, canonical-contamination check). Final state: `inec_submissions: 0`,
**ledger retained as evidence** (41 rows: 7 ACCEPTED / 19 REJECTED / 12 QUARANTINED / 3 DUPLICATE,
ACCEPTED rows marked `rolled_back_at`), **INEC master flag + rehearsal mode both FALSE**, canonical
total unchanged at **1,725,595** — Run 9's exact reconciled party sum.

### Least privilege (migration 294)

`inec_feed_raw` + `inec_ingest_config` had RLS enabled (deny) but still carried the default table
GRANTs to anon/authenticated — including INSERT/UPDATE/DELETE/TRUNCATE. Migration 294 revokes ALL
from anon/authenticated/PUBLIC (matching the `sim_driver_config` pattern) and re-asserts the live
`inec_accept_result()` body (set-based `jsonb_to_recordset` form; the migration-283 file text had
diverged from the live function). Verified: anon REST → **401 `42501`**, service role → 200;
negative probes (`UNKNOWN_PARTY:ZZZZ`, `PARTY_SUM_MISMATCH`) still reject, positive accept works.

---

## 6. Browser QA (performed live during Run 8)

| Surface | Result |
|---|---|
| Public desktop | Renders; live coverage/votes/map updating during the run |
| Public mobile (390 px) | Renders correctly; no overflow |
| Map | Active, "SIMULATED" banner shown per state |
| Live feed / leaderboard / parties | **BROKEN during run** — see issue 1 |
| Admin | Launch through the real route ✅ (Run 8) |

### Final Phase H QA pass — 2026-09-24 ~19:40 UTC, production, DB idle (Run 9 published)

Executed after the Supabase auth-saturation incident recovered (~13:50–19:30 UTC window).
All four surfaces inspected via live browser at 1440×900 and 390×844:

| Surface | Result | Evidence |
|---|---|---|
| Public desktop | **PASS** — headline 44.9M votes, SIMULATION RUNNING badge (20,356 published), realtime CONNECTED, map tiles + markers render, live feed shows party rows, state table 37/37, leaderboard 9 parties | screenshot + network log (all 200s, zero console errors) |
| Public mobile (390 px) | **PASS** — hamburger nav, all sections render, no overflow, honest "No disruptions" empty state | accessibility snapshot |
| Admin desktop | **PASS** — Overview stat cards live, System Data Mode = SIMULATED, Simulation tab renders full Pipeline Control Center (correctly IDLE, STOP disabled) | screenshot |
| Admin mobile (390 px) | **PASS** — all controls stacked correctly; Simulation Lifecycle shows Run 9 stats (20,356 published / 11.5% / disputed 6 / failed 0); Observability counters + Timeline Events render | screenshot + snapshot |
| Admin gate (production) | **PASS 5/5** — password grant, RLS admin row, middleware 307→login unauthenticated, dashboard 200 authenticated | `_logs/p3-admin-smoke-prod.json` |

Not exercised live: a fresh simulation run (Run 9's published dataset left untouched by design).
Issue 1 (429 storm) cannot recur in this idle pass — retest after deploy under load.

### Issue 1 — Self-inflicted 429 storm (severity: high) — **FIXED in code**

* **Symptom:** `GET /api/public/stats`, `/party-results`, `/results`, `/config`,
  `/polling-units/status-changes` all returning **429** on a normal page load. The UI froze at
  coverage 2.6% while the API reported 13.7%; the leaderboard rendered **empty** and the headline
  showed **0**.
* **Root cause:** `rateLimit()` built its bucket key as `` `${ip}:${config.windowMs}` `` —
  **ignoring the endpoint**. Every public route shared one 120 req/min budget per IP, so a single
  page load (6 endpoints, polling) rate-limited *itself*.
* **Fix:** `apps/web/src/lib/rate-limit.ts` — key is now
  `` `${bucket}:${ip}:${config.windowMs}` `` where bucket defaults to the request pathname, so each
  endpoint gets its own budget. Typecheck clean.
* **Retest:** requires deploy; not yet retested in production.

### Issue 2 — Incoherent live state during a run (severity: medium) — **OPEN**

* **Symptom:** headline **"0"** with the **"AWAITING DATA"** badge, while stat tiles showed
  150,514 votes and 2.6% coverage — and `/api/public/stats` returned `leaderboard: []` with
  `source: "live"`.
* **Root cause:** `release_published: true` deliberately blanks the previous dataset, so during
  the run the route serves the *in-progress* run's partial totals while the canonical leaderboard
  is only written at publish. The headline therefore legitimately has no leader.
* **Fix (not applied):** either (a) suppress pre-publish partial totals and render an explicit
  "SIMULATION IN PROGRESS" state, or (b) keep the previous dataset and accept the lower coverage
  ceiling. This is the release-then-run trade-off made visible.

### Issue 3 — Redundant HTTP driver causing contention (severity: medium) — **FIXED in code**

* `/api/public/stats` carries an *opportunistic simulation pump* that POSTs
  `/api/admin/simulate/tick` once per minute **per warm serverless instance**. With the
  in-database pg_cron job available, this is a second driver racing the same single-flight claim —
  measured Sep 24 it was holding steps up to 20.45 s and depressing throughput from the tick's
  24/min ceiling to ~11/min.
* **Fix:** `PUMP_INTERVAL_MS` 60 000 → 600 000 (a 10-minute backstop instead of a competitor).
  Not deployed.

---

## 7. Migrations applied in this session

| File | Purpose | Applied |
|---|---|---|
| `288_quota_500mb_and_audit_churn_release.sql` | real 500 MB ceiling; audit-churn release trim; audit in compaction set | ✅ |
| `289_audit_trim_escape_hatch.sql` | scoped, flag-gated bypass of the immutable-audit trigger | ✅ |
| `290_driver_cadence_p_max.sql` | job 53 → `neop_sim_tick_local(60, 50000)` | ✅ |
| `291_sync_progress_per_wave_not_chunk.sql` | roll up progress once per wave, not per chunk | ✅ (mid-run) |
| `293_uuid_generation_search_path_independent.sql` | trigger `fn_trg_rs_timeline` + 22 public column defaults swept to `gen_random_uuid()`; fixes real defect: `inec_accept_result()` is `SECURITY DEFINER SET search_path = public` and could not reach `extensions.uuid_generate_v4()` | ✅ |
| `294_inec_least_privilege_and_accept_fn.sql` | REVOKE ALL on `inec_feed_raw`/`inec_ingest_config` from anon/authenticated/PUBLIC (default grants allowed INSERT/UPDATE/DELETE/TRUNCATE); re-asserts live `inec_accept_result()` body | ✅ |

*(283–287 from the previous session were re-verified present and correct in-database,
including the migration-287 `v_contended` wait-and-retry and `stagger_minutes` markers.)*

---

## 8. Final reconciliation — Run 9 (PUBLISHED)

**Run 9 published at 15.8 min wall time, 297/297 steps, 0 failed steps.**

Election `3ad8b44f-32f5-4a3a-9fff-f77500f15636`, verified 2026-09-24:

| Measure | Value | Check |
|---|---|---|
| Party sum (published canonical) | **1,725,595** | **= valid votes ✅ exact** |
| `total_votes` (run) | 1,725,595 | matches ✅ |
| Published canonical PUs | 20,356 | = ledger PUBLISHED rows ✅ |
| Disputes (1% config) | 239 | ✅ |
| States + FCT | **37 / 37** | ✅ |
| Coverage | 20,356 / 176,846 = **11.5%** (requested 12%) | ✅ gate-capped |
| Database after publish | **412 MB** | under 500 MB ✅ |
| INEC flag | `false` | still OFF ✅ |
| DB size post-drill (19:35 UTC) | **424.3 MB** | under 500 MB ✅ — includes 41 ledger evidence rows; ~15% headroom |

### Post-publication auto-compaction — VERIFIED (the manual 873→779 MB cleanup is gone)

Run 9's COMPACTION step auto-scheduled **5 bare-statement `VACUUM FULL` one-shots, staggered 3 min
apart** (cron jobs 77–81, fired 12:43 → 12:55):

| Job | Table | Result |
|---|---|---|
| 77 | `party_results` | ✅ 7.9 s — **80 → 64 MB** |
| 78–81 | `canonical_party_results`, `verification_timeline_events`, `result_submissions`, `audit_log` | ✅ scheduled + firing on cadence |

`canonical_party_results` — the exact table the pg_cron 120 s timeout **killed** under Run 7 —
now completes in seconds because the one-shots no longer collide. **No manual vacuum was run
after Run 8 or Run 9.** The only manual vacuum in this session predates the fix.

### Purge-then-run lifecycle — VERIFIED

* `simulation_release_published()` executed twice: `{released: true, method: truncate,
  runs_purged: 1, ledger_cleared: true, purge_failures: 0}` and — with migration 288/289 active —
  **`audit_rows_trimmed: 29,710`**.
* The quota gate then reported **`retained_bytes: 0`** and gated against the true free baseline
  (it correctly *refused* 15% and recommended 12%, which launched cleanly).
* ⚠ The `release_published` route wiring exists only in the **working tree** (HEAD is still
  `9ea7865`). Until committed + deployed, production launches cannot pass the release flag and
  coverage stays capped at ~12% without a manual release.

### Additional findings from the post-publish public check — **BOTH FIXED 2026-09-24 (late session)**

* ~~**Highest-value page 4: `/api/public/stats` returns no populated `leaderboard` at all**~~
  **FIXED:** `getCachedStats()` was dropping `get_election_summary`'s `parties` rows on the floor
  (the same field that makes `/party-results` work). `/stats` now carries `leaderboard` built from
  that one source — 9 parties, display-scaled, percentage shares computed on unscaled totals.
  Verified live: NDC 17,455,048 (38.9%) identical on both endpoints; 4 new consistency tests pin it.
* ~~**Coverage semantics disagree between endpoints**~~ **FIXED (rename, not renumber):** the DB
  emits three distinct, well-defined rates (`coverage_percent` = accounted/total 99.7,
  `published_percent` = published/total 11.5, `verified_percent` = published/reporting 98.0) — the
  defect was UI labelling. The stat card is now **"Accounted"** with the published share shown
  explicitly under it (`· published 11.5%`), the Verified card says "published results", and a
  §2-glossary comment in `api-cache.ts` states each denominator at the source. The stale
  `verification_percent` test assertion (which embodied the old conflation) was corrected to the
  real contract. Also fixed en route: `middleware.ts` bucketed ALL `/api/public/*` into one
  per-IP token bucket — the middleware-layer twin of Issue 1; now per-endpoint (a bot-classified
  visitor drained 60 tokens on one homepage load).
* Remaining work: **commit + deploy** (fixes verified on local dev against production data;
  production still serves the old code).

---

## 9. Final go / no-go for a real INEC feed

### INEC ingestion
* ✅ Feature flag OFF by default (DB flag false; unset env can't enable it) — re-verified after all drills: flags still FALSE
* ✅ Authentication works (401s verified)
* ✅ Authorization / least privilege — anon/authenticated table grants revoked (migration 294); anon REST → 401 `42501`, service role → 200
* ✅ Schema validation works (422 machine-readable issues — drill cases 5–6)
* ✅ Raw ledger works — 41 evidence rows retained (7 ACCEPTED / 19 REJECTED / 12 QUARANTINED / 3 DUPLICATE), immutable
* ✅ Idempotency / duplicate / conflict — **exercised end-to-end** (drill cases 9–15): exact re-send → DUPLICATE mapping to original submission, different-transport re-send → DUPLICATE, conflicting payload → QUARANTINE; hash defect (`observed_at` in identity) found and fixed
* ✅ Kill switch — full drill 12/12: live ingestion killed by one UPDATE, accepted data intact, public canonical totals unchanged
* ✅ Rollback rehearsed twice — ledger-driven compensating rollback; `inec_submissions` → 0, canonical total unchanged at 1,725,595, ledger kept as evidence
* ✅ Staging dry-run write matrix complete — **17/17 PASS**
* ⚠ Connector idempotency-hash fix + migrations 293/294 are **uncommitted working tree** — deploy before pointing a real feed at production

### Simulation
* ✅ Runs launch through the real Admin route
* ✅ Configurable coverage + 1% disputes (239 disputes ≈ 1%)
* ✅ **Reconciliation passes exactly** — party sum = valid votes, verified twice (Runs 8 & 9)
* ✅ Performance: **101 → 21.9 → 15.8 min — the 10–15 min target band is reached**
* ✅ Final DB **412 MB**, inside the 500 MB envelope
* ✅ Post-publication auto-compaction verified (5 staggered one-shots, no manual vacuum needed)
* ✅ Advisory-lock guard unchanged and respected throughout (single-flight claim, 0 failed steps)

### Public system
* ✅ Live updates, map, state pages render — re-verified in final Phase H pass, desktop + mobile, zero console errors
* ✅ `/api/public/stats` leaderboard — **fixed** (same source as `/party-results`; 4 regression tests)
* ✅ Coverage semantics — **fixed**: card labelled "Accounted", published share shown separately, one denominator per word (§2 glossary comment at source)
* ❌ 429 storm (Issues 1 + middleware twin, both fixed in code, **not yet deployed**)

### Admin
* ✅ Real simulation startable through Admin; progress and errors visible

### Database
* ✅ Safely below the 500 MB constraint
* ✅ Audit-churn growth vector closed
* ✅ Post-publication auto-compaction covers 5 churn tables, staggered 3 min apart

**Verdict: GO for a supervised real-feed rehearsal once the working-tree fixes are committed and
deployed.** Every engineering condition above is now proven by drill evidence (17/17 write-path,
12/12 kill-switch, rollback ×2, migrations 293–294 verified in-DB, least-privilege revoked). The
remaining gate is operational, not architectural: HEAD is still `9ea7865`, so the connector's
idempotency fix, per-endpoint rate limits, pump backoff, and release wiring exist only in the
working tree. After deploy: re-run the admin smoke + drill smoke against production, then open a
supervised rehearsal window with the flag ON and the rollback script staged. The two public-reporting
defects (Issues 4/5) are display-semantics defects, not ingestion-path risks — they do not block the
rehearsal but should be fixed before the rehearsal is made public-facing.

---

## 10. Outstanding work, in priority order

1. **Commit + deploy the working tree** — connector idempotency-hash fix, per-endpoint rate limits
   (route layer **and** the middleware public bucket), pump backoff, release wiring, stats
   leaderboard, coverage relabel, migrations 293/294. This is now the **only
   gate** between the current state and a supervised real-feed rehearsal.
2. **Supervised real-feed rehearsal on production** — enable flag in a bounded window, monitor the
   ledger live, kill-switch drill on prod, rollback script staged and ready.
3. Decide the pre-publish public state (Issue 2).
4. Add the audit-churn trim to the per-run CLEANUP step, so churn is bounded even when runs are
   *retained* rather than released.
5. Optional: rewrite `neop_sim_wave`'s `wave_cmp` temp-table join (the residual 20–36 s/chunk
   bottleneck) to push steady-state runs from 15.8 min toward the ~12 min tick-cadence floor.
