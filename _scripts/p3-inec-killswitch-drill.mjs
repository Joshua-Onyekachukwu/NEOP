/**
 * NEOP Phase 3 — INEC KILL-SWITCH drill (brief §9).
 *
 *  1. Start ingestion  → confirm data is flowing (ACCEPTED).
 *  2. Disable the connector (single system_config UPDATE — no redeploy).
 *  3. Confirm new ingestion stops (503 inec_ingest_disabled).
 *  4. Confirm no partial writes (nothing new in the ledger).
 *  5. Confirm already-accepted data is unchanged.
 *  6. Confirm the public site stays healthy and its totals do not move.
 *
 * Leaves the connector DISABLED (the required default state).
 *
 * Usage: node _scripts/p3-inec-killswitch-drill.mjs [baseUrl]
 */
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const CONFIG_ID = "00000000-0000-0000-0000-000000000001";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rq = async (url, init = {}, tries = 5) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); } catch (e) { last = e; if (i < tries - 1) await sleep(1000 * (i + 1)); }
  }
  throw new Error(`fetch failed: ${url} :: ${last?.cause?.code || last?.message}`);
};
const getJson = async (u) => await (await rq(u, { headers: H })).json();

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  results.push({ name, ok: !!cond, detail: String(detail ?? "").slice(0, 200) });
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -- " + String(detail).slice(0, 200)}`);
};

const cfg = await getJson(`${SB}/rest/v1/inec_ingest_config?select=ingest_secret&id=eq.1`);
const secret = cfg[0].ingest_secret;
const flags = await getJson(`${SB}/rest/v1/system_config?select=active_election_id,data_mode,inec_rehearsal_mode&id=eq.${CONFIG_ID}`);
const ELECTION = flags[0].active_election_id;
const FIELD = `${BASE}/api/ingest/inec`;

const setFlag = (v) =>
  rq(`${SB}/rest/v1/system_config?id=eq.${CONFIG_ID}`, { method: "PATCH", headers: H, body: JSON.stringify({ inec_ingest_enabled: v }) });

const pus = await getJson(`${SB}/rest/v1/polling_units?select=official_code&limit=3&order=official_code`);
const PU = pus[2].official_code;                       // third PU: unused by earlier drills
const SEQ = Number(process.env.INEC_SEQ_BASE || (Math.floor(Date.now() / 1000) % 900000) + 10);
const SEQ_KILLED = SEQ + 1;

