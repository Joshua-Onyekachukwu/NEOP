# NEOP — FINAL PRODUCTION COMPLETION, SYSTEM CLEANUP, PERFORMANCE, TESTING AND ELECTION READINESS

## ROLE

You are the final principal engineer responsible for taking the existing NEOP platform through its final engineering, QA, performance, cleanup and production-readiness phase.

NEOP must now be treated as a complete product that needs to be brought to a genuinely finished and reliable state.

Your job is NOT simply to add more features.

Your job is to:

1. inspect everything
2. understand everything
3. identify everything incomplete
4. finish what is required
5. fix what is broken
6. remove what is unnecessary
7. improve performance
8. improve rendering speed
9. improve smoothness
10. verify the complete Agent → Verification → Admin → Live Site pipeline
11. run realistic simulations
12. run failure tests
13. run load tests
14. run security checks
15. clean the codebase and infrastructure
16. verify production deployment
17. perform a final end-to-end election rehearsal
18. leave NEOP in a clean, stable, production-ready state

Do not leave known issues simply because they are inconvenient.

Do not create unnecessary new architecture.

Do not rebuild working systems.

Do not hide failures.

Do not declare the system complete just because the application builds.

***

# 1. FINAL PRODUCT VISION

The finished NEOP system should operate as one connected platform.

```
                    NEOP
                     │
        ┌────────────┼────────────┐
        │            │            │
      AGENT        ADMIN        PUBLIC
        │            │            │
        ↓            ↓            ↓
    SUBMIT       MONITOR       LIVE SITE
        │         SIMULATE          ↑
        ↓         REVIEW            │
    VERIFICATION  CONTROL            │
        │            │               │
        └──────┬─────┘               │
               ↓                     │
       CANONICAL RESULTS ────────────┘
               │
        LIVE PROJECTION
               │
      ┌────────┼─────────┐
      ↓        ↓         ↓
     MAP      FEED    AGGREGATES
                       │
                  ┌────┴────┐
                  ↓         ↓
                STATE     PARTY
                TOTALS    TOTALS

```

Everything must be connected.

The Agent must not be a disconnected frontend.

The Admin must not be a disconnected dashboard.

The simulation must not be a fake animation.

The live website must not be a static mockup.

The verification engine must actually process submissions.

The canonical result must actually power the public result.

***

# 2. FINAL RESULT MODEL

The fundamental NEOP rule is:

# TWO AGENT REPORTS → ONE VERIFIED POLLING-UNIT RESULT → ONE PUBLIC RESULT

Every polling unit has two agents.

Therefore internally:

```
Polling Unit 001
    │
    ├── Agent 1 submission
    └── Agent 2 submission

```

After verification:

```
Polling Unit 001
    │
    └── ONE canonical result

```

The live website must only render the canonical result.

Never render both agent reports as two public results.

Never double-count their votes.

Never allow duplicate polling-unit records into the public aggregation.

***

# 3. FINAL SYSTEM STATE

The system must support the complete lifecycle:

```
AWAITING DATA
      ↓
VOTING
      ↓
COUNTING
      ↓
RESULT SUBMITTED
      ↓
VERIFICATION PENDING
      ↓
VERIFIED
      ↓
PUBLISHED
      ↓
RESULT ANNOUNCED

```

And exception states:

```
DISPUTED
DISRUPTED
REQUIRES ADMIN REVIEW
AI VERIFICATION FAILED

```

Make sure the status model is consistent across:

- Agent
- Admin
- database
- verification
- simulation
- map
- live site
- API
- realtime events

Do not maintain separate contradictory status systems.

***

# 4. FINAL LIVE SITE

The final live site should feel like a genuine live election-results platform.

It must not feel like a dashboard filled with static cards.

It should communicate:

- what election/data is being displayed
- whether the system is awaiting data, simulated or live
- how many polling units exist
- how many have submitted
- how many are being verified
- how many are verified
- how many are disputed
- how many have been published
- where results are coming from geographically
- current party totals
- state breakdown
- recent result activity
- current system update time

