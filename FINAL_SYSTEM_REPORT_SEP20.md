# NEOP — FINAL SYSTEM REPORT (September 20, 2026)

## Verdict

**READY FOR CONTROLLED OPERATION.**

Every pipeline the product architecture requires — submission → deterministic + AI
verification → two-submission comparison → one canonical PU result → publication →
state/national aggregation → live feed → map → leaderboard → public site — was
implemented, executed end-to-end at full-country scale under load, reconciled to
zero discrepancy, and verified against the live deployment. It is *not* labeled
"production ready" for a real election because no real INEC feed has ever been
connected; that boundary is data, not architecture.

---

## Simulation runs executed (this effort)

| Run | Scenario | Outcome |
|-----|----------|---------|
| 3 | Normal, full country | PUBLISHED — 9,624 PUs, all 37 states/FCT, reconciled |
| 4 | Close race, 15% discrepancy, high disruption | PUBLISHED — 7,167 PUs, 1,266 disputed, 2,605 failed, 162 disrupted, all 37 states |

Run 4's lifecycle also exercised the persistence contract: Run 3 completed and
*remained* the public dataset until Run 4 was explicitly started; on Run 4
finalization the public site switched to Run 4's data and stayed there. No
simulation ever auto-cleared public results.

## Reconciliation of the live dataset (Run 4, checked this session)

- canonical rows: **7,167** = sum of status counts; duplicate PU rows: **0**
- valid votes: **583,571** = party grand total (583,571) = sum of per-state totals (583,571)
- states covered: **37 / 37** (36 states + FCT)
- published rows without a passing verification record: **0**
- live site `/api/public/config`, `/api/public/stats`, `/api/public/party-results`
  all agree on one election, 7,167 published PUs, 583,571 votes

## Problems found → fixed → retested

1. **Concurrency death spiral** (steps re-claimed up to 45 attempts, ~9 min/step)
   → claim TTL 180s→600s + single-flight guard on the pg_cron driver (commit `72e95ba`)
   → retest: ~5s/step, Run 3 completed and published.
2. **Public leaderboard double-counting across runs** — `/api/public/party-results`
   summed all 3 sim elections (23,160 rows / 8.7M votes) while config/stats showed
   one (7,167 / 583K). Cause: fallback RPC overwrote the scoped primary + unscoped
   count query. → fixed in `api-cache.ts` + migration 270 (RPC scoped to active
   election) + purged superseded runs (commit `d96fefd`) → retest: live endpoints
   serve scoped totals.
3. **`purge_simulation_run` crossed election boundaries** — sim volunteer accounts
   are shared across runs, so the unscoped volunteer sweep would delete the ACTIVE
   dataset's submissions (an FK abort was the only thing that saved it).
   → rewritten election-scoped with guarded account sweeps; refuses to purge the
   active dataset (migration `271`, applied live) → retest: purged Runs 2 & 3 via
   pg_cron one-shot; active dataset intact, reconciliation clean.
4. **CLEANUP step timing out** at the 60s gateway on large archives → added indexes
   on incidents/observations/evidence_records (election_id, volunteer_id); purge
   now completes in-transaction in seconds.

## Admin dashboard audit

All simulation controls map to real, guarded endpoints: start pre-flight
(`v2-pipeline`), progress polling, stop (finalizes + releases lock), purge
(requires `confirm:"PURGE"`, refuses RUNNING runs, calls the fixed RPC, invalidates
caches), history. No dead simulation buttons found in the audit.

## Remaining risks (genuine, not manufactured)

- **Single-flight guard TOCTOU** — ~5 concurrent claims observed under heavy load
  (each fresh, not a spiral). Low impact: steps are idempotent and canonical upserts
  are PU-keyed. Watch in production; a hard advisory lock would close it.
- **Run duration** — full-country runs take ~30–45 min on current step granularity.
  Acceptable for rehearsal; tune wave size before election-day timelines.
