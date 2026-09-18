import { SupabaseClient } from "@supabase/supabase-js";

/**
 * DB-checkpointed simulation engine executor.
 *
 * Each call claims PENDING steps of the active run from sim_run_steps
 * (SKIP LOCKED — safe under concurrency), executes them, and marks them
 * DONE/FAILED. Every step is idempotent and durably recorded, so a run
 * survives Vercel cold starts: whoever calls next (cron every minute,
 * the dashboard poller, or the launch pumper) simply continues from
 * the queue.
 */

const DATA_CHUNKS = 24;
const LEDGER_CHUNKS = 6;
const LEDGER_CHUNK_SIZE = 30_000;

export interface TickResult {
  processed: number;
  remaining: number;
  run_finished: boolean;
  last_error?: string;
}

interface StepRow {
  id: number;
  run_id: string;
  seq: number;
  kind: "LEDGER" | "INIT" | "WAVE" | "CLEANUP";
  wave_index: number | null;
  chunk_index: number | null;
  chunk_count: number | null;
  coverage_pct: number | null;
}

export async function executeTickSteps(
  supabase: SupabaseClient,
  opts: { runId?: string | null; maxSteps?: number; budgetMs?: number } = {}
): Promise<TickResult> {
  const maxSteps = opts.maxSteps ?? 30;
  const budgetMs = opts.budgetMs ?? 45_000;
  const started = Date.now();

  let processed = 0;
  let remaining = -1;
  let runFinished = false;
  let lastError: string | undefined;

  // Reclaim steps whose executor died mid-flight (cold start, crash)
  try {
    await supabase.rpc("reclaim_stale_steps", { p_older_than_seconds: 180 });
  } catch {}

  // Retryable failures: a FAILED step (e.g. transient FK/gateway error)
  // returns to PENDING unless it has exhausted its attempts. Steps are
  // idempotent, so a retry cannot double-publish.
  try {
    await supabase.rpc("retry_failed_steps", { p_max_attempts: 4 });
  } catch {}

  while (processed < maxSteps && Date.now() - started < budgetMs) {
    const { data: claimed, error: claimErr } = await supabase.rpc(
      "claim_simulation_step",
      opts.runId ? { p_run: opts.runId } : {}
    );

    if (claimErr) {
      lastError = `claim failed: ${claimErr.message}`;
      break;
    }

    const step = (Array.isArray(claimed) ? claimed[0] : claimed) as StepRow | null;

    // claim_simulation_step() returns an EMPTY COMPOSITE (every column NULL)
    // rather than SQL NULL when the queue is drained. Left unchecked that
    // phantom step failed with "unknown step kind: null", which broke the
    // pump loop and — worse — skipped finalization, leaving a finished run
    // marked RUNNING with its lock still held.
    if (!step || step.id == null || step.kind == null) {
      // Nothing pending. If the active run is out of work, finalize it.
      runFinished = await maybeFinalizeRun(supabase);
      break;
    }

    try {
      const result = await executeStep(supabase, step);
      await supabase.rpc("complete_simulation_step", {
        p_step_id: step.id,
        p_ok: true,
        p_result: result ?? {},
      });
      processed++;
    } catch (e: any) {
      lastError = `step #${step.seq} (${step.kind}) failed: ${e?.message || e}`;
      await supabase.rpc("complete_simulation_step", {
        p_step_id: step.id,
        p_ok: false,
        p_result: { error: lastError },
      });
      // A failed step shouldn't spin the loop — bail and let the next
      // tick (or a human) investigate.
      break;
    }

    const { count } = await supabase
      .from("sim_run_steps")
      .select("id", { count: "exact", head: true })
      .eq("run_id", step.run_id)
      .eq("status", "PENDING");
    remaining = Number(count ?? 0);
  }

  return { processed, remaining, run_finished: runFinished, last_error: lastError };
}

// ── Step dispatch ──────────────────────────────────────────────

async function executeStep(supabase: SupabaseClient, step: StepRow): Promise<any> {
  switch (step.kind) {
    case "CLEANUP":
      return executeCleanupStep(supabase, step);
    case "LEDGER":
      return executeLedgerStep(supabase, step);
    case "INIT":
      return { noop: true };
    case "WAVE":
      return executeWaveStep(supabase, step);
    default:
      throw new Error(`unknown step kind: ${step.kind}`);
  }
}

/**
 * First step of every run (migration 261): purge every previous run —
 * results, ledger, sim observer accounts, [SIM] elections — and reset
 * live data, so each launch starts from a clean baseline and the new
 * run's outcome becomes what the site renders. Runs inside the engine's
 * step budget (statement_timeout 600s), never inside the HTTP request.
 */
async function executeCleanupStep(supabase: SupabaseClient, step: StepRow): Promise<any> {
  const { data, error } = await supabase.rpc("sim_preflight_cleanup", {
    p_keep_run: step.run_id,
  });
  if (error) throw new Error(`cleanup: ${error.message}`);
  // Compaction is skipped on purpose: VACUUM FULL needs an exclusive lock
  // and its space return is unnecessary for the quota math (the guard
  // already projects the DELETEd size). Autovacuum reclaims the rest.
  return data ?? {};
}

