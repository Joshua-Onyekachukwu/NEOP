# NEOP Deployment Instructions

## Current Status
- **Live Site:** https://ngeop.vercel.app/
- **Supabase:** https://lvtfrfrnqxqwjuematum.supabase.co

## Architecture
All data lives in Supabase. Simulation engine runs as SQL functions. No external services required.

## Deployment Options

### Option 1: Push to GitHub (Recommended)
The CI/CD pipeline will automatically deploy to Vercel:

```bash
git push origin master
```

The GitHub Actions workflow will:
1. Build the project
2. Deploy to Vercel production
3. Update the live site

### Option 2: Manual Deploy with Vercel CLI
If you have the Vercel token:

```bash
cd apps/web
VERCEL_TOKEN=your_token npx vercel --yes --prod
```

### Option 3: Deploy via Vercel Dashboard
1. Go to https://vercel.com/dashboard
2. Select the "ngeop" project
3. Click "Deployments"
4. Find the latest commit and click "Promote to Production"

## Environment Variables to Set in Vercel

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lvtfrfrnqxqwjuematum.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (from Supabase dashboard) |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase dashboard) |

## After Deployment

1. Verify the live site shows 176,846 polling units
2. Check that the map shows data points
3. Test admin/agent login (requires Google OAuth setup)
4. Run a test simulation

## Google OAuth Setup (Required for Login)

1. Go to Google Cloud Console
2. Create OAuth 2.0 credentials
3. Add redirect URIs:
   - `https://ngeop.vercel.app/auth/callback`
   - `https://lvtfrfrnqxqwjuematum.supabase.co/auth/v1/callback`
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
| States | 37 |
| LGAs | 774 |
| Wards | 8,793 |
| Polling Units | 176,846 |
| PUs with Coordinates | 172,846 (97.7%) |

## Simulation Data (Convex)

| Metric | Value |
|--------|-------|
| Total PUs | 176,846 |
| Active PUs | 171,572 (97%) |
| Total Votes | 11,865,713 |
| Status | COMPLETED |