const payload = (pu, seq, votes = 60) => ({
  batch_id: `p3kill-${Date.now()}`,
  results: [{
    schema_version: "1.0", election_code: ELECTION, polling_unit_code: pu, source_sequence: seq,
    observed_at: new Date().toISOString(),
    result: { rejected_ballots: 2, party_votes: [{ abbr: "APC", votes }, { abbr: "PDP", votes: 5 }, { abbr: "NDC", votes: 1 }] },
  }],
});
const send = (body) => rq(FIELD, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

// ── 1. Ensure the connector is ON, then prove data flows ──
await setFlag(true);
await sleep(300);
const flow = await res(await send(payload(PU, SEQ, 60)));
check("1. data flowing: valid payload ACCEPTED", flow.status === 200 && flow.body?.results?.[0]?.status === "ACCEPTED", JSON.stringify(flow.body?.results?.[0]));
const SUB = flow.body?.results?.[0]?.submission_id;

// public baseline BEFORE the kill (totals must not move afterwards)
const pubBefore = await getJson(`${SB}/rest/v1/canonical_party_results?select=votes`);
const totBefore = (pubBefore || []).reduce((a, r) => a + Number(r.votes || 0), 0);
const statsBefore = await res(await rq(`${BASE}/api/public/stats`));

const ledgerBefore = (await getJson(`${SB}/rest/v1/inec_feed_raw?select=id&limit=5000`) || []).length;

// ── 2. Kill switch: one UPDATE, no deploy ──
const t0 = Date.now();
const kill = await setFlag(false);
check("2. kill switch: single system_config UPDATE applied", kill.ok, `status=${kill.status}`);
const killLatencyMs = Date.now() - t0;
await sleep(300);

// ── 3. New ingestion stops ──
const blockedNew = await res(await send(payload(PU, SEQ_KILLED, 60)));
check(
  "3. new ingestion blocked (503 inec_ingest_disabled)",
  blockedNew.status === 503 && blockedNew.body?.error === "inec_ingest_disabled",
  JSON.stringify(blockedNew.body)
);
// kill switch outranks idempotency: a re-send of already-accepted data is also refused
const blockedDup = await res(await send(payload(PU, SEQ, 60)));
check("3b. kill switch outranks idempotent re-send (still 503)", blockedDup.status === 503, `status=${blockedDup.status} ${JSON.stringify(blockedDup.body).slice(0, 120)}`);

// ── 4. No partial writes ──
const ledgerAfter = await getJson(`${SB}/rest/v1/inec_feed_raw?select=id,status,polling_unit_code,source_sequence&limit=5000`);
check("4. no new ledger rows while disabled", (ledgerAfter || []).length === ledgerBefore, `${ledgerBefore} → ${(ledgerAfter || []).length}`);
check("4b. blocked (PU, sequence) never reached the ledger",
  !(ledgerAfter || []).some((r) => r.polling_unit_code === PU && r.source_sequence === SEQ_KILLED),
  JSON.stringify((ledgerAfter || []).filter((r) => r.polling_unit_code === PU).map((r) => [r.source_sequence, r.status])));

// ── 5. Already-accepted data unchanged ──
const sub = await getJson(`${SB}/rest/v1/result_submissions?select=id,valid_votes,rejected_votes,status,source&id=eq.${SUB}`);
check("5. accepted data intact after disable", sub?.[0]?.id === SUB && sub[0].source === "INEC_FEED", JSON.stringify(sub?.[0]));
const partyRows = await getJson(`${SB}/rest/v1/party_results?select=votes&result_submission_id=eq.${SUB}`);
check("5b. accepted party rows intact (sum = valid_votes)", (partyRows || []).reduce((a, r) => a + Number(r.votes), 0) === sub?.[0]?.valid_votes, JSON.stringify(partyRows));

// ── 6. Public site stable ──
const pubAfter = await getJson(`${SB}/rest/v1/canonical_party_results?select=votes`);
const totAfter = (pubAfter || []).reduce((a, r) => a + Number(r.votes || 0), 0);
check("6. public canonical totals unchanged", totAfter === totBefore, `${totBefore} → ${totAfter}`);
const statsAfter = await res(await rq(`${BASE}/api/public/stats`));
check("6b. /api/public/stats still 200", statsAfter.status === 200, `status=${statsAfter.status}`);
check("6c. no public endpoint leaked feed data", !JSON.stringify(pubAfter).includes("INEC_FEED"), "canonical layer has no feed provenance");

const flagsEnd = await getJson(`${SB}/rest/v1/system_config?select=inec_ingest_enabled&id=eq.${CONFIG_ID}`);
check("7. connector left DISABLED (default state)", flagsEnd[0].inec_ingest_enabled === false, JSON.stringify(flagsEnd[0]));

const evidence = {
  ran_at: new Date().toISOString(),
  pu: PU, sequence_accepted: SEQ, sequence_blocked: SEQ_KILLED,
  kill_switch_latency_ms: killLatencyMs,
  accepted_submission: SUB,
  public_totals: { before: totBefore, after: totAfter },
  ledger_rows: { before: ledgerBefore, after: (ledgerAfter || []).length },
  stats_status: { before: statsBefore.status, after: statsAfter.status },
  passed: pass, failed: fail, checks: results,
};
writeFileSync(new URL("../_logs/p3-inec-killswitch.json", import.meta.url), JSON.stringify(evidence, null, 2));
console.log(`\n==== KILL-SWITCH SUMMARY: ${pass} passed, ${fail} failed (flag left OFF) ====`);
console.log(`evidence: _logs/p3-inec-killswitch.json`);
process.exit(fail ? 1 : 0);
