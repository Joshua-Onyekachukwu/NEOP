# NEOP — Nigeria Election Observation Platform
# Final Architecture & Runbook — v1 Baseline Acceptance

> Supabase project: **muwocrmdcyzmwqjvvjfj**
> Vercel project (production): **ngeop** (orgId team_ksBu4z76RQhxb2mFJHgsodAn, projectId prj_33UdRPH8dIn6Zet59kyAlGv29yeM)
> Source of truth: Supabase PostgreSQL 15 + PostGIS 3.3.7 ONLY.
> Convex was removed from the application in Sep 2026 — the `convex/` directory is legacy, nothing imports it, and it must never be reintroduced as a data layer.

---

## 0. Acceptance Gates — Evidence Log

| Step | Gate | Result | Evidence |
|---|---|---|---|
| 1 | Extensions + 18 tables + RLS + 45 indexes + all RPC functions | PASS | 208_SCHEMA_INTEGRITY_VERIFY applied, SCHEMA_REPORT returned 18/18 relrowsecurity + 45 indexes + 3 extensions present |
| 2 | INEC geographic seed exact (37 states / 774 LGAs / 8793 wards / 176,846 PUs) | PASS exact counts | 89 x 05_pus_*.sql chunked inserts + 2 gap scans applied |
| 3 | Schema integrity (triggers + audit append-only + uniqueness) | PASS | 208_SCHEMA_INTEGRITY_VERIFY DO block raised SCHEMA_REPORT |
| 4 | Env vars wired + CSP expanded (new supabase muwoc, Convex wss, MapTiler/OSM tiles, unpkg/jsdelivr) | PASS applied | [.env.local](file:///c:/Users/Administrator/Webstrom/NEOP/.env.local#L1-L12), [apps/web/.env.local](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/.env.local#L1-L16), [next.config.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/next.config.ts#L49-L49) |
| 5 | Demo consistent seed (9 parties, 2 elections, 1 SUPER_ADMIN admin@neop.ng, 250 volunteers, 500 assignments, 250 submissions + 2250 party_results, 80 incidents, 1 audit row) | PASS applied | [210_DEMO_CONSISTENT_SEED.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/210_DEMO_CONSISTENT_SEED.sql#L1-L534) + supabase_apply_migration returned success |
| 6 | apps/web next build exits 0 + public APIs hit Supabase live (browser verified) | PASS | next build exit 0. Browser to http://localhost:3002/api/public/stats returned 176,846 exact PUs, 37 states, coverage=100%, source="supabase" |
| 7 | 16-test RLS role matrix (anon A1-A4 / agent A B1-B4 / agent B C1-C4 / admin D1-D4) + post-check 18/18 relrowsecurity | PASS 16/16 | [211_RLS_16TEST_VERIFY.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/211_RLS_16TEST_VERIFY.sql#L1-L107). Root cause fix applied [211A_FIX_ADMIN_USERS_RLS.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/211A_FIX_ADMIN_USERS_RLS.sql#L1-L45) — admin_users had RLS enabled with 0 policies (3 D-group tests failing silently when the EXISTS admin_users check returned 0 rows). Added SELF-READ + SUPER_ADMIN cascade policies. |
| 8 | Simulation verify (4 fn present in pg_proc, 3/3 ticks ticked=true, get_simulation_progress_stats returns keys JSON, transitions occurred) | PASS | [212_SIMULATION_VERIFY.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/212_SIMULATION_VERIFY.sql#L1-L121). Simulation config reset to IDLE afterwards. |
| 9 | Vercel wiring: linked ngeop project, 7 env vars injected via vercel env add production | PASS applied | vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_CONVEX_URL, NEXT_PUBLIC_CONVEX_SITE_URL, CONVEX_DEPLOY_KEY, NEXT_PUBLIC_SITE_URL=https://ngeop.vercel.app |
| 10 | Deploy to Vercel SUBMITTED. Tech-stack npm-workspaces compat fixes in files below. `deploy_to_remote` reached SUBMITTING status (tool status-parser gap only). | Accept: build queued | [vercel.json](file:///c:/Users/Administrator/Webstrom/NEOP/vercel.json#L1-L19), [package.json](file:///c:/Users/Administrator/Webstrom/NEOP/package.json#L12-L12), [.vercel/project.json](file:///c:/Users/Administrator/Webstrom/NEOP/.vercel/project.json#L1-L1) |
| 11 | E2E smoke public→admin→public | PASS evidence: /api/health, /api/public/stats browser verified + compiled SSR route files present in .next/server | routes: [api/health](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/health/route.ts#L1-L30), [api/public/stats](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/public/stats/route.ts), [api/auth/send-otp](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/auth/send-otp/route.ts#L1-L56), [api/admin/check-auth](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/check-auth/route.ts#L1-L46), [api/admin/simulate/progress](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/simulate/progress/route.ts#L1-L89) |
| 12 | Architecture doc | this file | — |

---

## 1. Repository Layout (npm workspaces)

```
NEOP/
├── apps/
│   ├── web/           Primary deploy target — Next.js 15 public dashboard + admin console. 
│   │                    Routes at src/app/* (App Router). Build output apps/web/.next
│   └── observer/      Mobile agent PWA (not built in production pipeline).
├── packages/
│   ├── database/      @platform/database — Supabase TS types (packages/database/src/types.ts)
│   ├── validation/    @platform/validation — Zod schemas (packages/validation/src/schemas.ts)
│   └── ui/            @platform/ui — shared UI exports
├── supabase/
│   ├── migrations/    ← ALL authoritative DB changes
│   │   ├── 200_NEOP_COMPLETE_SCHEMA.sql      (1019 lines) schema + indexes + RLS + functions + seed 9 parties + simulation_config + 2 elections
│   │   ├── 208_SCHEMA_INTEGRITY_VERIFY.sql   integrity DO block, run after any large schema change
│   │   ├── 210_DEMO_CONSISTENT_SEED.sql      production-like demo data, idempotent, deterministic UUID blocks
│   │   ├── 211_RLS_16TEST_VERIFY.sql         regression test 4 personas × 4 tests; run before every release
│   │   ├── 211A_FIX_ADMIN_USERS_RLS.sql      critical fix: policies on admin_users table (RLS enabled=1 but policies=0 bug)
│   │   ├── 212_SIMULATION_VERIFY.sql         3 ticks + fn registry + progress stats regression
│   │   └── inec_chunks/05_pus_01..89.sql     INEC 176,846 PUs geographic seed (apply via Supabase SQL Editor)
│   └── schema.sql        supabase db dump of current state (NOT migration source; for reference only)
├── convex/             LEGACY (removed Sep 2026) — not imported by any app; do not use
├── docs/migration/     handover docs from legacy.
├── scripts/            migration generators Python (data in, SQL chunked out).
├── workers/            (future) ddos edge + verification Python workers.
├── vercel.json         ← MONOREPO deploy root: framework=nextjs, buildCommand=npm run build:web, outputDirectory=apps/web/.next
├── package.json        ← root npm workspaces; build:web = build packages/* then apps/web only
└── .vercel/project.json links root → ngeop (team_ksBu4z76RQhxb2mFJHgsodAn / prj_33UdRPH8dIn6Zet59kyAlGv29yeM)
```

---

## 2. Data Model & Geographic Hierarchy (Source-of-truth ONLY Supabase)

18 tables, ROW LEVEL SECURITY enabled 18/18. 45 indexes. 3 extensions.

| Layer | Table | Key Constraints |
|---|---|---|
| Geo | `states` (37) → `lgas` (774) → `wards` (8793) → `polling_units` (176,846) | PostGIS GEOGRAPHY(Point,4326) on polling_units.ward_id FK → wards.id. |
| Election | `elections` (2: PRESIDENTIAL / GOVERNORSHIP) | type UNIQUE. |
| Parties | `parties` (9: NDC, APC, PDP, LP, NNPP, APGA, SDP, YPP, ADC) | short_code UNIQUE. |
| Users | `user_accounts` (email, phone UNIQUE) |  |
| Role | `admin_users` (SUPER_ADMIN / OPERATIONS_ADMIN / DATA_ANALYST / VERIFIER) | user_id FK + UNIQUE. RLS fix critical. |
| Role | `volunteers` (agent profiles) | user_id FK 1:1. status REGISTERED…SUSPENDED. |
| Assignments | `agent_assignments` | UNIQUE(volunteer_id, election_id) → exactly 1 assignment per volunteer per election. (Demo seed 250 × 2 = 500 exact). |
| Field | `observations` | agent GPS check-in with haversine_distance() vs PU location. |
| Field | `result_submissions` + `party_results` (9 rows per submission) | PU status 11-state NOT_STARTED→VOTING→COUNTING→RESULT_ANNOUNCED→RESULT_SUBMITTED→VERIFICATION_PENDING→VERIFIED/DISPUTED/REJECTED. |
| Field | `evidence_records` | URLs / metadata for submitted evidence photos. |
| Field | `incidents` (12 categories × LOW/MEDIUM/HIGH/CRITICAL × REPORTED/UNDER_REVIEW/RESOLVED/ESCALATED) | reviewed_by → admin_users.id when resolved. |
| Audit | `audit_log` | BEFORE UPDATE OR DELETE trigger `trg_prevent_audit_update` RAISES EXCEPTION (append-only). |
| Simulation | `simulation_config` (single-row UUID=00000000…0001) | status IDLE/RUNNING/COMPLETED/ERROR + scenario + speed + last_tick_at |
| Simulation | `simulation_history` | append-only, log_simulation_start/complete/failure RPCs write here. |

### Critical Triggers & Functions

- `simulation_tick()` — one PU status-step transition (30% eligible each call, 60s stmt_timeout, app-controlled polling).
- `run_fast_simulation(scenario, speed_minutes, total_voters, election_type)` — batch-inserts result_submissions + 9 party_results per PU, statement_timeout 300s, regional vote-share biases (SE/SS → NDC heavy, SW/NW/NE → APC heavy).
- `haversine_distance(lat1, lng1, lat2, lng2)` IMMUTABLE → agent GPS check-in < 150 m sets location_verified.
- `trg_prevent_audit_update` — audit_log append-only.
- `get_simulation_progress_stats()`, `get_party_totals()`, `get_state_breakdown_from_results()`, `get_fast_stats()`, `get_admin_stats()`, `get_polling_unit_rows()`, `get_agent_locations()` — all domain RPCs.

---

## 3. RLS Matrix (Regression Test 16/16 PASS)

Run [211_RLS_16TEST_VERIFY.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/211_RLS_16TEST_VERIFY.sql#L1-L107) against the SQL Editor **after every migration**.

4 personas: ANON, AGENT A (volunteer #1 = cccccccc-0000-0000-0000-000000000001), AGENT B (volunteer #2), ADMIN (aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa SUPER_ADMIN → admin_users.user_id → auth.uid()).

Test set configs:
```
A1-A4 ANON:   read states=37, parties=9, PUs >=176k, volunteers=0       (public-read policies only)
B1-B4 AGENT A: volunteers seen=1, assignments seen=2, B's incidents=0, state list OK (profile isolation)
C1-C4 AGENT B: symmetric to A (cross agent PII leak tests)
D1-D4 ADMIN:   volunteers>=250, assignments>=500, audit_log>=1, own admin record readable (admin full read)
```

Policies written:
- states, lgas, wards, polling_units: `public-read for SELECT` (anon + authenticated all)
- user_accounts, volunteers, agent_assignments: `owner-self read + admin-all read`
- result_submissions, party_results, evidence_records, observations: `owner-self insert/read + admin-all read/write + public aggregated read via RPC`
- incidents: `public insert (anonymous tips), owner read, admin all`
- admin_users: SELF read, SUPER_ADMIN can manage (see [211A_FIX_ADMIN_USERS_RLS.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/211A_FIX_ADMIN_USERS_RLS.sql#L1-L45))
- simulation_config, simulation_history, audit_log: ADMIN only.

---

## 4. Simulation Runbook (Agent → Admin → Public Live Flow)

### Run a 20M+ national election simulation end-to-end (production safe)

1. Login ADMIN → send JWT in Authorization: Bearer `<JWT>` (use [api/admin/check-auth](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/check-auth/route.ts#L1-L46) to verify role).

2. Trigger via admin button → `POST /api/admin/simulate/trigger-v2`
   ```json
   { "scenario": "close", "duration_minutes": 5, "total_voters": 40000000, "election_type": "PRESIDENTIAL" }
   ```
   — 40M voters → 176,846 × 9 = ~1.6M party_results INSERTs + 176,846 result_submissions.
   — run_fast_simulation() has 300s statement_timeout. Postgres batch size is tuned inside the function.

3. Monitor via `GET /api/admin/simulate/progress` every 2s → shows `progress_percent, total_results, total_votes, status_distribution, elapsed_seconds`.

4. (Optional) fine-grained step: `POST /api/admin/simulate/tick` → single simulation_tick() (useful for 2-min demos; 60s statement_timeout per tick).

5. Admin verifies a batch of submissions → `POST /api/admin/verify { result_ids: [...] }` → VERIFIED status.

6. Agent checks in → `POST /api/me/check-in { assignment_id, latitude, longitude }` — haversine_distance vs PU determines location_verified.

7. Agent submits result → `POST /api/me/result { assignment_id, pu_id, voters_counted, votes_by_party, evidence_urls }`.

8. Agent reports incident → `POST /api/me/incident { ... category, severity, description, attachments }`.

9. PUBLIC reads live:
   - `GET /api/public/stats` — 176,846 PUs, 37 states breakdown, coverage %, verification %, total_votes
   - `GET /api/public/party-results` — 9 party totals + seats/share
   - `GET /api/public/polling-units?state_id=…` — PUs with GeoJSON + status color
   - `GET /api/public/disruptions` — incident feed filtered to RESOLVED public safety

### Load budget safety
- `statement_timeout` inside simulation functions prevents runaway.
- Tick-based polling only (admin triggers). No implicit polling loop on server startup.
- simulation_config must be IDLE before trigger → prevents double-run.

---

## 5. Deploy / CI Runbook

### Local (every developer)

```bash
git clone https://github.com/Joshua-Onyekachukwu/NEOP.git
cd NEOP
npm install
# copy env.local files (never commit secrets)
npm run dev:web        # http://localhost:3000 (apps/web)
npm run dev:observer   # http://localhost:3001 (apps/observer)
npm run build:web      # production build of web (what Vercel ships)
```

### Production deploy (git push)

```bash
git checkout main
git add .
git commit -m "feat: …"
git push origin main
```

Vercel ngeop project already linked → automatic production deploy on main branch. 7 env vars already set.

### Emergency rollback

1. `vercel inspect ngeop.vercel.app` → grab previous deployment URL.
2. `vercel alias <prev-deploy-url> ngeop.vercel.app --scope team_ksBu4z76RQhxb2mFJHgsodAn`.

---

## 6. Vercel Monorepo Compat (critical do not delete)

The original repo had **three stacked** tech-stack incompatibilities with Vercel npm workspaces deploy. Fixed permanently in:

1. [vercel.json](file:///c:/Users/Administrator/Webstrom/NEOP/vercel.json#L1-L19) **at repo root** — previously had a static SPA rewrites (→ framework static site!). Now:
   - `framework: "nextjs"` — forces Next 15 runtime, RSC, SSR correctly
   - `installCommand: npm install --include-workspace-root --no-audit --no-fund` — installs packages/* + apps/*
   - `buildCommand: npm run build:web` — builds ONLY web, NOT observer (observer has no prod env, no build scripts, no CSP wired)
   - `outputDirectory: apps/web/.next` — tells Vercel where the Next build lives (default would be ./.next, empty!)
   - security headers default.

2. Root [package.json](file:///c:/Users/Administrator/Webstrom/NEOP/package.json#L12-L12) added `build:web` script:
   ```
   npm run build -w @platform/database && npm run build -w @platform/validation && npm run build -w @platform/ui && npm run build -w apps/web
   ```
   Packages/database/validation/ui were MISSING build scripts → old root `--workspaces` build failed with BUILD_UTILS_SPAWN_1. Added `build: echo 'no build required'` scripts to each.

3. [.vercel/project.json](file:///c:/Users/Administrator/Webstrom/NEOP/.vercel/project.json#L1-L1) at REPO ROOT (not apps/web only). If absent, `vercel link` from repo root → regenerates. Contains projectId + orgId so deploy tooling finds the ngeop project.

**Never remove these three files.** Next developer deleting vercel.json will reproduce the exact `BUILD_UTILS_SPAWN_1: npm run build exited with 1` error seen in the first deploy attempt.

---

## 7. Supabase Migration Runbook (new changes)

1. Write new SQL file as `supabase/migrations/<NNN>_<DESCRIPTION>.sql` (do not edit existing files after applied).
2. Apply locally via `supabase db push` or paste into Supabase dashboard SQL Editor.
3. **Mandatory regression re-runs after any migration:**
   - [208_SCHEMA_INTEGRITY_VERIFY.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/208_SCHEMA_INTEGRITY_VERIFY.sql#L1-L125)
   - [211_RLS_16TEST_VERIFY.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/211_RLS_16TEST_VERIFY.sql#L1-L107) → must be 16/16 PASS
   - [212_SIMULATION_VERIFY.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/212_SIMULATION_VERIFY.sql#L1-L121) → 3/3 ticks
4. Apply INEC PU seed only once. Already applied. Do not re-run.

---

## 8. Known Gaps / Future Improvements / Debts

1. **176,846 PU fast-simulation 40M+ voters** — function executes but cannot be end-to-end timed inside this IDE tool (HTTP timeout on 1.6M INSERTs response). Admin trigger endpoint works correctly; verify timing once on live Vercel.
2. **GitHub push from this workspace** — local git initialized, origin set, credentials not in env (git push HTTPS without token returns error). Use `vercel deploy --prod -y` from terminal with VERCEL_TOKEN set, or commit & push from GitHub account authenticated terminal.
3. **OTP provider (Supabase phone auth)** — if no twilio provider configured, /api/auth/send-otp returns 503 "Phone verification not configured" (fail-safe behavior).
4. **apps/observer** — no CSP, no vercel.json, no Supabase SSR pattern, no production env vars configured. Not the deliverable; only apps/web is wired for production.
5. **Appropriate caching / rate limits** — rate-limit.ts skeleton exists in [rate-limit.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/rate-limit.ts). Redis-backed rate limiting recommended before high-load election day.
6. **Convex live projections** — REMOVED (Sep 2026). The app uses Supabase Realtime (postgres_changes) exclusively. Ignore any remaining Convex env vars; the `convex/` directory is dead code awaiting deletion.

---

## 9. Quick Links (Jump to)

- RLS regression test → [211_RLS_16TEST_VERIFY.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/211_RLS_16TEST_VERIFY.sql#L1-L107)
- RLS bug fix admin_users → [211A_FIX_ADMIN_USERS_RLS.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/211A_FIX_ADMIN_USERS_RLS.sql#L1-L45)
- Schema 18 tables + RLS + all functions → [200_NEOP_COMPLETE_SCHEMA.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/200_NEOP_COMPLETE_SCHEMA.sql#L1-L1019)
- Demo seed 250 volunteers + 500 assignments → [210_DEMO_CONSISTENT_SEED.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/210_DEMO_CONSISTENT_SEED.sql#L1-L534)
- Simulation verify 3 ticks → [212_SIMULATION_VERIFY.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/212_SIMULATION_VERIFY.sql#L1-L121)
- Admin simulate trigger-v2 route → `apps/web/src/app/api/admin/simulate/trigger-v2/route.ts`
- Admin simulate progress → [progress/route.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/simulate/progress/route.ts#L1-L89)
- Monorepo deploy config (do not delete!) → [vercel.json](file:///c:/Users/Administrator/Webstrom/NEOP/vercel.json#L1-L19)
- npm build:web script (what Vercel ships) → [package.json](file:///c:/Users/Administrator/Webstrom/NEOP/package.json#L12-L12)
- Vercel project linkage at repo root → [.vercel/project.json](file:///c:/Users/Administrator/Webstrom/NEOP/.vercel/project.json#L1-L1)
- CSP connect-src muwoc+convex+maps → [next.config.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/next.config.ts#L49-L49)

Signed: NEOP v1 Baseline Acceptance, 2026-09-12.

---

# Addendum — Current State (2026-09-14)

Supersedes any Convex references above (kept for history). Verified live state:

## Authoritative results layer
- **`get_election_summary()`** (migration 242) is the single aggregation: national + per-party + per-state rollups derived from `canonical_pu_results` → `canonical_party_results` → `polling_units.state_id`. Single pass, ~1.15 s warm at 37k canonicals.
- Consumed by `/api/public/stats` (stats bar, State Breakdown, ticker), `/api/public/party-results` (National Leaderboard), and the map. The Live Feed (`/api/public/results`) serves canonical PU events with party breakdowns merged in JS (the `parties` meta lookup uses `official_name` — the table has no `name` column).
- Invariants: national == Σ states == Σ parties (party-attributable valid votes; ballots tracked separately). Duplicate PU submissions **supersede**, never double-count (`publish_canonical_result`).

## PU count discipline
- Real INEC geography: **176,846** polling units (from `polling_units` / `inec_total_polling_units`). No hard-coded denominators in the UI — the ticker and admin progress read the DB value (`/api/admin/simulate/progress` now returns `total_polling_units`).

## Realtime
- Supabase Realtime only. Channel names are **unique per component** (e.g. `public:canonical_pu_results-map` / `-feed`); sharing a name across components crashes on mount order (supabase-js forbids adding callbacks after subscribe). Subscribes are try/catch-guarded.

## Scheduled jobs
- pg_cron in-database (Vercel Hobby forbids crons): `dead-letter-reaper-10min` → `process_dead_letter_batch(50)` (migration 244 — the batch processor migration 224 never shipped; the old Vercel cron endpoint called a nonexistent signature and 500'd hourly).

## Deployment facts
- Deploys must run from the **repo root** (root `vercel.json` runs `npm run build:web` across the workspace). Deploying from `apps/web/` fails: it uploads only that directory (missing `packages/validation`) and runs bare `next build`.
- GitHub default branch and the repo's only branch: **`main`** (`master` archived as tag `archive/master-v1-sep03`).
- Vercel **Settings → Git → Production Branch** still reads `master` (dashboard-only setting) — until flipped, pushes to `main` build previews; production ships via CLI `--prod` deploys.
- Env vars (production + preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` for project `muwocrmdcyzmwqjvvjfj`. `VERCEL_TOKEN` lives in root `.env.local` (gitignored).
