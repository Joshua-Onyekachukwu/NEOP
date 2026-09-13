#!/usr/bin/env node
/* READ-ONLY probe of the live Supabase project.
 * Introspects constraint definitions + function signatures so we can write
 * an exact alignment migration. No writes anywhere. */
const fs = require("fs");
const path = require("path");

// minimal .env.local parser (no dotenv dependency)
function loadEnv() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnv();
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("FATAL missing SB URL/KEY"); process.exit(1); }

async function q(sql) {
  const r = await fetch(URL_ + "/rest/v1/rpc/exec_sql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: KEY,
      Authorization: "Bearer " + KEY,
    },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await r.text();
  let data = null;
  try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: r.status, data };
}

async function main() {
  console.log("=== 1. verifications constraints ===");
  let r = await q(
    "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.verifications'::regclass ORDER BY conname"
  );
  console.log(JSON.stringify(r, null, 1).slice(0, 4000));

  console.log("=== 2. verification_timeline_events constraints ===");
  r = await q(
    "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.verification_timeline_events'::regclass ORDER BY conname"
  );
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));

  console.log("=== 3. canonical_pu_results constraints ===");
  r = await q(
    "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.canonical_pu_results'::regclass ORDER BY conname"
  );
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));

  console.log("=== 4. key function signatures ===");
  r = await q(
    "SELECT p.proname, pg_get_function_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname IN ('publish_canonical_result','submit_result_atomic','enqueue_dead_letter','process_dead_letter_retry','exec_sql') ORDER BY p.proname"
  );
  console.log(JSON.stringify(r, null, 1).slice(0, 4000));

  console.log("=== 5. triggers on result_submissions ===");
  r = await q(
    "SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid='public.result_submissions'::regclass AND NOT tgisinternal"
  );
  console.log(JSON.stringify(r, null, 1).slice(0, 2500));

  console.log("=== 6. counts (read-only) ===");
  r = await q("SELECT (SELECT count(*) FROM verifications) AS verifications, (SELECT count(*) FROM result_submissions) AS submissions, (SELECT count(*) FROM canonical_pu_results) AS canonical, (SELECT count(*) FROM verification_timeline_events) AS events, (SELECT count(*) FROM dead_letter_jobs) AS dead_letters, (SELECT count(*) FROM system_config) AS sysconfig");
  console.log(JSON.stringify(r, null, 1));

  console.log("=== 7. system_config row ===");
  r = await q("SELECT data_mode, active_election_id IS NOT NULL AS has_active, last_updated_at FROM system_config");
  console.log(JSON.stringify(r, null, 1));

  console.log("PROBE DONE (read-only)");
}
main().catch((e) => { console.error("PROBE_ERR", e); process.exit(1); });
