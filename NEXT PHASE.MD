# NEOP — LIVE ELECTION SITE + SIMULATION + AGENT + ADMIN FULL-SYSTEM READINESS AND IMPLEMENTATION

## ROLE

You are the principal engineer responsible for taking the existing NEOP platform from its current state to a fully connected, production-ready election operations and live-results system.

You are not being asked to simply build a prettier live-results page.

You are being asked to make the entire system work as one connected platform:

```
AGENT APP
     ↓
RESULT SUBMISSION
     ↓
VERIFICATION ENGINE
     ↓
AI / NVIDIA VERIFICATION
     ↓
CANONICAL POLLING-UNIT RESULT
     ↓
LIVE RESULT PROJECTION
     ↓
LIVE WEBSITE
     ↓
NATIONAL / STATE / LGA / PU AGGREGATES

```

The Admin system must control, monitor, investigate and simulate this entire process.

The simulation system must be capable of exercising the same underlying result pipeline that will be used during a real election, while remaining completely isolated from real election data.

Do not build fake disconnected demo behavior.

Do not hard-code live results into the frontend.

Do not create duplicate result systems.

Do not stop after identifying issues.

Inspect the existing system, determine what is already implemented, fix what is broken, implement what is missing, test everything, and leave the system in a coherent working state.

***

# 1. FIRST: FULL NEOP SYSTEM AUDIT

Before implementing anything, inspect the entire repository.

Review:

### Frontend

- public/live website
- Agent application
- Admin application
- dashboards
- election pages
- polling-unit pages
- state pages
- result pages
- simulation pages
- verification pages
- mobile layouts
- loading states
- error states
- realtime updates

### Backend

- APIs
- server actions
- Supabase
- PostgreSQL
- Convex
- background jobs
- queues
- realtime
- storage
- result processing
- verification
- aggregation
- notifications
- audit system
- simulation system

### Data model

Inspect:

- elections
- states
- LGAs
- wards
- polling units
- agents
- agent assignments
- submissions
- results
- verification
- canonical results
- live projections
- party results
- aggregates
- simulations
- audit logs

### Infrastructure

Inspect:

- Vercel
- Supabase
- NVIDIA APIs
- environment variables
- production configuration
- migrations
- indexes
- RLS
- database functions
- triggers
- realtime subscriptions
- caching
- background workers

***

# 2. CREATE A FULL COMPLETION MATRIX

Before changing anything, internally assess every major feature as:

```
COMPLETE
PARTIAL
BROKEN
MISSING
DUPLICATED
UNSAFE
PERFORMANCE RISK
NOT REQUIRED

```

Then determine:

### P0

Must work before a real election.

### P1

Important for reliable operations.

### P2

Useful but not election-critical.

### P3

Future functionality.

Do not spend time polishing P3 features while P0 functionality is broken.

***

# 3. THE CORE SYSTEM MODEL

The entire platform must operate around this architecture:

```
                     ELECTION
                         │
                         ↓
                 POLLING UNIT
                         │
              ┌──────────┴──────────┐
              ↓                     ↓
          AGENT 1                AGENT 2
              │                     │
              ↓                     ↓
        SUBMISSION 1          SUBMISSION 2
              │                     │
              └──────────┬──────────┘
                         ↓
                VERIFICATION ENGINE
                         │
              ┌──────────┴──────────┐
              ↓                     ↓
        DETERMINISTIC             NVIDIA AI
           CHECKS                 ANALYSIS
              │                     │
              └──────────┬──────────┘
                         ↓
                  DECISION ENGINE
                         │
              ┌──────────┴──────────┐
              ↓                     ↓
           MATCH                 DISPUTE
              │                     │
              ↓                     ↓
        CANONICAL RESULT        ADMIN REVIEW
              │
              ↓
          PUBLISHED
              │
              ↓
       LIVE RESULT PROJECTION
              │
       ┌──────┼────────┐
       ↓      ↓        ↓
    NATIONAL STATE    MAP
      TOTALS   TOTALS
              │
              ↓
        PUBLIC LIVE SITE

```

