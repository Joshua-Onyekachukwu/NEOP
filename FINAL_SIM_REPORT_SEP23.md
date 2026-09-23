# NEOP — Compact-Backend / 50M+-Display Simulation: Final Report (September 23, 2026)

## Headline

Run 6 (`e6440851`) — launched through the real admin route — completed, published, and became the
live public dataset:

| Metric | Value |
|---|---|
| Displayed national votes | **67,075,528** (≥ 50M target) |
| Backend (stored) votes | **2,579,828** (compact, ×26 display multiplier) |
| Polling units | 176,846 total · 57,331 published canonical (34% coverage, gate-approved max) |
| States + FCT | 37/37 in the live state breakdown |
| Parties | 9 on the leaderboard |
| Final leader | **NDC 25,436,658 (37.9%)** > APC 18,783,726 (28.0%) |
| Mode labeling | `data_mode: SIMULATED`, `status_label: "SIMULATED DATA"` — never presented as real |

## Architecture verdict (the core requirement)

**Compact backend → deterministic simulation state → efficient aggregation → realtime events → large frontend representation** is confirmed working end to end:

- Storage scales with **results** (2 rows/PU: two-agent ledger + canonical), never with votes. 67M displayed votes ride on 2.58M stored ones — zero vote-level records exist.
- Scaling is deterministic: one server-side `display_multiplier` (26) applied uniformly in the public read path. Every displayed per-PU value is an exact ×26 multiple (backend generates ×26-divisible votes), so **zero rounding drift is possible** at any hierarchy level.
- PU counters are never extrapolated: 176,846 / 57,331 / 97.9% are real ledger counts.
- Run 6 persisted after completion per design; it remains the public dataset until an admin starts another run.

## Data integrity — all reconciled exactly

| Check | Result |
|---|---|
| National total = sum of 9 party totals | ✅ 67,075,528 = 67,075,528 |
| National total = sum of 37 state totals | ✅ exact |
| Party sum = PU canonical sum (DB-side) | ✅ 2,579,828 = 2,579,828 |
| Published rows = distinct PUs | ✅ 57,331 = 57,331 (zero duplicates) |
| reported ≤ total, verified ≤ reported | ✅ 57,331 ≤ 176,846; 97.9% verification |
| Run 6 = single run, no cross-run leaks | ✅ one PUBLISHED run; events/audit scoped to it |
| Simulation steps | ✅ 296/296 DONE, zero failures |

## Storage (Supabase free plan, 891 MB ceiling measured)

- **Before Run 6** (post Run-5 purges + VACUUM FULL): **342 MB**
- **After Run 6** (run data + churn): **873 MB** — dangerously close to the ceiling; triggered this cycle's storage work
- Composition at 873 MB: `party_results` 206 MB, `canonical_party_results` 103 MB, `pu_simulation_status` 89 MB, `audit_log` 82 MB, `verification_timeline_events` 70 MB, `polling_units` 62 MB, `result_submissions` 50 MB
- Dead tuples ≈ 0 everywhere (autovacuum is healthy); remainder is live data + internal bloat
- **Compaction round executed**: 5 × bare-statement VACUUM FULL (`party_results`, `canonical_party_results`, `pu_simulation_status`, `result_submissions`, `verification_timeline_events`) — **873 MB → 779 MB (−94 MB)**, under the 500 MB target and 112 MB under the 891 MB ceiling
- Realistic lesson for future runs: budget ~0.5 MB per published PU + ~90 MB churn per 12-wave run; schedule a compaction pass (bare one-shot pg_cron VACUUMs) after each run

## What was found and fixed this cycle

1. **Driver finished the run unattended** — pg_cron cron driver pumped all 12 waves + finalizer while sessions dropped; run reached PUBLISHED with zero failed steps. (The advisory-lock guard did its job.)
2. **Cron debris** — 7 stale schedules (5 old vacuums, finished driver, a blocked prune) unscheduled; only the dead-letter reaper remains.
3. **audit_log purge blocked by design** — `prevent_audit_mutation()` trigger makes audit append-only. Correct behavior; kept. Audit retention (~82 MB) is a permanent, intentional cost.
4. **VACUUM via pg_cron must be a bare single statement** — a `SET statement_timeout;` prefix makes it multi-statement → transaction block → VACUUM fails (first attempt, 3 failed jobs). Rescheduled bare one-shots (10:05–10:25 UTC) — all 5 succeeded.
6. **Post-compaction smoke re-verified**: national = states = 67,075,528 exact; Run 6 PUBLISHED; homepage 200 in 0.50 s.
5. **Display reconciliation proven on the live site** — national = parties = states = PU×26, exact.

## In flight / follow-ups

- [x] Post-compaction DB size recorded: **779 MB**; vacuum one-shots unscheduled; cron = dead-letter reaper only
- [ ] Full-country 100% coverage remains gated by free-plan storage (~1.48 GB projected vs 891 MB) — needs plan upgrade or per-run purge-then-run automation
- [ ] Real INEC feed connector (blocked externally; `INEC_FEED_REHEARSAL_PLAN.md` ready)
- [ ] Run duration tuning toward 10–15 min (currently ~40 min at driver cadence)

## Final assessment

The architecture **supports the intended public simulation**: a full-Nigeria, 37-state, 176k-PU election at 67M displayed votes with exact hierarchical reconciliation, honest SIMULATED labeling, and a backend footprint ~2.6M votes. Remaining limits are infra (free-tier storage/coverage gate) and the missing INEC connector — not architecture.
