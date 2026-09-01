# NEOP — Full System Migration Document

> Step-by-step guide for migrating NEOP to a new platform.

---

## 1. Current Architecture

### Tech Stack
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes (serverless)
- **Database**: Supabase (PostgreSQL + PostGIS)
- **Real-time**: Supabase Realtime + Convex (dual-source)
- **Auth**: Supabase Auth (Google OAuth + Email/Password)
- **Storage**: Supabase Storage (evidence uploads)
- **Deployment**: Vercel
- **CDN/DDoS**: Cloudflare

### Architecture Diagram
```
┌─────────────────────────────────────────────────┐
│                    Cloudflare                     │
│  CDN Cache + DDoS Protection + Rate Limiting     │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│                  Vercel Edge                     │
│  Next.js Middleware (Rate Limit + Security)      │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│             Vercel Serverless Functions          │
│  API Routes + Server Components                  │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Supabase │  │ Convex   │  │ NVIDIA OCR   │  │
│  │ Client   │  │ HTTP API │  │ API          │  │
│  └────┬─────┘  └────┬─────┘  └──────────────┘  │
└───────┼──────────────┼──────────────────────────┘
        │              │
┌───────▼──────┐ ┌────▼─────────┐
│   Supabase   │ │   Convex     │
│   (Primary)  │ │   (Real-time)│
│              │ │              │
│ PostgreSQL   │ │ Convex DB    │
│ Auth         │ │ Queries      │
│ Storage      │ │ Mutations    │
│ Realtime     │ │              │
└──────────────┘ └──────────────┘
```

---

## 2. Target Architecture

The target architecture maintains the same structure with these improvements:

### What Stays
- Next.js App Router (frontend + API)
- Supabase (auth + database + storage)
- Convex (real-time projections)
- Vercel (deployment)
- Cloudflare (CDN + DDoS)

### What Changes
- New Supabase project (fresh start)
- New Convex deployment
- Cleaner migration history
- Updated environment variables
- Improved documentation

---

## 3. Data Migration

### 3.1 Polling Units Data (~188,042 rows)
**Source**: Current Supabase `polling_units` + `states` + `lgas` + `wards` tables
**Destination**: New Supabase project

**Method**:
```sql
-- Export from old project
-- Use Supabase Dashboard → Table Editor → Export as CSV

-- Or use pg_dump for full schema + data
pg_dump -h <old-host> -U postgres -d postgres \
  --data-only \
  --table=states \
  --table=lgas \
  --table=wards \
  --table=polling_units \
  > polling_units_data.sql

-- Import to new project
psql -h <new-host> -U postgres -d postgres < polling_units_data.sql
```

**Priority**: CRITICAL — This is the foundation of the entire system.

### 3.2 Parties Data (9 rows)
**Source**: `parties` table
**Destination**: New Supabase project

**Method**: Manual insert or pg_dump
```sql
INSERT INTO parties (id, official_name, abbreviation, color, status) VALUES
  ('...', 'All Progressives Congress', 'APC', '#00A859', 'ACTIVE'),
  ('...', 'Peoples Democratic Party', 'PDP', '#0000FF', 'ACTIVE'),
  ('...', 'Labour Party', 'LP', '#00FF00', 'ACTIVE'),
  ('...', 'New Nigeria Peoples Party', 'NNPP', '#FF0000', 'ACTIVE'),
  ('...', 'All Progressives Grand Alliance', 'APGA', '#FFD700', 'ACTIVE'),
  ('...', 'Social Democratic Party', 'SDP', '#FF4500', 'ACTIVE'),
  ('...', 'Young Progressives Party', 'YPP', '#800080', 'ACTIVE'),
  ('...', 'African Democratic Congress', 'ADC', '#008080', 'ACTIVE'),
  ('...', 'National Democratic Coalition', 'NDC', '#228B22', 'ACTIVE');
```

### 3.3 Elections Data
**Source**: `elections` table
**Destination**: New Supabase project

```sql
INSERT INTO elections (id, name, type, scheduled_start, scheduled_end, status, is_active) VALUES
  ('...', 'Presidential & National Assembly Election', 'PRESIDENTIAL', '2027-01-16T08:00:00Z', '2027-01-16T18:00:00Z', 'PLANNED', true),
  ('...', 'Governorship & State Assembly Election', 'GOVERNORSHIP', '2027-02-06T08:00:00Z', '2027-02-06T18:00:00Z', 'PLANNED', false);
```