The public site must never directly render the two agent submissions.

There must be:

# ONE PUBLIC RESULT PER POLLING UNIT.

The two agent submissions are internal evidence.

***

# 4. LIVE SITE MUST NEVER BE A STATIC MOCKUP

Review every live-site component and determine whether it is:

```
STATIC
HARDCODED
MOCK DATA
CONNECTED TO REAL DATA
PARTIALLY CONNECTED
BROKEN

```

Remove fake behavior where the component is supposed to be connected.

Do not replace useful existing functionality unnecessarily.

Every important number displayed on the live website must have a real source.

***

# 5. LIVE SITE PRIMARY HEADER

The live site should clearly show the current election/data state.

The header should communicate:

```
Election / Data Mode

```

with an explicit indicator:

```
AWAITING DATA

```

or:

```
SIMULATED

```

or:

```
LIVE ELECTION

```

Never allow users to mistake simulation data for real election data.

The indicator must come from system state.

Do not hard-code:

```
LIVE

```

when the system is actually running a simulation.

***

# 6. POLLING UNIT COUNT

Render the total number of polling units relevant to the selected election.

Example:

```
POLLING UNITS ACROSS NIGERIA
[2,400]

```

or the actual configured INEC election dataset count.

The number must come from the database.

Do not hard-code the number into the component.

The system must support:

```
National
State
LGA
Ward
Polling Unit

```

scopes.

***

# 7. NATIONAL MAP

The live website must contain the national map.

The map must be connected to actual polling-unit/result state.

The interface should support status visualization such as:

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

The exact statuses should come from the system's canonical status model.

Do not create a second incompatible status model just for the map.

***

# 8. MAP STATUS MODEL

Every polling unit should be capable of having a map-visible state.

For example:

```
AWAITING DATA
VOTING
COUNTING
RESULT SUBMITTED
VERIFICATION PENDING
VERIFIED
RESULT ANNOUNCED
DISPUTED
DISRUPTED

```

The state transition should be driven by actual events.

Example:

```
No submission
    ↓
VOTING
    ↓
Agent 1 submits
    ↓
RESULT SUBMITTED
    ↓
Agent 2 submits
    ↓
VERIFICATION PENDING
    ↓
Verification passes
    ↓
VERIFIED
    ↓
Published
    ↓
RESULT ANNOUNCED

```

If the system is configured to use different terminology, preserve the existing product language while maintaining the same underlying meaning.

***

# 9. MAP MUST UPDATE FROM EVENTS

When a polling unit changes status:

```
PU 001
VERIFICATION PENDING

```

to:

```
PU 001
VERIFIED

```

the map should update without requiring a full page reload.

Do not refresh the entire election dataset for every status change.

Use a read-optimized projection and appropriate realtime/event mechanisms.

***

# 10. MAP PERFORMANCE

The map is potentially the most expensive component on the live site.

Do not render thousands of complex React components individually if that is unnecessary.

Optimize:

- marker rendering
- clustering
- viewport loading
- geographic queries
- state filtering
- realtime updates
- map layers
- result status changes

Only load the geographic data necessary for the current viewport where possible.

Do not query the entire national dataset repeatedly.

***

# 11. LIVE RESULT FEED

Implement a genuinely live result feed.

Example:

```
LIVE RESULT FEED

10:41:21
✓ Polling Unit 004 verified
State: Lagos
LGA: Ikeja
Party A: 184
Party B: 96

10:42:07
✓ Polling Unit 005 verified
State: Lagos
LGA: Ikeja
Party A: 201
Party B: 103

```

The feed must be generated from actual publication events.

Do not fabricate timestamps.

Do not hard-code fake activity.

The feed should show the latest relevant canonical result events.

***

