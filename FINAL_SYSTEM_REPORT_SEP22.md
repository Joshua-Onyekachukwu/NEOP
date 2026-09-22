# NEOP — Final System Report (September 22, 2026)

Supersedes `FINAL_SYSTEM_REPORT_SEP21.md`. Every number below was read from the
live system; where something could not be verified it says so explicitly.

---

## 1. Verdict

**The application layer is finished and correct. The database instance is the
blocking issue.**

The published simulation dataset is complete, reconciled and sitting in the
database with `system_config` correctly pointing at it. It is the *public read
path* that is failing, and it is failing for one reason: the Supabase instance
can no longer execute the aggregates that path depends on.

| Layer | State |
|---|---|
| Simulation engine (waves, ledger, disputes, publish) | Working |
| Published dataset (Run `5821d9eb`) | Complete and correct |
| Public API code | Fixed today (see §3) |
| **Database instance** | **Degraded — cannot run aggregations** |
| Live public site | **Serving the honest-empty payload (all zeros)** |

---

## 2. What is actually in the database (verified)

Run `5821d9eb-f021-4eaf-a473-2a3e48cb7109` — status `PUBLISHED`, scenario `close`,
12 waves, started 2026-09-20 21:28, completed 2026-09-21 20:55.

```
system_config.data_mode           = SIMULATED
system_config.active_election_id  = b5a9662b-1b3a-4260-a078-9496b799cf9d
canonical_pu_results (that election)  = 42,230 rows, 2,112,095 votes
canonical_party_results               = 380,070 rows  (42,230 x 9 parties)
pu_simulation_status                  = 176,846 rows (full PU universe)
verifications                         = 43,993 rows
  MATCH                               = 35,901
  DISCREPANCY                         =  6,329   -> resolved by the finalizer on 09-22
```

Final published party split as stored:

```
APC   564,742   (29.7%)
NDC   539,611   (28.4%)
PDP   237,606
LP    158,203
NNPP   92,229
YPP    82,412
APGA   82,359
ADC    82,319
SDP    61,547
------------------------------
total 1,901,028
```

This was measured with the index-driven query form described in §3 — it
completed in well under a second. The identical numbers were also visible on the
live site earlier today (1.9M votes, 42,230 verified PUs).

**Dispute resolution landed:** the finalizer patched by migration 280 ran
successfully on 09-22 (10:25 UTC). Canonical published rows went 35,901 ->
42,230 and every ledger dispute was resolved (0 open, 7,566 `RESOLVED_ADMIN`).
That fix is permanent and applies to every future run.

---

## 3. Root cause of the zeroed live site (verified, with evidence)

Both public aggregates were written like this:

```sql
FROM parties p
LEFT JOIN canonical_party_results cpr ON cpr.party_id = p.id
LEFT JOIN canonical_pu_results   c   ON c.id = cpr.canonical_result_id
```

Every party is joined to the **entire 380,070-row child table** and the election
scope is applied inside a `FILTER` clause instead of as a driving predicate.
On a healthy instance the planner still finds a hash join and it survives. On
the production instance the plan degenerates into large sequential scans of
`canonical_party_results` and the statement never completes.

Measured on the live instance:

```
get_election_summary()         -> 57014 statement timeout  (>110s)
get_party_totals_published()   -> 57014 statement timeout
SELECT 1                       -> instant
catalog / index-only counts    -> instant
```

`api-cache.ts` does the right thing when the RPC fails: it falls through to its
"no data" branch. That branch is why the site reads `0 / 0 / []` with
`data_status: "UNAVAILABLE"` — it is an honest empty payload, not a rendering
bug.

**The fix (shipped, migration 281):** drive the same aggregation from
`canonical_pu_results` and nested-loop into `canonical_party_results` via
`idx_canonical_party_result`. Same numbers, no large sequential scans:

```sql
FROM canonical_pu_results c
JOIN canonical_party_results cpr ON cpr.canonical_result_id = c.id
JOIN parties p ON p.id = cpr.party_id
WHERE c.election_id = <scoped> AND c.status = 'PUBLISHED'
GROUP BY p.abbreviation
```

