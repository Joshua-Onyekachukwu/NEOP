/**
 * NEOP admin-console smoke test.
 *
 * Asserts that the admin console is actually reachable through every layer
 * that has historically broken it, so a middleware or RLS change can never
 * silently lock admins out again:
 *
 *   1. Supabase auth accepts the admin credentials (GoTrue password grant)
 *      and admin_users returns the admin row through RLS — the exact query
 *      the dashboard's client gate performs. A recursion regression in the
 *      admin_users policies (the 42P17 bug) fails here with a clear name.
 *   2. The edge middleware gates /admin/dashboard: 307 to the login page
 *      without a session cookie, 200 WITH one.
 *   3. The dashboard page itself returns 200 and contains real console
 *      content (not a redirect page) when authenticated.
 *
 * Usage:
 *   node _scripts/admin-console-smoke.mjs [--base http://localhost:3000] [--json out]
 *
 * Credentials are read from .env.local (NEOP_ADMIN_EMAIL / NEOP_ADMIN_PASSWORD,
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Nothing is printed.
 *
 * Exit code 0 = all checks passed; 1 = at least one failed.
 */

import { readFileSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = arg("base", "http://localhost:3000");
const JSON_OUT = arg("json", "");

function envLocal() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const env = envLocal();
const SBURL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = env.NEOP_ADMIN_EMAIL;
const PASSWORD = env.NEOP_ADMIN_PASSWORD;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

if (!SBURL || !ANON || !EMAIL || !PASSWORD) {
  console.error("Missing NEOP_ADMIN_EMAIL / NEOP_ADMIN_PASSWORD / NEXT_PUBLIC_SUPABASE_* in .env.local");
  process.exit(1);
}

const ref = new URL(SBURL).hostname.split(".")[0];
const COOKIE_NAME = `sb-${ref}-auth-token`;

// ── 1. Auth + RLS gate (the exact client-side flow) ─────────────
let session = null;
try {
  const res = await fetch(`${SBURL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  check("auth: password grant accepted", res.ok && !!body.access_token,
    res.ok ? `user=${body.user?.email}` : `HTTP ${res.status}`);

  if (body.access_token) {
    session = body;
    // The dashboard's gate reads admin_users from the browser with the
    // user's JWT — this exact shape 500'd under the RLS recursion bug.
    const gate = await fetch(
      `${SBURL}/rest/v1/admin_users?select=id&user_id=eq.${body.user.id}&is_active=eq.true`,
      { headers: { apikey: ANON, Authorization: `Bearer ${body.access_token}` } }
    );
    let gateRows = [];
    try { gateRows = await gate.json(); } catch {}
    check("rls: admin_users gate query returns the admin row",
      gate.ok && Array.isArray(gateRows) && gateRows.length === 1,
      gate.ok ? `${gateRows.length} row(s)` : `HTTP ${gate.status} ${JSON.stringify(gateRows).slice(0, 120)}`);
  }
} catch (e) {
  check("auth: password grant accepted", false, e.message);
}

if (!session) {
  console.error("\nCannot continue without a session — auth or RLS is broken.");
  process.exit(1);
}

// Mirror supabase-browser.ts: the cookie the middleware requires.
const cookieValue = encodeURIComponent(JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  expires_at: session.expires_at,
  user: { id: session.user.id },
}));
const COOKIE = `${COOKIE_NAME}=${cookieValue}`;

// ── 2. Middleware gate: no cookie → redirect to login ───────────
try {
  const res = await fetch(`${BASE}/admin/dashboard`, { redirect: "manual" });
  check("middleware: /admin/dashboard without cookie redirects to login",
    res.status === 307 || res.status === 302,
    `HTTP ${res.status} → ${res.headers.get("location") || "?"}`);
} catch (e) {
  check("middleware: /admin/dashboard without cookie redirects to login", false, e.message);
}

// ── 3. Middleware gate + page: with cookie → 200 + console content ──
try {
  const res = await fetch(`${BASE}/admin/dashboard`, {
    redirect: "manual",
    headers: { Cookie: COOKIE },
  });
  const html = res.status === 200 ? await res.text() : "";
  const hasConsole = html.includes("Admin") || html.includes("admin");
  check("middleware: /admin/dashboard with session cookie returns 200",
    res.status === 200, `HTTP ${res.status}`);
  check("page: dashboard renders console content (not a redirect shell)",
    res.status === 200 && html.length > 500 && hasConsole,
    `${html.length} bytes`);
} catch (e) {
  check("middleware: /admin/dashboard with session cookie returns 200", false, e.message);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (JSON_OUT) {
  (await import("node:fs")).writeFileSync(
    JSON_OUT,
    JSON.stringify({ base: BASE, results, passed: failed.length === 0 }, null, 1)
  );
}
process.exit(failed.length === 0 ? 0 : 1);
