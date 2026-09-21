import { SupabaseClient } from "@supabase/supabase-js";
// Public-data caches are per-lambda unstable_cache entries; a run that
// publishes without invalidating them leaves warm instances serving the
// previous dataset well past the config cache's 300s TTL.
import { invalidateAllCaches } from "@/lib/api-cache";

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
    // 600s = 10 min — wave RPCs can legitimately take several minutes
    // under load; 180s caused a death spiral of concurrent re-executions.
    await supabase.rpc("reclaim_stale_steps", { p_older_than_seconds: 600 });
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
 * First step of every run: reclaim the storage of superseded batches —
 * results, ledger, sim observer accounts, [SIM] elections — while KEEPING the
 * dataset currently published on the live site (migration 262). Runs inside
 * the engine's step budget (statement_timeout 600s), never inside the HTTP
 * request, so the browser is never blocked on a multi-minute purge.
 *
 * It no longer clears the live site on launch: the previous successful
 * simulation keeps rendering until the new batch completes and publishes.
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

    // Outcome-profile fallbacks. These decide what the public headline
    // reads: "verified" is published / (published + disputed + disrupted),
    // so the defaults have to leave almost everything publishable. The old
    // 0.05/0.015/0.02/0.95 defaults produced an 83% verified headline on a
    // fully successful run, which reads as a broken pipeline rather than a
    // finished one. 0.01/0.005/0.005/1.0 lands the headline at ~98.5% while
    // still exercising both failure paths (disputes + interruptions).
    const { error: ocErr } = await supabase.rpc("assign_simulation_outcomes", {
      p_run: step.run_id,
      p_dispute_rate: p.dispute_rate ?? 0.01,
      p_failed_rate: p.failed_rate ?? 0.005,
      p_disrupted_rate: p.disrupted_rate ?? 0.005,
      p_unavailable_rate: p.unavailable_rate ?? 0.01,
      p_max_published_pct: p.max_published_pct ?? 1.0,
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

  // First time we learn the sim election id: bind the run to it and tick the
  // ledger. Nothing public is touched here (migration 262).
  //
  // This used to also point system_config.active_election_id at the new
  // election on the first wave — which blanked the live site the moment an
  // admin pressed Run, because the new dataset is empty at that point and
  // stayed empty if the batch later failed. The public dataset now switches
  // atomically in publish_simulation_run(), and only on success.
  if (row?.sim_election_id) {
    const eid = row.sim_election_id as string;
    if (!electionId) {
      await supabase
        .from("simulation_runs")
        .update({ election_id: eid })
        .eq("id", step.run_id);
    }
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
  // Publish-on-success (migration 262). Only a batch that actually produced
  // canonical results becomes what the public site renders; the RPC refuses
  // to switch on an empty dataset, so a failed batch can never blank the
  // demo. The previously published dataset stays live if this does nothing.
  try {
    const { data: pub, error: pubErr } = await supabase.rpc("publish_simulation_run", {
      p_run: run.id,
    });
    if (pubErr) {
      console.warn(`[sim-engine] publish failed: ${pubErr.message}`);
    } else if (pub && (pub as any).published === false) {
      console.warn(`[sim-engine] run kept unpublished: ${(pub as any).reason}`);
    } else {
      console.log(
        `[sim-engine] published run ${run.id} — ` +
          `${(pub as any)?.canonical_rows ?? "?"} canonical rows, ` +
          `${(pub as any)?.superseded_purged ?? 0} superseded run(s) reclaimed`
      );
    }
  } catch (e: any) {
    // publish_simulation_run() missing (migration 262 not applied yet). Fall
    // back to the legacy pointer switch so a completed batch is still
    // visible — this keeps the code safe to deploy in either order, instead
    // of a build that silently never publishes anything.
    console.warn(
      `[sim-engine] publish RPC unavailable (${e?.message}) — using the legacy pointer switch`
    );
    await legacyPublish(supabase, run.id);
  }

  // The switch is atomic in the DB, but warm serverless instances hold
  // per-process unstable_cache entries (stats 30s, config 300s). Without an
  // invalidation here, the live site can serve the previous dataset for many
  // minutes after a publish — and stale "RUNNING" coverage mid-switch.
  try {
    invalidateAllCaches();
  } catch {}

  // run_finished means finalize executed (regardless of publish outcome).
  return true;
}

/**
 * Pre-262 behaviour: point the public site straight at the run's election.
 * Used only when publish_simulation_run() does not exist, so a deploy can
 * never outrun its migration.
 */
async function legacyPublish(supabase: SupabaseClient, runId: string): Promise<boolean> {
  const { data: run } = await supabase
    .from("simulation_runs")
    .select("election_id, params")
    .eq("id", runId)
    .maybeSingle();

  const eid = (run as any)?.election_id as string | undefined;
  if (!eid) return false;

  const multiplier = Number((run as any)?.params?.display_multiplier ?? 1);
  try {
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
    return true;
  } catch (e: any) {
    console.warn(`[sim-engine] legacy publish failed: ${e?.message}`);
    return false;
  }
}

export { LEDGER_CHUNKS, LEDGER_CHUNK_SIZE, DATA_CHUNKS };