- **Real-feed boundary** — ingestion of genuine INEC data is untested by definition;
  the pipeline is the same one the simulator drives, but the first real feed needs
  a supervised rehearsal.
- **Evidence limitation** — live-site verification this session was via HTTP + DB
  probes (all passing); no interactive browser pass after the workspace restarts.

## Final recommendation

Ready for: development, internal demo, controlled testing, pilot, and controlled
election operation with the resilience knobs above noted. Not yet for unattended
production election operation — that requires a supervised real-feed rehearsal.

---

# September 21 addendum — display-completion & progressive-narrative pass

## What was asked and delivered (verified on the live site)

1. **Coverage / Verified reach ~100% when a simulation completes, with total votes shown.**
   Root cause: the coverage ledger RPC only recognized runs in
   `RUNNING/COMPLETED/STOPPED` — a finished run is `PUBLISHED`, so at completion
   the ledger went inactive and every headline stat fell back to DB-wide INEC
   denominators (176,846 PUs), pinning the site at ~4%. Fixed in migration 272:
   ledger recognizes `PUBLISHED`, finalizer reclassifies never-attempted PUs as
   `UNAVAILABLE` (honest reporting-scope denominator), repairs stranded
   disputed/failed PUs, and the stats cache prefers ledger-derived percentages.
   Retest (Run 4): coverage 99.9%, verified 97.8%, total votes 684,455 — all on
   the live site; state rows reconcile (Abia 4,062 PUs / 4,057 covered / 99.9%).

2. **State-breakdown bars track their own PUs/COV/VER numbers** (previously stuck
   at 3–4%). Cause: per-state `coverage_percent` used DB-wide PU totals instead
   of the run's per-state scope. Fixed via run-ledger merge in `api-cache.ts`
   (migration 272 + code). Retest mid-Run-5 (live): all 37 rows present, each
   bar equals its own COV÷PU (e.g. Abia 425/4,062 = 10.5%) and moves as waves
   publish; at finalize they land at the run's ~100% (proven on Run 4).

3. **Progressive national leaderboard — APC leads early, NDC overtakes late.**
   Two parts: (a) `neop_sim_wave` (migration 272) now drifts the close-scenario
   party mix linearly across waves — early waves over-weight APC
   (APC .378/NDC .195), late waves over-weight NDC (APC .182/NDC .405) with the
   wave-weighted mean preserved, so cumulative totals cross after ~wave 10/12;
   (b) `get_election_summary` now follows the RUNNING run's election from its
   first published row (previously the site kept showing the old dataset until
   finalize, hiding the progression). Retest (Run 5, live): at ~5k PUs the site
   shows APC 37.9% / NDC 19.9%; bucket ratios per wave confirm the designed
   drift (0.54 → 0.65 NDC:APC per 100); crossover expected near run end.

## New incident found & fixed during Run 5 (migration 273)

**Wave throughput collapse** (~10 concurrent wave steps → <1 step/8 min on the
free-tier DB). The public stats route's opportunistic pump (tick?max=10, once
per minute per warm serverless instance) plus cron plus dashboard pollers made
unbounded parallel claims. Fixes, all live + committed:
- `claim_simulation_step` now enforces **single-flight** via a per-run advisory
  xact lock + RUNNING-existence check (closes the TOCTOU listed as a risk above),
  with a 3-minute stale-claim reaper (the pump's 50s fetch abort was orphaning
  in-flight waves; idempotent steps make requeue safe).
- Waves execute in 12–22s; healthy cadence observed at ~15–60s/step thereafter.

Commits: `d96fefd`, `03aa679`, `ad56c66`, `f8d3071`, `59de476`, `2dc6e8f`;
migrations 270–273. Run 5 (close scenario, 12 waves, ~44k-PU scope) was launched
through the admin API exactly as the dashboard does — outcome recorded below
when finalized.