***

# 5. LIVE SITE REQUIRED COMPONENTS

Verify that the final live site properly renders and connects:

## Election/Data Mode

```
AWAITING DATA
SIMULATED
LIVE ELECTION

```

This must be real system state.

Never hard-code "LIVE".

***

## Polling Unit Count

Render the correct polling-unit count for the selected election.

Example:

```
POLLING UNITS ACROSS NIGERIA

2,400

```

or whatever the actual configured dataset contains.

Do not hard-code the number.

***

## National Map

The national map must show the geographic result state.

Support appropriate states such as:

```
Voting
Counting
Result submitted
Verification pending
Verified
Result announced
Disputed
Disrupted

```

The map must be connected to actual polling-unit state.

***

## Live Result Feed

Show newly published canonical results.

Example:

```
LIVE RESULT FEED

✓ PU 004
Lagos
Party A 184
Party B 96

✓ PU 005
Lagos
Party A 201
Party B 103

```

One PU must appear once.

***

## State Breakdown

Show state-level:

- polling units
- submitted
- verification pending
- verified
- disputed
- disrupted
- reporting progress
- party totals where appropriate

***

## Party Results

Show national party totals.

These must be calculated from:

```
published canonical PU results

```

Never:

```
Agent 1 + Agent 2

```

***

## Progress

Display meaningful election progress:

```
1,842 / 2,400
Polling units verified

76.75%

```

***

## Last Updated

Display the actual latest publication/update timestamp.

Never use fake timers.

***

# 6. LIVE SITE PERFORMANCE

The live site must be fast.

Perform a complete performance review.

Inspect:

- server rendering
- client rendering
- hydration
- API requests
- Supabase queries
- database joins
- aggregation
- realtime
- map rendering
- JavaScript bundles
- image loading
- fonts
- unnecessary dependencies
- component rerenders
- state management
- caching
- loading states

Find and fix anything slowing the application down.

***

# 7. ELIMINATE UNNECESSARY POLLING

Search the entire codebase for:

```
setInterval
setTimeout
polling loops
repeated fetches
automatic refresh

```

Determine whether each one is necessary.

Remove unnecessary polling.

The live site should not repeatedly request the entire election dataset.

Prefer:

```
canonical live projection
+
controlled realtime/event updates
+
caching

```

***

# 8. ELIMINATE N+1 QUERIES

Audit every major page.

Especially:

- live results
- map
- state breakdown
- Admin
- Agent
- verification
- simulation

Look for:

```
one request
    ↓
100 additional requests

```

Replace with appropriate:

- joins
- batched queries
- server-side aggregation
- projections
- caching

***

# 9. LIVE RESULT PROJECTION

The public site should primarily consume a read-optimized live result projection.

Architecture:

```
Agent submissions
       ↓
Verification
       ↓
Canonical result
       ↓
Publication
       ↓
Live result projection
       ↓
Public site

```

Do not make the public website perform complex verification logic.

***

# 10. REALTIME PERFORMANCE

Audit every realtime subscription.

Determine:

- how many subscriptions are created
- what each subscription listens to
- whether subscriptions are duplicated
- whether subscriptions are unnecessarily broad
- whether reconnects cause duplicates
- whether a page creates subscriptions that never clean up

Fix all unnecessary subscriptions.

When one result changes, do not force the entire application to rerender.

Update only the relevant:

- PU
- state aggregate
- national aggregate
- party total
- feed item
- progress count
- map status

***

# 11. MAP PERFORMANCE

The national map must remain responsive.

Optimize:

- clustering
- viewport loading
- marker rendering
- geographic queries
- map initialization
- status updates
- layer updates

Do not load enormous datasets unnecessarily.

Do not recreate the entire map every time a result changes.

***

# 12. DATABASE PERFORMANCE

Inspect all production queries.

Check:

- indexes
- query plans
- joins
- filters
- aggregation
- pagination
- sorting
- large scans
- duplicate queries

Add or modify indexes only where justified by actual query patterns.

Remove obsolete indexes where appropriate.

***

# 13. SUPABASE PROTECTION

The system must be designed so that normal election operation does not unnecessarily overload Supabase.

Especially inspect:

- live public viewers
- realtime
- simulation
- verification workers
- aggregation
- Admin dashboards

Use:

```
batching
controlled concurrency
caching
incremental aggregation
background processing

```

where appropriate.

***

# 14. AGENT FINAL CHECK

Fully test:

```
Login
Onboarding
Assignment
Polling Unit
Result Form
Party Results
Evidence Upload
Submission
Retry
Network Failure
Submission Status
Verification Status
History

```

Verify the Agent can only submit for authorized polling units.

Test two agents submitting the same PU.

Verify they become the two internal evidence records for that PU.

***

# 15. VERIFICATION FINAL CHECK

Test:

```
Agent 1 submits
Agent 2 submits
       ↓
System identifies same PU
       ↓
Compare reports
       ↓
Deterministic checks
       ↓
NVIDIA verification
       ↓
Verification decision

```

Test matching results.

Test mismatching results.

Test incomplete evidence.

Test malformed data.

Test duplicate submissions.

Test retries.

Test NVIDIA failure.

***

# 16. NVIDIA FINAL CHECK

Use the existing NVIDIA API keys.

Verify:

- production environment variables
- server-side requests
- correct model configuration
- timeout
- retry
- error handling
- logging
- failure recovery

Never expose keys to the client.

Never commit keys.

Never print secrets in logs.

***

# 17. ADMIN FINAL CHECK

Review the entire Admin application.

Admin must be able to:

- manage elections
- manage polling units
- manage agents
- manage assignments
- monitor submissions
- monitor verification
- inspect discrepancies
- resolve disputes
- monitor live results
- start simulations
- pause simulations
- stop simulations
- inspect simulation progress
- inspect audit history
- handle corrections

Everything should be functional.

***

# 18. ADMIN VERIFICATION QUEUE

The Admin must see exceptions clearly.

Example:

```
POLLING UNIT 004

Agent 1
Party A: 184
Party B: 96

Agent 2
Party A: 148
Party B: 96

DISCREPANCY

Party A difference: 36

[Review]

```

The public site must not display both reports.

***

# 19. SIMULATION FINAL CHECK

The simulation must be a genuine system rehearsal.

It must use the same underlying pipeline as real election processing:

```
Simulated Agent
       ↓
Submission
       ↓
Verification
       ↓
NVIDIA
       ↓
Canonical Result
       ↓
Publication
       ↓
Live Projection
       ↓
Live Site

```

Do not create a separate fake simulation rendering engine.

***

# 20. SIMULATION CONTROLS

From Admin, verify:

```
Create simulation
Start
Pause
Resume
Stop
Reset
Inspect

```

Simulation should support appropriate:

- number of polling units
- submission rate
- agent participation
- delays
- discrepancies
- failures
- verification load

***

# 21. RUN MULTIPLE SIMULATIONS

Run at least:

### Small

```
10–50 PUs

```

Purpose:

Validate functionality.

### Medium

```
100–500 PUs

```

Purpose:

Validate normal system operation.

### Large

```
1,000+ PUs

```

Purpose:

Validate throughput.

### Stress

Use a controlled high-volume simulation.

Purpose:

Identify bottlenecks.

Do not blindly increase traffic until infrastructure collapses.

***

# 22. SIMULATION FAILURE TESTS

Intentionally introduce:

```
Agent 1 delayed
Agent 2 delayed
Agent never submits
Duplicate submission
Conflicting result
Malformed result
Missing evidence
NVIDIA failure
Verification worker failure
Realtime disconnect
Database delay
Network failure

```

Verify the system recovers correctly.

***

# 23. SIMULATION MUST NEVER CONTAMINATE PRODUCTION

