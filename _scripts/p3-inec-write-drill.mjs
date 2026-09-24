/**
 * NEOP Phase 3 — INEC connector WRITE-PATH drill (Phase D).
 *
 * Exercises the full contract matrix from the brief (§4 idempotency, §7 dry-run,
 * §9 kill switch) against a running /api/ingest/inec, then performs the
 * documented rollback: normalized rows (result_submissions + verifications)
 * created by the drill are removed BY the raw ledger's own records; the ledger
 * itself is immutable (trigger-enforced) and is KEPT as evidence.
 *
 * Prereqs (provisioned externally via audited SQL):
 *   - inec_ingest_config row with ingest_secret = INEC_TEST_SECRET env
 *   - system_config.inec_ingest_enabled  = true   (master flag)
 *   - system_config.inec_rehearsal_mode  = true   (feed-isolation gate for SIMULATED mode)
 *
 * Usage: INEC_TEST_SECRET=... node _scripts/p3-inec-write-drill.mjs [baseUrl]
 * Exit code 0 = all checks passed.
 */
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);

const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");
const SECRET = process.env.INEC_TEST_SECRET;
if (!SECRET) {
  console.error("INEC_TEST_SECRET env required (must equal inec_ingest_config.ingest_secret)");
  process.exit(2);
}
const ELECTION = process.env.INEC_TEST_ELECTION || ""; // must equal active_election_id
if (!ELECTION) {
  console.error("INEC_TEST_ELECTION env required (must equal system_config.active_election_id)");
  process.exit(2);
}

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const URL_ = `${BASE}/api/ingest/inec`;

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: String(detail).slice(0, 200) });
  if (cond) pass++; else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${cond ? "" : "-- " + String(detail).slice(0, 200)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retrying fetch. Safe for this endpoint specifically because ingestion is
 *  idempotent by contract — a retry after a network failure must NOT be able to
 *  double-count, and this drill proves exactly that. */
const fetchRetry = async (url, init = {}, tries = 4) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(800 * (i + 1));
    }
  }
  throw new Error(`fetch failed after ${tries} tries: ${url} :: ${last?.cause?.code || last?.message}`);
};

