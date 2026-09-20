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