Verify:

```
simulation data
≠
real election data

```

Simulation must not:

- modify real election totals
- publish fake results into a real election
- trigger real election notifications
- alter real agent records
- corrupt real aggregates

The live site must clearly show:

```
SIMULATED

```

when simulation data is being displayed.

***

# 24. FULL LIVE-SITE SIMULATION REHEARSAL

Run the live site while the simulation is active.

Start from:

```
AWAITING DATA

```

Then watch:

```
SIMULATED
      ↓
Agent submissions
      ↓
Verification
      ↓
Verified PUs
      ↓
Published PUs

```

Verify that the live website changes naturally.

The following must update:

```
Polling-unit count/progress
Map
Live feed
State breakdown
Party totals
Verification counters
Last updated
Status indicators

```

***

# 25. DUPLICATE RESULT TEST

This is mandatory.

For every simulation:

```
2 agents
1 polling unit

```

must produce:

```
2 internal submissions
1 canonical result
1 public result

```

Verify the public site never displays:

```
PU 001
PU 001

```

because of the two agents.

Verify party totals are counted once.

***

# 26. IDEMPOTENCY TESTING

Repeat the same submission multiple times.

Repeat the same verification job.

Repeat the publication job.

Repeat realtime events.

Verify the final system still contains:

```
ONE canonical result
ONE aggregate contribution
ONE public result

```

***

# 27. CORRECTION TEST

Publish a result.

Then correct it.

Verify:

```
old result
↓
authorized correction
↓
new result
↓
aggregate corrected
↓
live site updated
↓
audit preserved

```

Never double-count the correction.

***

# 28. AUDIT LOG FINAL CHECK

Verify audit records exist for:

- submission
- verification
- AI analysis
- discrepancy
- admin review
- approval
- publication
- correction
- simulation
- simulation lifecycle

Audit records must identify:

```
who
what
when
which election
which polling unit
what changed

```

***

# 29. SECURITY FINAL CHECK

Run a complete security audit.

Check:

- authentication
- authorization
- RLS
- IDOR
- privilege escalation
- API security
- Admin authorization
- Agent authorization
- election isolation
- storage access
- evidence access
- service-role usage
- NVIDIA secret handling
- simulation access
- result modification
- canonical-result modification

Attempt unauthorized actions and verify they fail.

***

# 30. CODEBASE CLEANUP

Now perform a complete cleanup pass.

Search for:

```
TODO
FIXME
temporary
mock
mockData
dummy
placeholder
hardcoded
console.log
debug
test-only
unused
deprecated
legacy
old
backup

```

For each occurrence, determine whether it should:

```
REMOVE
REPLACE
KEEP
DOCUMENT

```

Do not blindly delete something without understanding its purpose.

***

# 31. REMOVE DEAD CODE

Find and remove:

- unused components
- unused hooks
- unused utilities
- unused API routes
- unused imports
- obsolete result systems
- obsolete simulation systems
- duplicate components
- duplicate queries
- abandoned experiments
- unused dependencies
- obsolete environment variables
- dead feature flags

Do not remove anything that is still required.

***

# 32. REMOVE DUPLICATED ARCHITECTURE

Search for multiple competing implementations of:

- result submission
- result verification
- aggregation
- live results
- simulation
- realtime
- polling-unit status

There should be one authoritative implementation for each responsibility.

If multiple implementations exist:

1. determine which is correct
2. migrate callers
3. remove obsolete implementation
4. test again

***

# 33. CLEAN DATABASE

Review:

- obsolete tables
- duplicate result tables
- unused columns
- unused indexes
- obsolete functions
- obsolete triggers
- stale RLS policies
- test records
- simulation contamination

Do not delete production data blindly.

Separate:

```
production
test
simulation

```

properly.

***

# 34. FRONTEND CLEANUP

Remove:

- unnecessary rerenders
- unnecessary client components
- duplicated fetching
- unused state
- excessive loading spinners
- unnecessary animations
- expensive effects
- stale components

