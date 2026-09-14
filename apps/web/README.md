# NEOP Web App

Public results dashboard + admin console for the Nigeria Election Observation Platform. Next.js 15 (App Router), React 19, TypeScript, Tailwind. Part of the npm-workspaces monorepo — **run commands from the repo root**.

## Commands (from repo root)

```bash
npm install          # install all workspaces
npm run dev:web      # dev server on :3000
npm run build:web    # production build (what Vercel runs)
npx vercel deploy --prod --yes   # CLI production deploy — run from REPO ROOT, not here
```

> ⚠️ Deploying with the Vercel CLI from inside `apps/web/` uploads only this directory: the build then fails on `@platform/validation` (workspace package) and runs the wrong build command. Always deploy from the repo root.

## Environment Variables

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://muwocrmdcyzmwqjvvjfj.supabase.co` (project `muwocrmdcyzmwqjvvjfj`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public anon JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ server-only — bypasses RLS |
| `GITHUB_TOKEN` | (local `.env.local` only) GitHub API for deploy status checks |
| `VERCEL_TOKEN` | (local `.env.local` only) CLI production deploys |

Set for production + preview on Vercel. See root `README.md` for architecture rules.

## Results APIs (all derive from `get_election_summary()`)

| Endpoint | Serves | Shape highlights |
|----------|--------|------------------|
| `GET /api/public/stats` | Stats bar, State Breakdown, ticker | `total_votes`, `state_breakdown[]` with `total_pus`, `covered`, `leader_*` |
| `GET /api/public/party-results` | National Leaderboard | `parties[]` ranked by votes (alphabetical tiebreak) |
| `GET /api/public/results` | Live Result Feed | rows with real `state`/`lga` and `party_results[]` summing to `valid_votes` |

Progress/simulation (admin): `/api/admin/simulate/progress` returns `total_polling_units` from the DB — the UI never hard-codes PU counts.

## Key invariants

- national total == Σ state totals == Σ party totals (single numeric basis: party-attributable valid votes; ballots total kept separately)
- Superseding a PU result replaces it (never double-counts); `canonical_party_results` is UNIQUE per (canonical, party) with ON CONFLICT
- Supabase Realtime channels are **named per component** (`…-map`, `…-feed`) — two components must never open the same channel name (mount-order crash); subscribes are try/catch-guarded
- `parties` table columns: `official_name`, `abbreviation`, `color` (there is no `name` column)

## Gotchas

- Node 24, npm workspaces. If the dev server 500s after a production build ran in `apps/web`, delete `apps/web/.next` and restart `npm run dev:web`.
- `unstable_cache` entries persist per server process — after DB surgery, restart the server (or wipe `apps/web/.next`) to avoid stale ISR values.
- The map needs OSM tile network access; in restricted/headless environments tiles won't load (data layers still render).
