# NEOP Deployment Instructions

## Current Status
- **Live Site:** https://ngeop.vercel.app/
- **Supabase:** https://muwocrmdcyzmwqjvvjfj.supabase.co (project ref `muwocrmdcyzmwqjvvjfj`)
- **Vercel project:** `ngeop` (Hobby plan) — production branch setting: see "Production branch" below

## Architecture
All data lives in Supabase PostgreSQL. The simulation engine runs as SQL functions; scheduled jobs (dead-letter reaper) run via **pg_cron inside Supabase** — not Vercel crons (Hobby plan forbids them). No external services required.

## Deployment Options

### Option 1: Push to GitHub (Recommended)
```bash
git push origin main
```
Vercel builds the push automatically using the root `vercel.json` (`npm run build:web` across the npm workspace). Check the commit status on GitHub (`Vercel`) for the build result.

> Note: until the Vercel dashboard setting **Settings → Git → Production Branch** is changed from `master` (a deleted branch) to `main`, pushes to `main` create *preview* deployments. Promote them in the dashboard or use Option 2 for production.

### Option 2: Manual Deploy with Vercel CLI
Run from the **repo root** (never from `apps/web/` — a subdirectory deploy misses the `packages/` workspace):

```bash
# VERCEL_TOKEN is stored in .env.local (gitignored)
VT=$(grep -oE "^VERCEL_TOKEN=vcp_[A-Za-z0-9]+" .env.local | cut -d= -f2- | tr -d '\r')
npx vercel deploy --prod --yes --token "$VT"
```

### Option 3: Deploy via Vercel Dashboard
1. Go to https://vercel.com/dashboard
2. Select the "ngeop" project
3. Open the latest preview deployment → "Promote to Production"

## Environment Variables (Vercel: production + preview)

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://muwocrmdcyzmwqjvvjfj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (from Supabase dashboard → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase dashboard → API; server-only) |

## Production branch (one-time dashboard fix)
Vercel → ngeop → **Settings → Git → Production Branch** → set to `main`. This is a dashboard-only setting (the REST API refuses it). Once set, every push to `main` deploys production automatically.

## After Deployment

1. Verify the live site shows **176,846 polling units** (real INEC geography from the database — never a hard-coded number)
2. Check `/api/public/stats`: `total_votes` == sum of `state_breakdown[].total_votes`
3. Check `/api/public/party-results`: party sum == national total, ranked by votes
4. Test admin/agent login (Google OAuth)
5. Run a test simulation and confirm the feed, leaderboard, state breakdown and map update together

## Google OAuth Setup (Required for Login)

1. Go to Google Cloud Console
2. Create OAuth 2.0 credentials
3. Add redirect URIs:
   - `https://ngeop.vercel.app/auth/callback`
   - `https://muwocrmdcyzmwqjvvjfj.supabase.co/auth/v1/callback`
4. In Supabase Dashboard → Authentication → Providers → Google:
   - Enter Client ID
   - Enter Client Secret
5. In Supabase Dashboard → Authentication → URL Configuration:
   - Site URL: `https://ngeop.vercel.app`
   - Redirect URLs: `https://ngeop.vercel.app/**`

## Login Details

### Admin Login
- **URL:** https://ngeop.vercel.app/admin/login
- **Method:** Google OAuth (requires setup)
- **Role:** Admin (determined by email in admin_users table)

### Agent Login
- **URL:** https://ngeop.vercel.app/agent/login
- **Method:** Google OAuth (requires setup)
- **Role:** Agent (default for Google OAuth users)

## Current Data in Database

| Table | Count |
|-------|-------|
| States | 37 (36 + FCT) |
| LGAs | 774 |
| Wards | 8,793 |
| Polling Units | 176,846 |
| PUs with Coordinates | ~97% |

## Scheduled Jobs

| Job | Where | Schedule |
|-----|-------|----------|
| `dead-letter-reaper-10min` | pg_cron in Supabase (migration 244) | every 10 minutes |

Manual trigger: `POST/GET /api/admin/cron/dead-letter-reaper-hourly` (admin-authenticated) — calls `process_dead_letter_batch(50)`.