The application should feel smooth.

Do not sacrifice usability just to remove animations.

***

# 35. UX SMOOTHNESS

Review every major transition.

Examples:

```
Agent submits
Admin receives submission
Verification starts
Verification completes
Result publishes
Live site updates

```

Avoid abrupt UI changes.

Use appropriate:

- optimistic states
- skeletons
- progress indicators
- status transitions
- error recovery
- realtime updates

Do not show fake progress.

***

# 36. LOADING STATES

Every important page must have a proper state for:

```
Loading
Loaded
Empty
Error
Offline/disconnected
No results
Awaiting verification

```

Do not allow blank white screens.

Do not leave users staring at an infinite spinner.

***

# 37. ERROR HANDLING

Every major API/action should handle:

```
network failure
timeout
authorization failure
validation failure
server error
database failure
AI failure

```

Errors should be recoverable where possible.

Do not expose internal stack traces to users.

***

# 38. MOBILE TESTING

Test the complete platform on mobile-sized screens.

Especially:

- Agent result entry
- evidence upload
- Admin monitoring
- live site
- map
- result feed
- state breakdown

The Agent workflow is especially important because election field operations may occur under difficult network/device conditions.

***

# 39. ACCESSIBILITY

Check:

- keyboard navigation
- focus states
- readable text
- contrast
- buttons
- form labels
- status communication
- screen-reader semantics
- map alternatives where appropriate

***

# 40. BUILD AND TYPE CHECK

Run:

```
production build
type checking
linting
tests

```

Fix all legitimate failures.

Do not suppress errors just to get green output.

***

# 41. BROWSER TESTING

Test major flows in a real browser environment.

Verify:

```
Agent
Admin
Public

```

independently.

Then test them simultaneously.

***

# 42. END-TO-END TEST

Run the complete flow:

```
Admin creates election
       ↓
Polling units exist
       ↓
Two agents assigned
       ↓
Agent 1 submits
       ↓
Agent 2 submits
       ↓
Verification starts
       ↓
NVIDIA processes verification
       ↓
Results match
       ↓
Canonical result created
       ↓
Result published
       ↓
National totals update
       ↓
State totals update
       ↓
Map updates
       ↓
Live feed updates
       ↓
Public result appears

```

Then repeat with a discrepancy.

***

# 43. LOAD TEST THE PUBLIC SITE

Test the live-results system under simulated public traffic.

Measure:

```
initial render
server response
database latency
realtime latency
map performance
memory
CPU
network payload

```

The public site's database load must not increase linearly with viewer count.

Use caching/CDN/read projections where appropriate.

***

# 44. PERFORMANCE TARGETS

Establish real measurements rather than claiming performance.

Measure:

```
TTFB
LCP
INP
CLS
API latency
database latency
publication latency
verification latency
realtime latency

```

Identify the largest bottlenecks.

Fix them.

Re-measure.

Do not say "optimized" without measuring before and after.

***

# 45. PRODUCTION ENVIRONMENT CHECK

Verify:

```
Vercel
Supabase
NVIDIA
backend workers
environment variables
database migrations
storage
realtime

```

Check that production is actually running the latest intended code.

Verify:

```
Git branch
commit
deployment
environment
migration version

```

are consistent.

***

# 46. PRODUCTION SMOKE TEST

After deployment, run a safe production smoke test.

Verify:

```
Public site loads
Admin loads
Agent loads
Authentication works
Election data loads
Live results load
Realtime connects
NVIDIA backend responds
Verification works
Simulation environment works

```

Do not modify real production election data during testing.

Use an isolated test/simulation context.

***

# 47. FINAL ELECTION-DAY REHEARSAL

Run one complete controlled election rehearsal.

Simulate:

```
Polling units
Two agents per PU
Agent submissions
Evidence
Verification
NVIDIA analysis
Discrepancies
Admin review
Publication
National aggregation
State aggregation
Map
Live feed
Public traffic

```