# 12. LIVE FEED MUST RENDER ONE RESULT PER PU

If:

```
Agent 1 → PU 004
Agent 2 → PU 004

```

the live feed must NOT show:

```
PU 004
PU 004

```

It must show:

```
PU 004
✓ Verified

```

once.

The feed must consume the canonical published-result event.

***

# 13. STATE BREAKDOWN

Implement the State Breakdown section.

It should show configured election states with live statistics.

Example:

```
STATE BREAKDOWN

Lagos
Polling Units     5,761
Submitted         4,892
Verified          4,521
Disputed             31
Progress          78.5%

Abuja FCT
Polling Units     ...
Submitted         ...
Verified          ...
Disputed          ...
Progress          ...

```

Use actual election data.

Do not assume every state has the same number of polling units.

***

# 14. STATE BREAKDOWN MUST BE LIVE

When another polling unit becomes verified:

```
Lagos
Verified: 4,521 → 4,522

```

The state aggregate should update.

Do not recalculate every state from every raw agent submission on every page render.

Use incremental canonical-result aggregation or an equivalent read-optimized architecture.

***

# 15. ELECTION PARTY RESULTS

The live site must contain party result information.

For example:

```
PARTY RESULTS

Party A        82,491
Party B        76,203
Party C        41,882
Party D        19,204

```

The values must come from published canonical polling-unit results.

Never aggregate:

```
Agent 1 + Agent 2

```

That would double-count votes.

The aggregation must be:

```
ONE CANONICAL RESULT PER PU

```

***

# 16. NATIONAL PARTY TOTALS

Implement national-level party totals.

When:

```
PU 004
Party A = 184

```

becomes published:

```
National Party A total
+
184

```

The aggregate must update exactly once.

If the result is corrected:

```
old Party A = 184
new Party A = 181

```

then:

```
remove 184
add 181

```

and never double-count.

***

# 17. OTHER LIVE SITE INFORMATION

Inspect the existing live-site design and identify all other intended sections.

Where appropriate, include:

- total polling units
- reporting progress
- verified results
- pending verification
- disputed results
- disrupted polling units
- voting status
- counting status
- result-announced status
- national party totals
- state breakdown
- LGA breakdown where useful
- live result feed
- recent verified results
- verification statistics
- turnout metrics where actual data exists
- valid votes
- rejected votes
- reporting percentage
- result coverage
- map
- election metadata
- last updated time
- data-source/methodology information
- simulation/live indicator

Do not invent metrics that the database cannot support.

***

# 18. RESULT PROGRESS

The live site should make the election's progress obvious.

For example:

```
RESULT PROGRESS

1,842 / 2,400
Polling units verified

76.75%

```

Also consider:

```
Submitted
1,936

Verification pending
63

Verified
1,842

Disputed
31

```

All values must be derived from canonical system state.

***

# 19. "LAST UPDATED"

Show when live result data was last updated.

Example:

```
Last updated 10:42:31

```

Do not use a fake timer.

The value must come from actual system events/data.

If the site is not receiving updates, make that visible internally and diagnose the problem.

***

# 20. LIVE SITE DATA ARCHITECTURE

The public website should NOT query the raw agent submission tables for normal rendering.

Use:

```
Agent submissions
      ↓
Verification
      ↓
Canonical results
      ↓
Published live projection
      ↓
Public website

```

The public website should primarily consume:

```
published canonical results
live aggregates
result-status projections

```

This keeps the public site fast.

***

# 21. PUBLIC RESULT DATABASE MODEL

Enforce:

```
election_id + polling_unit_id

```

as the logical uniqueness boundary for the canonical public result.

There must never be two published canonical results for the same polling unit and election.

Agent submissions can be multiple records.

Public results cannot.

***

# 22. ADMIN SIMULATION SYSTEM

The Admin application must contain a proper simulation control center.

The simulation must not be a fake animation.

