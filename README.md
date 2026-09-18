# Nigeria Election Observation Platform (NEOP)

Independent, evidence-backed election observation and verification platform for Nigeria — built for full-scale election simulation and live election-day operation.

**Live site:** https://ngeop.vercel.app · **Repo:** `main` branch (only branch; `master` was archived as tag `archive/master-v1-sep03`)

## ⚠️ CRITICAL RULES FOR THE DEVELOPMENT TEAM

These rules must be understood and followed by every contributor:

1. **Supabase is the single authoritative source of truth.** All election data — geography, elections, results, aggregations — lives in PostgreSQL. There is no second database.
2. **One aggregation layer for all results surfaces.** `get_election_summary()` (migration 242) is the authoritative rollup. The National Leaderboard, State Breakdown, Live Feed, Map, and stats counters all consume it — no component computes its own totals.
3. **Every observation belongs to exactly one election and polling unit.** No anonymous results exist.
4. **Agents cannot select arbitrary polling units during result submission.** The backend derives the polling unit from the assignment.
5. **Authorization must be enforced server-side and at the database layer.** Never rely on "the UI doesn't show the button."
6. **Never collect or store how an individual voted.** This is a non-negotiable technical constraint.
7. **Never build a shadow voter register.** The platform does not track voter participation.
8. **AI assists verification; humans make consequential decisions.** AI does not accuse anyone of fraud.
9. **An anomaly is not automatically fraud.** Public language: "Flagged for review."
10. **No result is presented as an official INEC result unless it actually comes from INEC.** All independent results carry explicit disclaimers, and simulated data is always labelled `SIMULATION`.
11. **No volunteer should put themselves in danger to collect data.** Safety takes absolute priority.
12. **Preserve evidence; don't overwrite history.** Corrections create new audit events; superseded results are kept, never deleted.
13. **Political neutrality is a system requirement.** No party colors in chrome, no candidate endorsement, no political profiling.
14. **Election-day reliability takes priority over fancy features.** Build boring, reliable software.
15. **No hard-coded result or geography numbers in the UI.** Denominators like the PU count come from the database (`inec_total_polling_units`), never literals.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS |
| Hosting | Vercel (`ngeop` project, Hobby plan) |
| Database | Supabase PostgreSQL 15 + PostGIS (project `muwocrmdcyzmwqjvvjfj`) |
| Auth | Supabase Auth (Google OAuth) |
| Storage | Supabase Storage (evidence bucket) |
| Realtime | Supabase Realtime (postgres_changes channels per component) |
| Scheduled jobs | pg_cron in-database (dead-letter reaper every 10 min) |
| Maps | MapLibre GL + OpenStreetMap tiles |
| Validation | Zod (`packages/validation`) |
| Source Control | GitHub (`Joshua-Onyekachukwu/NEOP`) |

> Convex was removed from the codebase in September 2026. The `convex/` directory is legacy and nothing imports it.

## Project Structure

```
nigeria-election-platform/
├── apps/
│   ├── web/                    # Public dashboard + admin console (the deployed app)
│   └── observer/               # Observer field app (PWA, in progress)
├── packages/
│   ├── database/               # TypeScript types
│   ├── validation/             # Zod schemas (@platform/validation)
│   └── ui/                     # Shared UI components
├── supabase/
│   ├── migrations/             # Numbered migrations (apply newest via Supabase MCP/SQL editor)
│   └── RECOVERY_DISK_FULL.sql  # Emergency cleanup for Supabase free-tier disk limit
├── _scripts/                   # Ops: E2E sim test, debris cleanup, favicon build, secret upload
└── docs/
    ├── ARCHITECTURE_RUNBOOK.md # Architecture + runbook
    └── ...                     # Audits and operational procedures
```

## Getting Started

```bash
# Install dependencies (npm workspaces)
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials (NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)

# Apply migrations (newest first, via Supabase MCP execute_sql or the SQL editor)
# Then start the app:
npm run dev:web      # Public dashboard (port 3000)

# Production build (what Vercel runs):
npm run build:web
```

## Results Data Flow

```
Simulation engine (SQL) / Live agent submission
          ↓
publish_canonical_result()  — validated, idempotent, supersedes prior PU results
          ↓
canonical_pu_results + canonical_party_results   (per polling unit)
          ↓
get_election_summary()  — ONE authoritative RPC
   ├→ /api/public/stats          → stats bar, State Breakdown, ticker
   ├→ /api/public/party-results  → National Leaderboard
   ├→ /api/public/results        → Live Result Feed (real PU/LGA/state per event)
   └→ map layers                 → PU status markers
```

