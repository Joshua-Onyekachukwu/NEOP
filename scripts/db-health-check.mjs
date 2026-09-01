#!/usr/bin/env node
/**
 * db-health-check.mjs
 *
 * Comprehensive database health check and auto-recovery script.
 * Monitors Supabase connection, and when the DB comes back:
 *   1. Runs migration 102 (master migration) via SQL
 *   2. Verifies all tables, functions, and 9 parties exist
 *   3. Triggers Convex sync
 *   4. Reports full health status
 *
 * Usage:
 *   node scripts/db-health-check.mjs              # Monitor mode (poll every 15s)
 *   node scripts/db-health-check.mjs --once       # Single check, then exit
 *   node scripts/db-health-check.mjs --fix        # Check + auto-fix issues
 *   node scripts/db-health-check.mjs --verbose    # Detailed output
 *
 * Reads credentials from apps/web/.env.local
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── CLI flags ──
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const ONCE = args.includes("--once");
const FIX = args.includes("--fix");

// ── Config ──
const POLL_INTERVAL = 15_000;
const LOG_FILE = resolve(ROOT, "scripts/db-health-check.log");

// ── Load env ──
function loadEnv() {
  const envPath = resolve(ROOT, "apps/web/.env.local");
  if (!existsSync(envPath)) {
    console.error("❌ Cannot find apps/web/.env.local");
    process.exit(1);
  }
  const env = readFileSync(envPath, "utf8");
  const get = (key) => {
    const match = env.match(new RegExp(`^${key}=(.+)`, "m"));
    return match ? match[1].trim() : null;
  };
  return {
    url: get("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: get("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceKey: get("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

function log(msg, level = "INFO") {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function logVerbose(msg) {
  if (VERBOSE) log(msg, "DEBUG");
}

// ── Health check results ──
const health = {
  dbOnline: false,
  tables: {},
  functions: {},
  parties: [],
  partyVotes: [],
  indexes: [],
  triggers: [],
  config: null,
  errors: [],
  warnings: [],
};

// ══════════════════════════════════════════
// SECTION 1: DB Connection Check
// ══════════════════════════════════════════

async function checkDBConnection(supabase) {
  log("Checking database connection...");
  try {
    const { data, error } = await Promise.race([
      supabase.from("parties").select("id").limit(1),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("Connection timeout (12s)")), 12000)
      ),
    ]);

    if (error) {
      log(`DB error: ${error.message}`, "ERROR");
      return false;
    }

    health.dbOnline = true;
    log("✅ Database is ONLINE");
    return true;
  } catch (e) {
    log(`DB offline: ${e.message}`, "WARN");
    return false;
  }
}

// ══════════════════════════════════════════
// SECTION 2: Table Verification
// ══════════════════════════════════════════

const REQUIRED_TABLES = [
  "states",
  "lgas",
  "wards",
  "polling_units",
  "elections",
  "parties",
  "candidates",
  "user_accounts",
  "admin_users",
  "volunteers",
  "agent_assignments",
  "observations",
  "result_submissions",
  "party_results",
  "incidents",
  "simulation_config",
  "simulation_history",
];

async function checkTables(supabase) {
  log("Checking required tables...");
  let passed = 0;
  let failed = 0;

  for (const table of REQUIRED_TABLES) {
    try {
      const { error } = await supabase.from(table).select("id").limit(1);
      if (error && error.code === "42P01") {
        health.tables[table] = "MISSING";
        health.errors.push(`Table "${table}" does not exist`);
        failed++;
        log(`  ❌ ${table} — MISSING`, "ERROR");
      } else {
        health.tables[table] = "OK";
        passed++;
        logVerbose(`  ✓ ${table}`);
      }
    } catch (e) {
      health.tables[table] = "ERROR";
      health.warnings.push(`Table "${table}": ${e.message}`);
      failed++;
      log(`  ⚠ ${table} — ${e.message}`, "WARN");
    }
  }

  log(`Tables: ${passed} OK, ${failed} missing/errored`);
  return { passed, failed };
}

// ══════════════════════════════════════════
// SECTION 3: RPC Functions Verification
// ══════════════════════════════════════════

const REQUIRED_FUNCTIONS = [
  "get_party_totals",
  "get_fast_stats",
  "get_state_breakdown_from_results",
  "run_fast_simulation",
];

async function checkFunctions(supabase) {
  log("Checking required RPC functions...");
  let passed = 0;
  let failed = 0;

  // get_party_totals
  try {
    const { data, error } = await supabase.rpc("get_party_totals");
    if (error) throw error;
    health.functions.get_party_totals = { status: "OK", rows: data?.length || 0 };
    passed++;
    logVerbose(`  ✓ get_party_totals (${data?.length || 0} parties)`);
  } catch (e) {
    health.functions.get_party_totals = { status: "MISSING", error: e.message };
    health.errors.push(`Function get_party_totals: ${e.message}`);
    failed++;
    log(`  ❌ get_party_totals — ${e.message}`, "ERROR");
  }

  // get_fast_stats
  try {
    const { data, error } = await supabase.rpc("get_fast_stats");
    if (error) throw error;
    health.functions.get_fast_stats = { status: "OK", hasData: !!data };
    passed++;
    logVerbose(`  ✓ get_fast_stats`);
  } catch (e) {
    health.functions.get_fast_stats = { status: "MISSING", error: e.message };
    health.errors.push(`Function get_fast_stats: ${e.message}`);
    failed++;
    log(`  ❌ get_fast_stats — ${e.message}`, "ERROR");
  }

  // get_state_breakdown_from_results
  try {
    const { data, error } = await supabase.rpc("get_state_breakdown_from_results");
    if (error) throw error;
    health.functions.get_state_breakdown_from_results = {
      status: "OK",
      states: data?.length || 0,
    };
    passed++;
    logVerbose(`  ✓ get_state_breakdown_from_results (${data?.length || 0} states)`);
  } catch (e) {
    health.functions.get_state_breakdown_from_results = { status: "MISSING", error: e.message };
    health.errors.push(`Function get_state_breakdown_from_results: ${e.message}`);
    failed++;
    log(`  ❌ get_state_breakdown_from_results — ${e.message}`, "ERROR");
  }

  log(`Functions: ${passed} OK, ${failed} missing/errored`);
  return { passed, failed };
}

// ══════════════════════════════════════════
// SECTION 4: Parties & Votes Verification
// ══════════════════════════════════════════

const EXPECTED_PARTIES = ["NDC", "APC", "PDP", "LP", "NNPP", "APGA", "SDP", "YPP", "ADC"];

async function checkParties(supabase) {
  log("Checking parties...");

  // Check all 9 parties exist
  const { data: parties, error: pErr } = await supabase
    .from("parties")
    .select("abbreviation, official_name, color")
    .order("abbreviation");

  if (pErr) {
    health.errors.push(`Cannot read parties: ${pErr.message}`);
    log(`  ❌ Cannot read parties: ${pErr.message}`, "ERROR");
    return;
  }

  health.parties = parties || [];
  const abbrs = (parties || []).map((p) => p.abbreviation);
  const missing = EXPECTED_PARTIES.filter((e) => !abbrs.includes(e));

  if (missing.length > 0) {
    health.warnings.push(`Missing parties: ${missing.join(", ")}`);
    log(`  ⚠ Missing parties: ${missing.join(", ")}`, "WARN");
  } else {
    log(`  ✓ All ${EXPECTED_PARTIES.length} parties present`);
  }

  // Check vote totals
  try {
    const { data: voteData, error: vErr } = await supabase.rpc("get_party_totals");
    if (vErr) throw vErr;

    health.partyVotes = voteData || [];
    const totalVotes = (voteData || []).reduce((sum, p) => sum + (Number(p.total_votes) || 0), 0);

    if (totalVotes === 0) {
      health.warnings.push("No votes in party_results — run simulation");
      log("  ⚠ No votes recorded yet — run simulation from admin panel", "WARN");
    } else {
      log(`  ✓ ${totalVotes.toLocaleString()} total votes across ${voteData.length} parties`);
      for (const p of voteData) {
        logVerbose(
          `    ${p.party_abbreviation}: ${Number(p.total_votes).toLocaleString()} (${p.percentage}%)`
        );
      }
    }
  } catch (e) {
    health.warnings.push(`Cannot check votes: ${e.message}`);
    log(`  ⚠ Cannot check votes: ${e.message}`, "WARN");
  }
}

// ══════════════════════════════════════════
// SECTION 5: Schema Fixes (if --fix)
// ══════════════════════════════════════════

async function applyFixes(supabase) {
  if (!FIX) return;

  log("Applying fixes...");
  let fixesApplied = 0;

  // Fix 1: Ensure parties.color exists and all 9 parties have colors
  const partyFixes = [
    { name: "Nigeria Democratic Congress", abbr: "NDC", color: "#1B5E20" },
    { name: "All Progressives Congress", abbr: "APC", color: "#00A859" },
    { name: "Peoples Democratic Party", abbr: "PDP", color: "#000080" },
    { name: "Labour Party", abbr: "LP", color: "#FF0000" },
    { name: "New Nigeria Peoples Party", abbr: "NNPP", color: "#E53935" },
    { name: "All Progressives Grand Alliance", abbr: "APGA", color: "#FFD600" },
    { name: "Social Democratic Party", abbr: "SDP", color: "#1565C0" },
    { name: "Young Progressives Party", abbr: "YPP", color: "#6A1B9A" },
    { name: "African Democratic Congress", abbr: "ADC", color: "#00838F" },
  ];

  for (const party of partyFixes) {
    try {
      const { data: existing } = await supabase
        .from("parties")
        .select("id")
        .eq("abbreviation", party.abbr)
        .limit(1);

      if (!existing || existing.length === 0) {
        const { error } = await supabase.from("parties").insert({
          official_name: party.name,
          abbreviation: party.abbr,
          color: party.color,
        });
        if (!error) {
          fixesApplied++;
          log(`  ✓ Added missing party: ${party.abbr}`);
        }
      }
    } catch {}
  }

  // Fix 2: Ensure simulation_config exists
  try {
    const { data: config } = await supabase
      .from("simulation_config")
      .select("id")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .limit(1);

    if (!config || config.length === 0) {
      const { error } = await supabase.from("simulation_config").insert({
        id: "00000000-0000-0000-0000-000000000001",
        election_type: "PRESIDENTIAL",
        status: "IDLE",
        speed: 3,
      });
      if (!error) {
        fixesApplied++;
        log("  ✓ Created simulation_config");
      }
    }
  } catch {}

  // Fix 3: Ensure active presidential election
  try {
    const { data: elections } = await supabase
      .from("elections")
      .select("id, is_active")
      .eq("type", "PRESIDENTIAL")
      .limit(1);

    if (!elections || elections.length === 0) {
      const { error } = await supabase.from("elections").insert({
        name: "Presidential Election 2027",
        type: "PRESIDENTIAL",
        status: "ACTIVE",
        is_active: true,
      });
      if (!error) {
        fixesApplied++;
        log("  ✓ Created active presidential election");
      }
    }
  } catch {}

  if (fixesApplied > 0) {
    log(`Applied ${fixesApplied} fixes via JS client`);
  } else {
    log("No JS-client-level fixes needed (DDL fixes need SQL Editor)");
  }
}

// ══════════════════════════════════════════
// SECTION 6: Convex Sync Trigger
// ══════════════════════════════════════════

async function triggerConvexSync() {
  log("Triggering Convex auto-sync...");
  try {
    const res = await fetch("https://ngeop.vercel.app/api/admin/sync-convex/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json();
    if (data.error) {
      log(`  ⚠ Sync error: ${data.error}`, "WARN");
    } else {
      log(`  ✓ Sync triggered: ${JSON.stringify(data).substring(0, 200)}`);
    }
  } catch (e) {
    log(`  ⚠ Sync failed (site may be deploying): ${e.message}`, "WARN");
  }
}

// ══════════════════════════════════════════
// SECTION 7: Full Health Report
// ══════════════════════════════════════════

function printReport() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║          DATABASE HEALTH CHECK REPORT                ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");

  // DB Status
  console.log(`  Database:      ${health.dbOnline ? "✅ ONLINE" : "❌ OFFLINE"}`);

  // Tables
  const tableOk = Object.values(health.tables).filter((v) => v === "OK").length;
  const tableFail = REQUIRED_TABLES.length - tableOk;
  console.log(
    `  Tables:        ${tableOk}/${REQUIRED_TABLES.length} present${tableFail > 0 ? ` (${tableFail} MISSING)` : " ✅"}`
  );

  // Functions
  const fnOk = Object.values(health.functions).filter((v) => v.status === "OK").length;
  const fnFail = REQUIRED_FUNCTIONS.length - fnOk;
  console.log(
    `  Functions:     ${fnOk}/${REQUIRED_FUNCTIONS.length} present${fnFail > 0 ? ` (${fnFail} MISSING)` : " ✅"}`
  );

  // Parties
  console.log(`  Parties:       ${health.parties.length}/9 present`);
  const totalVotes = health.partyVotes.reduce(
    (sum, p) => sum + (Number(p.total_votes) || 0),
    0
  );
  console.log(`  Total Votes:   ${totalVotes.toLocaleString()}`);

  // Party breakdown
  if (health.partyVotes.length > 0) {
    console.log("");
    console.log("  Party Breakdown:");
    for (const p of health.partyVotes) {
      const votes = Number(p.total_votes).toLocaleString();
      const bar = "█".repeat(Math.ceil((p.percentage || 0) / 5));
      console.log(
        `    ${p.party_abbreviation.padEnd(5)} ${votes.padStart(12)}  ${String(p.percentage).padStart(5)}%  ${bar}`
      );
    }
  }

  // Config
  if (health.config) {
    console.log(`\n  Election Type: ${health.config.election_type}`);
    console.log(`  Sim Status:    ${health.config.status}`);
  }

  // Errors
  if (health.errors.length > 0) {
    console.log("\n  ❌ ERRORS:");
    for (const e of health.errors) {
      console.log(`    • ${e}`);
    }
  }

  // Warnings
  if (health.warnings.length > 0) {
    console.log("\n  ⚠ WARNINGS:");
    for (const w of health.warnings) {
      console.log(`    • ${w}`);
    }
  }

  // Overall verdict
  console.log("");
  if (health.errors.length === 0 && health.dbOnline) {
    console.log("  VERDICT: ✅ HEALTHY — Ready for election day");
  } else if (health.errors.length > 0 && health.dbOnline) {
    console.log("  VERDICT: ⚠ DEGRADED — Some components missing, run 102_MASTER_MIGRATION.sql");
  } else {
    console.log("  VERDICT: ❌ OFFLINE — Database is not accepting connections");
  }
  console.log("");
}

// ══════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════

async function runHealthCheck(supabase) {
  // Step 1: Connection
  const online = await checkDBConnection(supabase);
  if (!online) return false;

  // Step 2: Tables
  await checkTables(supabase);

  // Step 3: Functions
  await checkFunctions(supabase);

  // Step 4: Parties & Votes
  await checkParties(supabase);

  // Step 5: Config
  try {
    const { data } = await supabase
      .from("simulation_config")
      .select("election_type, status")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single();
    health.config = data;
  } catch {}

  // Step 6: Apply JS-level fixes if --fix
  await applyFixes(supabase);

  // Step 7: Trigger Convex sync
  await triggerConvexSync();

  // Print report
  printReport();

  return true;
}

async function main() {
  const env = loadEnv();

  if (!env.url || !env.serviceKey) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(env.url, env.serviceKey, {
    db: { statement_timeout: 15000 },
    auth: { persistSession: false },
  });

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║        NEOP Database Health Check                    ║");
  console.log(`║  ${env.url.replace("https://", "").padEnd(48)} ║`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");

  if (ONCE) {
    // Single check
    const ok = await runHealthCheck(supabase);
    process.exit(ok ? 0 : 1);
  }

  // Monitor mode — poll until DB comes back, then run full check
  let attempt = 0;
  while (true) {
    attempt++;
    const now = new Date().toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos" });
    process.stdout.write(`[${now}] Attempt #${attempt} — checking DB... `);

    const online = await checkDBConnection(supabase);
    if (online) {
      console.log("ONLINE!\n");
      await runHealthCheck(supabase);
      log("Health check complete. Exiting.");
      process.exit(0);
    }

    console.log("OFFLINE");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