It must exercise the actual result pipeline.

Admin should be able to configure:

```
Election
Simulation mode
Number of polling units
Agent participation
Submission speed
Verification speed
Discrepancy rate
AI verification rate
Network delays
Failed submissions
Delayed submissions
Disrupted polling units

```

Only expose controls that are actually supported.

***

# 23. SIMULATION MODES

Support appropriate simulation modes such as:

### Controlled

Small deterministic simulation for development.

### Election rehearsal

Simulates a realistic election-day flow.

### Stress test

Tests high-volume submissions and verification.

### Failure test

Introduces:

- network failures
- delayed agents
- duplicate submissions
- conflicting results
- AI failures
- worker failures
- realtime reconnects

### Full-system rehearsal

Runs the complete:

```
Agent
→ submission
→ verification
→ canonical result
→ publication
→ live site

```

pipeline.

***

# 24. SIMULATION MUST USE REAL SYSTEM LOGIC

This is critical.

Do NOT implement:

```
Simulation → directly update live UI

```

Instead:

```
Simulation
    ↓
creates simulated agent submissions
    ↓
normal verification pipeline
    ↓
normal AI verification where configured
    ↓
normal canonical result creation
    ↓
normal publication pipeline
    ↓
simulation live projection
    ↓
live site in SIMULATED mode

```

The objective is to test the same architecture that will process a real election.

***

# 25. SIMULATION DATA ISOLATION

Simulation data must be clearly isolated.

Every simulation should have an explicit:

```
simulation_id

```

and/or appropriate simulation election/environment boundary.

Never allow simulated data to contaminate:

- real election results
- real aggregates
- real public election pages
- real notifications
- real agent records
- real audit records
- real production election data

The live site should explicitly identify:

```
SIMULATED

```

when displaying simulation results.

***

# 26. ADMIN SIMULATION CONTROL

Admin should be able to:

```
Create simulation
Start
Pause
Resume
Stop
Reset
Inspect
View progress
View errors
View verification
View discrepancies
View generated results

```

Do not allow an admin to accidentally start a production simulation against a real election.

Require an explicit simulation context.

***

# 27. SIMULATION PROGRESS

Admin should see:

```
SIMULATION

Polling Units
1,000

Agents
2,000

Submitted
742

Awaiting second agent
108

Verification
311

Verified
289

Disputed
12

Published
289

```

The values should update live.

***

# 28. SIMULATION SPEED

Allow the simulation engine to generate controlled event rates.

For example:

```
Slow
Normal
Fast
Stress

```

But do not simply create millions of simultaneous database writes.

Use controlled concurrency and batching.

The objective is to test system behavior without unnecessarily destroying Supabase performance.

***

# 29. SUPABASE PROTECTION DURING SIMULATION

The simulation system must be designed specifically to prevent uncontrolled database load.

Inspect:

- writes
- reads
- realtime events
- AI requests
- aggregation
- map updates
- public viewers

Use:

```
batching
controlled concurrency
queues
rate limits
aggregation
caching
bulk inserts
incremental projections

```

where appropriate.

Do not allow the simulation UI to trigger one database query per visual element.

***

# 30. SIMULATION SHOULD TEST THE LIVE SITE

When a simulation runs:

```
Admin starts simulation
       ↓
Simulated agents submit
       ↓
Verification occurs
       ↓
Canonical result created
       ↓
Published
       ↓
Live site updates

```

The live site should visibly move from:

```
AWAITING DATA

```

to:

```
SIMULATED

```

and show the simulated reporting progress.

Example:

```
SIMULATED

1,000 PUs

0 verified
     ↓
50 verified
     ↓
250 verified
     ↓
500 verified
     ↓
1,000 verified

```

***

# 31. LIVE/SIMULATION MODE MUST BE EXPLICIT

The live site must have a reliable data-mode source.

Possible states:

```
AWAITING DATA
SIMULATED
LIVE ELECTION

```