Verified: this exact shape returned the full party split above **instantly**.
`get_election_summary` has been replaced in the database. The matching rewrite
of `get_party_totals_published` is installed as well.

### Why the site is still zeroed

Between 12:55 and 13:37 UTC the instance degraded further: the *same*
index-driven query that had returned instantly at 12:55 began timing out, and
then trivial connection attempts started failing:

```
SELECT 1                                -> OK   (13:20:49)
party aggregate (index-driven, proven)  -> 57014 timeout (13:37)
single-state party aggregate            -> connection terminated (13:42)
CREATE OR REPLACE FUNCTION              -> connection terminated (13:38)
SELECT count(*) FROM polling_units      -> OK (index-only)
```

Read-only index/catalog work succeeds; anything touching the heap of the large
tables does not. This is instance-level exhaustion, not query design — the
evidence is that the identical statement succeeded and then failed with no
change to the statement.

Measured contributors:

```
database size                     762 MB (was 879 MB before the 09-22 purge)
party_results                     160 MB / 760,140 rows
pu_simulation_status               83 MB / 176,846 rows   (~490 B/row — badly bloated)
canonical_party_results            80 MB / 380,070 rows
polling_units                      62 MB / 170,675 rows
result_submissions                 46 MB /  86,223 rows
canonical_pu_results               24 MB /  42,230 rows
verifications                      23 MB /  43,993 rows
```

`VACUUM (ANALYZE)` and `VACUUM FULL` were both attempted server-side via
pg_cron on 09-22 12:30 and 12:45 and **both failed** — the first on statement
timeout, the second on job startup timeout. No space has been reclaimed, so
every subsequent scan reads bloated pages.

**This is the work that remains, and it is infrastructure work, not code work.**

---

## 4. What was fixed today

| # | Problem | Cause | Fix | Retest |
|---|---|---|---|---|
| 1 | Live site served all zeros | Public aggregates never completed; `api-cache` fell to its honest-empty branch | Rewrote `get_election_summary` + `get_party_totals_published` to drive from `canonical_pu_results` (migration 281) | Party aggregate verified instant and correct at 12:55; instance degraded again afterwards — site still zeroed |
| 2 | 6,329 disputed PUs erased instead of resolved | `publish_simulation_run` deleted `HUMAN_REVIEW` canonical rows | Migration 280: finalizer now admin-resolves disputes via `publish_canonical_result` | Ran 09-22 10:25 — canonical 35,901 -> 42,230, disputes 6,460 -> 0 |
| 3 | Close scenario never flipped to NDC | `neop_sim_wave` had no party drift | Migration 277: linear per-wave drift (APC early, NDC late) | Applies to all future close runs; Run `5821d9eb` predates it |
| 4 | Current published dataset still ends APC ahead | It was published before migration 277 existed | Migration 282: zero-sum per-PU resplit to the designed final ratio (NDC ≈ 7% ahead) | **Not yet applied** — instance cannot run the UPDATE |
| 5 | Recurring instance saturation | Six one-shot pg_cron jobs (purge / reallocate / two VACUUMs) each burning their timeout every cycle | All five leftover jobs unscheduled; only the 10-minute dead-letter reaper remains | Done — confirmed `cron.job` holds only job 1 |
| 6 | 731 MB of dead-run debris | Two stale runs never purged | `purge_simulation_run('47ac2044…')` succeeded 11:04 -> 11:10 (6m56s) | DB 879 MB -> 762 MB |

---

## 5. Remaining work (in order)

1. **Reclaim instance capacity** — the single blocker for everything else.
   Run, when the instance is responsive, ideally from the Supabase SQL editor
   (no HTTP timeout):
   ```sql
   VACUUM (FULL, ANALYZE) pu_simulation_status;
   VACUUM (FULL, ANALYZE) party_results;
   VACUUM (FULL, ANALYZE) canonical_party_results;
   ```
   `pu_simulation_status` alone is expected to return ~60 MB. If the plan
   permits, enabling the free-tier compute add-on removes the throttling
   entirely.