### 3.4 Admin Users
**Source**: Manual creation
**Destination**: New Supabase project

1. Create admin user via Supabase Auth dashboard
2. Add to `admin_users` table:
```sql
INSERT INTO admin_users (user_id, role, is_active) VALUES
  ('<auth-user-id>', 'SUPER_ADMIN', true);
```

### 3.5 Simulation Config
```sql
INSERT INTO simulation_config (id, status, election_type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'IDLE', 'PRESIDENTIAL');
```

### 3.6 What NOT to Migrate
- Test users and agents
- Simulation results (will be regenerated)
- Test evidence/images
- Debug data
- Temporary audit logs

---

## 4. Authentication Migration

### New Users
All users must re-authenticate with the new Supabase project.

### Process
1. Create new Supabase project
2. Configure Google OAuth with same credentials
3. Users sign in → new `user_accounts` record created automatically
4. Volunteers re-register (quick process)

### Admin Setup
1. Create admin account in new Supabase Auth
2. Insert into `admin_users` table
3. Test admin login

---

## 5. Environment Variables

### Frontend (Public)
```
NEXT_PUBLIC_SUPABASE_URL=https://<new-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new-anon-key>
NEXT_PUBLIC_CONVEX_URL=https://<new-convex>.convex.cloud
```

### Backend (Server-Only)
```
SUPABASE_SERVICE_ROLE_KEY=<new-service-role-key>
CONVEX_DEPLOY_KEY=<new-deploy-key>
```

### External APIs
```
NVIDIA_API_KEY=<nvidia-api-key>
NVIDIA_API_URL=https://integrate.api.nvidia.com/v1
```

### Optional
```
SENTRY_DSN=<sentry-dsn>
```

---

## 6. Deployment Steps

### Pre-Migration
1. [ ] Backup current database
2. [ ] Document current environment variables
3. [ ] Test build passes locally
4. [ ] Verify no secrets in git

### Migration
1. [ ] Create new Supabase project
2. [ ] Run all migrations (schema + data)
3. [ ] Create new Convex project
4. [ ] Deploy Convex functions
5. [ ] Configure Google OAuth
6. [ ] Set environment variables in Vercel
7. [ ] Update CSP headers in `next.config.ts`
8. [ ] Deploy to Vercel
9. [ ] Test admin login
10. [ ] Test agent registration
11. [ ] Test public dashboard
12. [ ] Run simulation test
13. [ ] Verify Convex sync
14. [ ] Test result submission flow

### Post-Migration
1. [ ] Create initial admin user
2. [ ] Load polling units data
3. [ ] Load parties data
4. [ ] Run test simulation
5. [ ] Verify all RPC functions work
6. [ ] Test real-time updates
7. [ ] Monitor for errors

---

## 7. Rollback Plan

If migration fails:

1. **Revert Vercel deployment** to previous version
2. **Restore database** from backup
3. **Revert environment variables** in Vercel
4. **Notify users** of temporary downtime

### Backup Commands
```bash
# Backup current database
pg_dump -h <host> -U postgres -d postgres > backup_$(date +%Y%m%d).sql

# Restore if needed
psql -h <host> -U postgres -d postgres < backup_YYYYMMDD.sql
```

---

## 8. Validation Checklist

### Database
- [ ] All tables created
- [ ] All indexes created
- [ ] All RLS policies active
- [ ] All RPC functions working
- [ ] 188,042 polling units loaded
- [ ] 9 parties loaded
- [ ] Simulation config exists

### Auth
- [ ] Google OAuth working
- [ ] Email/password login working
- [ ] Admin check working
- [ ] Session persistence working
- [ ] Token refresh working

### API
- [ ] Public endpoints responding
- [ ] Admin endpoints requiring auth
- [ ] Agent endpoints requiring auth
- [ ] Rate limiting working
- [ ] CORS configured

### Frontend
- [ ] Homepage loading
- [ ] Admin dashboard loading
- [ ] Agent dashboard loading
- [ ] Registration flow working
- [ ] Login flow working
- [ ] Result submission working

### Simulation
- [ ] Simulation triggers correctly
- [ ] Progress updates working
- [ ] Results appearing in database
- [ ] Convex sync working
- [ ] Dashboard showing live data
- [ ] Reset functionality working

### Security
- [ ] No secrets exposed to client
- [ ] RLS preventing unauthorized access
- [ ] Admin auth enforced on all admin routes
- [ ] Agent auth enforced on all agent routes
- [ ] Rate limiting active
- [ ] CSP headers configured
