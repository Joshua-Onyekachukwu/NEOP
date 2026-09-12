# NEOP — REAL-TIME DUAL-AGENT RESULT VERIFICATION, NVIDIA AI VALIDATION AND LIVE RESULTS IMPLEMENTATION

## ROLE

You are the principal engineer taking over the existing NEOP election platform.

Your responsibility is to inspect the entire existing NEOP system first, understand what has already been built, determine what is missing or incorrectly implemented, and then fully implement the real-time polling-unit result verification and live-results architecture described below.

Do not blindly rebuild existing functionality.

Do not create duplicate systems when an existing system can be extended correctly.

Do not assume the current architecture is correct.

Inspect it first.

The final system must be production-oriented, fast, secure, auditable, resilient, and capable of handling a real election workload.

***

# 1. FIRST: FULL SYSTEM INSPECTION

Before changing code, inspect the entire repository and understand:

- frontend architecture
- backend architecture
- Supabase project configuration
- PostgreSQL schema
- migrations
- authentication
- authorization
- RLS policies
- API routes
- server actions
- Convex usage
- realtime implementation
- storage
- election hierarchy
- polling units
- agents
- agent assignments
- result submission
- result verification
- result approval
- public/live results
- admin dashboard
- notifications
- audit logging
- simulations
- background jobs
- queues
- AI integrations
- NVIDIA integrations
- environment variables
- Vercel configuration
- production configuration
- caching
- current performance bottlenecks

Search the repository for all result-related code and identify:

- result tables
- submission tables
- verification tables
- election tables
- polling-unit tables
- agent tables
- public-result queries
- aggregation queries
- realtime subscriptions
- polling loops
- API endpoints
- server actions
- components responsible for rendering results
- any duplicated result representations

Do not implement anything until you understand how the existing system currently works.

Create an internal completion assessment:

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

Then implement the required architecture below.

***

# 2. CORE PRODUCT RULE

NEOP has TWO agents assigned to every polling unit.

Each agent independently submits their polling-unit result.

Therefore:

```
ONE POLLING UNIT
        │
        ├── Agent 1 submission
        │
        └── Agent 2 submission

```

The two submissions are separate internal evidence records.

However:

# THERE MUST ONLY EVER BE ONE PUBLIC RESULT FOR EACH POLLING UNIT.

The public/live website must NEVER render:

```
Agent 1 result
Agent 2 result

```

as two separate polling-unit results.

That would create duplicates.

Instead:

```
Agent 1 submission ─┐
                    ├── Verification ──> ONE canonical PU result
Agent 2 submission ─┘

```

The public site renders only:

```
Polling Unit
+
ONE canonical verified/published result

```

The two agent reports exist internally for verification, auditing, discrepancy detection, and evidence.

They are not two public result records.

***

# 3. REQUIRED RESULT LIFECYCLE

Implement the following state model.

## Agent submission states

Each agent submission should independently have a state such as:

```
SUBMITTED
PROCESSING
VERIFIED
DISCREPANCY
REQUIRES_REVIEW
REJECTED

```

## Polling-unit canonical result states

The polling unit itself must have its own result state:

```
AWAITING_AGENTS
ONE_SUBMISSION
VERIFYING
VERIFIED
FLAGGED
HUMAN_REVIEW
PUBLISHED
REJECTED

```

Do not confuse an individual agent submission state with the canonical polling-unit result state.

***

# 4. REAL-TIME FLOW

The intended flow is:

```
Agent 1 submits
       ↓
Save immediately
       ↓
Agent 2 submits
       ↓
Save immediately
       ↓
NEOP identifies both submissions
       ↓
Verification engine starts
       ↓
Compare the two reports
       ↓
Run deterministic validation
       ↓
Run NVIDIA AI verification
       ↓
Evaluate evidence
       ↓
        ┌──────────────────┐
        │                  │
      MATCH            DISCREPANCY
        │                  │
        ↓                  ↓
    VERIFIED          ADMIN REVIEW
        │                  │
        ↓                  ↓
   CANONICAL RESULT    HOLD RESULT
        │
        ↓
    PUBLISH
        │
        ↓
LIVE RESULTS

```

The live website must not wait for a slow frontend request to complete the entire verification pipeline.

The submission should be persisted immediately.

Verification should run asynchronously.

