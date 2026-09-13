/**
 * POST /api/admin/simulate/trigger-v2
 *
 * Batch PIPELINE simulation (migrations 230/232 — chunked waves).
 * Unlike the legacy run_sim_upgraded() (which wrote result_submissions
 * only and never rendered), this drives the REAL pipeline set-based
 * inside Postgres:
 *
 *   reset live data (optional, default ON)
 *     -> [wave 0] [SIM] election + sim agents + 2 assignments/PU
 *     -> per wave: submissions (2 agents/PU) -> trg_rs_timeline pairing
 *        -> deterministic comparison -> MATCH rows published through the
 *        REAL publish_canonical_result RPC -> DISCREPANCY -> HUMAN_REVIEW
 *     -> system_config.data_mode = SIMULATED (+ active/sim election)
 *
 * Because published rows land in canonical_pu_results /
 * canonical_party_results, the public site renders the run through the
 * exact same projection used on election day.
 *
 * Body: {
 *   scenario?: "landslide" | "sweep" | "close" | "random"   (default landslide)
 *   target_voters?: number                                  (default 20,000,000)
 *   duration_minutes?: number  0 = flat out                 (default 5)
 *   waves?: number            1-12                          (default 6)
 *   discrepancy_rate?: number 0-1                           (default 0.05)
 *   coverage_pct?: number     1-100    % of PUs in scope     (default 50;
 *                             turnout per covered PU scales up so total
 *                             votes still hit target_voters)
 *   reset_first?: boolean                                   (default true)
 * }
 *
 * Returns 202 immediately; the wave loop continues in the background and
 * heartbeats progress into simulation_config (visible via
 * GET /api/admin/simulate/progress). Every wave commits progressively,
 * so an interrupted run keeps everything completed so far.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";
import { createClient } from "@supabase/supabase-js";
import { invalidateAllCaches } from "@/lib/api-cache";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SCENARIOS = ["landslide", "sweep", "close"] as const;
const SYSTEM_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

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

    const target_voters = Math.max(
      1_000_000,
      Math.min(200_000_000, Number(body.target_voters) || 20_000_000)
    );
    // The sim stores REAL vote counts (kept small so the Free-plan DB
    // quota is never hit); display_voters is what the public site renders
    // (e.g. 50M for a 5M backend sim) — applied ONLY in SIMULATED mode
    // via system_config.display_multiplier. Live elections never scale.
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
    // not voters — the hosted DB disk quota failed at 100%/20M, so default
    // to 50% with per-PU turnout scaled up to keep 20M+ votes on target.
    const coverage_pct = Math.max(1, Math.min(100, Number(body.coverage_pct ?? 50)));
    const reset_first = body.reset_first !== false;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // verifications.decided_by / audit context expect a user_accounts.id
    // (admin_users.id is a different keyspace — J.5 lesson from Sep 13).
    let adminUuid: string | null = null;
    try {
      const { data: uaRow } = await supabase
        .from("user_accounts")
        .select("id")
        .eq("email", auth.admin_user.email)
        .maybeSingle();
      adminUuid = (uaRow as any)?.id ?? null;
    } catch {}

    let resetResult: any = null;
    if (reset_first) {
      const { data, error } = await supabase.rpc("neop_reset_live_data");
      if (error) {
        return NextResponse.json(
          { error: `Reset failed: ${error.message}` },
          { status: 500 }
        );
      }
      resetResult = data;
    }

    const perWave: any[] = [];
    let simElectionId: string | null = null;
    let pointerWritten = false;

    // The hosted PostgREST gateway kills multi-minute RPC calls with
    // "upstream request timeout", so every wave is chunked into many
    // short calls (migration 232/237), each committing progressively:
    //   24 chunks/wave (~7.4k PUs each: agents + submissions -> pairing -> publish)
    //   wave 0 additionally mints the [SIM] election and its agents per chunk
    const DATA_CHUNKS = 24;

    // Chunk calls are idempotent (ON CONFLICT / status guards / chunk hash
    // filters). A call that times out at the gateway KEEPS RUNNING server-
    // side (function statement_timeout), so retries must wait out that
    // window or they block on the dead call's uncommitted rows.
    const callRpc = async (args: Record<string, unknown>, label: string) => {
      for (let attempt = 1; ; attempt++) {
        const { data, error } = await supabase.rpc("neop_sim_wave", args);
        if (!error) return Array.isArray(data) ? data[0] : data;
        if (attempt >= 4) throw new Error(`${label} failed: ${error.message}`);
        // A timed-out wave-0 call may have already committed server-side,
        // creating the [SIM] election. Re-read the heartbeat before retrying
        // and adopt that election — otherwise the retry would create a
        // second one and split the run across two elections.
        if (!args.p_election_id) {
          try {
            const { data: cfg } = await supabase
              .from("simulation_config")
              .select("scenario")
              .eq("id", SYSTEM_CONFIG_ID)
              .maybeSingle();
            const eid = cfg?.scenario
              ? (JSON.parse(cfg.scenario)?.sim_election_id ?? null)
              : null;
            if (eid) {
              args.p_election_id = eid;
              simElectionId = eid;
            }
          } catch {}
        }
        const backoff = attempt === 1 ? 30000 : attempt === 2 ? 45000 : 60000;
        console.warn(`[trigger-v2] ${label} attempt ${attempt} failed (${error.message}); retrying in ${backoff / 1000}s`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    };

    // Chunked loop runs in the background (progressive commits; the route
    // returns 202 immediately). sim status is RUNNING while looping and
    // flips to COMPLETED/FAILED at the end — the dashboard polls /progress.
    // Wave 0 self-initializes: the RPC creates the [SIM] election and mints
    // the sim agents for each wave-0 chunk's PUs (at coverage_pct).
    (async () => {
      try {
        const startMs = Date.now();

        // Data waves, paced route-side to the configured duration
        for (let w = 0; w < waves; w++) {
          for (let c = 0; c < DATA_CHUNKS; c++) {
            const row: any = await callRpc(
              {
                p_scenario: scenario,
                p_total_voters: target_voters,
                p_waves: waves,
                p_wave_index: w,
                p_discrepancy_rate: discrepancy_rate,
                p_admin_user_id: adminUuid,
                p_election_id: simElectionId,
              p_data_chunk: c,
              p_data_chunks: DATA_CHUNKS,
              p_coverage_pct: coverage_pct,
            },
            `Wave ${w} chunk ${c}`
            );
            if (row?.sim_election_id) simElectionId = row.sim_election_id;
            // Point the public site at the simulated dataset as soon as the
            // election exists, so the banner/stats render during the run
            // (previously written only at completion — and via .update(),
            // which no-oped because no system_config row existed).
            if (simElectionId && !pointerWritten) {
              pointerWritten = true;
              try {
                await supabase
                  .from("system_config")
                  .upsert(
                    {
                      id: SYSTEM_CONFIG_ID,
                      data_mode: "SIMULATED",
                      simulation_election_id: simElectionId,
                      active_election_id: simElectionId,
                      display_multiplier,
                      last_updated_at: new Date().toISOString(),
                    },
                    { onConflict: "id" }
                  );
                invalidateAllCaches();
              } catch {}
            }
            perWave.push(row);
          }
          if (duration_seconds > 0 && w < waves - 1) {
            const targetMs = ((w + 1) * duration_seconds * 1000) / waves;
            const waitMs = targetMs - (Date.now() - startMs);
            if (waitMs > 0) {
              await new Promise((r) => setTimeout(r, Math.min(waitMs, 120_000)));
            }
          }
        }

        // Point the public site at the simulated dataset (upsert: the row
        // may not exist if the launch-time write was skipped)
        await supabase
          .from("system_config")
          .upsert(
            {
              id: SYSTEM_CONFIG_ID,
              data_mode: "SIMULATED",
              simulation_election_id: simElectionId,
              active_election_id: simElectionId,
              display_multiplier,
              last_updated_at: new Date().toISOString(),
            },
            { onConflict: "id" }
          );

        await supabase
          .from("simulation_config")
          .update({ status: "COMPLETED", last_tick_at: new Date().toISOString() })
          .eq("id", SYSTEM_CONFIG_ID);

        // Record the run for the dashboard Simulation History panel
        try {
          const last: any = perWave[perWave.length - 1] || {};
          await supabase.from("simulation_history").insert({
            scenario,
            election_type: "PRESIDENTIAL",
            status: "COMPLETED",
            total_polling_units: 176846,
            results_created:
              perWave.reduce((s, w: any) => s + (w?.published_this_wave || 0), 0) || null,
            party_results_created:
              perWave.reduce((s, w: any) => s + (w?.party_rows_published || 0), 0) || null,
            total_votes: last?.votes_cumulative || null,
            duration_seconds: Math.round((Date.now() - startMs) / 1000) || null,
            ndc_wins: true,
            started_at: new Date(Date.now() - (last?.seconds || 0) * 1000).toISOString(),
            completed_at: new Date().toISOString(),
          });
        } catch {}

        invalidateAllCaches();
        console.log(
          `[trigger-v2] Simulation complete: election=${simElectionId} scenario=${scenario} waves=${waves}`
        );
      } catch (e: any) {
        console.error("[trigger-v2] Wave loop failed:", e?.message);
        try {
          await supabase
            .from("simulation_config")
            .update({ status: "FAILED", last_tick_at: new Date().toISOString() })
            .eq("id", SYSTEM_CONFIG_ID);
        } catch {}
      }
    })();

    return NextResponse.json(
      {
        success: true,
        message:
          `Pipeline simulation started: ${waves} waves × ` +
          `${(target_voters / 1e6).toFixed(0)}M voters` +
          (duration_seconds > 0 ? ` over ~${duration_minutes} min` : " (flat out)"),
        engine: "pipeline_batch",
        scenario,
        target_voters,
        duration_minutes,
        waves,
        discrepancy_rate,
        coverage_pct,
        reset: resetResult,
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
