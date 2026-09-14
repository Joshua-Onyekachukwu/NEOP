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
├── convex/                     # LEGACY — not imported by any app; scheduled for deletion
├── scripts/                    # Seeding, health checks, deployment helpers
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

## Simulation

The simulation is a **backend SQL engine** — the frontend never fakes numbers. It generates polling-unit result events through the same ingestion path as live data (`publish_canonical_result`), paced in waves, with a configurable display multiplier (simulation only) and coverage. Simulated mode is labelled prominently on every public surface (`SIMULATION` badge + ticker).

Admin controls: `/admin/dashboard` → Run Simulation (target voters, duration, coverage, display multiplier).

## Deployment

- **Auto-deploy:** push to `main` → Vercel builds with root `vercel.json` (`npm run build:web` across the workspace).
- **CLI deploy (fallback):** run `npx vercel deploy --prod --yes` **from the repo root** — never from `apps/web/` (a subdirectory deploy misses the `packages/` workspace and uses the wrong build).
- Vercel Hobby plan does not allow scheduled crons — the dead-letter reaper runs via **pg_cron** inside Supabase (migration 244).
- **Vercel dashboard → ngeop → Settings → Git → Production Branch** must be set to `main` (dashboard-only setting; until flipped, pushes build previews and production ships via CLI deploys).

## Deployment verification

1. `GET /api/public/stats` — `total_votes` == sum of `state_breakdown[].total_votes`
2. `GET /api/public/party-results` — party sum == national total; ranked by votes
3. `GET /api/public/results?limit=3` — rows carry real state/LGA names and party chips summing to `valid_votes`
4. Homepage shows the SIMULATION badge and 176,846 total PUs (real INEC geography, from the database)

## License

Proprietary — All rights reserved.