The public result should be promoted into the live-results projection when the required verification conditions are satisfied.

***

# 5. DO NOT RENDER BOTH AGENT REPORTS

This requirement is mandatory.

Suppose:

Agent 1 submits:

```
Party A: 184
Party B: 96
Party C: 21

```

Agent 2 submits:

```
Party A: 184
Party B: 96
Party C: 21

```

The public website must display:

```
Polling Unit 004

Party A: 184
Party B: 96
Party C: 21

✓ Verified
✓ Result submitted

```

NOT:

```
Agent 1
Party A: 184

Agent 2
Party A: 184

```

and definitely not:

```
Polling Unit 004
184
Polling Unit 004
184

```

There must be exactly one public polling-unit result.

***

# 6. CANONICAL POLLING-UNIT RESULT

Introduce or correctly implement a canonical result representation.

Conceptually:

```
polling_unit_result

```

This is the ONLY record that the public/live-results system should consume.

It should identify:

```
election_id
polling_unit_id
canonical_result_id
status
verified_at
published_at
verification_id
source_submission_1
source_submission_2

```

plus the canonical party vote values.

The two agent submissions should remain linked as evidence:

```
polling_unit_result
        │
        ├── agent_submission_1
        │
        └── agent_submission_2

```

The public query should operate from the canonical result.

Never aggregate the two agent submissions as if they were two polling-unit results.

***

# 7. IDEMPOTENCY

This is extremely important.

A polling unit must not accidentally create multiple public results because:

- an agent retries
- network connection drops
- the mobile app retries
- the API request is repeated
- the browser resubmits
- an AI job runs twice
- a queue job retries
- Vercel retries a request
- realtime reconnects
- an administrator accidentally triggers verification again

Implement idempotency.

Use appropriate unique constraints and idempotency keys.

At minimum, enforce the logical relationship:

```
election_id + polling_unit_id

```

must identify one canonical public result.

Agent submissions can be separate records, but canonical publication must remain unique.

***

# 8. AGENT SUBMISSION

When an agent submits a result, capture sufficient evidence and metadata.

At minimum:

```
election_id
polling_unit_id
agent_id
assignment_id
submission_id
submitted_at
party_results
valid_votes
rejected_votes
accredited_voters
total_votes
result_sheet_image/evidence
device/session metadata where appropriate

```

Do not unnecessarily collect sensitive information.

Every submission must be traceable to:

```
WHO
WHERE
WHICH ELECTION
WHICH POLLING UNIT
WHEN
WHAT WAS SUBMITTED
WHAT EVIDENCE SUPPORTS IT

```

***

# 9. IMMEDIATE SAVE

When Agent 1 submits:

```
SAVE IMMEDIATELY

```

Do not wait for Agent 2.

When Agent 2 submits:

```
SAVE IMMEDIATELY

```

Do not wait for AI.

The user should immediately see that the submission has been received.

For example:

```
Agent 1
✓ Submitted

Agent 2
Waiting

```

Then after Agent 2:

```
Agent 1
✓ Submitted

Agent 2
✓ Submitted

Verification
Processing...

```

This status should update in realtime where appropriate.

***

# 10. FAST VERIFICATION PATH

Do not make an expensive AI model the first thing that happens.

The fastest path should be deterministic.

Run:

### Identity checks

```
✓ Agent belongs to election
✓ Agent assigned to polling unit
✓ Submission belongs to correct election
✓ Polling unit exists

```

### Structural checks

```
✓ Valid party IDs
✓ No unknown parties
✓ No duplicate party records
✓ Required fields exist
✓ Numeric values valid

```

### Mathematical checks

Check the appropriate election rules and configured result structure.

Examples:

```
total votes consistency
valid votes consistency
rejected votes consistency
accredited voter constraints
over-voting detection
negative values
impossible totals

```

Do not hard-code assumptions that may differ by election type.

Use election configuration where appropriate.

***

# 11. TWO-AGENT COMPARISON

Once both submissions exist, compare them.

Compare:

```
Party A
Party B
Party C
...
Valid votes
Rejected votes
Total votes
Other configured result fields

```

The comparison must be deterministic.

Example:

```
Agent 1:
Party A = 184

Agent 2:
Party A = 184

MATCH

```

If:

```
Agent 1:
Party A = 184

Agent 2:
Party A = 148

```

