/**
 * NEOP Phase 3 — launch the fresh full-coverage run through the REAL admin
 * route (/api/admin/simulate/trigger-v2), exactly as the dashboard does:
 *   1. Sign in via Supabase Auth (password grant) as NEOP_ADMIN_EMAIL
 *   2. POST the launch with a Bearer token
 *
 * release_published:true is the purge-then-run lifecycle (migration 285): the
 * current live dataset is released BEFORE the quota gate so 100% coverage is
 * gated against the free baseline, not "baseline minus the old dataset".
 *
 * Usage:
 *   node _scripts/p3-launch-run8.mjs                 # local :3210
 *   node _scripts/p3-launch-run8.mjs https://ngeop.vercel.app
 */
import { readFileSync, appendFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);

const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");
// Coverage is capped by simulation_quota_check(): under the real 500 MB
// free-plan ceiling the max feasible coverage is ~16% (base + full ledger +
// safety leave only ~197 MB for results). Override with argv[3].
const COVERAGE = Math.max(1, Math.min(100, Number(process.argv[3] || 15)));
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const LOG = new URL("../_logs/p3-run8-launch.log", import.meta.url);
const say = (o) => {
  const line = typeof o === "string" ? o : JSON.stringify(o);
  console.log(line);
  appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`);
};

say(`=== launch target: ${BASE} ===`);

const signIn = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: env.NEOP_ADMIN_EMAIL,
    password: env.NEOP_ADMIN_PASSWORD,
  }),
});
if (!signIn.ok) {
  say(`SIGNIN_FAILED ${signIn.status} ${(await signIn.text()).slice(0, 300)}`);
  process.exit(1);
}
const { access_token } = await signIn.json();
say(`signin ok (token length ${access_token.length})`);

const payload = {
  scenario: "landslide",
  coverage_pct: COVERAGE,
  waves: 12,
  target_voters: 2_000_000,
  display_voters: 52_000_000,
  discrepancy_rate: 0.01, // 1% disputes
  duration_minutes: 0, // flat out
  release_published: true, // purge-then-run (migration 285)
  reset_first: true,
};
say(`payload: ${JSON.stringify(payload)}`);

const t0 = Date.now();
const launch = await fetch(`${BASE}/api/admin/simulate/trigger-v2`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
const text = await launch.text();
say(`launch status ${launch.status} in ${Date.now() - t0}ms`);
say(text.slice(0, 2000));
