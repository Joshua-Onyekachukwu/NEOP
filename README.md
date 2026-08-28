# Nigeria Election Observation Platform

Independent, evidence-backed election observation and verification platform for Nigeria 2027.

## ⚠️ CRITICAL RULES FOR THE DEVELOPMENT TEAM

These rules must be understood and followed by every contributor:

1. **Supabase is the authoritative source of truth.** Convex handles live projections and realtime state — never competing databases.

2. **Every observation belongs to exactly one election and polling unit.** No anonymous results exist.

3. **Agents cannot select arbitrary polling units during result submission.** The backend derives the polling unit from the assignment.

4. **Authorization must be enforced server-side and at the database layer.** Never rely on "the UI doesn't show the button."

5. **Never collect or store how an individual voted.** This is a non-negotiable technical constraint.

6. **Never build a shadow voter register.** The platform does not track voter participation.

7. **Collect the minimum personal information necessary.** Follow Nigeria's data protection framework.

8. **AI assists verification; humans make consequential decisions.** AI does not accuse anyone of fraud.

9. **An anomaly is not automatically fraud.** Public language: "Flagged for review."

10. **No result is presented as an official INEC result unless it actually comes from INEC.** All independent results carry explicit disclaimers.

11. **No volunteer should put themselves in danger to collect data.** Safety takes absolute priority.

12. **Volunteers must be appropriately authorized/accredited for whatever field role they perform.** This platform does not grant INEC accreditation.

13. **Preserve evidence; don't overwrite history.** Corrections create new audit events.

14. **Every correction creates a new audit event.** The original is never deleted.

15. **Political neutrality is a system requirement, not merely a policy document.** No party colors, no candidate endorsement, no political profiling.

16. **Election-day reliability takes priority over fancy features.** Build boring, reliable software.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Hosting | Vercel |
| Database | Supabase PostgreSQL + PostGIS |
| Auth | Supabase Auth (Google OAuth) |
| Storage | Supabase Storage |
| Realtime | Convex |
| AI/OCR | Python, FastAPI, OpenCV, PyTorch |
| Maps | MapLibre GL |
| Validation | Zod |
| Source Control | GitHub |
| CI/CD | GitHub Actions + Vercel |

## Project Structure

```
nigeria-election-platform/
├── apps/
│   ├── web/                    # Public dashboard + admin console
│   └── observer/               # Observer field app (PWA)
├── packages/
│   ├── database/               # TypeScript types
│   ├── validation/             # Zod schemas
│   └── ui/                     # Shared UI components
├── supabase/
│   └── migrations/             # Database migrations
├── convex/                     # Convex realtime schema + functions
├── workers/
│   └── verification/           # Python AI/OCR workers
├── scripts/
│   ├── import-inec/            # INEC data importer
│   └── seed/                   # Seed data
└── docs/
    ├── legal/                  # Legal documents
    ├── operations/             # Operational procedures
    ├── methodology/            # Public methodology
    └── security/               # Security policies
```

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase and Convex credentials

# Run Supabase migrations
supabase db push

# Start development
npm run dev:web      # Public dashboard (port 3000)
npm run dev:observer # Observer app (port 3001)
```

## Database Ownership

| Supabase (Source of Truth) | Convex (Live Projections) |
|---------------------------|--------------------------|
| Electoral geography | Live result feeds |
| Elections, parties, candidates | Live dashboard updates |
| Polling units | Transient operational events |
| Volunteers, assignments | Realtime subscriptions |
| Observations, results | Dashboard counters |
| Evidence records | Coverage updates |
| Verification jobs | |
| Incidents | |
| Audit log | |
| Payments | |

## Development Phases

| Phase | Focus |
|-------|-------|
| 0 | Legal & organizational (pre-engineering) |
| 1 | Electoral geography database |
| 2 | Public platform |
| 3 | Volunteer system |
| 4 | Observer field application |
| 5 | Verification pipeline |
| 6 | Realtime + Convex |
| 7 | Payments |
| 8 | Security hardening |
| 9 | Nationwide simulation |
| 10 | Production deployment |

## License

Proprietary — All rights reserved.
