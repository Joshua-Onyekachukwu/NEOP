# INEC Result Feed — Supervised Rehearsal Plan

Status: PLAN (not yet executed — no real INEC feed has been connected).
Owner: principal engineer + one operator + one observer.
Principle: **no real feed ever writes to the public canonical dataset without
passing every gate below on staging first, and every production step has a
tested rollback.**

---

## 0. Current state (what exists today)

| Component | State |
|---|---|
| Two-agent submission model, deterministic validation, discrepancy flow | Implemented and simulation-tested |
| Canonical result pipeline (1 canonical result per PU) | Implemented; reconciles exactly |
| `system_config.data_mode` | `SIMULATED` — site labels itself correctly |
| Ingestion of an external feed (INEC IReV/EVM format) | **Not implemented** |
| Staging environment | **Not provisioned** (single prod project today) |

The simulation engine exercises the same pipeline as production data; the
connector below plugs into the *same* canonical pipeline — it is a new
**producer**, not a new pipeline.

---

## Phase 1 — Contract freeze (office work, 1–2 days)

1. Obtain and pin the exact INEC feed spec (IReV export format and/or EVM
   transmission schema). Record: transport (file/HTTP), auth, field list,
   PU identity key, dedupe key, refresh cadence, error semantics.
2. Produce a field-mapping table `INEC field → NEOP field` in this repo
   (`docs/inec-feed-mapping.md`). Nothing ambiguous may proceed to Phase 2.
3. Define the idempotency contract: `(election_id, polling_unit_code,
   source_sequence)` unique; re-delivery of the same sequence is a no-op;
   a changed payload for the same sequence is quarantined for review.
4. Decide the mode transition: `AWAITING_DATA → LIVE_ELECTION` is a manual
   admin action only. There is no automatic switch.

## Phase 2 — Staging environment (1 day)

1. Provision a **separate** Supabase project (staging) + a Vercel preview
   deployment wired to it. Staging never shares the prod database.
2. Restore a sanitized copy of the geographic hierarchy (states → LGAs →
   wards → PUs) into staging. No real submissions, no PII beyond PU codes.
3. Configure staging env vars; verify admin auth and that the public pages
   render `AWAITING DATA`.

## Phase 3 — Connector implementation (2–3 days)

1. New route `POST /api/ingest/inec` (server-only):
   - auth: signed secret header + IP allowlist (never browser-exposed);
   - validation: schema-validate every payload, reject unknown PU codes;
   - writes go to `inec_feed_raw` (append-only raw ledger) first;
   - a worker maps raw → the **existing** submission/verification pipeline
     (two "agents" = the feed's two source records when available; a
     single-record feed maps to the single-source path with
     `verification_source='INEC_FEED'` and deterministic validation only).
2. AI verification stays a non-blocking anomaly layer, exactly as in the
   simulation; a provider failure never blocks ingestion (fail-safe rule).
3. Feature flag `INEC_INGEST_ENABLED` (env + system_config), default OFF.

## Phase 4 — Staging dry-run (half day, supervised)

1. Replay a recorded/synthetic feed file (start with 10 PUs, then 100, then
   1,000) through the connector on staging.
2. Verify end-to-end on staging: raw ledger → pipeline → canonical results →
   aggregates → live site, including duplicate replay (no double count),
   malformed payload (rejected + quarantined), feed gap (PU stays
   AWAITING), and full reconciliation query passing.
3. Abort criteria: any duplicate canonical row, any reconciliation mismatch,
   any unhandled 5xx. Fix, redeploy, repeat — gate closed only on a clean run.

## Phase 5 — Production shadow mode (half day, supervised)

1. Enable the connector in **shadow mode** on production: raw ledger writes
   only, zero writes to canonical/aggregate tables. Public site unaffected.
2. Run the real feed (or a certification sample) for one hour; compare
   shadow totals to the feed's own published totals.
3. Rollback: turn the flag off. The raw ledger is the only artifact; delete
   it and nothing else changed.

## Phase 6 — Supervised cutover (the rehearsal)

Runbook (operator + observer on a call):

1. Announce freeze: no simulations, no admin data changes.
2. Admin sets `data_mode = LIVE_ELECTION` (manual, audited).
3. Enable `INEC_INGEST_ENABLED`; start feed; watch the first 10 PU results
   land end-to-end (raw → canonical → aggregates → live site).
4. Observer checks every 5 minutes: reconciliation query, feed lag, error
   rate, live feed ordering, map/leaderboard sanity.

### Rollback steps (rehearsed before cutover, each step timed)

| Trigger | Action | Time budget |
|---|---|---|
| Wrong/duplicate counts | Set `data_mode` back to `AWAITING_DATA`, flag OFF, run `revert_to_awaiting()` (restores the pre-election empty canonical state; raw ledger preserved for forensics) | < 5 min |
| Partial garbage ingestion | Flag OFF; quarantine + delete raw rows for affected window; re-run reconciliation; re-enable | < 15 min |
| Feed itself is broken | Flag OFF only; canonical data already ingested stays and is reconciled manually | n/a |
| DB degradation | Flag OFF; throttle; rely on read-optimized public projections (site degrades to cached totals) | < 2 min |

Every rollback action is an audited admin action. The rehearsal ends only
when a full cutover **and** a full rollback have both been executed once on
staging.

---

## Definition of done

- Mapping doc merged; connector merged behind a default-OFF flag.
- Staging dry-run clean at 1,000-PU scale including failure injections.
- Shadow-mode hour on production with zero public-facing writes.
- One full cutover + one full rollback rehearsed on staging.
- Only then: the real feed may be enabled on election day.