The UI should never infer the mode from random database values.

Use a proper election/data-mode configuration.

***

# 32. AGENT REVIEW

Review the complete Agent experience.

Verify:

```
login
onboarding
assignment
polling-unit selection
result form
party results
valid votes
rejected votes
supporting evidence
submission
retry
offline/intermittent connection behavior
success state
verification status
submission history

```

Make sure an agent can only submit for their assigned polling unit.

Test:

```
Agent 1 submits
Agent 2 submits

```

and verify the correct PU pairing occurs automatically.

***

# 33. ADMIN REVIEW

Review the entire Admin application.

Verify:

```
election creation
polling units
agents
assignments
result monitoring
verification
discrepancy queue
simulation
live monitoring
audit
corrections
result publication

```

Admin must be able to understand what is happening without inspecting the database.

***

# 34. ADMIN VERIFICATION QUEUE

The Admin dashboard should clearly show:

```
Awaiting second agent
Verification pending
Verified
Published
Disputed
AI failed
Human review

```

For disputes, show both internal submissions side by side.

Example:

```
POLLING UNIT 004

AGENT 1
Party A: 184
Party B: 96

AGENT 2
Party A: 148
Party B: 96

DISCREPANCY
Party A differs by 36

[Review evidence]
[Resolve]

```

The public site must not display both reports.

***

# 35. REALTIME EVENT ARCHITECTURE

Define clear events such as:

```
RESULT_SUBMITTED
SECOND_AGENT_SUBMITTED
VERIFICATION_STARTED
VERIFICATION_COMPLETED
RESULT_VERIFIED
RESULT_FLAGGED
RESULT_PUBLISHED
RESULT_CORRECTED
SIMULATION_STARTED
SIMULATION_PAUSED
SIMULATION_COMPLETED

```

Use these events consistently across:

- Agent
- Admin
- verification
- simulation
- live site

Avoid implementing separate incompatible realtime mechanisms for each page.

***

# 36. LIVE SITE EVENT FLOW

The most important event is:

```
RESULT_PUBLISHED

```

When this event happens:

```
canonical PU result updated
        ↓
state aggregate updated
        ↓
national aggregate updated
        ↓
party totals updated
        ↓
map status updated
        ↓
live feed updated
        ↓
progress counters updated
        ↓
last-updated timestamp updated

```

All of these should represent the same underlying event.

Do not create separate independent calculations that can disagree.

***

# 37. ATOMICITY

When a result becomes published, make the state transition reliable.

Do not allow:

```
Live feed says published
but party total did not update

```

or:

```
Party total updated
but polling-unit result is missing

```

Use transactions/event processing/idempotency appropriately.

If asynchronous processing is required, make the states explicit and recoverable.

***

# 38. DUPLICATE PROTECTION

Test every possible duplicate path.

Including:

```
Agent retry
Browser retry
Network retry
API retry
Queue retry
AI retry
Admin retry
Realtime reconnect
Simulation retry

```

A polling unit must never become two public results.

A published result must never contribute twice to national totals.

***

# 39. CORRECTION PIPELINE

If an admin corrects a published result:

```
Existing canonical result
        ↓
Correction request
        ↓
Authorization
        ↓
Audit
        ↓
New canonical state
        ↓
Aggregate adjustment
        ↓
Live update

```

Do not mutate history invisibly.

***

# 40. PERFORMANCE REQUIREMENT

The live site must feel extremely fast.

Optimize:

- initial page load
- server rendering
- data fetching
- map loading
- result rendering
- party totals
- state breakdown
- live feed
- realtime updates

Avoid:

```
large client-side data fetching
unnecessary hydration
full-page refetch
N+1 queries
constant polling
large JSON responses

```

Use server-side fetching, caching, projections, incremental updates, and pagination where appropriate.

***

# 41. PUBLIC SITE SHOULD SURVIVE HIGH VIEWER TRAFFIC