Invariants (verified by E2E tests): national total == sum of state totals == sum of party totals; duplicate submissions supersede rather than add; per-row feed party chips sum exactly to the row's valid votes.

## Simulation Architecture

The simulation is a **backend SQL engine** — the frontend never fakes numbers. It generates polling-unit result events through the same ingestion path as live data (`publish_canonical_result`), so everything the public site shows during a simulation is produced by the real pipeline.

### Lifecycle

```
Launch (POST /api/admin/simulate/trigger-v2)          → 202 in ~2s
   ↓ (background)
1. INIT      — archive any prior run, mint [SIM] election
2. LEDGER    — every PU in Nigeria is assigned a coverage status
               (chunked, hash-sliced, resumable)
3. OUTCOMES  — dispute/failed/disrupted profile applied INSIDE the
               engine's coverage scope only (migration 250/253)
4. WAVES     — 6 paced waves; each wave = N idempotent chunks
               (agents file submissions → pair → verify → publish)
5. FINALIZE  — run marked COMPLETE, pointer flips back, banner updates
```

The engine state lives **in the database** (`sim_run_steps` queue, migrations 251/252), not in a serverless function. Every step is claimed/completed atomically, so runs **survive restarts and serverless timeouts** — anyone (or anything) can drive the queue forward:

- **Site-traffic pump** — every public `/api/public/stats` request opportunistically ticks the queue (throttled, fire-and-forget)
- **Tick endpoint** — `POST /api/admin/simulate/tick` with `x-cron-secret: $CRON_SECRET` (or admin session)
- **E2E script** — `_scripts/e2e-sim-test.mjs` launches, pumps, and asserts the full lifecycle

### Coverage ledger (full-PU accounting)

Every one of the 176,846 INEC polling units is accounted for at all times (migration 245). The invariant `published + disputed + failed + disrupted + unavailable + awaiting == total_pus` is asserted by the E2E test. "Unavailable" is a real outcome — PUs the engine never reached — never a silent gap.

### Display multiplier (simulation only)

Real elections render exactly what the backend stores. During simulations, `system_config.display_multiplier` scales every public number (votes, PU counts) so a backend handling e.g. 1M real voters can render as 30M on the site. The multiplier is set at launch and applies **only** while `data_mode = SIMULATION`; live mode always uses ×1.

### Capacity envelope (Supabase Free plan)

Storage cost tracks **coverage**, not voters: the ledger is ~850 B per polling unit (× 176,846 ≈ 150 MB) and each *published* PU drags in its canonical rows at ~6.2 KB all-in. Target/display voters are never materialised — only the totals are, so `display_voters` is free.

Every launch runs `simulation_quota_check(coverage_pct)` **before any state is touched**. It projects the peak, nets out what the queued CLEANUP step will purge, and refuses the launch with HTTP 400 (naming the coverage that *would* fit and how many PUs that is) when the projection exceeds the plan envelope: **850 MB ceiling, 120 MB safety margin → ~730 MB usable**.

Measured against real runs from a clean baseline (~215 MB after compaction):

| Coverage | Projected peak | Observed / verdict |
|---|---|---|
| 20% | 584 MB | 558 MB observed — ✓ comfortable |
| 25% | 639 MB | ✓ comfortable |
| 30% | 694 MB | ✓ tight but fits |
| ≥ 40% | > 730 MB usable | ✗ refused pre-flight with a recommended maximum |

**Every launch clears the previous simulation first.** Step 1 of each run is a durable `CLEANUP` step that purges the prior run — results, ledger, sim observer accounts, `[SIM]` elections — and resets live data, so relaunching never accumulates debris and the new run's outcome becomes what the live site renders. It runs inside the engine's step budget (10-minute statement timeout), never inside the HTTP request, so the browser gets its 202 in milliseconds.

Want bigger on-screen numbers? Raise **display_voters**, not coverage — it costs no storage.

### Admin controls (`/admin/dashboard`)

| Control | Effect |
|---|---|
| **Run Simulation** | Params: target voters, duration (min), coverage %, display multiplier. Refused pre-flight if the projected peak would breach the plan envelope; on success the first queued step purges the previous run and resets live data (see *Capacity envelope*). Archives any prior run first (single-active lock). |
| **Stop** | Finalizes the coverage ledger (unreached PUs → UNAVAILABLE), marks the run STOPPED, releases the lock. Idempotent. |
| **Purge** | Deletes a stopped run's [SIM] election and all debris (submissions, agents, canonicals). Requires typed confirmation. |

Progress is visible on the dashboard (steps done/total) and publicly via the SIMULATION ticker banner.

### Running a simulation locally