then:

```
DISCREPANCY

```

Do not automatically select one agent's number.

Do not average them.

Do not let the AI choose whichever number appears more plausible.

Do not silently modify either submission.

***

# 12. NVIDIA AI VERIFICATION

Use the NVIDIA API keys that already exist in the project/environment.

Do not create fake keys.

Do not replace the existing NVIDIA integration unless inspection shows it is broken.

First identify:

- which NVIDIA APIs/models are currently configured
- how keys are stored
- where requests are made
- current model availability
- current timeout/retry behavior
- current rate limits
- current failure handling

Then integrate the verification engine correctly.

The AI should support verification, evidence interpretation, OCR/vision where available, anomaly detection, and consistency analysis.

The AI must NOT become the sole source of truth.

***

# 13. AI VERIFICATION SHOULD BE PARALLEL

Do not create one huge sequential AI pipeline.

Where appropriate, use parallel verification jobs.

Conceptually:

```
                    ┌── Vision / OCR
                    │
Agent reports ──────┼── Evidence verification
                    │
                    ├── Anomaly analysis
                    │
                    └── Consistency analysis
                             ↓
                     Verification engine

```

Use the NVIDIA infrastructure efficiently.

Do not make five unnecessary model calls for every normal result.

Optimize for:

```
speed
cost
reliability
accuracy

```

Use deterministic checks before expensive AI operations.

***

# 14. AI MUST NEVER ALTER THE ORIGINAL SUBMISSION

This is mandatory.

If an agent submits:

```
Party A = 184

```

and AI interprets the evidence as:

```
Party A = 148

```

AI must NOT change:

```
184 → 148

```

Instead:

```
DISCREPANCY

Submitted value: 184
Evidence interpretation: 148

Human review required

```

Original evidence must remain immutable.

AI output must remain an analysis result.

Human/admin resolution must be separately recorded.

***

# 15. AUTOMATIC VERIFICATION

If:

```
Agent 1 = Agent 2
AND
deterministic checks pass
AND
required evidence checks pass
AND
AI verification does not raise a material issue
AND
no duplicate exists
AND
no assignment/security issue exists

```

then:

```
POLLING UNIT = VERIFIED

```

Then create/update exactly ONE canonical polling-unit result.

Then publish it to the live-results projection.

***

# 16. DISCREPANCY HANDLING

If:

```
Agent 1 != Agent 2

```

or the verification system finds a material problem:

```
POLLING UNIT = FLAGGED

```

Do not publish it as a verified canonical result.

Send it to the Admin verification queue.

Admin should see:

```
Polling Unit 004

Agent 1
Party A: 184
Party B: 96

Agent 2
Party A: 148
Party B: 96

Discrepancy
Party A: 36 votes

Evidence
[Agent 1 evidence]
[Agent 2 evidence]

AI analysis
...

[Review]

```

The administrator should be able to resolve the discrepancy through a controlled workflow.

Every resolution must be audited.

***

# 17. LIVE RESULTS ARCHITECTURE

The public website must be optimized for extremely fast rendering.

Do not make the public website perform expensive verification queries.

Do not make the public website join:

```
agents
submissions
verification
AI outputs
assignments
audit logs

```

every time a user opens the results page.

Instead create a read-optimized live-results projection.

Conceptually:

```
CANONICAL VERIFIED RESULT
          ↓
LIVE RESULTS PROJECTION
          ↓
PUBLIC WEBSITE

```

The public site should read only what it needs to render the result.

***

# 18. ONE PU = ONE PUBLIC RESULT

Enforce this at the database level where appropriate.

The live result dataset must guarantee:

```
ONE ELECTION
+
ONE POLLING UNIT
=
ONE PUBLIC RESULT

```

Never allow:

```
Election X
PU 001
Agent 1 result

Election X
PU 001
Agent 2 result

```

to become two public result rows.

Instead:

```
Election X
PU 001
Canonical result
    ↳ Agent 1 evidence
    ↳ Agent 2 evidence

```

***

# 19. LIVE PARTY TOTALS

When a polling unit becomes published:

```
PU 004
Party A = 184
Party B = 96
Party C = 21

```

the election-level totals should update.

Do NOT recalculate the entire election from every raw submission for every page load.

Use an incremental aggregation strategy.

