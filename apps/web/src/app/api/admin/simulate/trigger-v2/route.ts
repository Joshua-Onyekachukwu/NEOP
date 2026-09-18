/**
 * POST /api/admin/simulate/trigger-v2
 *
 * Launches a pipeline simulation through the DB-CHECKPOINTED engine
 * (migration 251). The entire pipeline — ledger materialization,
 * outcome assignment, wave data chunks — is enqueued as idempotent
 * steps in sim_run_steps. The route returns 202 immediately; steps are
 * executed by whichever pump ticks next:
 *
 *   • this request's fire-and-forget pumper,
 *   • the admin dashboard poller (/api/admin/simulate/tick), or
 *   • Vercel Cron hitting /api/admin/simulate/tick every minute
 *     (production runs progress across serverless cold starts).
 *
 * Because the queue state lives in Postgres, a run survives any number
 * of function restarts — no more "run stuck at 0 published" on prod.
 *
 * Body: {
 *   scenario?: "landslide" | "sweep" | "close" | "random"   (default landslide)
 *   target_voters?: number     real votes stored in the DB   (min 100k, default 1M)
 *   display_voters?: number    votes the public site renders (>= target_voters)
 *   duration_minutes?: number  0 = flat out                  (0-30, default 5)
 *   waves?: number             1-12                          (default 6)
 *   discrepancy_rate?: number  0-1                           (default 0.05)
 *   coverage_pct?: number      1-100    % of PUs in scope    (default 50)
 *   reset_first?: boolean      accepted for compatibility; the reset ALWAYS
 *                              runs as the queue's first CLEANUP step, so
 *                              every launch starts from a clean baseline
 * }
 *
 * Pre-flight (migration 261): the launch is REFUSED (400) when the
 * projected peak database size exceeds the Free-plan envelope. Storage
 * scales with coverage_pct, not with voters.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";
import { createClient } from "@supabase/supabase-js";
import { invalidateAllCaches } from "@/lib/api-cache";
import { LEDGER_CHUNKS } from "@/lib/sim-engine";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SCENARIOS = ["landslide", "sweep", "close"] as const;
const SYSTEM_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

// Configurable outcome profile (migration 245): every PU in the universe
// gets a ledger row and an explicit fate. Failure modes are
// admin-configurable per launch; nothing is hard-coded in the UI.
const OUTCOME_DEFAULTS = {
  dispute_rate: 0.05,       // agents disagree -> HUMAN_REVIEW (admin queue)
  failed_rate: 0.015,       // fails verification -> NOT countable
  disrupted_rate: 0.02,     // zero votes recorded
  unavailable_rate: 0.01,   // never reached / no data
  max_published_pct: 0.95,  // ceiling of PUs that can successfully publish
};

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;

    const body = await request.json().catch(() => ({}));

    let scenario: string = body.scenario || "landslide";
    if (scenario === "random") {
      scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    }
    if (!SCENARIOS.includes(scenario as any)) {
      return NextResponse.json({ error: `Unknown scenario: ${scenario}` }, { status: 400 });
    }

    // Real votes kept small so the Free-plan DB quota is never hit;
    // display_voters is what the public site renders (SIMULATED mode
    // only, via system_config.display_multiplier). Live elections
    // never scale.
    const target_voters = Math.max(
      100_000,
      Math.min(200_000_000, Number(body.target_voters) || 1_000_000)
    );
    const display_voters = Math.max(
      target_voters,
      Math.min(5_000_000_000, Number(body.display_voters) || target_voters)
    );
    const display_multiplier = Math.max(1, Math.round((display_voters / target_voters) * 10) / 10);
    const duration_minutes = Math.max(0, Math.min(30, Number(body.duration_minutes ?? 5)));
    const duration_seconds = Math.round(duration_minutes * 60);
    const waves = Math.max(1, Math.min(12, Number(body.waves) || 6));
    const discrepancy_rate = Math.max(0, Math.min(1, Number(body.discrepancy_rate ?? 0.05)));
    // Coverage % of polling units in scope. Disk/row cost tracks coverage,
    // not voters — coverage is the knob for staying under disk quotas.
    const coverage_pct = Math.max(1, Math.min(100, Number(body.coverage_pct ?? 50)));
    const reset_first = body.reset_first !== false;

    // Optional per-launch outcome profile overrides (§4: configurable,
    // not hard-coded). dispute_rate is BOUND to discrepancy_rate — the
    // ledger's HUMAN_REVIEW pick mirrors the engine's deterministic hash.
    const outcomes = {
      dispute_rate: discrepancy_rate,
      failed_rate: Math.max(0, Math.min(1, Number(body.failed_rate ?? OUTCOME_DEFAULTS.failed_rate))),
      disrupted_rate: Math.max(0, Math.min(1, Number(body.disrupted_rate ?? OUTCOME_DEFAULTS.disrupted_rate))),
      unavailable_rate: Math.max(0, Math.min(1, Number(body.unavailable_rate ?? OUTCOME_DEFAULTS.unavailable_rate))),
      max_published_pct: Math.max(0, Math.min(1, Number(body.max_published_pct ?? OUTCOME_DEFAULTS.max_published_pct))),
    };

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Pre-flight quota guard ──────────────────────────────────
    // Storage cost tracks COVERAGE (published PUs × ~6.2 KB + the full
    // ledger), not voters — target/display voters are never materialised.
    // Refuse before any state is touched when the projection exceeds the
    // Free-plan envelope (850 MB ceiling, 120 MB safety margin).
    //
    // Since migration 262 the currently published dataset is RETAINED for the
    // whole run (that is what keeps the live site populated while a new batch
    // runs), so its footprint is added to the projection. This is the honest
    // cost of persistence: a smaller maximum coverage per batch, never a
    // blanked demo. Absent until 262 is applied — treated as 0.
    const { data: quota, error: quotaErr } = await supabase
      .rpc("simulation_quota_check", { p_coverage_pct: coverage_pct });

    let retainedBytes = 0;
    try {
      const { data: retained, error: retainedErr } = await supabase.rpc(
        "simulation_retained_bytes"
      );
      if (!retainedErr) retainedBytes = Number(retained ?? 0) || 0;
    } catch {
      /* migration 262 not applied yet */
    }

    if (quotaErr) {
      console.warn("[trigger-v2] quota check unavailable, continuing:", quotaErr.message);
    } else if (quota) {
      const projectedPeak = Number(quota.projected_peak_bytes ?? 0) + retainedBytes;

      if (!quota.ok || projectedPeak > Number(quota.quota_bytes ?? 0)) {
        const gb = (n: number) => (n / 1e9).toFixed(2) + " GB";
        const retainedNote =
          retainedBytes > 0
            ? ` Of that, ${gb(retainedBytes)} is the simulation currently published on the live ` +
              `site, which is kept intact for the whole run so the demo never goes blank. `
            : " ";
        return NextResponse.json(
          {
            error:
              `Coverage ${coverage_pct}% would push the database to ~${gb(projectedPeak)} — ` +
              `over the plan ceiling (${gb(quota.quota_bytes)}).${retainedNote}` +
              `The launch was refused BEFORE any data was changed. Re-run with coverage ≤ ` +
              `${quota.recommended_max_coverage_pct}% ` +
              `(projected published PUs: ${(quota.projected_published_pus || 0).toLocaleString()}). ` +
              `Display figures do not depend on coverage — raise display_voters instead if you ` +
              `want bigger on-screen numbers.`,
            quota: { ...quota, retained_bytes: retainedBytes, projected_peak_with_retained: projectedPeak },
          },
          { status: 400 }
        );
      }
    }

    // ── Full-coverage lifecycle (migration 245 + 261) ──────────────
    // 1. stop any stale run (cheap, releases the single-active lock)
    // 2. start_simulation_run: acquires the lock and hands back a run id
    // 3. enqueue: the FIRST queued step (CLEANUP) purges every previous
    //    run — results, ledger, sim observer accounts, [SIM] elections —
    //    and resets live data, all inside the engine's 10-minute step
    //    budget instead of this HTTP request. The browser gets its 202
    //    in milliseconds; the previous run's outcome is cleared out and
    //    the new run's numbers become what the live site renders.
    try {
      await supabase.rpc("stop_simulation_run");
    } catch {}

    const { data: runIdData, error: runErr } = await supabase.rpc("start_simulation_run", {
      p_label: `Pipeline ${new Date().toISOString().slice(5, 16).replace("T", " ")} ${scenario}`,
      p_scenario: scenario,
    });
    if (runErr || !runIdData) {
      return NextResponse.json(
        { error: `Could not start simulation run: ${runErr?.message || "no run id"}` },
        { status: 409 }
      );
    }
    const runId = String(runIdData);

    // ── Enqueue the entire pipeline as durable, idempotent steps ──
    const { error: enqErr } = await supabase.rpc("enqueue_simulation_run", {
      p_run: runId,
      p_scenario: scenario,
      p_target_voters: target_voters,
      p_waves: waves,
      p_discrepancy_rate: discrepancy_rate,
      p_coverage_pct: coverage_pct,
      p_ledger_chunks: LEDGER_CHUNKS,
    });
    if (enqErr) {
      await supabase.rpc("stop_simulation_run");
      return NextResponse.json(
        { error: `Could not enqueue run steps: ${enqErr.message}` },
        { status: 500 }
      );
    }

    // Persist engine params (incl. display multiplier) for the executor
    try {
      await supabase
        .from("simulation_runs")
        .update({
          display_multiplier,
          params: {
            scenario,
            target_voters,
            waves,
            discrepancy_rate,
            coverage_pct,
            display_multiplier,
            duration_seconds,
            ...outcomes,
          } as any,
        })
        .eq("id", runId);
    } catch {}

    invalidateAllCaches();

    // Fire-and-forget pumper: executes queued steps until the platform
    // reclaims this function. Cron / dashboard polling continue the run.
    (async () => {
      try {
        const { executeTickSteps } = await import("@/lib/sim-engine");
        const r = await executeTickSteps(supabase, {
          runId,
          maxSteps: 60,
          budgetMs: 50_000,
        });
        console.log(`[trigger-v2] launch pumper: ${r.processed} steps, ${r.remaining} left`);
      } catch (e: any) {
        console.warn("[trigger-v2] launch pumper ended:", e?.message);
      }
    })();

    return NextResponse.json(
      {
        success: true,
        message:
          `Simulation queued: ${waves} waves × ` +
          `${(target_voters / 1e6).toFixed(1)}M voters ×${display_multiplier} display` +
          (duration_seconds > 0 ? ` over ~${duration_minutes} min` : " (flat out)"),
        engine: "checkpoint_queue",
        scenario,
        target_voters,
        display_multiplier,
        duration_minutes,
        waves,
        discrepancy_rate,
        coverage_pct,
        run_id: runId,
        outcomes,
        cleanup:
          "queued as first step — reclaims superseded batches only; the dataset " +
          "currently published on the live site is retained until this run publishes",
        reset: { queued: true, mode: "CLEANUP step (migrations 261+262)" },
      },
      { status: 202 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to start simulation" },
      { status: 500 }
    );
  }
}
