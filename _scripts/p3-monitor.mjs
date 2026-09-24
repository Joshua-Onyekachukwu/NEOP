/**
 * NEOP Phase 3 — simulation cadence monitor (durable).
 *
 * Polls sim_run_steps for a run and appends a cadence line every interval so
 * the steps/min rate survives session restarts. Detached-friendly: writes to
 * _logs/p3-run8-monitor.log and stdout.
 *
 * Usage: node _scripts/p3-monitor.mjs <run_id> [intervalSec] [maxMinutes]
 */
import { readFileSync, appendFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" };

const RUN = process.argv[2];
const INTERVAL = Number(process.argv[3] || 20) * 1000;
const MAX_MIN = Number(process.argv[4] || 30);
if (!RUN) {
  console.error("usage: node _scripts/p3-monitor.mjs <run_id> [intervalSec] [maxMinutes]");
  process.exit(1);
}
const LOG = new URL("../_logs/p3-run8-monitor.log", import.meta.url);
const say = (s) => {
  console.log(s);
  appendFileSync(LOG, s + "\n");
};

const j = async (url) => {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

const t0 = Date.now();
let lastDone = 0;
let lastT = t0;
say(`=== monitor start run=${RUN} interval=${INTERVAL / 1000}s ===`);

for (let i = 0; i < (MAX_MIN * 60 * 1000) / INTERVAL; i++) {
  try {
    const [run] = await j(`${SB}/rest/v1/simulation_runs?id=eq.${RUN}&select=status,total_pus,published_pus,dispute_pus,total_votes,started_at,completed_at`);
    const steps = await j(`${SB}/rest/v1/sim_run_steps?run_id=eq.${RUN}&select=seq,kind,status`);
    const done = steps.filter((s) => s.status === "DONE" || s.status === "COMPLETED").length;
    const failed = steps.filter((s) => s.status === "FAILED").length;
    const running = steps.filter((s) => s.status === "RUNNING").length;
    const pending = steps.filter((s) => s.status === "PENDING").length;
    const now = Date.now();
    const rate = ((done - lastDone) / ((now - lastT) / 60000)).toFixed(1);
    lastDone = done;
    lastT = now;
    const elapsedMin = ((now - t0) / 60000).toFixed(1);
    say(
      `[+${elapsedMin}m] status=${run?.status} steps=${done}/${steps.length} ` +
      `pend=${pending} run=${running} fail=${failed} rate=${rate}/min ` +
      `published_pus=${run?.published_pus ?? 0} disputes=${run?.dispute_pus ?? 0} votes=${run?.total_votes ?? 0}`
    );
    if (run?.status === "PUBLISHED" || run?.status === "COMPLETED") {
      const wall = run.started_at && run.completed_at
        ? ((new Date(run.completed_at) - new Date(run.started_at)) / 60000).toFixed(1)
        : "?";
      say(`=== RUN ENDED status=${run.status} wall=${wall}min steps=${steps.length} ===`);
      break;
    }
  } catch (e) {
    say(`[+${((Date.now() - t0) / 60000).toFixed(1)}m] poll error: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, INTERVAL));
}
say("=== monitor exit ===");