Conceptually:

```
PU verified
    ↓
Canonical result published
    ↓
Update aggregate
    ↓
Party totals updated
    ↓
Emit live event
    ↓
Connected clients update

```

If a published result is corrected later, the aggregation system must correctly apply:

```
old canonical values
        ↓
remove old contribution
        ↓
apply new approved values

```

without double counting.

***

# 20. REALTIME PUBLIC EXPERIENCE

The public site should feel genuinely live.

When PU 004 becomes published:

```
PU 004
✓ Result submitted
✓ Verified

```

appears without requiring a full-page refresh.

The party totals update.

The polling-unit count updates.

Example:

```
RESULTS

1,842 / 2,400
Polling units verified

76.75%

Party A
82,491

Party B
76,203

Party C
41,882

```

When another PU is published:

```
1,843 / 2,400

```

and the relevant party totals update.

***

# 21. DO NOT USE AGGRESSIVE CLIENT POLLING

Avoid:

```
setInterval(...)

```

that repeatedly hits Supabase.

Do not have every visitor continuously query the entire election dataset.

Use an appropriate realtime/event-driven architecture.

If Supabase Realtime is used, use it carefully.

Do not create thousands of unnecessary subscriptions.

Prefer a small number of meaningful result/projection events.

Evaluate whether a server-side event fan-out or cached projection is more appropriate for the expected election traffic.

***

# 22. SUPABASE LOAD PROTECTION

This system must NOT overload Supabase.

Inspect every query involved in:

- submissions
- verification
- live results
- aggregates
- dashboards
- public results
- simulations

Look for:

```
N+1 queries
full-table scans
unbounded queries
repeated aggregation
duplicate reads
excessive realtime subscriptions
high-frequency polling
unnecessary writes
large payloads

```

Fix them.

Use:

```
indexes
pagination
batching
aggregation
caching
incremental updates
controlled concurrency
background jobs
database constraints

```

where appropriate.

***

# 23. SIMULATIONS MUST NOT DAMAGE PRODUCTION

NEOP already has simulation/testing requirements.

Simulations must be isolated from real election data.

Never let a simulation:

- modify real results
- publish fake public results
- trigger real election notifications
- pollute real aggregates
- consume uncontrolled production resources
- overwhelm Supabase
- trigger thousands of unnecessary realtime events

Use an explicit simulation namespace/environment/data boundary.

If the existing simulation system is unsafe, fix it.

***

# 24. AI FAILURE MUST NOT BREAK RESULTS

If NVIDIA becomes temporarily unavailable:

```
NVIDIA unavailable

```

NEOP should NOT lose submissions.

The submission remains safely stored.

The verification job becomes:

```
AI_PENDING

```

and can retry.

Do not make the entire election system dependent on one model request completing successfully.

Implement:

```
timeouts
retries
backoff
job status
failure recording
dead-letter handling where appropriate

```

Do not retry indefinitely.

***

# 25. LIVE SITE MUST REMAIN AVAILABLE

The public results site should continue rendering already-published results even if:

- AI is temporarily unavailable
- an admin dashboard has problems
- an agent submission fails
- a verification worker crashes
- one NVIDIA model fails
- one queue is delayed

The public live-results projection should be independently readable.

***

# 26. ADMIN REAL-TIME MONITORING

Create or improve the Admin verification dashboard.

Show:

```
Total polling units
Submitted
Waiting for second agent
Verifying
Verified
Published
Flagged
Human review
Rejected
AI pending
AI failures

```

Admin should immediately see new discrepancies.

Example:

```
VERIFICATION ALERT

PU 01/02/03/004

Agent disagreement detected.

[Review]

```

***

# 27. VERIFICATION TIMELINE

Every polling unit should have an internal timeline:

```
10:41:02
Agent 1 submitted

10:41:18
Agent 2 submitted

10:41:18
Deterministic verification started

10:41:19
Agent results matched

10:41:20
NVIDIA verification completed

10:41:20
Polling unit verified

10:41:21
Canonical result published

10:41:21
Live aggregate updated

```

This is important for auditability and debugging.

***

# 28. AUDIT LOG

Every significant action must be auditable.

Record:

```
submission created
verification started
verification completed
AI result
AI flags
discrepancy detected
admin opened review
admin decision
canonical result created
canonical result changed
result published
result unpublished
correction made
aggregate updated

```