```bash
# 1. Build & serve the production build (dev server works too)
npm run build:web && cd apps/web && npx next start -p 3000

# 2. Ensure CRON_SECRET exists in apps/web/.env.local (copied from repo root)

# 3. Log in as admin and grab a session token (see NEOP_ADMIN_* in .env.local)
#    POST {NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password

# 4. Launch (from repo root).
#    target_voters = what the DB stores; display_voters = what the site
#    renders. The engine derives display_multiplier from the ratio, so
#    a small real dataset can render a big national total.
curl -X POST http://localhost:3000/api/admin/simulate/trigger-v2 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  # coverage_pct must fit the envelope above (25% is comfortable on a clean DB)
  -d '{"target_voters":300000,"display_voters":30000000,"duration_minutes":10,"coverage_pct":25,"scenario":"close","max_published_pct":0.78}'

# 5. Drive it. `Authorization: Bearer $CRON_SECRET` is the cron path.
curl -X POST http://localhost:3000/api/admin/simulate/tick?max=1 \
  -H "Authorization: Bearer $CRON_SECRET"

# Full automated lifecycle test with assertions:
node _scripts/e2e-sim-test.mjs
```

#### Driving the queue reliably

```bash
# Serial pump against a long-lived server (no serverless time cap).
# Run this instead of hand-calling /tick when a run must finish.
bash _scripts/local-pump.sh http://localhost:3000 1
```

Three hard limits shape how a run must be driven. **Every queue step has to
finish inside all three**, or it is marked FAILED and its slice of polling
units never publishes:

| Limit | Value | Where it comes from |
|---|---|---|
| Function `statement_timeout` | 60–300s | per-function, migration 257 |
| API gateway | ~120s | Supabase PostgREST request ceiling |
| Serverless invocation | ~60s | Vercel `maxDuration` on `/api/admin/simulate/tick` |

Consequences worth remembering:

- **One step per tick.** Claiming many heavy wave steps at once (`max=10`)
  makes them contend for the same rows and the database starts cancelling
  them with `statement timeout`. The pump therefore defaults to `max=1`.
- **Full coverage is genuinely heavy.** 100% coverage means all 176,846 polling
  units get a ledger row and ~141k of them publish. That is hours of database
  work on the Free plan, so keep `target_voters` small and let
  `display_voters` do the scaling.
- **Chunk size is the knob for step duration.** `sim_run_steps.chunk_count`
  controls how many slices a wave is split into; more, smaller slices fit
  inside the gateway limit where fewer, larger ones time out.
- A step that does time out can be re-queued safely — every step is
  idempotent. Reset it and let the pump pick it up again:

```sql
update sim_run_steps set status='PENDING', attempts=0, claimed_at=null,
       finished_at=null
 where run_id = '<run uuid>' and status='FAILED';
select reclaim_stale_steps(0);   -- release steps whose worker died
```

If it is specifically the last LEDGER step that keeps failing, its expensive
half is the whole-universe outcome assignment. That one call can be made
directly (and then the step marked DONE), which unblocks every wave step —
they publish nothing until outcomes exist:

```bash
node _scripts/assign-outcomes.mjs <run uuid> 100
```

Note: the middleware rate-limits `/api/admin/simulate/*`; valid `CRON_SECRET` and admin-session requests are exempt. Local Node on Windows may exit with a libuv teardown crash after success — check the log tail, not the exit code.

## Deployment

- **Auto-deploy:** push to `main` → Vercel builds with root `vercel.json` (`npm run build:web` across the workspace). The project's Git integration `productionBranch` is `main` (fixed via `POST /v10/projects/{id}/link` with `productionBranch` — the field lives on the link object, not the project).
- **CI validation:** GitHub Actions (`.github/workflows/production-deploy.yml`) runs typecheck, tests, the PU-count lint, and a **no-env production build** on every push — it validates without deploying, so Vercel never double-deploys.
- **CLI deploy (fallback):** run `npx vercel deploy --prod --yes` **from the repo root** — never from `apps/web/` (a subdirectory deploy misses the `packages/` workspace and uses the wrong build).
- Vercel Hobby plan does not allow scheduled crons — the dead-letter reaper runs via **pg_cron** inside Supabase (migration 244), and the simulation queue is driven by site traffic / the tick endpoint (see Simulation Architecture).

## Deployment verification

1. `GET /api/public/stats` — `total_votes` == sum of `state_breakdown[].total_votes`
2. `GET /api/public/party-results` — party sum == national total; ranked by votes
3. `GET /api/public/results?limit=3` — rows carry real state/LGA names and party chips summing to `valid_votes`
4. Homepage shows the SIMULATION badge and 176,846 total PUs (real INEC geography, from the database)

## License

Proprietary — All rights reserved.
