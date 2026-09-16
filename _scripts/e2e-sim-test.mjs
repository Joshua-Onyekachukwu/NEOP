#!/usr/bin/env node
/**
 * E2E simulation acceptance test (local).
 *
 * Verifies the full checkpoint-queue pipeline:
 *   1. Start a simulation via the admin API (small, fast).
 *   2. Drive the queue by calling the tick endpoint.
 *   3. Confirm ledger assignment covers the PU universe.
 *   4. Confirm published canonical results appear.
 *   5. Confirm full reconciliation: all ledger statuses sum to the
 *      universe, and the public stats endpoint reports the same.
 *
 * Usage: node _scripts/e2e-sim-test.mjs [--base http://localhost:3000]
 * Admin token: _logs/qa-admin-token.json (refreshed by caller if stale)
 * Env: reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local
 */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : "http://localhost:3000";

const ROOT = process.cwd();
const readEnv = (k) => {
  for (const f of [".env.local", "apps/web/.env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return process.env[k];
};

const SB_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const SB_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!SB_URL || !SB_KEY) {
  console.error("FATAL: Supabase env not found");
  process.exit(1);
}

const sb = async (query) => {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${query}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
  });
  return res.json();
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── 1. Launch ──────────────────────────────────────────────────
let token;
try {
  token = JSON.parse(fs.readFileSync(path.join(ROOT, "_logs/qa-admin-token.json"), "utf8")).token;
} catch {
  console.error("FATAL: no admin token at _logs/qa-admin-token.json");
  process.exit(1);
}
const CRON_SECRET = readEnv("CRON_SECRET");

/** Refresh the stored admin token (rotating refresh token) and rewrite the file. */
async function refreshAdminToken() {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(ROOT, "_logs/qa-admin-token.json"), "utf8"));
    if (!store.refresh) return null;
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") || "", "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: store.refresh }),
    });
    const j = await res.json();
    if (j.access_token) {
      fs.writeFileSync(
        path.join(ROOT, "_logs/qa-admin-token.json"),
        JSON.stringify({ token: j.access_token, refresh: j.refresh_token, expires: j.expires_at }, null, 2)
      );
      return j.access_token;
    }
  } catch {}
  return null;
}

console.log("→ Launching simulation (small: 1 wave, 2% coverage, 200k voters ×10 display)...");
const LAUNCH_BODY = JSON.stringify({
  scenario: "landslide",
  target_voters: 200_000,
  display_voters: 2_000_000,
  duration_minutes: 0,
  waves: 1,
  discrepancy_rate: 0.05,
  coverage_pct: 2,
  reset_first: true,
});
let launchRes = null;
for (let attempt = 1; attempt <= 15; attempt++) {
  launchRes = await fetch(`${BASE}/api/admin/simulate/trigger-v2`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: LAUNCH_BODY,
  });
  if (launchRes.status === 401) {
    console.log("→ Access token expired; refreshing...");
    const fresh = await refreshAdminToken();
    if (fresh) token = fresh;
    continue;
  }
  if (launchRes.status === 429) {
    // Middleware token bucket (tight for /api/admin/simulate): back off.
    console.log(`  (launch rate-limited, attempt ${attempt}; waiting 20s)`);
    await new Promise((r) => setTimeout(r, 20_000));
    continue;
  }
  break;
}
const launch = await launchRes.json();
check(
  "launch accepted (202)",
  launchRes.status === 202 && !!launch.run_id,
  `HTTP ${launchRes.status} run=${launch.run_id ?? "-"} err=${launch.error ?? "none"}`
);
const runId = launch.run_id;
if (!runId) process.exit(1);

// ── 2. Drive the queue via tick ────────────────────────────────
console.log("→ Driving queue via /tick (max 8 min)...");
let ticks = 0;
let finished = false;
const t0 = Date.now();
while (Date.now() - t0 < 480_000) {
  const tickAuth = CRON_SECRET ? `Bearer ${CRON_SECRET}` : `Bearer ${token}`;
  const tickRes = await fetch(`${BASE}/api/admin/simulate/tick?max=30`, {
    method: "POST",
    headers: { Authorization: tickAuth },
  });
  ticks++;
  if (tickRes.status === 429) {
    // Middleware token bucket — back off and retry (does not count as work)
    await new Promise((r) => setTimeout(r, 20_000));
    continue;
  }
  const tick = await tickRes.json();
  if (tick.run_finished || (tick.remaining === 0 && tick.processed === 0)) {
    finished = true;
    break;
  }
  if (tick.last_error) console.log("  (tick error:", tick.last_error + ")");
  // A tick can take up to its 45s internal budget; pause briefly between.
  await new Promise((r) => setTimeout(r, 3_000));
}
check("run finished via tick pump", finished, `${ticks} tick calls`);

// ── 3. Ledger coverage ─────────────────────────────────────────
console.log("→ Checking ledger coverage...");
const cov = await sb("get_pu_coverage_summary");
const totalPus = Number(cov?.total_pus ?? 0);
check("ledger covers full PU universe", totalPus >= 170_000, `${totalPus} rows`);
check("scope recorded", Number(cov?.scope_pus ?? 0) > 0, `scope=${cov?.scope_pus}`);

// ── 4. Published results exist ─────────────────────────────────
const published = Number(cov?.published_pus ?? 0);
check("published results > 0", published > 0, `${published} PUs published`);

// ── 5. Reconciliation: statuses sum to universe ────────────────
const sum =
  published +
  Number(cov?.dispute_pus ?? 0) +
  Number(cov?.failed_pus ?? 0) +
  Number(cov?.disrupted_pus ?? 0) +
  Number(cov?.unavailable_pus ?? 0) +
  Number(cov?.awaiting_pus ?? 0) +
  Number(cov?.other_pus ?? 0);
check(
  "ledger statuses reconcile to universe",
  sum === totalPus,
  `${published}+${cov?.dispute_pus}+${cov?.failed_pus}+${cov?.disrupted_pus}+${cov?.unavailable_pus}+${cov?.awaiting_pus}+${cov?.other_pus} = ${sum}`
);

// ── 6. Public stats endpoint agrees ────────────────────────────
const statsRes = await fetch(`${BASE}/api/public/stats`);
const stats = await statsRes.json();
check(
  "public stats reports same published count (display-scaled)",
  Number(stats.published_pus ?? 0) >= published,
  `api=${stats.published_pus} vs ledger=${published}`
);
// The public site must render display_multiplier × the real stored votes
// (SIMULATED mode only) — the core "small backend, big frontend" contract.
const realVotes = Number(cov?.total_votes ?? 0);
const dispVotes = Number(stats.total_votes ?? 0);
check(
  "display scaling active (rendered ≥ 10× stored)",
  realVotes > 0 && dispVotes >= realVotes * 10,
  `stored=${realVotes} rendered=${dispVotes}`
);

// ── Summary ────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
// Brief settle so in-flight sockets close before exit (avoids a libuv
// teardown assertion crash on Node/Windows that masks the exit code).
await new Promise((r) => setTimeout(r, 500));
process.exit(failed.length > 0 ? 1 : 0);