The number of public viewers should not multiply database load linearly.

Do not build:

```
10,000 viewers
=
10,000 constant database polling loops

```

Instead build:

```
database
    ↓
live result projection
    ↓
controlled realtime/event delivery
    ↓
many public viewers

```

Use caching and CDN-friendly architecture where appropriate.

***

# 42. NATIONAL MAP PERFORMANCE

The map must not become the reason the live site becomes slow.

Implement:

- clustering
- viewport-based loading
- appropriate geographic indexes
- lightweight result-status data
- lazy loading
- minimized rerenders

Do not repeatedly send the entire Nigerian polling-unit dataset to every browser after every result.

***

# 43. PUBLIC RESULT DETAILS

When a user selects a polling unit, show:

```
Polling Unit
State
LGA
Ward

Status

Party results
Valid votes
Rejected votes
Total votes

Submitted
Verified
Published

Last updated

```

Do not expose internal agent information unless explicitly intended by the product/security model.

The public result should be the canonical result.

***

# 44. STATE DETAIL

When a user selects a state, provide:

```
Polling units
Submitted
Verification pending
Verified
Disputed
Disrupted
Progress
Party totals

```

The state should be linked to the same canonical result data powering the national view.

***

# 45. LGA DETAIL

Where supported, implement the same structure for LGAs:

```
Polling units
Submitted
Verified
Disputed
Progress
Party totals

```

Again, do not create a separate calculation system.

Use canonical published results.

***

# 46. ELECTION SELECTOR

If NEOP supports multiple elections, the public site must clearly identify the selected election.

Do not accidentally combine results from:

```
Election A
+
Election B

```

Every query must be scoped to the selected election.

***

# 47. DATA INTEGRITY

Every result must belong to:

```
Election
State
LGA
Ward
Polling Unit

```

Validate the hierarchy.

Do not allow:

```
PU belongs to Lagos
but result appears in Kaduna

```

or similar hierarchy mismatches.

***

# 48. INEC 2026 DATA

Inspect the current polling-unit/election dataset.

Verify that the configured Nigerian polling-unit hierarchy is correct for the intended NEOP election dataset.

Do not blindly hard-code:

```
2,400

```

or any other number simply because it appears in a design.

The actual number should come from the configured election dataset.

If the product currently uses a specific 2026 INEC dataset, preserve and validate it.

***

# 49. DATA MODE BANNER

The public page should make the mode impossible to misunderstand.

For simulation:

```
SIMULATED ELECTION DATA
This page is displaying simulated election activity.

```

For awaiting data:

```
AWAITING DATA
No live election results have been published yet.

```

For a live election:

```
LIVE ELECTION
Results are being received and verified in real time.

```

Use appropriate wording approved by the existing product design.

***

# 50. TEST THE ENTIRE SYSTEM FROM THE ADMIN PAGE

Do not test each component independently only.

From Admin:

```
Create/select simulation
       ↓
Start simulation
       ↓
Simulated agents submit
       ↓
Two submissions per PU
       ↓
Verification
       ↓
NVIDIA verification
       ↓
Canonical result
       ↓
Publication
       ↓
Live result projection
       ↓
Live site

```

Open the live site separately and verify that it updates as the simulation progresses.

This is a mandatory E2E test.

***

# 51. FULL ELECTION REHEARSAL

Perform a realistic rehearsal.

For example:

```
1,000 polling units
2,000 agent submissions

```

with realistic timing variation.

Include:

```
normal results
delayed agents
duplicate submissions
discrepancies
AI failures
network failures
verification delays
admin resolutions
published results
corrections

```

Observe:

```
Admin
Agent
Verification
Database
NVIDIA
Live site
Map
Party totals
State totals
Feed

```

Everything must remain consistent.

***

# 52. IMPORTANT: SIMULATION MUST BE ABLE TO PROVE THE ARCHITECTURE

