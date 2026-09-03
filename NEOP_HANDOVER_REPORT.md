# NEOP — COMPLETE SYSTEM HANDOVER REPORT

## Nigeria Election Observation Platform

**One-Line Summary:** NEOP is a real-time election observation and simulation platform that enables trained field agents to report election results from Nigeria's 176,846 polling units while the public watches live data on an interactive dashboard — and administrators can run large-scale election simulations to model different scenarios before, during, and after actual elections.

---

## TABLE OF CONTENTS

1. [What NEOP Is](#1-what-neop-is)
2. [How It Works](#2-how-it-works)
3. [System Architecture](#3-system-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Database Schema](#5-database-schema)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Public Live Election System](#7-public-live-election-system)
8. [Agent System](#8-agent-system)
9. [Admin System](#9-admin-system)
10. [Simulation Engine](#10-simulation-engine)
11. [API Reference](#11-api-reference)
12. [Security](#12-security)
13. [Performance](#13-performance)
14. [Deployment](#14-deployment)
15. [File Structure](#15-file-structure)
16. [Environment Variables](#16-environment-variables)
17. [Database Migrations](#17-database-migrations)
18. [Known Limitations](#18-known-limitations)
19. [Future Roadmap](#19-future-roadmap)
20. [Contact & Support](#20-contact--support)

---

## 1. WHAT NEOP IS

NEOP (Nigeria Election Observation Platform) is a full-stack web application designed to:

**For the Public:**
- View live election results as field agents report them from polling units across Nigeria
- See an interactive map with 176,846 polling unit locations
- Track results by state, LGA, ward, and individual polling unit
- View party vote totals with percentages and rankings
- Monitor election coverage and verification progress
- Access a live feed of incoming results with party breakdowns

**For Field Agents:**
- Register and onboard through Google OAuth
- Receive assignments to specific polling units
- Check in with GPS verification at their assigned location
- Submit election results (party-by-party vote counts)
- Report incidents (violence, disruptions, etc.)
- Track their submission status and history

**For Administrators:**
- Manage volunteers and assignments
- Verify and approve election results
- Monitor agent locations in real-time
- Run large-scale election simulations (1M to 100M voters)
- View audit trails of all system actions
- Configure election types (Presidential, Governorship)

**For Election Simulation:**
- Model different election scenarios (landslide, sweep, close race)
- Distribute votes across 9 political parties with regional variations
- Process 176,846 polling units in a single SQL transaction
- Generate realistic voter turnout patterns
- Produce party-level breakdowns at every geographic level

---

## 2. HOW IT WORKS

### The Live Election Flow

```
1. ADMIN starts simulation or election goes live
2. SYSTEM generates results for 176,846 polling units
3. RESULTS stored in Supabase PostgreSQL database
4. MATERIALIZED VIEW aggregates party totals
5. PUBLIC APIs serve data to the live dashboard
6. DASHBOARD renders maps, charts, tables, and feeds
7. VISITORS see real-time election data
```

### The Agent Reporting Flow

```
1. AGENT registers via Google OAuth
2. AGENT completes onboarding (profile, phone, location)
3. ADMIN assigns AGENT to a polling unit
4. AGENT checks in with GPS at polling unit
5. AGENT submits party-by-party vote counts
6. SYSTEM validates votes (total = valid + rejected)
7. RESULT stored with idempotency key
8. ADMIN reviews and verifies/rejects
9. VERIFIED results appear on public dashboard
```

### The Simulation Flow

```
1. ADMIN configures simulation (scenario, voter count, election type)
2. ADMIN clicks "Run Simulation"
3. SYSTEM calls run_sim_upgraded() SQL function
4. FUNCTION TRUNCATES old results
5. FUNCTION generates 176,846 result submissions
6. FUNCTION distributes votes across 9 parties
7. FUNCTION applies regional vote patterns
8. FUNCTION updates simulation_config status
9. MATERIALIZED VIEW refreshed
10. PUBLIC dashboard shows new data
```

---

## 3. SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                    NEOP SYSTEM ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   FRONTEND   │    │   BACKEND    │    │   DATABASE   │  │
│  │  Next.js 14  │    │  API Routes  │    │  Supabase    │  │
│  │  React 18    │◄──►│  Serverless  │◄──►│  PostgreSQL  │  │
│  │  Tailwind    │    │  Middleware  │    │  PostGIS     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  Live Pages  │    │  Auth (JWT)  │    │  RLS Policies│  │
│  │  Agent Dash  │    │  Rate Limit  │    │  RPC Functions│  │
│  │  Admin Dash  │    │  Validation  │    │  Indexes     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    DEPLOYMENT                        │  │
│  │  Vercel (Frontend + API) → Supabase (Database)       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | Next.js 14 + React 18 | UI rendering, routing, state |
| Styling | Tailwind CSS | Responsive design |
| Database | Supabase PostgreSQL | Data storage, RLS, RPC |
| Auth | Supabase Auth + Google OAuth | User authentication |
| API | Next.js API Routes | Backend logic |
| Maps | MapLibre GL JS | Geographic visualization |
| Charts | Recharts | Data visualization |
| Deployment | Vercel | Hosting, serverless functions |

---

## 4. TECHNOLOGY STACK

### Frontend
- **Next.js 14** — React framework with App Router
- **React 18** — UI library
- **TypeScript** — Type safety
- **Tailwind CSS** — Utility-first CSS
- **MapLibre GL JS** — Interactive maps
- **Recharts** — Charts and graphs
- **Material Symbols** — Icons
- **Remix Icon** — Additional icons

### Backend
- **Next.js API Routes** — Serverless API endpoints
- **Supabase JS Client** — Database operations
- **Server-side auth** — JWT verification

### Database
- **Supabase PostgreSQL** — Primary database
- **PostGIS** — Geographic queries
- **pgcrypto** — UUID generation
- **Materialized Views** — Pre-aggregated data

### Authentication
- **Google OAuth** — Primary login method
- **Supabase Auth** — Session management
- **JWT Bearer tokens** — API authorization

### Deployment
- **Vercel** — Hosting and serverless
- **Supabase Cloud** — Managed PostgreSQL
- **GitHub** — Source control

---

## 5. DATABASE SCHEMA

### Core Tables (18 tables)

#### Geographic Hierarchy
```sql
states (id, name, code)           -- 36 states + FCT
lgas (id, state_id, name, code)   -- 774 LGAs
wards (id, lga_id, name, code)    -- 8,801 wards
polling_units (id, official_code, name, state_id, lga_id, ward_id, 
               latitude, longitude, registered_voters, status)
                                   -- 176,846 polling units
```

#### Election Structure
```sql
elections (id, name, type, scheduled_start, scheduled_end, status, is_active)
parties (id, official_name, abbreviation, color, logo_url, status)
                                   -- 9 parties: NDC, APC, PDP, LP, NNPP, APGA, SDP, YPP, ADC
```

#### Users & Auth
```sql
user_accounts (id, email, full_name, avatar_url, auth_provider)
admin_users (id, user_id, role, is_active)
volunteers (id, user_id, status, phone, state_id, lga_id, 
            verification_status, training_status, selected_polling_unit_id)
```

#### Assignments & Results
```sql
agent_assignments (id, volunteer_id, polling_unit_id, election_id, status,
                   observer_number, checked_in_at, check_in_lat, check_in_lng,
                   distance_from_pu, location_verified)
result_submissions (id, election_id, polling_unit_id, volunteer_id, assignment_id,
                    valid_votes, rejected_votes, total_votes, status,
                    idempotency_key, submitted_at, verified_at)
party_results (id, result_submission_id, party_id, votes)
```

#### Incidents & Evidence
```sql
incidents (id, election_id, polling_unit_id, volunteer_id, assignment_id,
           category, severity, what_observed, when_observed, status)
evidence_records (id, parent_type, parent_id, election_id, polling_unit_id,
                  volunteer_id, file_id, sha256_hash, mime_type, is_public)
```

#### System
```sql
audit_log (id, actor_id, actor_type, action, resource_type, resource_id, metadata)
simulation_config (id, election_type, status, scenario, total_results_submitted, 
                   started_at, last_tick_at)
simulation_history (id, scenario, election_type, status, total_polling_units,
                    results_created, total_votes, duration_seconds)
```

### Key Database Functions (RPC)

| Function | Purpose | Performance |
|----------|---------|-------------|
| `run_sim_upgraded()` | Full election simulation | ~30s for 176K PUs |
| `get_fast_stats()` | Dashboard statistics | ~1s |
| `get_party_totals()` | Party vote aggregation | ~0.5s |
| `get_state_breakdown_fast()` | State-level breakdown | ~2s |
| `get_polling_unit_rows()` | GeoJSON for maps | ~4s |
| `get_simulation_progress_stats()` | Simulation monitoring | ~1s |

### Materialized View

```sql
mv_party_totals
-- Pre-aggregated party vote totals
-- Refreshed after each simulation
-- Query time: <0.1s
```

---

## 6. AUTHENTICATION & AUTHORIZATION

### Authentication Flow

```
1. User clicks "Sign in with Google"
2. Redirected to Google OAuth consent screen
3. Google returns authorization code to /auth/callback
4. Server exchanges code for session tokens via Supabase
5. Session stored in httpOnly cookie
6. User redirected based on role:
   - Admin → /admin/dashboard
   - Agent (trained) → /agent/dashboard
   - Agent (not trained) → /agent/onboarding
   - New user → /agent/register
```

### Authorization Rules

| Role | Access | Protected By |
|------|--------|-------------|
| Public | Live page, public APIs | None (intentional) |
| Agent | Agent dashboard, own data | Bearer token + RLS |
| Admin | Admin dashboard, all data | Bearer token + admin_users check |

### API Authorization

```typescript
// All admin endpoints use requireAdmin()
const auth = await requireAdmin(request);
if (!isAdminSuccess(auth)) return auth.error; // 401 or 403

// All agent endpoints verify Bearer token
const { data: { user } } = await supabase.auth.getUser(token);
if (!user) return 401;
```

### Row Level Security (RLS)

Every table has RLS enabled with policies:

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| states | Public | — | — | — |
| polling_units | Public | — | — | — |
| user_accounts | Own | Own | Own | — |
| admin_users | Service-role | — | — | — |
| volunteers | Own + Admin | Own | Own | — |
| agent_assignments | Own + Admin | Admin | Admin | — |
| result_submissions | Public + Own | Own (with assignment) | Admin | — |
| party_results | Public | Via result | — | Cascade |
| incidents | Public + Own | Own | Admin | — |
| audit_log | Admin only | System | Blocked | Blocked |

---

## 7. PUBLIC LIVE ELECTION SYSTEM

### Pages

| Page | URL | Purpose |
|------|-----|---------|
| Home/Live | `/` | Main election dashboard |
| About | `/about` | Platform information |

### Live Dashboard Components

| Component | Data Source | Updates |
|-----------|-----------|---------|
| StatsBar | `/api/public/stats` | Coverage, verified %, total votes |
| PartyResults | `/api/public/party-results` | 9 parties with votes and percentages |
| StateTable | `/api/public/stats` | 37 states with coverage |
| LiveMap | `/api/public/polling-units` | GeoJSON with 176K markers |
| ResultFeed | `/api/public/results` | Recent results with party breakdowns |
| DisruptionFeed | `/api/public/disruptions` | Incident reports |
| SimulationTicker | `/api/public/config` | Election status |

### Data Displayed

Each result shows:
- Polling Unit name and code
- State, LGA, Ward
- Valid votes, rejected votes, total votes
- Party-by-party breakdown (9 parties)
- Submission timestamp
- Verification status

---

## 8. AGENT SYSTEM

### Agent Pages

| Page | URL | Purpose |
|------|-----|---------|
| Login | `/agent/login` | Google OAuth login |
| Register | `/agent/register` | New agent registration |
| Onboarding | `/agent/onboarding` | Profile completion |
| Dashboard | `/agent/dashboard` | Main agent workspace |
| Submit Result | `/agent/submit-result` | Report election results |
| Report Incident | `/agent/report-incident` | Report issues |
| Safety | `/agent/safety` | Safety information |

### Agent Workflow

```
1. LOGIN via Google OAuth
2. REGISTER (phone, state, LGA, polling unit selection)
3. COMPLETE ONBOARDING (training modules)
4. REQUEST VERIFICATION (ID document)
5. RECEIVE ASSIGNMENT (admin assigns to polling unit)
6. CHECK IN with GPS at polling unit
7. SUBMIT RESULTS (party-by-party votes)
8. REPORT INCIDENTS if issues occur
9. CHECK OUT when done
```

### Result Submission Validation

```typescript
// Server-side validation
- valid_votes + rejected_votes = total_votes
- valid_votes >= 0
- rejected_votes >= 0
- Sum of party votes = valid_votes
- Agent must be CHECKED_IN
- Assignment must belong to authenticated agent
- Idempotency key prevents duplicates
```

---

## 9. ADMIN SYSTEM

### Admin Pages

| Page | URL | Purpose |
|------|-----|---------|
| Login | `/admin/login` | Admin login |
| Dashboard | `/admin/dashboard` | Main admin workspace |

### Admin Dashboard Tabs

| Tab | Purpose | Key Features |
|-----|---------|-------------|
| Overview | System stats | Volunteer count, assignments, results, incidents |
| Verification | Result review | Approve/reject results, batch verify |
| Volunteers | Agent management | View all agents, status, training |
| Agent Management | Detailed agent view | Search, filter, verify/reject |
| Locations | GPS tracking | Agent check-in locations on map |
| Incidents | Incident management | View and review incidents |
| Audit | Audit trail | Filterable log of all actions |
| Simulation | Run simulations | Configure and execute simulations |

### Admin API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/check-auth` | POST | Verify admin status |
| `/api/admin/config` | PUT | Update election config |
| `/api/admin/simulate` | POST | Start simulation |
| `/api/admin/results` | GET | List all results |
| `/api/admin/volunteers` | GET | List all volunteers |
| `/api/admin/assignments` | GET | List all assignments |
| `/api/admin/incidents` | GET | List all incidents |
| `/api/admin/audit` | GET | List audit entries |
| `/api/admin/verify` | POST | Verify/dispute results |
| `/api/admin/assign` | POST | Assign agents to PUs |
| `/api/admin/agent-locations` | GET | GPS check-in data |

---

## 10. SIMULATION ENGINE

### How the Simulation Works

The simulation runs entirely inside PostgreSQL via the `run_sim_upgraded()` function:

```sql
-- 1. TRUNCATE old results
TRUNCATE TABLE party_results, result_submissions, incidents;

-- 2. Update config to RUNNING
UPDATE simulation_config SET status = 'RUNNING';

-- 3. Generate results for all 176,846 PUs
INSERT INTO result_submissions (...)
SELECT ... FROM polling_units pu
  JOIN states st ON st.id = pu.state_id
  -- Calculate votes per PU based on regional patterns

-- 4. Generate party-level breakdowns
INSERT INTO party_results (...)
-- Distribute votes across 9 parties with regional multipliers

-- 5. Update config to COMPLETED
UPDATE simulation_config SET status = 'COMPLETED';
```

### Regional Vote Distribution

| Region | NDC | APC | PDP | LP | Notes |
|--------|-----|-----|-----|----|-------|
| South-East (SE) | 1.9x | 0.3x | — | — | NDC stronghold |
| South-South (SS) | 1.6x | 0.4x | — | — | NDC strong |
| FCT | 1.2x | 1.0x | — | — | Competitive |
| North-Central (NC) | 1.0x | 1.1x | — | — | Balanced |
| North-East (NE) | 0.7x | 1.3x | — | — | APC strong |
| North-West (NW) | 0.6x | 1.4x | — | — | APC stronghold |
| South-West (SW) | 0.5x | 1.5x | — | — | APC strong |

### Simulation Performance

| Metric | Value |
|--------|-------|
| Total PUs processed | 176,846 |
| Execution time | ~30 seconds |
| Results created | 176,846 |
| Party results created | ~1.6M |
| Total votes generated | ~14.7M |
| Database impact | TRUNCATE + bulk INSERT |

### Simulation Scenarios

| Scenario | NDC Share | APC Share | Description |
|----------|-----------|-----------|-------------|
| landslide | 42% | 22% | NDC wins by 20+ points |
| sweep | 37% | 25% | NDC carries most regions |
| close | 30% | 28% | Tight race, NDC edges APC |

---

## 11. API REFERENCE

### Public APIs (No Auth Required)

| Endpoint | Method | Response Time | Description |
|----------|--------|--------------|-------------|
| `/api/public/config` | GET | 0.02s (cached) | Election config and status |
| `/api/public/party-results` | GET | 0.03s (cached) | Party vote totals |
| `/api/public/stats` | GET | 0.02s (cached) | Dashboard statistics |
| `/api/public/results` | GET | 5-8s | Recent results with party breakdowns |
| `/api/public/polling-units` | GET | 4.4s | GeoJSON for maps |
| `/api/public/disruptions` | GET | 0.6s | Incident reports |

### Protected APIs (Auth Required)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/*` | * | Admin | All admin operations |
| `/api/me/*` | * | Agent | Agent-specific operations |
| `/api/auth/send-otp` | POST | None | Send phone OTP |
| `/api/auth/verify-otp` | POST | None | Verify phone OTP |
| `/api/verify/result` | POST | Admin | Verify a result |
| `/api/verify/batch` | POST | Admin | Batch verify results |

### Rate Limits

| Category | Limit | Window |
|----------|-------|--------|
| Public API | 120 req/min | Per IP |
| Admin API | 60 req/min | Per IP |
| Agent API | 60 req/min | Per IP |
| Auth API | 10 req/min | Per IP |
| Simulation | 5 req/min | Per IP |

---

## 12. SECURITY

### Security Audit Results

| Category | Score | Status |
|----------|-------|--------|
| Authentication | 8/10 | ✅ Google OAuth working |
| Authorization | 9/10 | ✅ Server-side checks |
| RLS | 8/10 | ✅ All 18 tables protected |
| API Security | 9/10 | ✅ Rate limiting, validation |
| Election Data | 8/10 | ✅ Server-side validation |
| Simulation | 8/10 | ✅ Admin-only, service-role |
| Secrets | 7/10 | ✅ Server-side only |
| Headers | 8/10 | ✅ CSP, HSTS, X-Frame-Options |

### Vulnerabilities Found & Fixed

| # | Vulnerability | Severity | Status |
|---|--------------|----------|--------|
| 1 | OTP bypass (any 6-digit code accepted) | CRITICAL | ✅ Fixed |
| 2 | OTP leaked in response body | CRITICAL | ✅ Fixed |
| 3 | verify/result GET leaks data | HIGH | ✅ Fixed |
| 4 | verify/batch GET leaks counts | HIGH | ✅ Fixed |

### Security Headers

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Cache-Control: no-store (for sensitive endpoints)
```

---

## 13. PERFORMANCE

### API Response Times

| Endpoint | Cold Start | Cached | Status |
|----------|-----------|--------|--------|
| `/api/public/config` | 1.5s | 0.02s | ✅ Excellent |
| `/api/public/party-results` | 0.8s | 0.03s | ✅ Excellent |
| `/api/public/stats` | 2.5s | 0.02s | ✅ Good |
| `/api/public/results` | 5-8s | N/A | ⚠️ Slow |
| `/api/public/polling-units` | 4.4s | N/A | ✅ Acceptable |

### Page Load Times

| Page | Load Time | Status |
|------|-----------|--------|
| Home | 3.4s | ✅ Good |
| Agent Login | 0.66s | ✅ Fast |
| Admin Login | 0.61s | ✅ Fast |

### Build Metrics

| Metric | Value |
|--------|-------|
| TypeScript errors | 0 |
| Build status | ✅ Success |
| Bundle size | ~102 KB shared |
| Middleware | 35.1 KB |

---

## 14. DEPLOYMENT

### Current Deployment

| Service | Platform | URL |
|---------|----------|-----|
| Frontend + API | Vercel | neop.vercel.app |
| Database | Supabase Cloud | *.supabase.co |
| Source Control | GitHub | github.com/Joshua-Onyekachukwu/NEOP |

### Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://*.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Google OAuth (configured in Supabase Dashboard)
```

### Deployment Process

```bash
# 1. Push to GitHub
git push origin master

# 2. Vercel auto-deploys from master branch

# 3. Run SQL migrations in Supabase SQL Editor
# (if schema changes are needed)
```

---

## 15. FILE STRUCTURE

```
NEOP/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx              # Live election dashboard
│       │   │   ├── layout.tsx            # Root layout with RealtimeLayer
│       │   │   ├── admin/
│       │   │   │   ├── dashboard/        # Admin dashboard
│       │   │   │   └── login/            # Admin login
│       │   │   ├── agent/
│       │   │   │   ├── dashboard/        # Agent dashboard
│       │   │   │   ├── login/            # Agent login
│       │   │   │   ├── register/         # Agent registration
│       │   │   │   ├── onboarding/       # Agent onboarding
│       │   │   │   ├── submit-result/    # Result submission
│       │   │   │   ├── report-incident/  # Incident reporting
│       │   │   │   └── safety/           # Safety info
│       │   │   ├── api/
│       │   │   │   ├── admin/            # 12 admin endpoints
│       │   │   │   ├── me/               # 7 agent endpoints
│       │   │   │   ├── auth/             # OTP endpoints
│       │   │   │   ├── public/           # 6 public endpoints
│       │   │   │   └── verify/           # 2 verification endpoints
│       │   │   └── auth/
│       │   │       └── callback/         # OAuth callback
│       │   ├── components/
│       │   │   ├── live/                 # Live dashboard components
│       │   │   ├── admin/                # Admin components
│       │   │   ├── Layout/               # Navbar, Footer
│       │   │   └── ui/                   # Shared UI components
│       │   └── lib/
│       │       ├── admin-auth.ts         # Admin auth helper
│       │       ├── api-cache.ts          # API caching layer
│       │       ├── auth-helpers.ts       # Client auth helpers
│       │       ├── rate-limit.ts         # Rate limiting
│       │       ├── supabase-browser.ts   # Browser Supabase client
│       │       └── supabase-server.ts    # Server Supabase client
│       ├── middleware.ts                 # Rate limiting + security headers
│       └── next.config.ts               # Next.js configuration
├── supabase/
│   ├── NEOP_COMPLETE_SCHEMA.sql          # Full database schema
│   ├── CLEAN_AND_SIMULATE_20M.sql        # 20M voter simulation
│   ├── RUN_THIS_IN_SQL_EDITOR.sql        # Main simulation SQL
│   └── migrations/                       # Database migrations
├── convex/                               # Convex functions (legacy)
├── scripts/                              # Setup and utility scripts
└── docs/                                 # Documentation
```

---

## 16. ENVIRONMENT VARIABLES

### Required

| Variable | Purpose | Location |
|----------|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Vercel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Vercel (server-only) |

### Optional

| Variable | Purpose | Location |
|----------|---------|----------|
| `VERCEL_TOKEN` | Vercel deployment token | GitHub Secrets |

---

## 17. DATABASE MIGRATIONS

### Current Schema Version

The database is at the `NEOP_COMPLETE_SCHEMA.sql` version which includes:

- All 18 tables with proper foreign keys
- RLS policies on all tables
- Indexes for performance
- Database functions (RPCs)
- Triggers for audit logging
- Seed data (9 parties, simulation config)

### Running Migrations

```sql
-- 1. Run in Supabase SQL Editor:
-- Paste NEOP_COMPLETE_SCHEMA.sql

-- 2. Run simulation:
-- Paste RUN_THIS_IN_SQL_EDITOR.sql

-- 3. Refresh materialized view:
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_party_totals;
```

---

## 18. KNOWN LIMITATIONS

| Limitation | Impact | Workaround |
|-----------|--------|------------|
| `/api/public/results` slow (5-8s) | Live feed loads slowly | Cache at CDN level |
| Rate limiter in-memory | Resets on cold start | Acceptable for serverless |
| Phone OTP not configured | OTP endpoints return 503 | Use Google OAuth only |
| No about page | 404 on /about | Create page |
| Convex removed but docs remain | Confusing documentation | Clean up docs |

---

## 19. FUTURE ROADMAP

### Short Term (1-2 months)
- [ ] Create /about page
- [ ] Optimize results API performance
- [ ] Add persistent rate limiting (Redis/Upstash)
- [ ] Clean up Convex references in documentation
- [ ] Add comprehensive error logging

### Medium Term (3-6 months)
- [ ] Real-time WebSocket updates (instead of polling)
- [ ] Mobile app (React Native)
- [ ] Offline support for agents
- [ ] Multi-language support (Hausa, Yoruba, Igbo)
- [ ] Advanced analytics dashboard

### Long Term (6-12 months)
- [ ] AI-powered result verification
- [ ] Blockchain result anchoring
- [ ] Multi-election support
- [ ] International election support
- [ ] API for third-party integrations

---

## 20. CONTACT & SUPPORT

### Repository
- **GitHub:** github.com/Joshua-Onyekachukwu/NEOP
- **Branch:** master (main development)
- **Last Updated:** September 3, 2026

### Key Files for Reference
- `NEOP_COMPLETE_SCHEMA.sql` — Full database schema
- `RUN_THIS_IN_SQL_EDITOR.sql` — Simulation SQL
- `NEOP_SECURITY_AUDIT_REPORT.md` — Security findings
- `NEOP_FINAL_QA_REPORT.md` — QA test results
- `DEPLOY_INSTRUCTIONS.md` — Deployment guide

---

## APPENDIX: QUICK START

### For Developers

```bash
# 1. Clone repository
git clone https://github.com/Joshua-Onyekachukwu/NEOP.git

# 2. Install dependencies
cd NEOP/apps/web
npm install

# 3. Set up environment
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# 4. Run development server
npm run dev

# 5. Open browser
http://localhost:3000
```

### For Database Setup

```bash
# 1. Create Supabase project
# 2. Go to SQL Editor
# 3. Paste NEOP_COMPLETE_SCHEMA.sql
# 4. Run the SQL
# 5. Paste RUN_THIS_IN_SQL_EDITOR.sql
# 6. Run the SQL
# 7. Refresh materialized view:
#    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_party_totals;
```

### For Deployment

```bash
# 1. Push to GitHub
git push origin master

# 2. Vercel auto-deploys

# 3. Set environment variables in Vercel dashboard

# 4. Verify deployment at neop.vercel.app
```

---

*Report generated by NEOP System Handover — September 3, 2026*
*Total development time: Multiple sprints*
*Lines of code: ~15,000+*
*Database tables: 18*
*API endpoints: 27*
*Pages: 12*
