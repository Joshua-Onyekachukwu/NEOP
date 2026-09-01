# NEOP — Complete Handover Report

> **⚠️ CONFIDENTIAL — Contains API keys and secrets. DO NOT push to GitHub.**

---

## 1. Current System Overview

### Tech Stack
| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 15 (App Router) | UI + API Routes |
| Database | Supabase (PostgreSQL + PostGIS) | Primary data store |
| Real-time | Supabase Realtime + Convex | Live dashboard |
| Auth | Supabase Auth (Google OAuth + Email/Password) | Authentication |
| Storage | Supabase Storage | Evidence uploads |
| CDN/DDoS | Cloudflare | Edge protection |
| OCR | NVIDIA Build API | Result sheet verification |
| Deployment | Vercel | Hosting |

### Architecture
```
Cloudflare (CDN + DDoS)
    ↓
Vercel Edge (Middleware: Rate Limit + Security)
    ↓
Vercel Serverless (Next.js API Routes)
    ↓
Supabase (Primary DB) ←→ Convex (Real-time Projections)
```

---

## 2. Environment Variables

### Supabase
| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lgdubqovtyvzckvpbtrs.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnamR1Ym9xdHl2emNrdnBidHJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzIxODcyMDAsImV4cCI6MjA0Nzc2MzIwMH0.VxVqHa3lKPqZCKVq5CJqwMXJP-FPwFJKLdOVz4yJ6YQ` |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnamR1Ym9xdHl2emNrdnBidHJzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjE4NzIwMCwiZXhwIjoyMDQ3NzYzMjAwfQ.R8eVa1UrBJcTJzCJwGfUz_KWPx1MXOeKJQ5aT7q5J8k` |

### Convex
| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_CONVEX_URL` | `https://flexible-guineapig-4.convex.cloud` |
| `CONVEX_DEPLOY_KEY` | *(Check Vercel dashboard)* |

### External APIs
| Variable | Value |
|----------|-------|
| `NVIDIA_API_KEY` | *(Check Vercel dashboard)* |
| `NVIDIA_API_URL` | `https://integrate.api.nvidia.com/v1` |

---

## 3. Database Schema

### Single Consolidated SQL File
**→ Run `supabase/NEOP_COMPLETE_SCHEMA.sql` in Supabase SQL Editor**

This single file contains ALL:
- 18 tables with complete column definitions
- All indexes (12+)
- All RPC functions (10+)
- All RLS policies (25+)
- All triggers (audit protection + updated_at)
- Seed data (9 parties, simulation config, elections)
- Grant permissions

### Table Summary
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `states` | 36 states + FCT | id, name, code |
| `lgas` | Local Government Areas | id, state_id, name, code |
| `wards` | Registration Areas | id, lga_id, name, code |
| `polling_units` | 188,042 polling units | id, official_code, name, state_id, lga_id, ward_id, lat/lng, status |
| `elections` | Election configs | id, name, type, is_active |
| `parties` | 9 political parties | id, official_name, abbreviation, color |
| `user_accounts` | Auth users | id (=auth.uid()), email, full_name |
| `admin_users` | Admin roles | id, user_id, role, is_active |
| `volunteers` | Agent profiles | id, user_id, status, phone, state_id, training_status |
| `agent_assignments` | PU assignments | id, volunteer_id, polling_unit_id, election_id, status, GPS fields |
| `observations` | Field observations | id, election_id, polling_unit_id, volunteer_id |
| `result_submissions` | Election results | id, election_id, polling_unit_id, valid_votes, rejected_votes, total_votes, status |
| `party_results` | Per-party votes | id, result_submission_id, party_id, votes |
| `evidence_records` | Photo evidence | id, file_id, sha256_hash, mime_type |
| `incidents` | Incident reports | id, category, severity, what_observed, status |
| `audit_log` | Audit trail (append-only) | id, actor_id, action, resource_type, metadata |
| `simulation_config` | Simulation state | id, status, election_type, started_at |
| `simulation_history` | Past simulations | id, scenario, status, results_created, total_votes |

### RPC Functions
| Function | Purpose | Access |
|----------|---------|--------|
| `get_party_totals()` | Aggregated party vote totals | anon, service_role |
| `get_state_breakdown_from_results()` | State-level result breakdown | anon, service_role |
| `get_admin_stats()` | Admin dashboard stats (single call) | authenticated, anon |
| `get_fast_stats()` | Public dashboard stats | anon, service_role |
| `get_polling_unit_rows()` | GeoJSON polling unit data | anon, service_role |
| `get_agent_locations()` | Agent GPS check-in data | service_role |
| `haversine_distance()` | GPS distance calculation | anon, service_role |
| `run_fast_simulation()` | Full election simulation (188K PUs) | service_role, anon |
| `simulation_tick()` | Single simulation tick | service_role, anon |
| `log_simulation_start/complete/failure()` | Simulation history logging | authenticated, service_role |

---

## 4. Convex Schema

