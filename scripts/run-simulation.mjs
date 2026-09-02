#!/usr/bin/env node

/**
 * Run Upgraded Simulation — 20M voters with PU disruption modeling
 *
 * Usage: node ../../scripts/run-simulation.mjs [scenario] [voters]
 * Example: node ../../scripts/run-simulation.mjs landslide 20000000
 *
 * Or run directly in Supabase SQL Editor:
 *   SELECT run_sim_upgraded('landslide', 20000000);
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const paths = [resolve(__dirname, "../apps/web/.env.local"), resolve(process.cwd(), ".env.local")];
  for (const p of paths) {
    if (existsSync(p)) {
      for (const line of readFileSync(p, "utf-8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#") || !t.includes("=")) continue;
        const [k, ...v] = t.split("=");
        if (!process.env[k.trim()]) process.env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, "");
      }
      return;
    }
  }
}

loadEnv();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing env vars"); process.exit(1); }

const scenario = process.argv[2] || "landslide";
const voters = parseInt(process.argv[3] || "20000000", 10);

async function rpc(fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} (${r.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  console.log(`Simulation: scenario=${scenario}, voters=${(voters / 1e6).toFixed(0)}M\n`);
  const t = Date.now();

  const result = await rpc("run_sim_upgraded", { p_scenario: scenario, p_total_voters: voters });

  console.log(`Done in ${((Date.now() - t) / 1000).toFixed(1)}s\n`);
  console.log(`  Total PUs: ${result.total_pus?.toLocaleString()}`);
  console.log(`  Active PUs: ${result.active_pus?.toLocaleString()}`);
  console.log(`  Disrupted PUs: ${result.disrupted_pus?.toLocaleString()} (banditry/security)`);
  console.log(`  Results created: ${result.results_created?.toLocaleString()}`);
  console.log(`  Total votes: ${(result.total_votes / 1e6).toFixed(1)}M`);
  console.log(`  Avg turnout: ${result.avg_turnout}`);
}

main().catch((err) => { console.error("Failed:", err.message); process.exit(1); });