Do not make audit logs mutable.

***

# 29. SECURITY

Perform a complete security review.

Verify:

- authentication
- authorization
- RLS
- API authorization
- assignment authorization
- polling-unit authorization
- election isolation
- admin privileges
- IDOR protection
- service-role key protection
- NVIDIA API key protection
- storage security
- evidence access
- public/private data separation

An agent must only be able to submit for the polling unit they are legitimately assigned to.

An agent must never be able to submit another agent's result.

A public user must never be able to modify results.

A public user must only see the intended public result projection.

***

# 30. NVIDIA KEY SECURITY

The NVIDIA API keys already exist.

Use the existing environment variables.

Never:

- expose NVIDIA keys to browser JavaScript
- put keys in client components
- commit keys to Git
- print keys in logs
- return keys through APIs

NVIDIA requests must happen server-side.

Inspect Vercel and backend environment configuration.

Verify production has the correct NVIDIA credentials.

***

# 31. PERFORMANCE TARGET

Optimize the system around this principle:

# SUBMISSION MUST FEEL IMMEDIATE.

The agent should not sit waiting for:

```
OCR
AI
aggregation
admin
realtime

```

to complete.

The immediate response should be:

```
✓ Result received

```

Then background processing begins.

Likewise, the public website should not wait for complex AI processing.

It should render already-published canonical results immediately.

***

# 32. PUBLIC RESULT QUERY MODEL

Review every existing public result query.

If the public site currently queries raw agent submissions, change it.

The public site should conceptually query:

```
published canonical polling-unit results

```

not:

```
agent submissions

```

and not:

```
AI verification records

```

The public site should never have to understand the two-agent verification mechanism in order to render results.

That is an internal NEOP concern.

***

# 33. RESULT PUBLICATION TRANSACTION

Make publication safe and atomic.

When a PU is approved:

```
BEGIN

create/update canonical result

update publication state

update aggregate contribution

record verification relationship

record publication event

COMMIT

```

Use appropriate database transactions.

Do not allow:

```
canonical result published
BUT
aggregate not updated

```

or:

```
aggregate updated
BUT
canonical result not published

```

without a recoverable state.

***

# 34. CORRECTIONS

Design for the possibility that a published result must later be corrected.

Never overwrite history invisibly.

Maintain:

```
previous canonical result
new canonical result
reason
who authorized change
when
evidence

```

Update aggregates safely.

Emit the appropriate live update.

Keep the audit trail.

***

# 35. OBSERVABILITY

Add useful metrics for:

```
submission latency
verification latency
AI latency
NVIDIA failure rate
verification success rate
discrepancy rate
admin review time
publication latency
database latency
aggregate update latency
realtime delivery latency
queue depth
failed jobs

```

The objective is to know where the election pipeline is slowing down.

***

# 36. IMPORTANT: DO NOT OVERUSE AI

AI should be used where it adds value.

Do not call an expensive model when deterministic comparison already proves:

```
Agent 1 = Agent 2

```

and all required deterministic checks pass, unless the configured evidence policy requires AI review.

Design the system so the expensive AI workload can be controlled.

Potentially:

```
NORMAL MATCH
→ lightweight verification

EVIDENCE REQUIRED
→ NVIDIA vision verification

DISCREPANCY
→ deeper AI analysis

HIGH-RISK RESULT
→ additional analysis + admin review

```

Do not blindly run maximum AI processing on every result.

***

# 37. DO NOT PREDICT OR DECLARE ELECTION WINNERS

NEOP's verification system is for:

```
capture
verification
comparison
integrity checking
evidence analysis
discrepancy detection
aggregation
visualization
audit

```

Do not build AI functionality that:

- predicts the winner and treats it as fact
- changes submitted numbers
- declares an election winner
- replaces the legally authorized electoral authority
- fabricates missing results

If results are incomplete, show them as incomplete.

***

# 38. PUBLIC STATUS LANGUAGE

Use clear status language.

Examples:

```
Result submitted
Result verified
Result published
Awaiting second submission
Verification in progress
Verification issue detected
Under review

```

Do not imply that an internally verified NEOP result is a legally declared official result.

Make the public UI clear about what NEOP is reporting.

***

# 39. DATABASE DESIGN REVIEW