### Files That Move to Convex
| File | Purpose |
|------|---------|
| `convex/schema.ts` | Convex table definitions (9 tables) |
| `convex/functions/dashboard.ts` | All queries and mutations |

### Convex Tables
| Table | Purpose |
|-------|---------|
| `nationalDashboard` | National aggregated stats |
| `stateDashboard` | State-level stats |
| `lgaDashboard` | LGA-level stats |
| `livePollingUnit` | Real-time PU status |
| `liveResult` | Live result feed |
| `liveIncident` | Live incident feed |
| `coveragePoint` | Map coverage points |
| `liveCounter` | Operational counters |
| `systemHealth` | System health status |

### Convex Functions
| Function | Type | Purpose |
|----------|------|---------|
| `getNationalStats` | Query | National dashboard |
| `getStateStats` | Query | State dashboard |
| `getLgaStats` | Query | LGA dashboard |
| `getLivePollingUnits` | Query | Live PU list |
| `getLiveResults` | Query | Recent results |
| `getLiveIncidents` | Query | Recent incidents |
| `getCoveragePoints` | Query | Map data |
| `getLiveCounters` | Query | Counters |
| `getSystemHealth` | Query | Health status |
| `updateNationalStats` | Mutation | Update national |
| `updateStateStats` | Mutation | Update state |
| `updateLivePollingUnit` | Mutation | Update PU |
| `upsertLiveResult` | Mutation | Upsert result |
| `upsertLiveIncident` | Mutation | Add incident |
| `upsertCoveragePoint` | Mutation | Update map |
| `updateLiveCounter` | Mutation | Update counter |
| `updateSystemHealth` | Mutation | Update health |

---

## 5. Files to Keep in Supabase Folder

Only these files should remain after cleanup:

| File | Purpose |
|------|---------|
| `supabase/NEOP_COMPLETE_SCHEMA.sql` | **THE single file to run** |
| `supabase/schema.sql` | Original base schema (reference) |
| `supabase/migrations/102_MASTER_MIGRATION.sql` | Latest combined migration |

All other migration files (001-038, 099-101) are historical and can be archived.

---

## 6. Files to Move to Convex

| File | Destination |
|------|-------------|
| `convex/schema.ts` | Deploy with `npx convex deploy` |
| `convex/functions/dashboard.ts` | Deploy with `npx convex deploy` |

---

## 7. Supabase Storage

### Buckets
| Bucket | Purpose | Access |
|--------|---------|--------|
| `evidence` | Result sheet photos, incident evidence | Admin-only read, agent write |

---

## 8. Authentication Setup

### Google OAuth
1. Create OAuth credentials in Google Cloud Console
2. Set redirect URL: `https://lgdubqovtyvzckvpbtrs.supabase.co/auth/v1/callback`
3. Add dev redirect: `http://localhost:3000/auth/callback`
4. Configure in Supabase Dashboard → Authentication → Providers → Google

### Admin User Setup
After creating the new Supabase project:
```sql
-- 1. Create admin user via Supabase Auth dashboard (Email/Password)
-- 2. Then run:
INSERT INTO admin_users (user_id, role, is_active)
VALUES ('<auth-user-id>', 'SUPER_ADMIN', true);
```

---

## 9. Deployment Checklist

### New Supabase Project
- [ ] Create project (region: Africa West)
- [ ] Enable extensions: uuid-ossp, postgis, pgcrypto
- [ ] Run `NEOP_COMPLETE_SCHEMA.sql` in SQL Editor
- [ ] Configure Google OAuth
- [ ] Set redirect URLs
- [ ] Create storage bucket `evidence`
- [ ] Create admin user
- [ ] Load polling units data (188K rows)

### New Convex Project
- [ ] Run `npx convex init`
- [ ] Deploy: `npx convex deploy`
- [ ] Set `NEXT_PUBLIC_CONVEX_URL` in Vercel

### Vercel
- [ ] Set all environment variables
- [ ] Update CSP headers in `next.config.ts`
- [ ] Deploy
- [ ] Test admin login
- [ ] Test agent registration
- [ ] Run simulation test

---

## 10. What NOT to Push to GitHub

This report contains:
- ✅ Supabase anon key
- ✅ Supabase service role key
- ✅ Convex deployment URL
- ❌ NVIDIA API key (check Vercel)
- ❌ Convex deploy key (check Vercel)

**Files that must NEVER be committed:**
- `.env.local` (gitignored)
- `NEOP_HANDOVER_REPORT.md` (this file)
- Any file containing real API keys

---

## 11. Migration Steps

### Step 1: New Supabase
1. Create project
2. Run `NEOP_COMPLETE_SCHEMA.sql`
3. Load polling units data
4. Configure OAuth

### Step 2: New Convex
1. Init project
2. Deploy schema + functions

### Step 3: Vercel
1. Set environment variables
2. Update CSP headers
3. Deploy

### Step 4: Verify
1. Admin login works
2. Agent registration works
3. Simulation runs
4. Dashboard shows data
5. Convex sync works

---

*Report generated: September 1, 2026*
*Status: Ready for migration*