Monitor the entire system.

The purpose is to answer:

# "If this system had to process an election tomorrow, what would break?"

If anything breaks:

```
identify
fix
test
retest

```

Do not simply document the problem.

***

# 48. FINAL HEALTH CHECK

At the end, verify:

```
Frontend              ✓
Backend               ✓
Database              ✓
Authentication        ✓
Authorization         ✓
RLS                   ✓
Agent workflow        ✓
Admin workflow        ✓
Verification          ✓
NVIDIA                ✓
Canonical results     ✓
Aggregation           ✓
Realtime              ✓
Live site             ✓
Map                   ✓
Simulation            ✓
Audit                 ✓
Security              ✓
Performance           ✓
Mobile                ✓
Production deployment ✓

```

***

# 49. FINAL CLEANUP CHECK

Before declaring completion:

```
[ ] No unnecessary mock data
[ ] No duplicate result systems
[ ] No duplicate public results
[ ] No dead result code
[ ] No unnecessary polling
[ ] No N+1 queries
[ ] No exposed secrets
[ ] No broken links/routes
[ ] No obvious console errors
[ ] No uncontrolled realtime subscriptions
[ ] No uncontrolled simulation writes
[ ] No production contamination from simulations
[ ] No unresolved P0 issues
[ ] No known critical security issues
[ ] No known critical data-integrity issues

```

***

# 50. FINAL DEFINITION OF DONE

NEOP is only considered complete when:

### Agent

Two agents can independently submit results for the same polling unit.

### Verification

The system automatically compares the submissions and performs the configured deterministic and NVIDIA checks.

### Discrepancy

Conflicting submissions are flagged for Admin instead of silently being published.

### Canonical result

Matching/approved submissions produce exactly ONE canonical polling-unit result.

### Live site

The public site renders exactly ONE result per polling unit.

### Aggregation

That canonical result contributes exactly once to:

- national totals
- state totals
- LGA totals where supported
- party totals
- reporting statistics

### Realtime

The live site updates naturally as new canonical results are published.

### Map

The map reflects the current result status.

### Feed

The feed shows newly published results once.

### Simulation

Admin can run a realistic election simulation through the actual system pipeline.

### Isolation

Simulation cannot contaminate real election data.

### Performance

The system remains fast under realistic submission and public-viewer loads.

### Security

Unauthorized users cannot manipulate results or access protected functionality.

### Reliability

Failures do not cause data loss or corrupt the canonical result.

### Audit

Every important action is traceable.

***

# 51. FINAL REPORT

When finished, produce a final engineering report with these sections:

## SYSTEM STATUS

Choose exactly one:

```
NOT READY
CONDITIONALLY READY
READY FOR CONTROLLED OPERATION
PRODUCTION READY

```

Do not choose a higher status unless the evidence supports it.

## WHAT WAS ALREADY WORKING

List it.

## WHAT WAS BROKEN

List it.

## WHAT WAS MISSING

List it.

## WHAT YOU IMPLEMENTED

List everything.

## WHAT YOU REMOVED

List dead/duplicate/obsolete functionality removed.

## PERFORMANCE IMPROVEMENTS

Include actual measurements where available.

## DATABASE CHANGES

List migrations, indexes, constraints, functions and policies.

## NVIDIA

Explain the final verification integration.

## SIMULATION RESULTS

Include:

- simulation sizes
- throughput
- failures tested
- results
- bottlenecks

## SECURITY

List tests performed and findings.

## E2E

Confirm the complete Agent → Verification → Canonical Result → Live Site pipeline.

## REMAINING ISSUES

Be completely honest.

If anything remains, explain:

```
severity
impact
why it remains
what is required

```

***

# FINAL INSTRUCTION

Do not stop when the application looks finished.

Do not stop when the build passes.

Do not stop when the dashboard loads.

Do not stop when the live page displays mock data.

Do not stop when a small simulation works.

