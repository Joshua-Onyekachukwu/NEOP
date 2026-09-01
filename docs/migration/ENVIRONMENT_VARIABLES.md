# NEOP — Environment Variable Audit

> Complete inventory of all environment variables used by NEOP.

---

## 1. Frontend / Public Variables

These are bundled into the client-side JavaScript. **Never put secrets here.**

| Variable | Purpose | Required |
|----------|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (public) key | ✅ Yes |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL | Optional |

**⚠️ WARNING**: `NEXT_PUBLIC_` variables are visible to all users in the browser. Never include service keys, API secrets, or passwords.

---

## 2. Backend / Server-Only Variables

These are only available in server-side code (API routes, server components). **Never expose to client.**

| Variable | Purpose | Required |
|----------|---------|----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key (bypasses RLS) | ✅ Yes |
| `CONVEX_DEPLOY_KEY` | Convex deployment key | Optional |
| `NVIDIA_API_KEY` | NVIDIA API key for OCR | Optional |
| `NVIDIA_API_URL` | NVIDIA API endpoint | Optional |
| `SENTRY_DSN` | Sentry error tracking DSN | Optional |

---

## 3. Supabase Variables

| Variable | Where Used | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + Server | Supabase project endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + Server | Public API key (RLS-enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Admin API key (bypasses RLS) |

### Where Supabase Variables Are Used

**Browser Client** (`supabase-browser.ts`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Server Client** (`supabase-server.ts`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Service Client** (`auth.ts`, `admin-auth.ts`, all API routes):
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 4. Convex Variables

| Variable | Where Used | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_CONVEX_URL` | Browser + Server | Convex WebSocket endpoint |
| `CONVEX_DEPLOY_KEY` | Server only | Deploy key for mutations |

---

## 5. External API Variables

| Variable | Where Used | Purpose |
|----------|-----------|---------|
| `NVIDIA_API_KEY` | Server only | NVIDIA Build API for OCR |
| `NVIDIA_API_URL` | Server only | NVIDIA API endpoint |

---

## 6. Development Variables

| Variable | Purpose | Notes |
|----------|---------|-------|
| `NODE_ENV` | Environment mode | `development`, `production`, `test` |
| `VERCEL_ENV` | Vercel environment | `production`, `preview`, `development` |
| `VERCEL_URL` | Vercel deployment URL | Auto-set by Vercel |
| `VERCEL_GIT_COMMIT_SHA` | Git commit hash | Auto-set by Vercel |

---

## 7. Variable Security Rules

### Rule 1: No Secrets in Client Code
```javascript
// ✅ CORRECT — public variable
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

// ❌ WRONG — secret exposed to client
const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // In client component!
```

### Rule 2: No Secrets in Git
```bash
# .env.local is gitignored — this is correct
# Never commit .env files with real values

# .env.example contains only placeholders
```

### Rule 3: No Secrets in Logs
```javascript
// ✅ CORRECT
console.log('Config loaded');

// ❌ WRONG — leaks secret
console.log('Service key:', process.env.SUPABASE_SERVICE_ROLE_KEY);
```

### Rule 4: Use Service Role Only on Server
```javascript
// ✅ CORRECT — in API route (server-only)
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ❌ WRONG — in React component (client-side)
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
```

---

## 8. Environment Setup by Environment

### Development (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=https://lgdubqovtyvzckvpbtrs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<dev-service-key>
NEXT_PUBLIC_CONVEX_URL=https://flexible-guineapig-4.convex.cloud
```

### Production (Vercel Dashboard)
Set these in Vercel → Settings → Environment Variables:
```
NEXT_PUBLIC_SUPABASE_URL=<production-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<production-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<production-service-key>
NEXT_PUBLIC_CONVEX_URL=<production-convex-url>
CONVEX_DEPLOY_KEY=<production-deploy-key>
```

### Staging (Vercel Preview)
Same as production but with staging Supabase project.

---

## 9. Current Values (DO NOT COMMIT)

> **⚠️ The following are the current Supabase/Convex URLs used in the codebase.**
> These are already partially visible in the code (hardcoded fallbacks).
> On migration, these must be updated to the new project values.

### Supabase
- **Project URL**: `https://lgdubqovtyvzckvpbtrs.supabase.co`
- **Anon Key**: [See .env.local — NOT documented here]
- **Service Role Key**: [See .env.local — NOT documented here]

### Convex
- **Deployment URL**: `https://flexible-guineapig-4.convex.cloud`
- **Site URL**: `https://flexible-guineapig-4.convex.site`

### Hardcoded References
These files contain hardcoded Supabase URLs that need updating on migration:
- `apps/web/src/lib/supabase-server.ts` (fallback)
- `apps/web/src/lib/auth.ts` (fallback)
- `apps/web/src/lib/convex-http.ts` (Convex URL)
- `apps/web/next.config.ts` (CSP headers)
- Multiple API route files (fallback URL)

---

## 10. Migration Checklist

- [ ] All `NEXT_PUBLIC_*` variables set correctly
- [ ] All server-only variables set in Vercel
- [ ] No secrets committed to git
- [ ] CSP headers updated for new URLs
- [ ] Hardcoded fallback URLs updated
- [ ] Google OAuth redirect URLs updated
- [ ] Convex deployment linked and tested
- [ ] Sentry DSN updated (if used)