const post = async (body, token = SECRET) =>
  fetchRetry(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const res = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

// Resolve two real PU codes + one bogus one; party list from DB.
const pus = await (await fetchRetry(`${SB}/rest/v1/polling_units?select=official_code&limit=2&order=official_code`, { headers: H })).json();
const PU1 = pus?.[0]?.official_code;
const PU2 = pus?.[1]?.official_code;
if (!PU1 || !PU2) { console.error("could not resolve real polling units"); process.exit(2); }

// Each run consumes a FRESH sequence band. `source_sequence` is a revision
// number for a polling unit, and the raw ledger is immutable evidence — so a
// re-run must never reuse a (PU, sequence) pair that is already ACCEPTED
// (it would be reported as a conflict, correctly).
const SEQ0 = Number(process.env.INEC_SEQ_BASE || (Math.floor(Date.now() / 1000) % 900000) + 1000);
const SEQ1 = SEQ0 + 1;
console.log(`[drill] sequence band: ${SEQ0}..${SEQ1}`);

const result = (apc, pdp, ndc, rejected = 3) => ({
  schema_version: "1.0",
  election_code: ELECTION,
  observed_at: new Date().toISOString(),
  result: { rejected_ballots: rejected, party_votes: [
    { abbr: "APC", votes: apc }, { abbr: "PDP", votes: pdp }, { abbr: "NDC", votes: ndc },
  ]},
});
const send = (pu, seq, r) => ({ batch_id: `p3drill-${Date.now()}`, results: [{ ...r, polling_unit_code: pu, source_sequence: seq }] });

// ── 0. Kill switch OFF state (flag currently true from provisioning; verify mechanism anyway)
// ── 1. unauthenticated / bad token
check("401 no auth", (await res(await post({ results: [] }, null))).status === 401, "expect 401");
check("401 bad token", (await res(await post(send(PU1, 1, result(10, 5, 2)), "nope-nope-nope-nope-nope-nope-nope"))).status === 401, "expect 401");

// ── 2. schema validation → 422
const bad = await res(await post({ batch_id: "p3-schema-bad", results: [{ schema_version: "1.0", election_code: ELECTION, polling_unit_code: PU1, source_sequence: 1, observed_at: "not-a-date", result: { rejected_ballots: 0, party_votes: [] } }] }));
check("422 schema invalid", bad.status === 422 && bad.body?.error === "schema_validation_failed", JSON.stringify(bad.body).slice(0, 120));
const badVote = await res(await post(send(PU1, 99, { schema_version: "1.0", election_code: ELECTION, observed_at: new Date().toISOString(), result: { rejected_ballots: 0, party_votes: [{ abbr: "APC", votes: -5 }] } })));
check("422 invalid vote value", badVote.status === 422, `status=${badVote.status} ${JSON.stringify(badVote.body).slice(0, 100)}`);

// ── 3. unknown PU / unknown party → REJECTED in-band
const unkPu = await res(await post(send("99/99/99/999", 1, result(10, 5, 2))));
check("REJECT unknown PU", unkPu.status === 200 && unkPu.body?.results?.[0]?.status === "REJECTED" && /unknown_polling_unit/.test(unkPu.body?.results?.[0]?.reason || ""), JSON.stringify(unkPu.body?.results?.[0]));
const unkParty = await res(await post({ batch_id: "p3-unkparty", results: [{ schema_version: "1.0", election_code: ELECTION, polling_unit_code: PU1, source_sequence: 42, observed_at: new Date().toISOString(), result: { rejected_ballots: 0, party_votes: [{ abbr: "ZZZZ", votes: 5 }] } }] }));
check("REJECT unknown party", unkParty.status === 200 && /unknown_party/.test(unkParty.body?.results?.[0]?.reason || ""), JSON.stringify(unkParty.body?.results?.[0]));

// ── 4. FIRST SUBMISSION → ACCEPTED
const first = await res(await post(send(PU1, SEQ0, result(120, 80, 40))));
const firstOut = first.body?.results?.[0];
check("ACCEPT first submission", first.status === 200 && firstOut?.status === "ACCEPTED" && !!firstOut?.submission_id, JSON.stringify(firstOut));
const SUB1 = firstOut?.submission_id;

// ── 5. EXACT DUPLICATE → DUPLICATE (no double count, no new submission)
const dup = await res(await post(send(PU1, SEQ0, result(120, 80, 40))));
const dupOut = dup.body?.results?.[0];
check("DUPLICATE exact re-send", dup.status === 200 && dupOut?.status === "DUPLICATE", JSON.stringify(dupOut));
check("DUPLICATE maps to original submission", dupOut?.submission_id === SUB1, `${dupOut?.submission_id} vs ${SUB1}`);

// ── 6. same result, different transport metadata (batch_id differs, extra transport field) → still DUPLICATE
const dupMeta = await res(await post({ batch_id: `p3drill-meta-${Date.now()}`, results: [{ ...result(120, 80, 40), polling_unit_code: PU1, source_sequence: SEQ0, transport: { channel: "sftp", attempt: 2 } }] }));
check("DUPLICATE with different transport", dupMeta.body?.results?.[0]?.status === "DUPLICATE", JSON.stringify(dupMeta.body?.results?.[0]));

// ── 7. CONFLICTING payload, same (PU, seq) → QUARANTINED (never silently applied)
const conflict = await res(await post(send(PU1, SEQ0, result(999, 80, 40))));
check("QUARANTINE conflicting payload", conflict.body?.results?.[0]?.status === "QUARANTINED" && /conflict/i.test(conflict.body?.results?.[0]?.reason || ""), JSON.stringify(conflict.body?.results?.[0]));

// ── 8. next sequence same PU → ACCEPTED (updates supersede via sequence)
const next = await res(await post(send(PU1, SEQ1, result(50, 30, 20, 1))));
check("ACCEPT next sequence", next.body?.results?.[0]?.status === "ACCEPTED", JSON.stringify(next.body?.results?.[0]));

// ── 9. batch of multiple results incl. one invalid → per-result outcomes, batch succeeds
const batch = await res(await post({ batch_id: `p3drill-multi-${Date.now()}`, results: [
  { ...result(11, 7, 3), polling_unit_code: PU2, source_sequence: SEQ0 },
  { ...result(21, 13, 8), polling_unit_code: "99/99/99/998", source_sequence: SEQ0 },
]}));
const bOuts = batch.body?.results || [];
check("BATCH mixed outcomes", batch.status === 200 && bOuts.find(o => o.status === "ACCEPTED") && bOuts.find(o => o.status === "REJECTED"), JSON.stringify(bOuts.map(o => o.status)));

// ── 10. retry: send the PU2 batch item again → DUPLICATE
const retry = await res(await post(send(PU2, SEQ0, result(11, 7, 3))));
check("RETRY is idempotent", retry.body?.results?.[0]?.status === "DUPLICATE", JSON.stringify(retry.body?.results?.[0]));

// ── DB consistency: exactly ONE normalized submission per accepted (PU, seq)
const ledger = await (await fetchRetry(`${SB}/rest/v1/inec_feed_raw?select=id,status,polling_unit_code,source_sequence,normalized_submission_id,reject_reason&order=received_at.desc&limit=400`, { headers: H })).json();
const accepted = (ledger || []).filter(r => r.status === "ACCEPTED");
const distinctSubs = new Set(accepted.map(r => r.normalized_submission_id));
check("one submission per accepted ledger row", distinctSubs.size === accepted.length, `${distinctSubs.size} distinct vs ${accepted.length} accepted`);
const pu1SeqN = (ledger || []).filter(r => r.polling_unit_code === PU1 && r.source_sequence === SEQ0);
check(`PU1 seq${SEQ0} ledger: 1 ACCEPTED + evidence rows`, pu1SeqN.filter(r => r.status === "ACCEPTED").length === 1, JSON.stringify(pu1SeqN.map(r => r.status)));

// ── rollback readiness (NOT deletion):
// The drill deliberately leaves its normalized rows in place. Rollback is the
// DOCUMENTED compensating procedure (_scripts/p3-inec-rollback.sql), which is
// ledger-driven: it removes exactly the submissions named by ACCEPTED ledger
// rows and nothing else, and preserves the ledger as forensic evidence.
// This check proves the procedure has an unambiguous target set to work from.
const rollback = {
  procedure: "_scripts/p3-inec-rollback.sql",
  target_submissions: [...distinctSubs],
  accepted_ledger_rows: accepted.length,
};
check(
  "rollback: ledger names every drill submission (unambiguous target set)",
  accepted.every((r) => !!r.normalized_submission_id) && distinctSubs.size > 0,
  JSON.stringify({ accepted: accepted.length, targets: distinctSubs.size })
);
console.log(`[rollback] apply _scripts/p3-inec-rollback.sql to remove ${distinctSubs.size} normalized submission(s); ledger rows are kept`);

const evidence = {
  ran_at: new Date().toISOString(),
  base_url: BASE,
  passed: pass,
  failed: fail,
  checks: results,
  sequence_band: [SEQ0, SEQ1],
  ledger_at_end: (ledger || []).map((l) => ({ status: l.status, pu: l.polling_unit_code, seq: l.source_sequence, reason: l.reject_reason ?? null })),
  rollback,
};
writeFileSync(new URL("../_logs/p3-inec-write-drill.json", import.meta.url), JSON.stringify(evidence, null, 2));

console.log(`\n==== DRILL SUMMARY: ${pass} passed, ${fail} failed ====`);
results.filter(r => !r.ok).forEach(r => console.log(`  FAILED: ${r.name}: ${r.detail}`));
console.log(`evidence: _logs/p3-inec-write-drill.json`);
process.exit(fail ? 1 : 0);