Continue until the entire system has been inspected, implemented, cleaned, tested, stress-tested and verified.

The final NEOP experience should be:

```
FAST
SMOOTH
CONNECTED
RELIABLE
SECURE
AUDITABLE
REALTIME
SCALABLE

```

The final architecture must remain:

```
                TWO AGENT SUBMISSIONS
                         ↓
                  VERIFICATION
                  /           \
          DETERMINISTIC       NVIDIA AI
                  \           /
                   ↓         ↓
                 DECISION
                     ↓
            ONE CANONICAL PU RESULT
                     ↓
                  PUBLISHED
                     ↓
             LIVE RESULT PROJECTION
                     ↓
          ┌──────────┼───────────┐
          ↓          ↓           ↓
        MAP        FEED       AGGREGATES
                                  ↓
                         STATE + NATIONAL
                         + PARTY RESULTS
                                  ↓
                             LIVE SITE

```

The simulation must exercise this same architecture.

The Admin must control it.

The Agent must feed it.

The verification engine must validate it.

The live site must render it.

And the final system must be cleaned and optimized so that the complexity of everything happening underneath is not visible to the user.

The user should experience NEOP as a fast, smooth, trustworthy, continuously updating election platform.

---

## SESSION REPORT — Sep 14: Simulation pipeline end-to-end (DONE)

**Goal**: Run Simulation flow (reset → 20M+ votes rendered → configurable duration) working on the live site.

**Architecture decision (per user)**: No Convex (would add a slow second data layer). Supabase Free-plan DB quota (~500MB, enforcement periodic) cannot hold 20M real votes (measured: ~40MB per 1M votes + ~0.78MB per 1k agents). Chosen design: **backend stores real small vote counts; public site renders ×display_multiplier (e.g. ×10) — SIMULATED mode only, live elections never scale.**

**Migrations**: 238 (display_multiplier column + mv_public_published_results view fix: canonical_result_id/pu_name aliases), 239 (get_party_totals_published RPC), 240 (get_published_vote_totals RPC), 241 (scenario weight fix — minor parties rescaled by 1−NDC−APC so landslide = NDC 42%/APC 22%; was diluted to 25%/15%).

**Route/api-cache fixes**:
- trigger-v2: accepts `display_voters`; upserts system_config (data_mode=SIMULATED, active_election_id, display_multiplier) at launch AND completion (was .update() on a nonexistent row → site never left AWAITING).
- api-cache: getDisplayScale() applies ×multiplier to stats.total_votes, party totals, per-PU feed votes when SIMULATED; stats/party-results now use server-side RPCs (PostgREST hard-caps un-capped selects at 1000 rows — silently undercounted once sim data >1000 rows).
- Dashboard: Real Voters (1-10M) + Display Voters (×1-40) sliders, coverage default 25%, defaults changed from 100M → 5M real / 50M display.

**Verified live** (localhost:3000):
- config: SIMULATED / SIMULATED DATA, 80,996 results, 35,190 published
- stats: 37,003 covered, 35,190 verified, **39,792,160 votes** (3.98M real ×10), 37 states
- party-results: NDC 38.8% / APC 24.8% landslide, grand_total 35.8M
- results feed: source supabase, 35,190 PUs, per-PU votes ×10
- DB: 636MB, read-write, no lock

**Admin login**: admin@neop.ng / NEOP-admin-2026! (password set via SQL this session — change it).

**Re-run**: POST /api/admin/simulate/trigger-v2 {scenario, target_voters, display_voters, duration_minutes, coverage_pct:25, reset_first:true} — or use the dashboard Simulation tab (defaults 5M/50M/25%/5min).

**Known limits**: Free-plan DB locks read-only when size exceeds quota (observed at ~777MB). Safe sim envelope: ≤5M real votes at ≤25% coverage (~450-640MB peak). If a run dies mid-way: cleanup via _scripts/cleanup-sim-debris.mjs (election-scoped) or supabase/RECOVERY_DISK_FULL.sql, then VACUUM FULL each big table (single-statement via MCP execute_sql — multi-statement wraps in a txn and VACUUM rejects that; SET TRANSACTION READ WRITE unblocks MCP writes when locked).

