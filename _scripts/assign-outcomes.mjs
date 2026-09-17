// Directly call assign_simulation_outcomes for a run and report the
// result plus wall-clock duration. Used to isolate the outcome-assignment
// step when the queue's LEDGER step fails on statement timeouts.
//
// Usage: node _scripts/assign-outcomes.mjs <run_id> [coverage_pct]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);

const runId = process.argv[2];
const coverage = Number(process.argv[3] || 100);
if (!runId) {
  console.error("usage: node _scripts/assign-outcomes.mjs <run_id> [coverage_pct]");
  process.exit(1);
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const t0 = Date.now();
const { data, error } = await supabase.rpc("assign_simulation_outcomes", {
  p_run: runId,
  p_dispute_rate: 0.05,
  p_failed_rate: 0.015,
  p_disrupted_rate: 0.02,
  p_unavailable_rate: 0.01,
  p_max_published_pct: 0.78,
  p_coverage_pct: coverage,
});
console.log(
  JSON.stringify({ seconds: ((Date.now() - t0) / 1000).toFixed(1), data, error: error?.message ?? null })
);
