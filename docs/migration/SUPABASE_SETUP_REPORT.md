# NEOP — New Supabase Setup Report

> Complete guide for recreating the Supabase environment for NEOP on a new project.

---

## 1. Project Setup

### Create Project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Set project name: `neop-production` (or similar)
3. Set a strong database password (save it securely)
4. Choose region: **Africa (West)** or closest to Nigeria
5. Wait for project initialization (~2 minutes)

### Required Extensions
Run in SQL Editor:
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

---

## 2. Authentication Configuration

### Providers
1. Go to **Authentication → Providers**
2. Enable **Email/Password** (for admin login)
3. Enable **Google OAuth**:
   - Create OAuth credentials in Google Cloud Console
   - Set redirect URL to: `https://<your-project>.supabase.co/auth/v1/callback`
   - Also add: `http://localhost:3000/auth/callback` for development
   - Copy Client ID and Client Secret to Supabase

### Redirect URLs
Add to **Authentication → URL Configuration**:
```
http://localhost:3000/auth/callback
https://<your-domain>.vercel.app/auth/callback
```

### Session Settings
- JWT expiry: 3600 seconds (1 hour)
- Refresh token rotation: Enabled
- Refresh token reuse interval: 10 seconds

---

## 3. Database Schema

### Run Migrations
Execute these migrations in order via the SQL Editor:

1. `supabase/schema.sql` — Complete database schema
2. `supabase/migrations/006_simulation_config.sql` — Simulation config table
3. `supabase/migrations/008_fast_stats_functions.sql` — RPC functions
4. `supabase/migrations/009_geojson_function.sql` — GeoJSON function
5. `supabase/migrations/013_agent_gps_checkin.sql` — GPS check-in
6. `supabase/migrations/014_fast_simulation.sql` — Simulation engine
7. `supabase/migrations/019_fast_admin_stats.sql` — Admin stats RPC
8. `supabase/migrations/030_state_breakdown_fn.sql` — State breakdown RPC
9. `supabase/migrations/034_add_elections_active_flag.sql` — Active election flag
10. `supabase/migrations/101_simulation_history.sql` — Simulation history
11. `supabase/migrations/102_MASTER_MIGRATION.sql` — Final combined migration

**Or use the all-in-one migration:**
```sql
-- Run supabase/schema.sql first, then:
\i supabase/migrations/099_ALL_IN_ONE.sql
```

### Key Tables
| Table | Purpose | Row Count (est.) |
|-------|---------|-----------------|
| `states` | 36 states + FCT | 37 |
| `lgas` | Local Government Areas | ~774 |
| `wards` | Registration Areas | ~8,812 |
| `polling_units` | Polling Units | ~188,042 |
| `elections` | Election configs | 1-5 |
| `parties` | Political parties | 9 |
| `user_accounts` | Auth users | Variable |
| `admin_users` | Admin roles | 1-10 |
| `volunteers` | Agent profiles | Variable |
| `agent_assignments` | PU assignments | Variable |
| `result_submissions` | Election results | 0-188,042 |
| `party_results` | Per-party vote breakdown | 0-1,692,378 |
| `evidence_records` | Photo evidence | Variable |
| `incidents` | Incident reports | Variable |
| `audit_log` | Audit trail (append-only) | Variable |
| `simulation_config` | Simulation state | 1 |
| `simulation_history` | Past simulations | Variable |

### Key Indexes
```sql
-- Polling units
CREATE INDEX idx_polling_units_state ON polling_units(state_id);
CREATE INDEX idx_polling_units_lga ON polling_units(lga_id);
CREATE INDEX idx_polling_units_ward ON polling_units(ward_id);
CREATE INDEX idx_polling_units_code ON polling_units(official_code);

-- Audit log
CREATE INDEX idx_audit_log_timestamp ON audit_log(created_at);

-- Simulation
CREATE INDEX idx_simulation_config_status ON simulation_config(status);
```

### Key RPC Functions
| Function | Purpose |
|----------|---------|
| `get_party_totals` | Aggregated party vote totals |
| `get_state_breakdown_from_results` | State-level result breakdown |
| `get_admin_stats` | Admin dashboard stats |
| `get_polling_unit_rows` | GeoJSON polling unit data |
| `run_fast_simulation` | Full election simulation |
| `simulation_tick` | Single simulation tick |

---

## 4. Row Level Security (RLS)

### Policies Summary
| Table | Public Read | User Read | User Write | Admin Read | System Write |
|-------|------------|-----------|------------|------------|--------------|
| `states` | ✅ | — | — | — | — |
| `lgas` | ✅ | — | — | — | — |
| `wards` | ✅ | — | — | — | — |
| `polling_units` | ✅ | — | — | — | — |
| `elections` | ✅ | — | — | — | — |
| `parties` | ✅ | — | — | — | — |
| `user_accounts` | — | Own | Own | — | — |
| `admin_users` | — | — | — | Active admins | — |
| `volunteers` | — | Own | Own | All | — |
| `agent_assignments` | — | Own | — | All | — |
| `result_submissions` | ✅ | Own | Own (with assignment) | All | — |
| `party_results` | ✅ | — | — | All | — |
| `evidence_records` | Public only | Own | Own | All | — |
| `incidents` | ✅ | Own | Own | All | — |
| `audit_log` | — | — | — | Super/Ops admin | Insert-only |

### Important RLS Notes
- Service role key bypasses RLS (used in API routes)
- Anon key respects RLS (used in browser client)
- Result submissions require valid assignment (ACTIVATED/CHECKED_IN status)
- Audit log is append-only (trigger prevents UPDATE/DELETE)

---

## 5. Storage

### Buckets
| Bucket | Purpose | Public Access |
|--------|---------|---------------|
| `evidence` | Result sheet photos, incident evidence | No (admin-only) |

### Storage Policies
```sql
-- Agents can upload to their own evidence folder
CREATE POLICY "Agents can upload evidence"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'evidence');

-- Admins can read all evidence
CREATE POLICY "Admins can read evidence"
ON storage.objects FOR SELECT
USING (bucket_id = 'evidence');
```

---

## 6. Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

**⚠️ CRITICAL: Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.**

---

## 7. Security Settings

### Dashboard Settings
- **API Security**: Enable IP allowlisting for production
- **Auth**: Set minimum password length to 8
- **Auth**: Enable leaked password protection
- **Auth**: Set OTP expiry to 300 seconds (5 minutes)
- **Auth**: Enable rate limiting on auth endpoints
- **Database**: Enable SSL for all connections
- **API**: Set rate limits:
  - Anonymous: 100 requests/minute
  - Authenticated: 300 requests/minute

---

## 8. Deployment Checklist

- [ ] Project created with correct region
- [ ] Extensions enabled (uuid-ossp, postgis, pgcrypto)
- [ ] All migrations applied in order
- [ ] RLS enabled on all tables
- [ ] All RLS policies created
- [ ] Storage bucket `evidence` created
- [ ] Google OAuth configured
- [ ] Redirect URLs configured
- [ ] Environment variables set in Vercel
- [ ] Service role key secured
- [ ] Initial admin user created
- [ ] Initial election record created
- [ ] Parties table populated
- [ ] Polling units data loaded (188,042 records)
