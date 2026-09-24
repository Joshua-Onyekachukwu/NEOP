/**
 * Launches a simulation through the REAL admin pipeline route
 * (/api/admin/simulate/trigger-v2) exactly as the dashboard does:
 *   1. Sign in via Supabase Auth (password grant) as NEOP_ADMIN_EMAIL
 *   2. POST the launch with a Bearer token
 * Usage: node _scripts/launch-run6.mjs [coverage_pct]
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const coverage = Number(process.argv[2] || 60);

const signIn = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: env.NEOP_ADMIN_EMAIL, password: env.NEOP_ADMIN_PASSWORD }),
});
if (!signIn.ok) {
  console.error("SIGNIN_FAILED", signIn.status, (await signIn.text()).slice(0, 300));
  process.exit(1);
}
const { access_token } = await signIn.json();
console.log("signin ok, token len", access_token.length);

const launch = await fetch("https://ngeop.vercel.app/api/admin/simulate/trigger-v2", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    scenario: "close",
    coverage_pct: coverage,
    waves: 12,
    target_voters: 2_000_000,
    display_voters: 52_000_000,
    discrepancy_rate: 0.01,
    duration_minutes: 0,
    release_published: true,
  }),
});
const text = await launch.text();
console.log("launch status", launch.status);
console.log(text.slice(0, 1200));
