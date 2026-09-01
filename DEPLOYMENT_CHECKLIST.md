# NEOP Deployment Checklist

Step-by-step guide for deploying NEOP to a new Supabase project.

---

## 1. Create Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **New Project**
3. Choose a project name (e.g. `neop-production`)
4. Set a strong database password (save it — you'll need it)
5. Choose a region close to your users (e.g. `Africa` or `Europe West`)
6. Click **Create new project** and wait ~2 minutes

---

## 2. Run the Database Schema

1. In the Supabase dashboard, go to **SQL Editor**
2. Click **New query**
3. Paste the entire contents of `supabase/NEOP_COMPLETE_SCHEMA.sql`
4. Click **Run**
5. Verify success — you should see `=== NEOP Complete Schema Applied ===`

This creates:
- 18 tables (states, lgas, wards, polling_units, elections, parties, etc.)
- 10+ RPC functions (get_fast_stats, get_party_totals, run_fast_simulation, etc.)
- RLS policies on all tables
- Indexes for performance
- Seed data (9 political parties, simulation config, elections)

---

## 3. Seed Nigerian Geographic Data

After the schema runs, seed the geographic hierarchy:

```bash
cd apps/web
npx tsx ../../scripts/seed/seed-nigerian-data.ts
```

This inserts:
- 36 states + FCT
- 774 LGAs
- ~8,800 wards
- ~188,000 polling units

> **Note:** This step takes 5-10 minutes due to the volume of polling units.

---

## 4. Set Up Storage Buckets

In the Supabase dashboard, go to **Storage** and create:

| Bucket Name | Public | Purpose |
|-------------|--------|---------|
| `evidence` | No | Agent-uploaded result sheet photos |

For the `evidence` bucket, add this policy (SQL Editor):

```sql
-- Allow authenticated users to upload to their own folder
CREATE POLICY "Agents can upload evidence" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'evidence'
    AND auth.role() = 'authenticated'
  );

-- Allow public read access
CREATE POLICY "Public can view evidence" ON storage.objects
  FOR SELECT USING (bucket_id = 'evidence');
```

---

## 5. Configure Authentication

### 5a. Email/Password Auth (for Admin)

1. Go to **Authentication → Providers**
2. Ensure **Email** is enabled
3. Disable "Confirm email" for faster admin login (or keep it enabled for security)

### 5b. Google OAuth (optional, for public users)

1. Go to **Authentication → Providers → Google**
2. Enable Google sign-in
3. Enter your Google OAuth Client ID and Client Secret
4. Add redirect URLs:
   - `http://localhost:3000/auth/callback` (development)
   - `https://your-domain.vercel.app/auth/callback` (production)

### 5c. Create Admin User

1. Go to **Authentication → Users**
2. Click **Add user**
3. Enter email and password
4. Copy the user's UUID
5. Go to **SQL Editor** and run:

```sql
-- Insert admin user record
INSERT INTO user_accounts (id, email, full_name, auth_provider)
VALUES ('<USER_UUID>', 'admin@yourdomain.com', 'Admin', 'email')
ON CONFLICT (id) DO NOTHING;

-- Grant admin role
INSERT INTO admin_users (user_id, role, is_active)
VALUES ('<USER_UUID>', 'SUPER_ADMIN', true);
```

Replace `<USER_UUID>` with the actual UUID from step 4.

---

## 6. Environment Variables

Set these in your deployment platform (Vercel, etc.) or in `apps/web/.env.local`:

### Required (Supabase)

| Variable | Where to find | Notes |
|----------|---------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL | e.g. `https://xxxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon public | Long JWT string |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role | ⚠️ SECRET — never expose to client |

### Required (Convex) — if using Convex for realtime

| Variable | Where to find | Notes |
|----------|---------------|-------|
| `NEXT_PUBLIC_CONVEX_URL` | Convex dashboard → Settings | e.g. `https://xxxxx.convex.cloud` |
| `CONVEX_DEPLOY_KEY` | Convex dashboard → Settings → Deploy key | ⚠️ SECRET |

### Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `NVIDIA_API_KEY` | OCR verification of result sheet photos | None (OCR disabled) |
| `NVIDIA_API_URL` | NVIDIA API endpoint | `https://integrate.api.nvidia.com/v1` |
| `NEXT_PUBLIC_SITE_URL` | App base URL | `http://localhost:3000` |

### ⚠️ Security Rules

- `NEXT_PUBLIC_*` variables are exposed to the browser — never put secrets here
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — keep it server-side only
- `CONVEX_DEPLOY_KEY` authorizes mutations — keep it server-side only
- Never commit `.env.local` to git (already in `.gitignore`)

---

## 7. Update CSP Headers

In `apps/web/next.config.ts`, update the Content-Security-Policy `connect-src` and `script-src` with your new Supabase and Convex URLs:

```typescript
"connect-src 'self' https://YOUR-PROJECT.supabase.co https://YOUR-PROJECT.convex.cloud https://YOUR-PROJECT.convex.site wss://YOUR-PROJECT.convex.cloud",
"script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://YOUR-PROJECT.convex.cloud",
```

---

## 8. Deploy Convex (if using Convex)

```bash
cd apps/web
npx convex deploy
```

This deploys:
- `convex/schema.ts` — Convex schema
- `convex/functions/dashboard.ts` — Dashboard queries and mutations

After deploy, copy the Convex URL and set it as `NEXT_PUBLIC_CONVEX_URL`.

---

## 9. Deploy the Application

### Vercel

```bash
cd apps/web
vercel --prod
```

Or push to GitHub and connect the repo in Vercel dashboard.

### Environment Variables on Vercel

Go to Project → Settings → Environment Variables and add all variables from Step 6.

---

## 10. Verify the Deployment

### 10a. Test Database Connection

Open your deployed URL and check:
- [ ] Landing page loads
- [ ] No console errors about Supabase connection
- [ ] Parties load (9 parties visible)

### 10b. Test Admin Login

- [ ] Go to `/admin/login`
- [ ] Log in with admin credentials
- [ ] Dashboard loads with statistics
- [ ] Polling unit count shows ~188K (from database, not hardcoded)

### 10c. Test Agent Flow

- [ ] Go to `/agent/register`
- [ ] Complete registration (phone → OTP → polling unit → training)
- [ ] Agent dashboard shows assignment
- [ ] GPS check-in works
- [ ] Result submission works
- [ ] Photo upload works

### 10d. Test Simulation

- [ ] Admin dashboard → Simulation tab
- [ ] Click "Run Simulation"
- [ ] Progress bar updates (polling every 5 seconds)
- [ ] Simulation completes
- [ ] "Sync to Convex" button works (if Convex is configured)
- [ ] Results appear in verification tab

### 10e. Test Public Dashboard

- [ ] Go to `/` (landing page)
- [ ] Election dashboard shows results
- [ ] State breakdown loads
- [ ] Party totals load

---

## 11. Post-Deployment Checklist

- [ ] All environment variables set correctly
- [ ] CSP headers updated with new URLs
- [ ] Admin user created and can log in
- [ ] Google OAuth configured (if needed)
- [ ] Storage bucket created with policies
- [ ] Convex deployed (if using)
- [ ] DNS configured (if custom domain)
- [ ] SSL certificate active (Vercel handles this automatically)
- [ ] `NEOP_HANDOVER_REPORT.md` is NOT committed to GitHub (contains secrets)

---

## Troubleshooting

### "Could not find Convex client"
→ Set `NEXT_PUBLIC_CONVEX_URL` environment variable

### "Unauthorized" on admin pages
→ Verify `SUPABASE_SERVICE_ROLE_KEY` is set and the admin user exists in `admin_users` table

### Blank dashboard / no statistics
→ Run the simulation first, or check that `get_fast_stats()` RPC function exists

### Result submission fails
→ Check that the agent has an active assignment with status `CHECKED_IN`

### Photo upload fails
→ Verify the `evidence` storage bucket exists and has the correct policies

### 401 on Convex sync
→ Verify `CONVEX_DEPLOY_KEY` is set and matches your Convex project

---

## Files Reference

| File | Purpose |
|------|---------|
| `supabase/NEOP_COMPLETE_SCHEMA.sql` | Complete database schema — run this ONE file |
| `supabase/migrations/102_MASTER_MIGRATION.sql` | Incremental migration for existing databases |
| `supabase/schema.sql` | Reference schema (tables only, no functions) |
| `convex/schema.ts` | Convex schema definition |
| `convex/functions/dashboard.ts` | Convex queries and mutations |
| `apps/web/next.config.ts` | Security headers and CSP — **update URLs here** |
| `apps/web/.env.local` | Local environment variables (not committed) |
| `NEOP_HANDOVER_REPORT.md` | ⚠️ Contains API keys — never push to GitHub |
