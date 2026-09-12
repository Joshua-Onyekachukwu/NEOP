# NEOP — Full System Completion Audit
## "ELECTION TOMORROW" READINESS ASSESSMENT v1

Audited: 2026-09-12 against Supabase project **muwocrmdcyzmwqjvvjfj**, Vercel project **ngeop**, repo commit state `c:\Users\Administrator\Webstrom\NEOP\`.
Audited surfaces: 44 API routes, 14 frontend page routes, 18 DB tables, 16 lib files, 22 migration SQL files, 3 packages/*, middleware, caching, RLS, realtime, simulation engine, deployment config.

**Mandatory classification result (top line):**
- **DEMO READY: YES.** Baseline demo works. Public dashboard displays INEC-accurate 176,846 PUs via Supabase live. 16/16 RLS persona test PASS, 3/3 simulation ticks PASS, local build:web exits 0, admin verify/assign/volunteer APIs wired, submission/incident/check-in wired.
- **BETA READY: PARTIAL.** Missing 20+ P0/P1 controls before controlled users.
- **ELECTION OPERATION READY: NO.** Not safe for real operational election use. 32 P0/P1 findings must be addressed; see §3. Do not deploy for real elections today.
- **FUTURE:** Sections 29-37 enhancement list.

---

## Table of Contents
1. [Completion Matrix (40 areas) — §1](#1-completion-matrix-40-areas)
2. [Readiness Rationale — §2](#2-readiness-rationale-demobetaelection-ready)
3. [P0/P1/P2/P3 Priority List — §3](#3-priority-action-list-p0-p3-grouped-by-work-type)
4. [Per-Area Detailed Findings — §4](#4-per-area-detailed-findings-with-code-links)
5. [Operational Recovery Runbook (for tomorrow scenario) — §5](#5-operational-recovery-runbook)
6. [Evidence Inventory (files read) — §6](#6-evidence-inventory)

---

## 1. Completion Matrix (40 areas)

Legend:
Statuses: **COMPLETE** • **PARTIAL** • **BROKEN** • **MISSING** • **NOT REQUIRED FOR TOMORROW** • **BLOCKED**

| # | Area | Status | What exists | What works | What's broken | What's missing | Election critical? | Required action |
|---|---|---|---|---|---|---|---|---|
| 1 | Schema & constraints | PARTIAL | 18 tables in 200 schema; PKs/FKs for geo/parties/volunteers/assignments; idempotency_key UNIQUE, (pu, election, observer) UNIQUE, (volunteer, election) UNIQUE | UNIQUE for above 3 keys prevents some duplicates; `chk_votes_math` + `chk_non_negative` DB-level checks | No FKs from result_submissions → assignments (cascade); no FK party_results → parties; observations no FKs; `admin_users.user_id → user_accounts.id` FK missing; evidence no FK | constraints for every table; ON DELETE rules for field data; `election_id` FK on incidents/evidence; `UNIQUE (polling_unit_id, election_id)` no (but assignment-level uniqueness only, 2 observers allow 2 separate submissions) | YES-P0 | Audit FKs, add missing FKs; define policy for duplicates without election-level PU unique (see §4.1) |
| 2 | RLS Policies & authorization | PARTIAL | 18/18 relrowsecurity on. 32 CREATE POLICY statements: public-read geo/parties/elections; owner-self for accounts/volunteers/assignments; self/Admin read for results/evidence/incidents; admin_users 4 policies (211A fix) | 16/16 RLS persona matrix PASS after fix 211A (A1-D4) | Incidents select=public for ALL via policy row 880 (leaks PII `agent_safe` false, unredacted `what_observed`); observations public read; result_submissions public-read (leaks volunteer_id visible to anon!); party_results public-read visible to anon — all without RLS aggregation only; Admin policies inconsistent: admin_assign route uses inline verifyAdmin() instead of requireAdmin (uses user.id not admin role scope) | RLS for audit_log, admin_users, simulation: only admin read. RLS rewrite: public APIs should not bypass RLS (they use service role today). Aggregate only — never raw results to anon. RLS policy for service_role bypass check. | YES-P0 | Rewrite incidents/observations/result_submissions public-read policies; redact fields; restrict rows to VERIFIED only; audit_log/admin_users/sim_config admin-only RLS; all service role routes still do manual authorization |
| 3 | Indexes & query performance | PARTIAL | 6 geo indexes confirmed via 208; party_results UNIQUE(result_submission,party) + chk. 45 total indexes | Stats via `get_fast_stats`, `get_state_breakdown_from_results` RPCs; materialized view `mv_party_totals` (115 migration) | Indexes unknown for incidents(category, severity); result_submissions(status, submitted_at) — unindexed?; admin results filtering by status not performant. public/stats uses covered*123 heuristic instead of real sum. Export API fetches all data + post-filters by name with `.includes()` instead of DB WHERE — O(n²) with 176k results. polling-units API loads 176,846 rows over 4 HTTP round trips to build GeoJSON per request (only 300 s-maxage + 5-min module cache) — no `ST_AsGeoJSON` RPC, no indexed range queries. `getCachedStats` fallback: total_votes = covered × 123 (magic number, data integrity bug). | Missing indexes audit; public polling-units load via RPC+GeoJSON aggregate; export use DB-level WHERE filters; exact totals not heuristic. | YES-P1 | Add indexes for results/incidents status+dates; rewrite stats to sum actual votes; convert GeoJSON/export to server-side filtering + RPC. |
| 4 | Data import / load tooling | MISSING | 89-file chunked SQL INEC seed (applied once). No import UI/API. | Manually load via SQL Editor (inefficient). 210 demo seed is deterministic + idempotent (upserts only). | No CSV/import endpoint, no batch volunteer CSV, no party candidates upload, no progress reporting, no transaction rollback, no malformed handling, no duplicate detection by official_code across files. "No practical way to load thousands of records except SQL paste per user instruction earlier." | Tooling: CSV import states/lgas/wards/pus with code dedupe + FK validation; volunteers CSV; candidates; dry-run mode. | YES-P0 | Build CSV import (PU/volunteer/parties/candidates) with admin-only, transaction, dry-run, progress, validation. |
| 5 | Agent registration + onboarding | PARTIAL | /agent/register + /agent/onboarding pages; supabase-browser session; middleware auth cookie check; POST /api/auth/send-otp + verify-otp; POST /api/me/auto-assign (training complete + phone + selects PU). | SendOTP / verify-otp via Supabase phone auth endpoints wired; OTP sends 6-digit codes; auto-assign: training+phone check, capacity 2 observers max, returns alternatives if full. | OTP provider not configured → route returns 503 `Phone verification not configured` (production blocker). No actual password/pin; no email verification; user_accounts not auto-created on OTP (route only uses Supabase auth.users — but volunteers `user_id → user_accounts.id` FK? No; 200 schema user_accounts PK UUID direct, no FK to auth.users — disconnect). No activation/deactivation via register flow. volunteer.status = ACTIVE logic runs in auto-assign (ok), but registration page must create volunteer row (not in OTP routes; no /api/me/profile create endpoint exists). Middleware only checks cookie `sb-*-auth-token` exists — never verifies JWT validity; attacker with stale cookie still passes /agent/register gate. | Passwordless PIN or magic link; user_accounts↔auth.users join; create volunteer profile endpoint; middleware JWT verify not just cookie presence; deactivation flow. | YES-P0 | Wire Twilio/MessageBird for SMS; create POST /api/me/profile to CREATE/UPSERT volunteer + user_accounts; middleware JWT verify (call supabase.auth.getUser in edge functions) and role check. |
| 6 | Agent authentication lifecycle | PARTIAL | Bearer token pattern for /api/me/*; auth.verifyOtp returns session (NOT returned to client today — auth route returns just `{verified:true, phone: '+234…'}` with no access_token; client pages rely on localStorage Supabase session (PKCE not configured for server cookies)). Auth lib `auth.ts` patterns for getUser + role lookups. | Client-side persistSession works; waitForSession helpers retry. | Session cookie not HttpOnly/Secure (localStorage = XSS risk). Logout endpoint /api/auth/logout — MISSING. Password reset MISSING. Session refresh on expiry: client autoRefresh enabled but server middleware has no 401 refresh UX. Activation/deactivation admin side works via PATCH volunteers:id (status + training). Revocation on SUSPENDED/WITHDRAWN: API /api/me still accepts Bearer for SUSPENDED because /me/result only checks `volunteers where user_id=X single`, never `status` check. Role-based volunteers suspension NOT enforced anywhere in /api/me routes. | HttpOnly server cookies for session; /logout; reset; revoke SUSPENDED tokens — middleware or each /me route add `volunteers.status IN ('ACTIVE', 'REGISTERED', …)` not any status. | YES-P0 | Implement /logout, server cookie sessions; add status-check guard to every /me route. |
| 7 | Agent visibility & assignment isolation | COMPLETE (DB) / PARTIAL (UX) | Agent assignment endpoint `GET /me/assignment` returns own only (volunteer_id eq lookup). RLS "Volunteers can read own assignments" policy. `canSubmitResult` verifies assignment belongs + status CHECKED_IN only. | IDOR not possible via DB + Bearer; all me/ routes re-derive volunteer.id from token user.id not param. | Dashboard UI not audited; not rendered in browser — cannot guarantee UX only shows own PUs. Auto-assign code: `full ward alternatives loop` (see §4.7 — N+1 queries for alternatives but admin path only, low scale). | UX audit pages agent/dashboard, submit-result, report-incident; enforce that results only show for CHECKED_IN assignments in form. | NO-P1 | Render and test pages; confirm no cross-agent data leaks. |
| 8 | Agent result submit | PARTIAL | `POST /me/result` — Bearer, `assignment.status=CHECKED_IN`, idempotency_key UNIQUE, party sum = valid_votes math check DB chk + route chk, rejects negative. Audit RESULT_SUBMITTED. Non-blocking call to `/api/verify/result` for 2-observer comparison + OCR pipeline. | Idempotency (dedup) returns existing success; vote-sum validation 400. | Schema constraint: idempotency_key UNIQUE only per DB row. But NO DUPLICATE DETECTION FOR SAME (assignment_id + election_id + status chain) without idempotency_key. If client forgets idempotency key (mobile bug), result_submissions table allows multi rows per assignment (no UNIQUE constraint per assignment). Party results insert: if party_results fails, result_submission was committed (no transaction). `party_results` filtered with `.filter(pr => pr.party_id)` null-party skips silently so valid_votes check passes but some parties not persisted for submitted record. route expects party_results object keyed by abbreviation — but schema at §1 line 129 says `z.array(PartyResultEntrySchema)` (UUID party_id + votes). SHAPE MISMATCH between Zod schema (array UUID) and route (Object `{NDC: 123, APC: 45}`). This is a silent bug — Zod validates neither, the route does Object.entries without validation. | Atomic transaction around submission+party_results; UNIQUE(assignment_id) or explicit "single submission per assignment lifecycle in non-CORRECTION states" rule; apply Zod schema at the top of the route, not loose field checks; party_results array of UUIDs; no silent party drop. Today's shape mismatch — if page sends wrong schema, party results 0 rows. | YES-P0 | Transaction; UNIQUE guard; Zod ResultSubmissionSchema validation at route head; party_results array<{party_id, votes}> match schemas.ts. |
| 9 | Result correction / resubmission | MISSING | Schema has no correction state, no ResultCorrectionSchema endpoint wired, no parent_submission_id column in result_submissions. | `ResultCorrectionSchema` defined in [schemas.ts](file:///c:/Users/Administrator/Webstrom/NEOP/packages/validation/src/schemas.ts#L164-L180) (unused). | `POST /verify/batch` exists (route), but no correction route. Admin can set status REJECTED → agent cannot resubmit (no route). "Correction workflow (reject → request → resubmit → new version, old preserved + audit, version count + aggregation only uses latest not duplicated)" MISSING entirely. Aggregation (public results) returns all submissions: if Observer A + B both submit VERIFIED, mv_party_totals sums both → total double counted per PU (election fraud critical). | Correction: rejection_reason column, correction API, parent_submission FK + status SUPERSEDED on old; aggregation only picks LATEST VERIFIED or distinct PU-election-VERSION (never double count). | YES-P0 | Add correction tables/routes; version submissions; fix aggregation to deduplicate per PU election. |
| 10 | Result state machine & illegal transitions | PARTIAL | States `UNVERIFIED PENDING_REVIEW PARTIALLY_VERIFIED VERIFIED DISPUTED REJECTED SUPERSEDED` in DB. Admin verify route sets any status decision∈{VERIFIED DISPUTED REJECTED}; admin/verify result writes DB with direct update. | States declared; decision enum enforced. | No DB-level state guard (CHECK or trigger): can transition REJECTED→VERIFIED directly without correction; SUPERSEDED not used; agent can UPDATE results (RLS "Volunteers can insert own results" only — no UPDATE policy. But INSERT allowed any number of times except idempotency_key: see #8). No "own approve forbidden" (agent can't call /admin/verify because Bearer admin only — good). | State-transition trigger with allowlist; DB enforces machine; corrections (new submission + SUPERSEDE old); no UPDATE of ever-inserted field data (versions only). | YES-P0 | State-transition TRIGGER (before update on result_submissions raise when transition illegal). |
| 11 | Duplicate/ambiguous submit protection | BROKEN | DB: `idempotency_key UNIQUE`. | Works only when client passes key. | No UNIQUE(result_submissions.assignment_id); 2 observers → 2 allowed records (intended). But no transaction around insert + party_results. If party_results write fails, submission partial persisted. No check-then-insert race (TOCTOU) protection for idempotency_key — 2 concurrent requests: SELECT returns nothing, both INSERT → one raises 23505 unique_violation, returns 500 instead of returning existing success. Routes: `me/result` line 109-137 — no BEGIN/COMMIT. | Transaction + on conflict on idempotency_key do nothing returning id = idempotent safe; atomic write both tables. | YES-P0 | ON CONFLICT idempotency_key DO UPDATE returning id → 200 existing; transaction begin/rollback on party fail or use CTE multi inserts. |
| 12 | Duplicate protection: aggregation | BROKEN | mv_party_totals MV (115 migration) — `get_party_totals_fast` RPC exists; public/party-results uses dedup per abbreviation `Number(p.total_votes) > dedup[abbr] — replace if larger (WTF!)`. | — | Aggregation DOES NOT deduplicate per polling_unit. If 2 observers both VERIFIED for same PU+election, results double counted. public/stats line 233: `total_votes = covered_pus × 123` — not actual sum of valid_votes; mathematical integrity broken at public endpoints. get_state_breakdown_from_results needs to be back-checked for correct math SUM(DISTINCT submission per PU-election). | Aggregation DISTINCT ON (polling_unit_id, election_id, version); mv_party_totals rebuilt per corrected state; get_fast_stats real totals. | YES-P0 | Rewrite aggregation logic; rebuild mv_party_totals correctly; rebuild stats totals. Unit test with double submissions. |
| 13 | Result entry validation (server-side) | PARTIAL | `me/result`: party sum = valid votes, negatives rejected. DB: chk_non_negative, chk_votes_math. | Works for simple numeric cases. | No party_id UUID existence check against `parties` table (only filtered). No registered_voters ceiling (per PU turnout > registered not rejected). No turnout percentages impossible (>100% not flagged). No duplicate party entries check in array (if duplicates, party_results UNIQUE throws uncaught). No 9-party completeness (should require ALL known parties with 0 votes if 0). No malformed data rejected for "PU exists and agent assignment election matches". | All-party completeness; registered_voters cap; party_id existence FK enforced; malformed JSON body Zod rejected at route head. | YES-P1 | Zod ResultSubmissionSchema at /me/result head; registered_voters cap; all 9 parties. |
| 14 | Admin verify / approve / reject | PARTIAL | `POST /admin/verify` (bearer admin). Writes `decision`∈V/D/R, status + verified_at + audit. Admin audit events RESULT_VERIFIED / RESULT_DISPUTED / RESULT_REJECTED. | Decision enum enforced; audit written with admin actor id. | No lock: no SELECT FOR UPDATE so two admins concurrently can disagree. No state-legality guard (as in §10). Reviewed_by NOT populated in the UPDATE of result_submissions: only status + verified_at set. Rejection reason not persisted (notes only saved to audit_log.metadata JSON — not queryable). Rejection does NOT go back to agent via notification; no endpoint to list rejected for my assignment. `POST /verify/batch` route exists — not yet audited expected bulk. | reviewed_by, rejection_reason columns; batch verify endpoint with per-item lock. | YES-P1 | Add FOR UPDATE; persist rejection_reason + reviewed_by. |
| 15 | Admin operational controls | PARTIAL | GET/PATCH volunteers/:id (activation, verification_status, training); GET admin/volunteers (list). POST /admin/assign (manual + auto_assign_all) with capacity 2 guard per PU+election, UNIQUE(volunteer, election). | Works per routes inspected. | Missing: Disable agent instantly (volunteer status → SUSPENDED, but #6 routes accept Bearer for SUSPENDED). Reassign endpoint: changing an assignment doesn't log assignment change in audit_log (assign logs only insert). Monitor health endpoint /health returns status but not DB ping. Missing operational controls: coverage report per state/LGA/ward (not just counts). Anomaly detection no UI to see impossible-vote PU list. | Coverage per geo drill-down; SUSPEND revoke instantly; assignment PATCH + audit; DB ping in health; missing PU matrix; anomalies view. | YES-P1 | Expose coverage API + UI; SUSPEND API revokes; assignments audit updated; DB health. |
| 16 | Election-day monitoring dashboard | PARTIAL (FE) / BROKEN (data integrity) | /admin/dashboard page exists; /api/public/stats + /api/public/party-results; admin/results + incidents endpoints + pagination. | Pages route successfully, browser smoke /public/stats returns 176,846 PUs. | Total votes bug (#12 — heuristic). Per-state breakdown no real verified/covered vs geo-totals; no coverage% breakdown by PU-level geographic drill-down; /admin/results does not filter by polling_unit_id, LGA, state — limit 100-500 only, no search API, no sort by status, admin cannot identify "missing PUs by ward". | Drill-down APIs; search+filter admin results; DB health dashboard panel. | YES-P1 | Build geo drill-down, search, filter; admin anomaly panel. |
| 17 | Anomaly detection | MISSING | Deterministic integrity checks: party sum=valid_votes DB-level only. | Works for math constraint only. | No checks: `valid_votes / registered_voters > 110%` impossible turnout; PU observation NDC=100% of votes (suspicious); same volunteer_id submit 100 results over limit; 2-observer discrepancy ≥ MAX_DISCREPANCY_THRESHOLD (defined in verification lib but no alert). Reports of VIOLENCE incidents >= CRITICAL no dashboard alert. "Anomaly" column not added to result_submissions flagged_by_system. | Flag anomalous rows; dashboard list ordered by severity. | YES-P1 | Implement deterministic anomaly TRIGGER + anomaly_flag column + API/UI. |
| 18 | Notifications | MISSING | Log line "Send emergency notification to coordinator" placeholder in /me/incident when agent_safe=false. | — | All missing: SMS/email/push for assignment_created / result_rejected / correction_requested / result_approved / emergency_escalation / new_incident_admin. Supabase Edge Functions / email not wired. No notification_settings in DB. | Low-volume transactional emails (Resend + AWS SES) first-class for election ops. | YES-P1 | Add emails via Resend; start with 6 core notification types. |
| 19 | Realtime subscriptions | PARTIAL | Supabase channel "live-results" subscribes to result_submissions INSERT, polling_units UPDATE, party_results INSERT → refresh key bump (1 sec debounced). Stats polling: config 30s idle / 5s simulation. | Realtime SUBSCRIBED → isLive true in UI. Good fallback via polling if realtime drops. | 3 subscriptions per user = 3 Postgres replication slots per client. For 10k concurrent dashboard viewers → ~30k slots = Supabase Pro plan ceiling. No fallback from Realtime to polling without a reconnect loop (code only unsubscribes on unmount, no error-handling reconnect exponential backoff). Realtime not needed for public results page at all when s-maxage=30 middleware cache already does stale-while-revalidate; remove heavy realtime default. | Keep realtime only for agent/admin, disable for anonymous public. Add reconnect backoff + slot count guard. | YES-P1 | Remove public realtime; only admin/agent dashboards. Add error handling reconnect. |
| 20 | Public stats & results APIs | BROKEN (integrity) / COMPLETE (routes) | All 7 public routes exist (stats / party-results / polling-units / results / disruptions / config / pu-availability / status-changes / export). CDN cache via middleware s-maxage 10-300s. unstable_cache 30s. | Returns shape 200s always; 176,846 PUs in earlier smoke. | (§3 P0) Stats total_votes = covered_pus × 123 (magic number). Aggregation double counts observers. Incidents leaks unredacted what_observed to anon. polling-units API GeoJSON built on 176,846 object transfers every cache miss in serverless memory (10MB+ payload, slow). export API post-filter by LGA/ward/state NAME not ID so typo = all records filtered wrong; no server-side WHERE (download 50k rows then filter). Public/results shows status=any even DISPUTED/UNVERIFIED where public should show only APPROVED/VERIFIED aggregation. | Aggregation correctness; redact incidents; only VERIFIED in public; GeoJSON RPC; DB-level WHERE in export; real vote totals. | YES-P0 | Fix aggregation; rewrite public leak policies; add "status IN (VERIFIED, APPROVED)" filter to public endpoints; remove heuristic votes. |
| 21 | Public data privacy & PII leak | BROKEN | Observations + incidents + result_submissions all public SELECT via policy. | — | Incidents `what_observed` + `agent_safe` exposed directly to world (§2 RLS policies). If any future incident says "Party agent A threatened me at PU X with weapon" — public disclosure without redaction endangers the safety observer. Evidence records policy only (is_public=true) — good, but result_submissions leaks volunteer_id to anon; users can reverse engineer with phone/public directory. All API routes use service role (bypasses RLS) — so RLS policies are bypassed entirely anyway for public routes! So RLS is COSMETIC ONLY — service role reads full tables. The code manually filters what it returns — so bug in API return = full table leak. | Audit each public endpoint JSON; never return volunteer_id, phone, agent_safe (redact or summarize for public). is_public column on result_submissions; always use service role with explicit column whitelisting. | YES-P0 | Rewrite every public route: return only whitelisted fields; never volunteer_id, user_accounts.email, unredacted incidents. Add tests for field whitelist. |
| 22 | Simulation trigger v1/v2/tick/progress | PARTIAL | Trigger v1/v2 both call run_sim_upgraded(p_scenario, p_total_voters) as promise fire-and-forget. tick endpoint checks sim_config RUNNING then RPC simulation_tick. progress reads get_simulation_progress_stats plus config. | Earlier regression 3/3 ticks PASS, functions present in pg_proc. | `trigger/route.ts` v1 — NO ADMIN AUTH (23-56 lines)!! Bearer never read, any anon with VERCEL_URL origin can run `run_sim_upgraded(p_total_voters=20_000_000)` to write 176,846 submissions × 9 parties = 1.6M rows into election production DB during live election. THIS IS CRITICAL. trigger-v2 uses requireAdminWithDetails (good) — but v1 route still exists and unprotected. There's NO pre-check that simulation_config = IDLE before firing trigger-v2; can be called twice → 2x data corruption. No `p_duration_minutes` / scenario sweep/50M-voter actual budget validation (RPC code not inspected line by line; statement_timeout set? Depends on SQL). | DELETE route trigger v1; OR add identical requireAdmin guard + IDLE guard + concurrency lock (pg_advisory_xact_lock). Add statement_timeout wrapper; validate scenarios and caps before invoking. | YES-P0 | Delete trigger v1; lock trigger v2 with advisory lock idle check. |
| 23 | Simulation load safety & realistic batching | PARTIAL | run_sim_upgraded in-database; statement_timeout 300s declared in schema (110-115 migrations?). Progress stats via RPC. | Tick 60s timeout; 3-tick PASS. | Unknown exact memory/transaction behaviour for 176,846 PU × party inserts. Single transaction possibly blows up at 50M voters (locks all writes during insert, replicas fall behind). Trigger is fire-and-forget Promise but the Supabase client has HTTP timeout 60s — so the function will be aborted by HTTP timeout even though the SQL runs? Actually RPC server-side keepalive? Unknown. Progressive levels required: 100 agents → 500 → 1k → production. No jobs queue (BullMQ / Upstash QSTASH not present). No backpressure. No retries on failure. No progressive report to simulation_history. | Use QSTASH or Supabase pg_cron job to run simulation asynchronously with statement_timeout + chunked commits; simulation_history detail per chunk. Do NOT allow 50M voter single RPC call — split 100 chunks of 1000 state batches, commit each. | YES-P0 | Split simulation chunks; cron it; stop single transaction 50M. |
| 24 | Audit trail | PARTIAL | audit_log table; append-only trigger `trg_prevent_audit_update` (RAISE on UPDATE/DELETE) — good. Most routes call INSERT audit_log for submissions, admin verify/assign PATCH, incidents, check-in, volunteer status update. Status: result actions ok. | Append-only enforced (trigger confirmed in 200 schema lines 910+). | Audit missing for: assignments updated (reassign after initial insert); agent status reverted back to ACTIVE after SUSPENDED; election config changed; parties/candidates modified; sim trigger called; admin logged-in/out; result corrections (§9 missing anyway). actor_id vs auth.uid mapping: actor_id for VOLUNTEER is volunteers.id not user_accounts.id; for ADMIN is admin_users.id (the row id not user_id). So actor_id is inconsistent type per actor_type; hard to pivot. No actor_ip address consistently set (some routes use audit() which accepts ip_address param but only if route passes it). Middleware has request ID but never stored. | Audit every column-change (before/after diff JSON) for P0 30 ops; unify actor_id = auth.uid across types always; pass x-forwarded-for consistently; include request id; rotate audit_log monthly partition or no — partition optional. | YES-P1 | Add missing 20 audit events; unify actor_id; diff JSON for critical mutations. |
| 25 | Backups & recovery runbook | MISSING | Supabase default backup exists (project not checked). No documented restore procedure. | — | No runbook for: DB unavailable fallbacks; migration failure rollback; Vercel rollback; accidental TRUNCATE simulation data recovery; RLS policy rollback; env var rotation. Point-in-time Recovery (PITR) enabled in muwoc project? Not verified; required for election ops (7 day PITR minimum). Backups of key tables (parties/geo) exported flat SQL? Have 200 schema seed; but no export/import of current-state. | Enable PITR; write runbook: restore Supabase + Vercel rollback (in §5 skeleton). | YES-P0 | Enable Supabase PITR; verify backup schedule; write recovery runbook. |
| 26 | Failure scenarios handling | PARTIAL | Rate limiting (2 level: middleware + route-level in-memory maps); DDoS suspicious patterns middleware; under attack detection; CDN cache s-maxage public routes; seeded fallback data when Supabase unreachable (getSeededStats/SeededPartyResults in api-cache). | Graceful degrades when DB fails: shows seeded data to users. | Agent/admin endpoints with DB down show generic 500; no retry UX. Realtime disconnects handled only by not reconnecting? No. Vercel deploy rollback not automated (manual process). No simulation failure auto-recover (only console.error). DB unavailable during submission — retry button not audited on frontend; server-side no idempotency-OK retry. | Agent retries with idempotency key backoff; admin failure pages; automated Vercel alias rollback script. | YES-P1 | Retry UX for submission; admin outage UI; automated rollback script. |
| 27 | Timezone & authoritative timestamps | PARTIAL | Server uses `new Date().toISOString()` for all created_at. All clients display Africa/Lagos. Middleware rate limit Date.now() only. | — | submission_time, verified_at, when_observed not server-default (can be spoofed from client in JSON body: incident route actually sets when_observed client-submitted; some DB columns default now() if omitted? 200 schema: result_submissions.submitted_at DEFAULT now() if omitted; good but if route passes it it overrides; no DB guard to reject future-dated timestamps. Agent mobile clock skew → future dates. Simulation timestamps server ok. | `result_submissions.submitted_at` ALWAYS set DEFAULT now() even if value provided. Same for approval/rejection timestamps. Enforce server defaults in triggers; reject timestamps > now()+5min. | YES-P1 | DB trigger to override user-provided timestamps with now(). |
| 28 | Environment variables & secrets | PARTIAL | .env.local (12) root + apps/web; NEXT_PUBLIC vars prefixed correctly. Service role = server-only patterns in lib. | Supabase keys never leaked to NEXT_PUBLIC (good). | Convex live keys plus DEPLOY_KEY set (was preview key — status unverified). NVIDIA_API_KEY optional. Vercel env vars injected earlier (7): NEXT_PUBLIC_SUPABASE_URL/ANON, SUPABASE_SERVICE_ROLE, CONVEX_URL, SITE_URL, CONVEX_DEPLOY_KEY. Middleware only reads from headers/cookies no secrets. No `.env` files committed (Git not inspected — P0 confirm). No rotation docs: Supabase JWT, service, Convex keys. | gitignore .env.local checked; key rotation doc; swap Convex prod key; never print secrets on build output. | YES-P0 | Confirm no .env in Git history; swap to production CONVEX_DEPLOY_KEY when deploying. |
| 29 | Storage: evidence, images, sheets | MISSING | evidence_records table, EvidenceUploadSchema defined. /api/me/evidence route exists (not read). storage "evidence" bucket referenced in verifyResult. | — | Bucket not verified in Supabase. No public/policy ACL policies for evidence storage; no virus scan; no signed URL expiry best-practices (5-min default in verifyResult). No candidate photos, logos. | Create evidence bucket in muwoc Supabase project; set RLS on storage.objects. Virus scan not required tomorrow. | YES-P1 | Create storage bucket with policy; max size; signed URLs consistent. |
| 30 | Vercel production deployment | PARTIAL (config fixes done) / BLOCKED (green URL) | vercel.json root monorepo (framework nextjs / build:web / output apps/web/.next). Root .vercel linked to ngeop project. 7 env vars. ngeop linked via vercel-cli-with-tokens earlier. Local build:web exits 0. deploy_to_remote returned SUBMITTING (Vercel servers accepted). | Config locally builds without SPA error. | Green build URL not yet obtained (user provided dashboard links ngeop but no final URL paste-back). Deploy_to_remote status parser missing SUBMITTING wrapper (NOT a Vercel failure). Unknown production test of all 44 routes in real Vercel cold start serverless (timeouts on public/polling-units 176k in-memory likely causes 50s Vercel serverless budget exceeded + OOM? — P0 concern). | Final green Vercel URL; smoke 44 API routes against production URL with Postman-like hits; rewrite polling-units RPC + pagination to avoid memory + timeouts. | YES-P0 (URL) | Obtain final URL from Vercel dashboard; smoke all routes; fix heavy endpoints. |
| 31 | Tests (unit/integration/E2E) | MISSING | 211_RLS_16TEST_VERIFY.sql: 16/16 pass; 212 simulation verify: 3 ticks; 208 integrity check. Schema-level regression SQL tests only. | All migrations applied; 208+211+212 regression SQLs available after every schema change. | No Jest/Vitest; no Playwright; no unit tests for: auth, canSubmitResult, validateMath (verification lib), compareObservers, computeConfidence, zod schemas; no idempotency duplicate-submit test, no real transaction unit tests, no state transition tests. No E2E: agent login → check in → submit → admin verify → public sees (only manual process). | At minimum: vitest for verification + state transitions + idempotency; Playwright smoke for register→submit flow. | YES-P1 | Add Vitest for 20+ critical business rules; 1 Playwright smoke. |
| 32 | CSP, headers, middleware security | PARTIAL | middleware rate limit + suspicious patterns + challenge. CSP headers: next.config.ts connect-src expanded (muwoc + wss + convex + MapTiler + OSM). X-Content-Type-Options, X-Frame-Options, Referrer. | Suspicious pattern detector. | Middleware `isUnderAttack()` global counter resets but per-edge-instance only → false positives in multi-instance Vercel. CSP HSTS missing. Content-Security-Policy not in middleware (only headers from next.config? line 401/402 in middleware only X-Frame + nosniff). CSRF: no Origin header check on mutation routes (POST /me/result accepts any Origin with Bearer — acceptable since Bearer not cookie based). Auth protected pages check only cookie prefix `sb-*-auth-token` not JWT validity. | HSTS; CSP header; CSRF double submit cookie if we ever use cookie auth; middleware actually verify Bearer for /admin|/agent mutation. | YES-P1 | HSTS header add; CSP at edge; verify JWT validity in middleware. |
| 33 | Admin/Agent role enforcement | PARTIAL | Admin routes use requireAdmin which verifies admin_users.is_active. Agent /me routes derive volunteer from Bearer user.id. | IDOR not possible via /me routes. | Inconsistency: `POST /admin/assign` route has custom `verifyAdmin()` helper that just checks admin_users.id EXISTS, not requireAdmin scope (same effect probably). `POST /admin/simulate/trigger/v1` — NO ADMIN CHECK; see §22 P0. Result status update from any authenticated admin — no role granularity OPERATIONS_ADMIN vs VERIFIER segregation. | Admin role matrix; route-level requireRole('VERIFIER') vs requireRole('SUPER_ADMIN'); delete trigger v1. | YES-P0 | Delete /admin/simulate/trigger; implement admin role checks granularly. |
| 34 | Security IDOR / escalation attempts | BROKEN (known gap) | Manual tests: try pass user_id in body to /me/result — all endpoints re-derive volunteer from token user.id good. | /me routes safe. | Public incident policy reveals all data; result_submissions.public_read exposes volunteer_id to public via anon service role; no pagination limit on /admin/results (someone with admin creds can dump 50M records in single call — limit 100-500 good). Admin-only /api/verify/result callable by admin only (middleware good). Agents can't see each other's data — policies good. No checks: admin password reset endpoint missing. | Data leaks §21 P0 fixed; role based admin capabilities. | YES-P0 | Fix PII leaks. |
| 35 | Middleware matcher routes covered | COMPLETE | Middleware matcher: /api/* /agent/* /admin/* | Auth check /agent/register + onboarding. Admin/* redirects no session. Works. | Middleware only redirects if no cookie; does not verify role for admin pages. User without admin_users row but with valid agent session — navigates to /admin/dashboard (frontend page shows admin UI but all subsequent API calls 401: good UX flash of unauth UI first). | Frontend redirect immediately at page-level if check-auth fails; loading skeleton not 403 flash. | NO-P2 | Frontend loading skeleton, redirect first. |
| 36 | Agent mobile responsiveness | NOT REQUIRED FOR TOMORROW / PARTIAL | Pages at agent/* exist; no viewport tested in-browser. | — | Buttons too small, keyboard overlap, long forms, duplicate submit, scroll issues, tables — all unknown. No max-width mobile meta not confirmed. | Basic manual QA mobile viewport, disable button after first submit. | YES-P1 | Mobile QA; disable submit duplicate until response. |
| 37 | Intermittent connectivity & UX | MISSING | Idempotency_key only used on server; not generated by UI. No offline first service worker. | — | Lost connection mid-submit: duplicate submit on reconnect possible; no "submitting" persisted state; refresh during submit → lost form; timeout after server actually saved → client thinks failed; no retry-idempotency UI. | Generate client UUID idempotency key on form mount; store pending state in localStorage until 200; auto retry once on reconnect with same key + show toast "submitted earlier". | YES-P1 | Client submission store with idempotency. |
| 38 | Domain & operational communications | BLOCKED (external) | Vercel ngeop.vercel.app default. Custom domain + DNS not in scope of user instruction today. | — | No SSL warnings; HSTS missing (§32). No uptime monitoring URL (Better Uptime / StatusCake not set). | Not a blocker for functionality; nice-to-have domain, email. | NO-P2 | Add custom domain + uptime monitor later. |
| 39 | Legal/audit data retention | NOT REQUIRED FOR TOMORROW | No retention schedule / GDPR for Nigerian election observer data. | — | — | Legal review outside scope; retention policy for 7 years after election + audit archive immutable. | NO-P3 | Future; archive + retention. |
| 40 | Organizational / runbooks | NOT REQUIRED FOR TOMORROW / PARTIAL | ARCHITECTURE_RUNBOOK v1 written. | — | Incident response / on-call rota / election-day communication channels not in repo. | Manual org prep; not engineering. | NO-P3 | Runbooks enhanced. |

---

## 2. Readiness Rationale (Demo/Beta/Election-ready)

### DEMO READY — YES (10/10 confidence)
Evidence:
- Local build `npm run build:web` exits 0. [package.json](file:///c:/Users/Administrator/Webstrom/NEOP/package.json#L12) `build:web` ordered workspace script; packages no-op builds echo; Next build compiles 44 routes without TS errors.
- Browser smoke `http://localhost:3002/api/public/stats`: `source="supabase"`, `total_polling_units=176,846`, state_breakdown Lagos=13,325 … FCT=2,235 (exact INEC seed from 89 SQL chunks applied).
- DB: 18 tables; 18/18 relrowsecurity; 45 total indexes confirmed via 208_SCHEMA_INTEGRITY_VERIFY SQL.
- RLS matrix 16/16 PASS after [211A_FIX_ADMIN_USERS_RLS.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/211A_FIX_ADMIN_USERS_RLS.sql) — Anon A1-A4, Agent A B1-B4, Agent B C1-C4, Admin D1-D4.
- Simulation: 4 simulation fn (simulation_tick/run_fast_simulation/get_simulation_progress_stats/log_simulation_start) confirmed present; 3× tick call transitions state correctly per 212_SIMULATION_VERIFY.sql.
- UI: All 14 page routes compile (home/login/admin/dashboard/agent/*/about/*). Home page realtime + polling wired, 9× live components imported.
- Vercel: 3-stack compatibility fixed (vercel.json, build:web, root .vercel). deploy_to_remote reached Vercel SUBMITTING status on second attempt.

### BETA READY — PARTIAL. 32 P0/P1 to address before beta with 50-200 controlled volunteers (see §3).

### ELECTION OPERATION READY — NO. 11 P0s today will realistically cause:
- Submission duplicates / partial persisted party_results (transaction atomicity #8 #11).
- Aggregation shows wrong totals (double count 2 observers, magic number 123 heuristic). #12 #20.
- Incident PII endangers observers (#21 #2 RLS public incidents/observations).
- Anonymous caller can trigger 20M-voter simulation writes into live DB (#22 trigger v1 missing auth).
- Agent SUSPENDED still accepted Bearer submits (#6).
- No SMS/OTP provider: agents can't authenticate at all (#5 BLOCKED).
- OTP verify route returns `verified: true` but never returns the access_token/session the UI needs (#6 mismatch).
- Result shape mismatch between Zod schemas and route code — party results could silently not persist (#8).
- No FKs: data corruption if geo delete. No state machine: REJECTED → VERIFIED possible without correction (#1 #10).
- No election data CSV import tooling: manually loading 5000+ volunteers SQL paste unworkable (#4).
- Backup/PITR not confirmed enabled; no recovery runbook; critical data loss unrecoverable in 1hr (#25).

---

## 3. Priority Action List (P0-P3) grouped by work-type

Required grouping per rule 40: **Already complete / Verification only / Small fix / Required implementation / Future**.

### P0 — MUST FIX BEFORE ELECTION (11 items)
#### Already complete (no action)
- Build toolchain (npm workspaces + build:web + Vercel config) — [vercel.json](file:///c:/Users/Administrator/Webstrom/NEOP/vercel.json).
- Schema + INEC 176,846 seed applied.
- 18/18 RLS enabled + 16 persona regression SQLs.

#### Verification only (run once / confirm state, no code changes)
- **V-P0-Env:** Confirm no .env*.local files in git history with `git log -p | Select-String VERCEL_TOKEN|SUPABASE_SERVICE_ROLE|CONVEX_DEPLOY_KEY`; swap CONVEX_DEPLOY_KEY from preview to production deployment key in Vercel env vars.
- **V-P0-Supabase:** In muwoc project → Settings → Backups — Confirm PITR enabled ≥ 7 days. Note frequency. Snapshot DB now, export demo seed as flat SQL.

#### Small fix (existing implementation requires correction; <1 hour each usually)
- **S-P0-1-DeleteTriggerV1:** Delete or guard [admin/simulate/trigger/route.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/simulate/trigger/route.ts#L1-L56). Today it accepts anon calls → 20M-voter writes into live election DB. Guard with `requireAdmin` + IDLE `simulation_config` check OR delete file entirely, keep only trigger-v2.
- **S-P0-2-StatsVotesHeuristic:** Replace `total_votes = covered_pus * 123` line 233 in [api-cache.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/api-cache.ts#L233-L233) with real SUM(result_submissions.valid_votes) DISTINCT ON (polling_unit_id, election_id) per PU-election.
- **S-P0-3-PublicRLSLeaks:** Public/disruptions, public/results rewrite to NEVER return volunteer_id / agent_safe / what_observed raw / unverified status submissions. incidents.category_icon + severity only, redact description to generic 20-char summary + state + LGA only, never exact PU street name for CRITICAL VIOLENCE reports until verified/redacted by admin.
- **S-P0-4-ResultStatusMachine:** Create BEFORE UPDATE trigger on `result_submissions` enforcing only: `UNVERIFIED → PENDING_REVIEW, PENDING_REVIEW → {VERIFIED|DISPUTED|REJECTED}, REJECTED → SUPERSEDED via correction only. VERIFIED cannot become anything else unless admin SUPER_ADMIN role + explicit column manual override`. Raise EXCEPTION otherwise.
- **S-P0-5-AtomicSubmit:** Wrap /me/result insert with single transaction. BEGIN; insert result_submissions; insert party_results array; COMMIT. Use ON CONFLICT (idempotency_key) DO NOTHING RETURNING id (no race condition SELECT/INSERT 23505 → 200 existing). Rollback on party_results error.
- **S-P0-6-SuspensionGuard:** In every /api/me/* route, after deriving volunteer.id add single line: `if (volunteer.status === 'SUSPENDED' || volunteer.status === 'WITHDRAWN' || volunteer.status === 'REJECTED') return 403 Revoked`.
- **S-P0-7-ShapeMismatch:** [me/result/route.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/me/result/route.ts#L36-L127) — change party_results from `Object.values(party_results)` (abbrev keyed object) → `zod safeParse ResultSubmissionSchema` head of route → array of {party_id UUID, votes}. The shapes today are incompatible.
- **S-P0-8-MiddlewareJWT:** Agent/admin middleware checks only `sb-*-auth-token` cookie EXISTS. Move a lightweight JWT verify into middleware: decode Supabase JWT signature (HS256 or RS256 per project JWT secret) with libraries. Alternative: if middleware cannot verify due to crypto limits, call Supabase auth.getUser on every /admin/* page in RSC before render (acceptable).
- **S-P0-9-AggDedup:** Rebuild `mv_party_totals` materialized view; `get_party_totals`, `get_state_breakdown_from_results` re-implemented to select DISTINCT ON (polling_unit_id, election_id, latest_version) — never add two observer submissions for same PU. Update README refresh CONCURRENTLY schedule.
- **S-P0-10-OTPReturnsSession:** [verify-otp/route.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/auth/verify-otp/route.ts#L43-L48) today returns {verified:true} only. Supabase `verifyOtp(data, token, type='sms')` returns a session! Return `{access_token: session.access_token, refresh_token: session.refresh_token, expires_in, user}` to the frontend so login actually works.
- **S-P0-11-SmsProvider:** Connect Supabase → Twilio or MessageBird test credentials; test send-otp returns not 503.

#### Required implementation (feature genuinely missing; build new code)
- **I-P0-1-CSVImportAdmin:** Build POST `/api/admin/import` (volunteers, polling units, parties, candidates) with: form-data CSV, Zod schema per file type, dry_run=true first, transaction rollback, progress events, malformed row index report, UNIQUE violation detection, rollback.
- **I-P0-2-CorrectionWorkflow:** Add result_submissions columns: rejection_reason TEXT, reviewed_by admin_users.id FK, parent_submission_id UUID FK (self), version INTEGER. POST /me/result/correction (requires status REJECTED on parent; new submission with parent SUPERSEDED update; aggregation uses version MAX per assignment).
- **I-P0-3-RevokeLogin:** POST `/api/auth/logout` (httpOnly delete cookie + Supabase signOut).

#### Future (not required for election readiness)
None in P0.

### P1 — SHOULD FIX BEFORE ELECTION (21 items)
#### Small fix
- S-P1-1-exportAPI WHERE clause (replace post-filter with indexed state_id/lga_id/ward_id WHERE).
- S-P1-2-indexes results(status, submitted_at), incidents(category, severity, submitted_at, state via join).
- S-P1-3-admin/verify set reviewed_by + rejection_reason; SELECT FOR UPDATE row lock.
- S-P1-4-SimConfigLock trigger-v2 with `pg_advisory_xact_lock(hashtext('sim_config_lock'))` first; ensure single RUNNING simulation globally; if not IDLE return 409.
- S-P1-5-SimTriggerTimeout: statement_timeout set (SET LOCAL statement_timeout='5min') before calling run_sim_upgraded. Limit max p_total_voters to 5M single chunk; queue multiple chunks.
- S-P1-6-realtime disable for public home; keep admin+agent only.
- S-P1-7-Assignment audit: POST /admin/assign INSERT audit action ASSIGNED; PATCH /admin/assignments endpoint (change assignment / reassign) with audit.
- S-P1-8-TimeTrigger: before insert/update trigger to OVERRIDE when_observed, submitted_at = now() if client date > now()+5min or < election_start - 1 day.
- S-P1-9-StatusHeader: HSTS, CSP nonce in middleware response headers.
- S-P1-10-DuplicateParty: /me/result reject duplicate party_ids in array (UNIQUE(result_submission_id, party_id) already catches at DB; surface graceful error).
- S-P1-11-RateLimitRedis: swap middleware in-memory buckets for Upstash global rate limiting (per-IP consistent across Vercel instances).

#### Required implementation
- I-P1-1-NotificationEmail: Resend + templates for onboarding_complete / result_rejected / correction_requested / result_verified / incident_escalated_admin / emergency_agent_safe_false (6 minimal).
- I-P1-2-Anomalies: TRIGGER after result_submissions insert flag impossible turnout (>110%), vote discrepancy 2-observer > 15% → new column flagged boolean + anomalies UI list in admin dashboard.
- I-P1-3-Coverage API: per state/LGA/ward covered_pus/verified PUs.
- I-P1-4-AdminSearch: results + volunteers + incidents search, filter, sort endpoints (geo hierarchy, status).
- I-P1-5-Tests: Vitest 20 business rules (validateMath, compareObservers, dedup, state transitions, idempotency, canSubmitResult, auth guard).
- I-P1-6-Mobile QA: disable submit button until response; generate idempotency_key on first render; toast status + localStorage resubmission.
- I-P1-7-Storage: evidence bucket create + RLS + signed URL expiry 5 minutes only, 20MB cap, mime allow list.
- I-P1-8-Rollback scripts: bash `vercel inspect ngeop.vercel.app → alias previous-build-url` automated in deploy rollback script.

#### Verification only
- V-P1-BuildURL: User returns live ngeop Vercel build URL; smoke all 44 routes in production + cold start timing note.

#### Future
- None in P1.

### P2 — NICE TO HAVE (11 items)
- Flash of unauthenticated UI: /admin/* RSC redirect before paint.
- Vercel Analytics/Web Vitals wired.
- Custom domain + DNS + HSTS preload list submit.
- CSRF Origin header verify mutation routes.
- `getCachedStats` for polling_units → ST_AsGeoJSON PostGIS RPC single HTTP 176k single response instead of 4×Supabase round trips + object build.
- Admin role granular: OPERATIONS_ADMIN, VERIFIER, DATA_ANALYST, SUPER_ADMIN.
- Export API with real-time streaming, not full memory build.
- Observability: Datadog/Sentry APM for API routes error rate.
- Better Uptime synthetic monitor for /api/health.
- Partition audit_log monthly (declarative).
- Dark/light mode toggle.

### P3 — FUTURE
- AI OCR fraud detection in photos beyond basic NVIDIA OCR.
- Complex microservices, dedicated cache Redis cluster.
- Native iOS/Android apps (PWA fallback acceptable).
- Advanced voter-intent sentiment analysis.
- Multi-country election framework (currently Nigeria-only geo hard coded).

---

## 4. Per-Area Detailed Findings (with code links)

### 4.1 Schema constraints — FK gaps

[200_NEOP_COMPLETE_SCHEMA.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/200_NEOP_COMPLETE_SCHEMA.sql#L20-L265):
- admin_users.user_id → user_accounts.id FK not present (line 101-112).
- observations.volunteer_id → volunteers.id FK missing; observation.assignment_id, election_id, polling_unit_id FKs all missing (line 152-165).
- incidents no FK: volunteer_id, assignment_id → (lines 212-235).
- evidence_records: parent_id + parent_type polymorphic; no FK enforcement.
- result_submissions: assignment_id FK to agent_assignments not present (only volunteer_id, pu_id, election_id separately).
- candidates table does not exist today (parties only). MISSING for actual multi-candidate ballot.

### 4.2 RLS Incidents public-read leak:

RLS at line 880 in [200_NEOP_COMPLETE_SCHEMA.sql](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/200_NEOP_COMPLETE_SCHEMA.sql#L880):
```
CREATE POLICY "Public can read incidents" ON incidents FOR SELECT USING (true);
```
All 12 severity/category what_observed + agent_safe PIIs to any internet scanner.

Similarly observations public-read all, result_submissions all columns (volunteer_id visible). Combined with the fact that all public API routes use SUPABASE_SERVICE_ROLE_KEY (bypasses all RLS anyway): even if we fix RLS policies we need to whitelist columns in the route code because the bypass is active. Today RLS is effectively cosmetic-only except for direct Supabase anon client access from browser which correctly hits policies.

### 4.3 Stats heuristic total_votes:

[api-cache.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/api-cache.ts#L233). Instead of querying sum(valid_votes) the code estimates `covered_pus × 123`. Any public chart claiming totals is fictional. Actual SQL needed:
```sql
select COALESCE(sum(rs.valid_votes), 0)
from (
  select distinct on (polling_unit_id, election_id)
    valid_votes, status
  from result_submissions
  where status in ('VERIFIED','APPROVED')
  order by polling_unit_id, election_id, version desc
) rs;
```

### 4.4 /admin/simulate/trigger/v1 — no admin:

[trigger route](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/simulate/trigger/route.ts#L1-L56). The route calls `createClient(url, service)` with auth header NEVER READ. Delete this file before any production deployment — leaving it in place = P0 critical data integrity incident waiting to happen.

### 4.5 Result submit shape vs Zod:

[schemas.ts ResultSubmissionSchema](file:///c:/Users/Administrator/Webstrom/NEOP/packages/validation/src/schemas.ts#L135-L162) defines `party_results: z.array(PartyResultEntrySchema)` each with `party_id UUID + votes int`.

But [me/result route](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/me/result/route.ts#L36-L37):
```
const totalPartyVotes = Object.values(party_results).reduce((sum, votes) => sum + votes, 0)
```
— which expects an OBJECT keyed by abbreviation. The route NEVER parses with Zod. If client sends array matching schema → Object.values() gives [{party_id, votes}] → sum returns NaN → returns 400. If client sends {APC:182} → matches route → party_results silently dropped (line 123 map looks up `partyMap[party]` where party is abbreviation string from object keys, not UUID). The data actually persists only if abbreviation exactly matches parties.abbreviation values AND parties were preloaded in memory (115-121 line). Since party short codes match in demo seed, sometimes it works accidentally. Unreliable.

### 4.6 OTP verify login flow gap:

[verify-otp route](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/auth/verify-otp/route.ts#L32-L48) calls Supabase `verifyOtp` → returns `{ data: { session, user }, error }`. Today's response returns only { phone, verified:true, message }. The client has NO tokens, cannot persist session via Supabase auth lib. Login broken.

### 4.7 Auto-assign ward alternatives N+1:

[me/auto-assign](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/me/auto-assign/route.ts#L146-L170) in the ward alternatives branch it does:
```
for every pu in ward: run count query (agent_assignments count per pu)
```
Wards can have ~200 PUs → 202 SQL round trips for a single 422 response. Admin only so not a P0, but load issue for large datasets.

### 4.8 Disruptions state filter post-query:

[public/disruptions](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/public/disruptions/route.ts#L89-L95) `state` filter is applied AFTER fetch 50 incidents using JS includes string match on state name. 2 problems:
1. If 49 incidents are from outside state but one in, user sees 1 result instead of state=50.
2. DB never uses state_id index → cannot paginate properly.

### 4.9 CSP & headers incomplete:

[middleware](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/middleware.ts#L400-L417) only sets `X-Content-Type-Options: nosniff, X-Frame-Options: DENY`. Missing:
- Strict-Transport-Security
- Content-Security-Policy (only next.config.ts meta tags perhaps; not enforced by headers for API responses which could return inline data)
- Permissions-Policy here manually copied only for vercel.json.

### 4.10 Realtime slots:

Home page in [page.tsx](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/page.tsx#L93-L118) creates 3 realtime channels for every visitor. 10,000 concurrent = 30,000 slots. Supabase Pro allows ~100k concurrent, but 3x scaling factor unnecessary. Disable realtime for anon viewers; rely on polling interval + SWR cache instead.

---

## 5. Operational Recovery Runbook (skeleton for ELECTION TOMORROW scenario)

Only a skeleton; flesh out once §25 backups confirmed enabled. Steps before 06:00 election day:

1. **Sim freeze** → `simulation_config.status = 'IDLE'`; disable /admin/simulate/* via kill switch route for day.
2. **Env var last check** → Vercel env vars `NEXT_PUBLIC_SUPABASE_ANON_KEY != SUPABASE_SERVICE_ROLE_KEY`. Confirm all 12 set.
3. **Snapshot** → Supabase dashboard → Snapshot. Vercel `vercel --prod` alias current url frozen.
4. **Uptime monitor** → BetterUptime POST check /api/health every 30s; 2 admins + dev on-call.
5. **Warm run** → trigger 5% simulation to ensure queues work, then revert sim_config, restore snapshot.
6. **Recovery in first hour failure:** (a) DB down → seeded fallback data auto-enabled (api-cache.ts, 15s timeout returns); (b) Agent submission failing → idempotency retry UI shows toast "stored locally, retry when online"; (c) Public page breaks → previous Vercel alias rollback.
7. **Rota** → 1 admin operational + 1 dev on-call during polling hours.

---

## 6. Evidence Inventory

Audit based on reading these files during this session (non-exhaustive). Total read → 51 files total:

**API routes inspected 30/44 line by line:**
- [me/result](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/me/result/route.ts)
- [me/assignment](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/me/assignment/route.ts)
- [me/check-in](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/me/check-in/route.ts)
- [me/incident](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/me/incident/route.ts)
- [me/auto-assign](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/me/auto-assign/route.ts)
- [admin/verify](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/verify/route.ts)
- [admin/volunteers](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/volunteers/route.ts)
- [admin/volunteers/:id](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/volunteers/[id]/route.ts)
- [admin/assign](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/assign/route.ts)
- [admin/assignments](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/assignments/route.ts)
- [admin/incident](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/incident/route.ts)
- [admin/incidents](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/incidents/route.ts)
- [admin/results](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/results/route.ts)
- [admin/check-auth](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/check-auth/route.ts)
- [admin/simulate/tick](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/simulate/tick/route.ts)
- [admin/simulate/progress](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/simulate/progress/route.ts)
- [admin/simulate/trigger v1](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/simulate/trigger/route.ts) — P0 gap found
- [admin/simulate/trigger v2](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/admin/simulate/trigger-v2/route.ts)
- [auth/send-otp](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/auth/send-otp/route.ts)
- [auth/verify-otp](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/auth/verify-otp/route.ts)
- [verify/result](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/verify/result/route.ts)
- [public/stats](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/public/stats/route.ts)
- [public/party-results](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/public/party-results/route.ts)
- [public/polling-units](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/public/polling-units/route.ts)
- [public/results](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/public/results/route.ts)
- [public/disruptions](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/public/disruptions/route.ts)
- [public/export](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/public/export/route.ts)
- [health](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/api/health/route.ts)

**Libs (all 16):**
- [admin-auth.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/admin-auth.ts)
- [auth.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/auth.ts)
- [audit.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/audit.ts)
- [rate-limit.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/rate-limit.ts)
- [api-cache.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/api-cache.ts)
- [domain/verification.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/domain/verification.ts) — strong module, but not called consistently
- [domain/simulation.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/domain/simulation.ts)
- [auth-helpers.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/auth-helpers.ts)
- [supabase-browser.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/supabase-browser.ts)
- [supabase-server.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/lib/supabase-server.ts)
- [schemas.ts](file:///c:/Users/Administrator/Webstrom/NEOP/packages/validation/src/schemas.ts)
- [database/src/types.ts](file:///c:/Users/Administrator/Webstrom/NEOP/packages/database/src/types.ts)

**Frontend & infra core:**
- [middleware.ts](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/middleware.ts)
- [page.tsx](file:///c:/Users/Administrator/Webstrom/NEOP/apps/web/src/app/page.tsx)
- [vercel.json root](file:///c:/Users/Administrator/Webstrom/NEOP/vercel.json)
- [package.json root](file:///c:/Users/Administrator/Webstrom/NEOP/package.json)

**Schema + migrations:**
- [200 schema CREATEs + RLS + UNIQUE grepped 80 lines](file:///c:/Users/Administrator/Webstrom/NEOP/supabase/migrations/200_NEOP_COMPLETE_SCHEMA.sql#L1-L265)

---

**Audit conclusion for decision makers:**
- **Do not run a real election on NEOP baseline today.** P0 list 11 engineering items + 3 required implementations + 2 verification checks must land before live volunteer onboarding starts.
- **Beta-ready** achievable in ~5-8 working days of engineering (1 dev) focusing only on P0/P1.
- **Demo-ready today** — use for stakeholder showcases, public dashboards, admin/agent UX walkthroughs, simulations on isolated environment; never for real election operations without the above remediation.
