/**
 * Batched simulation-debris cleanup over PostgREST.
 * Designed to work when the database disk is nearly full: every
 * request touches a few hundred rows (no temp spill, small WAL).
 *
 * Usage: SR=<service_role_key> node _scripts/cleanup-sim-debris.mjs
 */
const BASE = "https://muwocrmdcyzmwqjvvjfj.supabase.co/rest/v1";
const KEY = process.env.SR;
if (!KEY) { console.error("SR env var required"); process.exit(1); }

const SIM_ELECTION = process.env.SIM_ELECTION_ID || "";
if (!SIM_ELECTION) { console.error("SIM_ELECTION_ID env var required"); process.exit(1); }
const CHUNK = Number(process.env.CHUNK || 300);

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function rest(method, path) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}/${path}`, { method, headers: H });
    } catch (e) {
      if (attempt >= 5) throw e;
      console.log(`  network error, retry ${attempt}`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
      return { status: res.status, body: await res.text() };
    }
    if (attempt >= 5) return { status: res.status, body: await res.text() };
    console.log(`  ${res.status} on ${method} ${path.slice(0, 80)}… retry ${attempt}`);
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
}

/**
 * Chunked parent->child drain: fetch a chunk of parent ids, delete child
 * rows by FK chunk, then the parents. Avoids PostgREST embedded-resource
 * filters entirely (they require select embedding). No temp spill, no
 * bulk WAL growth — safe on a nearly-full disk.
 */
async function drainParentWithChildren(parentTable, parentFilter, childTable, childFkCol) {
  let total = 0;
  for (;;) {
    const g = await rest("GET", `${parentTable}?select=id&${parentFilter}&order=id&limit=${CHUNK}`);
    if (g.status !== 200) throw new Error(`GET ${parentTable}: ${g.status} ${g.body}`);
    const parents = JSON.parse(g.body);
    if (!parents.length) break;
    const ids = parents.map((r) => r.id);
    // Delete in sub-chunks of 300: each UUID adds ~40 chars to the in.()
    // URL, and PostgREST 400s on oversized request URLs (CHUNK=1000 is
    // ~38KB — too big). Sub-chunking keeps URLs short.
    for (let i = 0; i < ids.length; i += 300) {
      const list = ids.slice(i, i + 300).join(",");
      if (childTable) {
        const dc = await rest("DELETE", `${childTable}?${childFkCol}=in.(${list})`);
        if (dc.status !== 204 && dc.status !== 200) {
          throw new Error(`DELETE ${childTable}: ${dc.status} ${dc.body}`);
        }
      }
      const dp = await rest("DELETE", `${parentTable}?id=in.(${list})`);
      if (dp.status !== 204 && dp.status !== 200) {
        throw new Error(`DELETE ${parentTable}: ${dp.status} ${dp.body}`);
      }
    }
    total += ids.length;
    console.log(`  ${parentTable}: ${total} (+children) removed so far`);
  }
  return total;
}

async function deleteByIds(table, ids, col = "id") {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const list = chunk.join(",");
    const { status, body } = await rest("DELETE", `${table}?${col}=in.(${list})`);
    if (status !== 204 && status !== 200) throw new Error(`DELETE ${table}: ${status} ${body}`);
    deleted += chunk.length;
    if (deleted % 30000 === 0) console.log(`  ${table}: ${deleted}/${ids.length}`);
  }
  return deleted;
}

async function deleteByFilter(table, filter) {
  const { status, body } = await rest("DELETE", `${table}?${filter}`);
  if (status !== 204 && status !== 200) throw new Error(`DELETE ${table}: ${status} ${body}`);
}

// ---- 0. NULL verifications.canonical_result_id (FK blocks canonical deletes)
console.log("nulling verifications.canonical_result_id…");
for (;;) {
  const g = await rest("GET", `verifications?select=id&election_id=eq.${SIM_ELECTION}&canonical_result_id=not.is.null&order=id&limit=300`);
  if (g.status !== 200) throw new Error(`GET verifications: ${g.status} ${g.body}`);
  const rows = JSON.parse(g.body);
  if (!rows.length) break;
  const list = rows.map((r) => r.id).join(",");
  const p = await fetch(`${BASE}/verifications?id=in.(${list})`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify({ canonical_result_id: null }),
  });
  if (!p.ok) throw new Error(`PATCH verifications: ${p.status} ${await p.text()}`);
  console.log(`  nulled ${rows.length}`);
}

// ---- 1. canonical results + their party rows ---------------------------
console.log("draining canonical results (+ party rows)…");
await drainParentWithChildren("canonical_pu_results", `election_id=eq.${SIM_ELECTION}`, "canonical_party_results", "canonical_result_id");

// ---- 2. verifications (+ timeline events) BEFORE submissions —
// verifications.submission_id_1/2 are NO ACTION FKs and block submission
// deletes until the referencing rows are gone.
console.log("draining verifications (+ timeline events)…");
await drainParentWithChildren("verifications", `election_id=eq.${SIM_ELECTION}`, "verification_timeline_events", "verification_id");

// ---- 3. submissions + party results ------------------------------------
console.log("draining result_submissions (+ party_results)…");
await drainParentWithChildren("result_submissions", `election_id=eq.${SIM_ELECTION}`, "party_results", "result_submission_id");

// ---- 4. agent assignments ----------------------------------------------
console.log("draining agent_assignments…");
await drainParentWithChildren("agent_assignments", `election_id=eq.${SIM_ELECTION}`, null, null);

// ---- 5. sim observers: accounts -> volunteers ---------------------------
console.log("draining sim observer accounts (+ volunteers)…");
await drainParentWithChildren("user_accounts", `email=like.sim_obs_%2A`, "volunteers", "user_id");

// ---- 5. sim elections + their audit rows --------------------------------
await deleteByFilter("elections", `id=eq.${SIM_ELECTION}`);
await deleteByFilter("audit_log", `resource_id=eq.${SIM_ELECTION}`);
console.log("election + audit rows deleted");

// ---- 6. point the site back at live mode --------------------------------
for (const [table, patch] of [
  ["system_config", { data_mode: "AWAITING_DATA", active_election_id: null, simulation_election_id: null }],
  ["simulation_config", { status: "IDLE" }],
]) {
  const res = await fetch(`${BASE}/${table}?id=eq.00000000-0000-0000-0000-000000000001`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  console.log(`${table} PATCH -> ${res.status}`);
  if (!res.ok) throw new Error(await res.text());
}

console.log("CLEANUP COMPLETE");