Inspect the current database before creating new tables.

Prefer extending existing tables where appropriate.

Do not create unnecessary duplicate result tables.

The intended conceptual relationships are:

```
Election
   │
   └── Polling Unit
          │
          ├── Agent Assignment 1
          ├── Agent Assignment 2
          │
          ├── Submission 1
          ├── Submission 2
          │
          └── Canonical Result
                  │
                  ├── Verification
                  └── Publication

```

The canonical result is the public-facing representation.

***

# 40. INDEXING

Review and add appropriate indexes for the actual queries.

Especially consider:

```
election_id
polling_unit_id
agent_id
assignment_id
status
submitted_at
published_at
verification_status

```

Composite indexes should reflect real query patterns.

Do not blindly add indexes everywhere.

***

# 41. FRONTEND IMPLEMENTATION

Inspect:

- agent result submission UI
- submission progress
- admin verification UI
- public results page
- polling-unit result cards
- party totals
- realtime updates
- loading states
- error states
- mobile rendering

Make the experience fast.

Avoid unnecessarily rerendering the entire results page when one polling unit changes.

Update only the affected:

```
polling unit
aggregate totals
status counters

```

where possible.

***

# 42. PUBLIC UI DUPLICATE PROTECTION

Even if the backend accidentally returns duplicate records, the frontend must not blindly render duplicates.

The data layer should normalize by:

```
polling_unit_id

```

and only expose one canonical result.

But do not rely only on frontend deduplication.

The database and backend must enforce the canonical one-result model.

Frontend protection is a final safety layer, not the primary solution.

***

# 43. FULL END-TO-END TEST

Create tests for:

### Test 1

Agent 1 submits.

Expected:

```
submission stored
PU = ONE_SUBMISSION
public result = not published

```

### Test 2

Agent 2 submits matching result.

Expected:

```
two evidence submissions
verification runs
PU = VERIFIED
one canonical result
public result = published

```

### Test 3

Both agents submit identical result.

Expected:

```
ONE public result
NOT TWO

```

### Test 4

Agents disagree.

Expected:

```
PU = FLAGGED
no public publication
admin review required

```

### Test 5

Agent retries submission.

Expected:

```
no duplicate canonical result

```

### Test 6

AI fails.

Expected:

```
submissions preserved
verification pending/retry
no data loss

```

### Test 7

NVIDIA is unavailable.

Expected:

```
system remains operational
AI job retries
public previously-published results remain available

```

### Test 8

A published result is corrected.

Expected:

```
old contribution removed
new contribution applied
one canonical public result
audit trail preserved

```

### Test 9

Two users open the public site.

Expected:

```
fast initial render
no unnecessary polling storm

```

### Test 10

Large simulation.

Expected:

```
simulation isolated
production election untouched
Supabase protected

```

***

# 44. LOAD TESTING

Do not test only with 10 polling units.

Test realistic scenarios.

For example:

```
1,000 polling units
5,000 polling units
10,000 polling units

```

depending on the actual deployment target.

Simulate:

```
two agents per polling unit
submissions arriving concurrently
verification jobs
NVIDIA calls
published results
aggregate updates
public viewers
realtime updates

```

Measure:

```
submission latency
verification throughput
publication latency
database load
CPU
memory
queue depth
NVIDIA latency
realtime performance
public page latency

```

Do not simply increase concurrency until the database breaks.

Find the safe operating capacity.

***

# 45. PRODUCTION DEPLOYMENT

After implementation:

Verify:

```
local development
staging/preview
production

```

Check Vercel deployment.

Verify:

- build succeeds
- migrations applied
- environment variables exist
- NVIDIA credentials exist
- Supabase credentials exist
- backend jobs work
- realtime works
- public results work
- admin verification works
- agent submission works

Do not claim production readiness based only on a successful build.

Run the complete workflow against the deployed environment where safe.

***

# 46. FINAL PRODUCTION REHEARSAL

Perform a complete controlled rehearsal:

```
Create election
      ↓
Create polling units
      ↓
Assign Agent 1
      ↓
Assign Agent 2
      ↓
Agent 1 submits
      ↓
Agent 2 submits
      ↓
Verification
      ↓
NVIDIA verification
      ↓
Canonical result
      ↓
Publication
      ↓
Live site update
      ↓
Party aggregate update
      ↓
Admin monitoring
      ↓
Audit trail

```

