# NEOP — Convex Setup Report

> Complete guide for setting up Convex as the real-time layer for NEOP.

---

## 1. Project Setup

### Create Convex Project
1. Install Convex CLI: `npm install -g convex`
2. Run `npx convex init` in the project root
3. Link to your Convex dashboard at [convex.dev](https://convex.dev)

### Deployment
```bash
# Deploy schema and functions
npx convex deploy

# Push schema changes only
npx convex dev
```

### Environment Variables
```
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
CONVEX_DEPLOY_KEY=<your-deploy-key>
```

---

## 2. Schema

Convex schema is defined in `convex/schema.ts`. Key tables:

### Dashboard State
| Table | Purpose |
|-------|---------|
| `nationalDashboard` | National aggregated stats |
| `stateDashboard` | State-level stats |
| `lgaDashboard` | LGA-level stats |

### Live Data
| Table | Purpose |
|-------|---------|
| `livePollingUnit` | Real-time PU status |
| `liveResult` | Live result feed |
| `liveIncident` | Live incident feed |
| `coveragePoint` | Map coverage points |
| `liveCounter` | Operational counters |
| `systemHealth` | System health status |

### Indexes
All tables have appropriate indexes for efficient queries:
- `by_election` — Filter by election ID
- `by_election_state` — Filter by election + state
- `by_status` — Filter by PU status
- `by_election_key` — Counter key lookup

---

## 3. Functions

### Queries (Read)
| Function | Purpose |
|----------|---------|
| `getNationalStats` | National dashboard stats |
| `getStateStats` | State-level stats |
| `getLgaStats` | LGA-level stats |
| `getLivePollingUnits` | Live PU status list |
| `getLiveResults` | Recent results feed |
| `getLiveIncidents` | Recent incidents |
| `getCoveragePoints` | Map coverage data |
| `getLiveCounters` | Operational counters |
| `getSystemHealth` | System health |

### Mutations (Write)
| Function | Purpose |
|----------|---------|
| `updateNationalStats` | Update national dashboard |
| `updateStateStats` | Update state dashboard |
| `updateLivePollingUnit` | Update PU status |
| `upsertLiveResult` | Upsert result in feed |
| `upsertLiveIncident` | Add incident to feed |
| `upsertCoveragePoint` | Update map point |
| `updateLiveCounter` | Update counter |
| `updateSystemHealth` | Update health status |

**⚠️ CRITICAL: Mutations are called by Supabase webhooks/server, NOT by clients.**

---

## 4. Architecture

### Data Flow
```
Agent submits result
    ↓
Supabase stores result (source of truth)
    ↓
Server-side webhook triggers Convex mutation
    ↓
Convex updates live projection
    ↓
Client receives real-time push via Convex subscription
    ↓
Dashboard updates instantly
```

### Key Rules
1. **Supabase is the source of truth** — All authoritative data lives in Supabase
2. **Convex is the live projection** — Convex mirrors Supabase data for real-time
3. **Never allow Convex and Supabase to compete** — Convex is read-heavy, write-light
4. **Clients subscribe to Convex** — Real-time push, no polling needed
5. **Server writes to Convex** — Via HTTP mutations from Supabase webhooks

### Fallback Strategy
The app has a **dual-source fallback**:
1. Primary: Supabase (direct queries with 4-second timeout)
2. Fallback: Convex (HTTP queries when Supabase is slow/down)
3. Last resort: Empty/default data

This is implemented in `apps/web/src/lib/api-cache.ts`.

---

## 5. Frontend Integration

### Provider Setup
Convex is integrated via `ConvexProvider` in `apps/web/src/lib/convex-provider.tsx`:
- Dynamically imports `convex/react` on client only
- Gracefully falls back if Convex is not configured
- Wraps the entire app in `layout.tsx`

### Real-time Layer
`ConvexRealtimeLayer` component handles Convex subscriptions:
- Subscribes to live data via `useQuery`
- Falls back to REST polling if Convex is unavailable
- Renders the homepage with real-time updates

### REST Fallback
`apps/web/src/lib/use-convex-data.ts` provides hooks that:
- Poll Supabase REST API every 10-30 seconds
- Work independently of Convex
- Are used as primary data source in most components

---

## 6. Sync Process

### Manual Sync
Admin can manually sync via `/api/admin/sync-convex`:
1. Fetches aggregated data from Supabase RPC functions
2. Builds Convex mutations
3. Sends mutations via HTTP
4. Reports success/failure

### Auto-Sync
After simulation completes:
1. Progress endpoint detects `COMPLETED` status
2. Fires auto-sync in background
3. Same flow as manual sync
4. 60-second cooldown prevents duplicate syncs

### What Gets Synced
| Data | Source | Convex Table |
|------|--------|--------------|
| Party totals | `get_party_totals` RPC | `stats:upsertPartyTotals` |
| State breakdown | `get_state_breakdown_from_results` RPC | `stats:upsertStateStats` |
| Global stats | Count queries | `stats:upsertGlobalStats` |
| Simulation config | `simulation_config` table | `stats:updateSimConfig` |

---

## 7. Configuration

### CSP Headers
The Content Security Policy in `next.config.ts` includes:
```
connect-src 'self' https://<your-convex>.convex.cloud wss://<your-convex>.convex.cloud
```

### Convex URL
Set in `.env.local`:
```
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
```

---

## 8. Troubleshooting

### "Could not find Convex client"
- Ensure `NEXT_PUBLIC_CONVEX_URL` is set in `.env.local`
- Ensure `ConvexProvider` wraps the app in `layout.tsx`
- Check browser console for import errors

### Real-time not working
- Verify Convex deployment is running
- Check `connect-src` in CSP allows Convex URLs
- Verify WebSocket connection in browser dev tools

### Data not syncing
- Check admin sync endpoint logs
- Verify Convex mutations are succeeding
- Check Convex dashboard for function errors

---

## 9. Production Checklist

- [ ] Convex project created and linked
- [ ] Schema deployed (`npx convex deploy`)
- [ ] Functions deployed
- [ ] Environment variables set in Vercel
- [ ] CSP headers updated with Convex URLs
- [ ] Auto-sync tested after simulation
- [ ] Manual sync tested from admin dashboard
- [ ] Real-time subscriptions verified on homepage
- [ ] Fallback to Supabase working when Convex unavailable
