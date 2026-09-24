/**
 * Phase D driver — runs the INEC write-path drill with the provisioned secret
 * injected from the database (so the rehearsal secret never appears in shell
 * history, logs, or the transcript).
 *
 *   node _scripts/p3-inec-drill-run.mjs [baseUrl]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url, tries = 5) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await (await fetch(url, { headers: H })).json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(1000 * (i + 1));
    }
  }
  throw new Error(`supabase fetch failed after ${tries} tries: ${last?.cause?.code || last?.message}`);
};

const cfg = await getJson(`${SB}/rest/v1/inec_ingest_config?select=ingest_secret&id=eq.1`);
const secret = cfg?.[0]?.ingest_secret;
if (!secret) { console.error("inec_ingest_config row missing"); process.exit(2); }

const flags = await getJson(`${SB}/rest/v1/system_config?select=active_election_id,inec_ingest_enabled,inec_rehearsal_mode&id=eq.00000000-0000-0000-0000-000000000001`);
const election = flags?.[0]?.active_election_id;
console.log(`[driver] flag=${flags?.[0]?.inec_ingest_enabled} rehearsal=${flags?.[0]?.inec_rehearsal_mode} election=${election} secret_len=${secret.length}`);

execFileSync(process.execPath, ["_scripts/p3-inec-write-drill.mjs", process.argv[2] || "http://localhost:3210"], {
  stdio: "inherit",
  env: { ...process.env, INEC_TEST_SECRET: secret, INEC_TEST_ELECTION: election },
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
});