async function executeLedgerStep(supabase: SupabaseClient, step: StepRow): Promise<any> {
  const chunks = step.chunk_count ?? LEDGER_CHUNKS;
  const { data, error } = await supabase.rpc("materialize_ledger_hash_chunk", {
    p_run: step.run_id,
    p_chunk: step.chunk_index ?? 0,
    p_chunks: chunks,
  });
  if (error) throw new Error(error.message);

  const inserted = Number(data ?? 0);

  // After the LAST ledger chunk, assign outcomes (scoped to coverage)
  if ((step.chunk_index ?? 0) === chunks - 1) {
    const { data: run } = await supabase
      .from("simulation_runs")
      .select("params, total_pus")
      .eq("id", step.run_id)
      .maybeSingle();
    const p: any = run?.params ?? {};
    const { count: ledgerRows } = await supabase
      .from("pu_simulation_status")
      .select("id", { count: "exact", head: true })
      .eq("run_id", step.run_id);

    await supabase
      .from("simulation_runs")
      .update({ total_pus: Number(ledgerRows ?? 0) })
      .eq("id", step.run_id);

    const { error: ocErr } = await supabase.rpc("assign_simulation_outcomes", {
      p_run: step.run_id,
      p_dispute_rate: p.dispute_rate ?? 0.05,
      p_failed_rate: p.failed_rate ?? 0.015,
      p_disrupted_rate: p.disrupted_rate ?? 0.02,
      p_unavailable_rate: p.unavailable_rate ?? 0.01,
      p_max_published_pct: p.max_published_pct ?? 0.95,
      p_coverage_pct: step.coverage_pct ?? p.coverage_pct ?? 50,
    });
    if (ocErr) throw new Error(`outcome assignment: ${ocErr.message}`);
  }

  return { inserted };
}

async function executeWaveStep(supabase: SupabaseClient, step: StepRow): Promise<any> {
  // Run params
  const { data: run } = await supabase
    .from("simulation_runs")
    .select("params, election_id")
    .eq("id", step.run_id)
    .maybeSingle();
  const p: any = run?.params ?? {};

  // Resolve the [SIM] election id. Wave 0 passes NULL so neop_sim_wave
  // resolves/mints the [SIM] election itself (guarded, reset-safe) — the
  // heartbeat in simulation_config can reference an election deleted by
  // reset_first, which previously caused FK violations. Later waves use
  // the run-bound election id recorded by the first wave-0 completion.
  let electionId: string | null = (run as any)?.election_id ?? null;
  if (!electionId && (step.wave_index ?? 0) > 0) {
    throw new Error("sim election not yet created (wave-0 pending)");
  }

  // Admin uuid for audit attribution
  let adminUuid: string | null = null;
  try {
    const { data: ua } = await supabase
      .from("user_accounts")
      .select("id")
      .ilike("email", "%admin%")
      .limit(1)
      .maybeSingle();
    adminUuid = (ua as any)?.id ?? null;
  } catch {}

  const { data, error } = await supabase.rpc("neop_sim_wave", {
    p_scenario: p.scenario ?? "landslide",
    p_total_voters: p.target_voters ?? 1_000_000,
    p_waves: p.waves ?? 6,
    p_wave_index: step.wave_index ?? 0,
    p_duration_seconds: 0,
    p_discrepancy_rate: p.discrepancy_rate ?? 0.05,
    p_admin_user_id: adminUuid,
    p_election_id: electionId,
    p_init_chunk: null,
    p_init_chunks: null,
    p_data_chunk: step.chunk_index ?? 0,
    p_data_chunks: step.chunk_count ?? DATA_CHUNKS,
    p_coverage_pct: step.coverage_pct ?? p.coverage_pct ?? 50,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;

  // First time we learn the sim election id: bind the run, point the
  // public site at the dataset, tick the ledger.
  if (row?.sim_election_id) {
    const eid = row.sim_election_id as string;
    if (!electionId) {
      await supabase
        .from("simulation_runs")
        .update({ election_id: eid })
        .eq("id", step.run_id);
    }
    const multiplier = Number(p.display_multiplier ?? 1);
    await supabase.from("system_config").upsert(
      {
        id: "00000000-0000-0000-0000-000000000001",
        data_mode: "SIMULATED",
        simulation_election_id: eid,
        active_election_id: eid,
        display_multiplier: multiplier > 0 ? multiplier : 1,
        last_updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    try {
      await supabase.rpc("sync_simulation_progress", { p_run: step.run_id });
    } catch {}
  }

  return row ?? {};
}

// ── Finalization ───────────────────────────────────────────────

async function maybeFinalizeRun(supabase: SupabaseClient): Promise<boolean> {
  const { data: run } = await supabase
    .from("simulation_runs")
    .select("id, status")
    .eq("status", "RUNNING")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!run) return false;

  const { count: pending } = await supabase
    .from("sim_run_steps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id)
    .in("status", ["PENDING", "RUNNING"]);

  if (Number(pending ?? 0) > 0) return false; // work remains (or in flight)

  // All steps done: promote remaining planned PUs, then finalize the
  // ledger (out-of-scope PUs -> UNAVAILABLE) and release the lock.
  try {
    await supabase.rpc("sync_simulation_progress", { p_run: run.id });
  } catch {}
  try {
    await supabase.rpc("stop_simulation_run");
  } catch {}
  try {
    await supabase
      .from("simulation_config")
      .update({ status: "COMPLETED", last_tick_at: new Date().toISOString() })
      .eq("id", "00000000-0000-0000-0000-000000000001");
  } catch {}

  // Cancel any stragglers for cleanliness
  await supabase
    .from("sim_run_steps")
    .update({ status: "FAILED", finished_at: new Date().toISOString() })
    .eq("run_id", run.id)
    .in("status", ["PENDING", "RUNNING"]);

  return true;
}

export { LEDGER_CHUNKS, LEDGER_CHUNK_SIZE, DATA_CHUNKS };