Then test:

```
discrepancy
retry
AI failure
duplicate submission
correction
realtime reconnect
high public traffic

```

***

# 47. DO NOT STOP AT IDENTIFYING PROBLEMS

If you find something broken:

1. document it
2. determine the correct implementation
3. implement the fix
4. test it
5. re-test related workflows
6. verify no regression

Do not simply produce a list of issues and leave them unresolved unless the change genuinely requires an external human decision.

***

# 48. DO NOT REBUILD FUNCTIONAL SYSTEMS

If the existing NEOP system already has:

- authentication
- agent onboarding
- assignments
- polling units
- elections
- result forms
- admin dashboards
- public results
- simulations
- realtime
- audit

inspect and extend them.

Do not create duplicate versions.

Remove obsolete or conflicting implementations where necessary, but only after understanding their dependencies.

***

# 49. FINAL ACCEPTANCE CRITERIA

The implementation is complete only when all of the following are true.

## Agent

```
Agent 1 can submit.
Agent 2 can submit.
Both submissions are independently stored.

```

## Verification

```
Two reports are automatically associated with the correct PU.
They are compared.
Deterministic checks run.
NVIDIA verification runs according to the configured policy.
Discrepancies are detected.
AI never silently changes submitted numbers.

```

## Canonical result

```
Every polling unit has at most ONE canonical public result.

```

## Public results

```
The public site renders ONE result per polling unit.
The two agent submissions never appear as duplicate results.

```

## Live updates

```
Verified results become visible quickly.
Party totals update incrementally.
Polling-unit progress updates in realtime.
The page does not require constant full-page refreshes.

```

## Performance

```
Public rendering is fast.
Supabase is protected from unnecessary polling.
Queries are indexed.
No N+1 query problems remain.
Realtime subscriptions are controlled.

```

## AI

```
NVIDIA API integration works server-side.
Existing NVIDIA API keys are used.
Keys are never exposed to clients.
AI failures do not cause data loss.

```

## Security

```
Agents can only submit where authorized.
Public users cannot modify results.
Admin operations are protected.
RLS/API authorization is verified.

```

## Audit

```
Every submission is traceable.
Every verification is traceable.
Every discrepancy is traceable.
Every admin resolution is traceable.
Every publication is traceable.
Every correction is traceable.

```

## Simulation

```
Simulation cannot contaminate production election data.
Simulation cannot publish fake public results.
Simulation cannot overwhelm Supabase.

```

***

# 50. FINAL REPORT

At the end, provide a concise but complete implementation report containing:

### A. What you found

```
Existing functionality
Missing functionality
Broken functionality
Duplicated functionality
Performance risks
Security risks

```

### B. What you changed

List every major implementation.

### C. Database changes

List:

```
tables
columns
indexes
constraints
RLS
functions/triggers
migrations

```

### D. NVIDIA changes

Explain:

```
models/APIs used
verification flow
timeouts
retries
fallback behavior

```

### E. Live results architecture

Explain:

```
agent submission
verification
canonical result
publication
aggregation
realtime
public rendering

```

### F. Testing

Report:

```
unit tests
integration tests
E2E tests
load tests
security tests
production rehearsal

```

### G. Remaining blockers

Do not hide anything.

If something genuinely requires a human decision or external infrastructure, explicitly identify it.

***

# FINAL PRINCIPLE

Build NEOP around this rule:

```
TWO AGENTS
     ↓
TWO INTERNAL EVIDENCE RECORDS
     ↓
ONE VERIFICATION PROCESS
     ↓
ONE CANONICAL POLLING-UNIT RESULT
     ↓
ONE PUBLIC RESULT
     ↓
ONE CONTRIBUTION TO LIVE AGGREGATES

```

Never:

```
TWO AGENTS
     ↓
TWO PUBLIC RESULTS

```

The agents provide independent evidence.

The verification engine determines whether the evidence agrees and passes the configured checks.

The canonical result is the single public representation.

The live site reads the canonical published result, not the underlying agent submissions.

The entire system must be optimized so that users experience NEOP as a fast, continuously updating live election-results platform while the complex verification work happens safely in the background.

Inspect first.

Implement completely.

Test everything.

Fix what you find.

Do not leave partially implemented systems behind.