The simulation is not just for visual demonstration.

It must prove:

```
the agent can submit
the system can receive
the system can identify the PU
the two reports can be paired
the verification system can compare them
NVIDIA can process verification
discrepancies can be detected
canonical results can be created
published results can aggregate
the live site can update
the map can update
the feed can update
state totals can update
national totals can update
admin can monitor everything

```

***

# 53. FAILURE TESTING

Intentionally test:

### Agent 1 submits, Agent 2 never submits

Expected:

```
AWAITING SECOND AGENT

```

### Agent 2 submits conflicting result

Expected:

```
DISPUTED

```

No public verified publication.

### NVIDIA unavailable

Expected:

```
AI verification pending/retry

```

No data loss.

### Duplicate submission

Expected:

```
idempotent

```

### Realtime disconnect

Expected:

```
client reconnects
current state is recovered

```

### Database/worker delay

Expected:

```
queue/state remains recoverable

```

***

# 54. SIMULATION CLEANUP

Admin must be able to end a simulation safely.

Verify:

```
simulation stops
workers stop
queued simulation jobs are handled
realtime simulation events stop
public site returns to correct mode
simulation data remains isolated
production election data remains untouched

```

Do not simply delete records blindly if auditability is required.

***

# 55. SECURITY REVIEW

Audit:

- Admin access
- Agent access
- public access
- simulation access
- result publication
- correction
- RLS
- API authorization
- service role usage
- NVIDIA API keys
- evidence storage
- election isolation

An Agent must not be able to:

- submit another PU
- alter another agent's submission
- publish results
- modify canonical results
- access admin simulation controls

Only authorized Admin operations can resolve disputes and control simulation.

***

# 56. OBSERVABILITY

Admin should have enough information to know whether the system is healthy.

Track:

```
submission rate
verification rate
publication rate
verification latency
NVIDIA latency
NVIDIA failures
queue depth
disputes
failed jobs
database latency
realtime health
live projection health

```

If the live site stops receiving updates, Admin should be able to identify whether the problem is:

```
submission
verification
NVIDIA
queue
database
projection
realtime
frontend

```

***

# 57. FINAL UI/UX REVIEW

Review the live website visually and functionally.

Check:

- desktop
- tablet
- mobile
- map
- cards
- typography
- spacing
- loading
- empty states
- error states
- live indicator
- simulation indicator
- status colors
- accessibility
- responsiveness

Make sure the interface clearly communicates what is happening.

Avoid unnecessary visual complexity.

The live election site should feel trustworthy, fast, calm and data-focused.

***

# 58. FINAL LIVE SITE CHECKLIST

Before declaring the live site ready, verify:

```
[ ] Election/data mode works
[ ] Polling-unit count is real
[ ] National map is connected
[ ] Map statuses are real
[ ] Live result feed is real
[ ] State breakdown is real
[ ] Party totals are real
[ ] Progress metrics are real
[ ] Last updated is real
[ ] One public result per PU
[ ] No duplicate agent results
[ ] Canonical result architecture works
[ ] Realtime updates work
[ ] Simulation updates live site
[ ] Admin can control simulation
[ ] Agent submissions reach verification
[ ] NVIDIA verification works
[ ] Disputes reach Admin
[ ] Published results reach public site
[ ] Aggregates update correctly
[ ] Corrections update aggregates
[ ] Supabase is protected
[ ] Public traffic is handled efficiently
[ ] Simulation is isolated
[ ] Security is verified
[ ] Audit trail works

```

***

# 59. FINAL ACCEPTANCE TEST

Run this exact scenario.

## Step 1

Create a test election.

## Step 2

Create/import its polling units.

## Step 3

Assign two agents to each polling unit.

## Step 4

Open:

```
Agent 1
Agent 2
Admin
Live Site

```

simultaneously.

## Step 5

Agent 1 submits PU 001.

Verify:

```
Agent 1 ✓
PU = ONE_SUBMISSION
Live site = no verified result yet

```

## Step 6

Agent 2 submits the same PU result.

Verify:

```
Agent 2 ✓
Verification starts

```

## Step 7

Run deterministic verification.

## Step 8

Run NVIDIA verification.

## Step 9

Verify:

```
PU = VERIFIED

```

## Step 10

Publish canonical result.

## Step 11

Verify live site shows:

```
PU 001
ONE RESULT

```

not two.

## Step 12

Verify party totals increase exactly once.

## Step 13

Verify state totals increase exactly once.

## Step 14

Verify map status changes.

## Step 15

Verify live feed receives one event.

## Step 16

Create a discrepancy.

Verify it does NOT publish automatically.

## Step 17

Resolve discrepancy in Admin.

Verify the canonical result publishes.

## Step 18

Run a large simulation.

Verify the same flow works at scale.

***

# 60. FINAL REPORT TO RETURN

After completing the implementation, provide:

## 1. Current system assessment

What already worked.

## 2. Problems found

Broken, missing, duplicated and unsafe functionality.

## 3. Live site changes

Every major live-site implementation.

## 4. Simulation changes

Every simulation capability implemented.

## 5. Agent changes

Everything changed in the Agent workflow.

## 6. Admin changes

Everything changed in Admin.

## 7. Verification changes

Explain the verification pipeline.

## 8. NVIDIA integration

Explain exactly how NVIDIA is being used.

## 9. Database changes

List:

- tables
- columns
- indexes
- constraints
- RLS
- functions
- triggers
- migrations

## 10. Performance

Report:

- public rendering performance
- database load
- realtime behavior
- simulation throughput
- verification latency
- NVIDIA latency

## 11. Testing

Report:

- unit tests
- integration tests
- E2E tests
- simulation tests
- failure tests
- load tests
- security tests

## 12. Remaining blockers

Be completely honest.

Do not claim READY if something important is still broken.

***

# FINAL SYSTEM PRINCIPLE

NEOP must behave as one connected system.

The desired architecture is:

```
                 AGENT 1
                    │
                    ↓
               SUBMISSION
                    │
                    │
                 AGENT 2
                    │
                    ↓
               SUBMISSION
                    │
                    ↓
             VERIFICATION
                    │
          ┌─────────┴─────────┐
          ↓                   ↓
      RULES ENGINE        NVIDIA AI
          │                   │
          └─────────┬─────────┘
                    ↓
              DECISION ENGINE
                    │
          ┌─────────┴─────────┐
          ↓                   ↓
       VERIFIED             DISPUTED
          │                   │
          ↓                   ↓
   CANONICAL RESULT         ADMIN
          │                 REVIEW
          ↓
       PUBLISHED
          │
          ↓
   LIVE RESULT PROJECTION
          │
     ┌────┼─────┬──────────┐
     ↓    ↓     ↓          ↓
    MAP  FEED  STATE     NATIONAL
         │     TOTALS      TOTALS
         │       │           │
         └───────┴───────────┘
                  ↓
             LIVE SITE

```

The fundamental rule is:

# TWO AGENT REPORTS → ONE VERIFIED POLLING-UNIT RESULT → ONE PUBLIC RESULT.

The simulation must exercise this same architecture.

The Admin must be able to control and monitor the simulation.

The Agent system must feed the verification system.

The verification system must feed the canonical result.

The canonical result must feed the live projection.

The live projection must power the map, feed, state breakdown, party totals, progress indicators and every other live-results component.

Nothing should be a disconnected mock.

Nothing should be hard-coded where real system data exists.

Nothing should be duplicated.

Nothing should silently double-count.

The live site must be fast.

The simulation must be realistic.

The Admin must have operational control.

The Agent workflow must work end to end.

The NVIDIA verification layer must work reliably.

And the entire system must be tested as one complete election platform, not as isolated pages.