## SESSION R — Sep 14 (evening): Firefox crash fix, branch cleanup, prod deploy
- **Firefox "Something went wrong"**: LiveMap + ResultFeed both subscribed a Supabase channel named `public:canonical_pu_results`; second mount added callbacks to an already-subscribed channel → throw → error boundary. Fixed via unique names (`-map`/`-feed`) + try/catch guard (commit cbb6979). Verified in prod-mode bundle locally and in the deployed production chunk.
- **Branches**: master and main had NO common ancestor (two histories). master stale since Sep 03 → archived as tag `archive/master-v1-sep03`, GitHub default branch switched to `main`, `master` deleted. `main` is the only branch.
- **Production**: CLI deploy of cbb6979 to ngeop.vercel.app — READY. Verified: home 200, config SIMULATED, parties NDC 38.8%/APC 24.8%, fixed channel names present in prod bundle, zero occurrences of the broken name.
- **Vercel caveat**: API refuses to change project productionBranch (still `master`, now deleted) — dashboard-only setting. Until set to `main` by hand (Dashboard → ngeop → Settings → Git), pushes to main create previews; production ships via CLI deploys.
- **Vercel token saved to `.env.local` as VERCEL_TOKEN (gitignored, untracked — never commit it).**
## SESSION S — One authoritative results pipeline, feed party fix, deploy-path repair (Sep 14)

- **Authoritative aggregation (242)**: `get_election_summary()` is now the single source of truth — national + per-party + per-state (with leaders) all derived from PU canonicals via `polling_units.state_id`. Single-pass over the 37k canonicals: 9–13 s → **1.15 s warm**; invariant verified: state-sum == national == party-sum (35,835,290).
- **State Breakdown empty → fixed**: the stats route grouped PUBLISHED-only mv rows (1000-row cap, no `total_pus`) so every state rendered zeros; the good RPC fallback never ran. Route now serves the RPC with compatibility aliases (`covered_pus`, `total_pus`, etc.). All **37/37 states render real data** (Lagos 13,325 PUs, Kano 11,222).
- **StateTable key mismatch fixed**: UI read `covered_pus` while payload emitted `covered` — aliases + leading-party column + verification % + derived-data note.
- **Leaderboard ordering**: deterministic (votes DESC, alphabetical tiebreak) enforced at the final sort; single numeric basis across surfaces (party-attributable valid votes; ballots kept separately for transparency).
- **Feed fixed twice**: real geography per row (state/LGA), and the party join rebuilt as plain select + JS merge after finding `parties.name` doesn't exist (`official_name`) — chips now **sum exactly to each row's valid votes**.
- **Full-screen map**: opens full-viewport with badge + exit control, canvas context preserved (CSS fixed-position, not DOM reparenting), verified open/resize/exit in browser.
- **E2E integrity PASS**: published PDP 120 / APC 80 / LP 40 through the real ingestion fn → national +240, covered +1, party deltas exact; resubmission **supersedes** (never double-counts); cleanup done.
- **Deploy-path repair**: `apps/web/vercel.json` hourly cron (Hobby-incompatible) blocked deploys; cron removed in favor of **pg_cron `dead-letter-reaper-10min`** running the new **`process_dead_letter_batch`** RPC (migration 244) — the batch processor migration 224 never shipped, and the manual cron endpoint had been calling a nonexistent signature. Deploys must run from **repo root** (workspace build).
- **Production rehearsal PASS**: national = state-sum = party-sum = 35,835,290; 37/37 states; leaderboard NDC > APC > PDP; feed chips reconcile; GitHub auto-deploy `Vercel=success`.
- Commits: `51b2a85`, `229d2ba`, `1c3f43b` (all today-dated).