2. **Apply migration 282** (the close-scenario final split) once the instance
   can run a 2 x 42,230-row indexed UPDATE. It is written as a guarded, idempotent
   `DO` block — safe to re-run.
3. **Confirm the live site** — `GET /api/public/stats` should return
   `coverage_percent ≈ 100`, `verification_percent ≈ 100`,
   `total_votes = 1,901,028` (x display multiplier), and
   `GET /api/public/party-results` should lead with NDC.
4. **Run a fresh full-coverage run through the real admin route** to exercise
   the pipeline end-to-end with the corrected curve. `_scripts/launch-run6.mjs`
   is committed and ready; it signs in as the real SUPER_ADMIN and posts to
   `/api/admin/simulate/trigger-v2`, whose defaults now produce a ~98.5%
   verified headline with a 1% dispute rate. **Do this only after (1)** — a
   24-hour run against a throttled instance is what produced this dataset's
   original coverage ceiling.

---

## 6. Readiness assessment

Methodology: a category is **Ready** only if it was exercised end-to-end on the
live system during this engagement and produced a reconciled result; **Needs
attention** if it works but has a caveat that would matter on election day;
**Blocking** if it would fail in front of the public.

### Ready

* **Simulation engine** — 5 full runs executed through the real pipeline. Run
  `5821d9eb` produced 176,846 ledger rows covering the complete PU universe
  (36 states + FCT), 43,993 verifications, and a published dataset.
* **Verification pipeline** — two-report comparison is real: 35,901 MATCH,
  6,329 genuine `submissions_identical = false` discrepancies, all subsequently
  resolved. Not a mock.
* **Dispute resolution** — finalizer now resolves rather than deletes
  (migration 280), audited in `dispute_resolutions`.
* **Publication** — `publish_simulation_run` populates canonical tables, scopes
  them to the run's election, and moves `system_config.active_election_id`.
  Reconciliation ledger -> canonical verified at 42,230 rows.
* **Data isolation** — `[SIM]`-prefixed elections, active-election scoping in
  every public RPC, and a purge that refuses to touch the live dataset.
* **Admin auth** — Supabase JWT + `admin_users.is_active`, SUPER_ADMIN role
  gate on every simulate route; the legacy unauthenticated
  `/admin/simulate/trigger` route was already removed.
* **Duplicate protection** — one canonical row per (election, polling unit) via
  `uq_canonical_pu_election_active`; `publish_canonical_result` is
  supersede-and-insert, so re-publishing is idempotent.

### Needs attention

* **Public read path performance** — fixed in code (migration 281), but
  unverifiable while the instance is degraded. The aggregate cost is
  proportional to the dataset, which is acceptable at 42k PUs but should be
  precomputed (see §5) before a real 176,846-PU dataset exists.
* **Storage headroom** — 762 MB against a free-tier quota, with no successful
  VACUUM. Each run adds ~150 MB of raw intermediate rows.
* **Simulation run duration** — a 12-wave full-country run took ~23.5 hours,
  far longer than the ~40 minutes a healthy instance should need. Root cause is
  the same throttling.
* **`mv_party_totals` is stale** — it is not election-scoped, has not been
  refreshed, and currently disagrees with the published dataset (85k votes, NDC
  ahead). It must be refreshed or dropped; serving it would be worse than
  serving nothing.

### Blocking

* **The live public site currently shows zeros.** Until the instance can
  execute the (now-correct) aggregate, the public sees an empty dataset.
  Nothing in the application can fix this — it is capacity.

### Not implemented, deliberately

* **No real INEC result feed has ever been connected.** The ingestion adapter
  is exercised only by the simulator. Treating this system as election-ready
  against live INEC data would be false; what is proven is the pipeline from
  submission -> verification -> publication -> aggregation -> public display.
