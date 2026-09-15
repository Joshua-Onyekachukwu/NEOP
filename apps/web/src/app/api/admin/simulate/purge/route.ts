/**
 * POST /api/admin/simulate/purge
 *
 * Admin: explicitly delete ONE simulation run's data (retention/cleanup).
 *
 * DANGEROUS OPERATION — requires body { confirm: "PURGE", run_id?: uuid }.
 *
 * Deletes ONLY the named run's:
 *   - coverage ledger rows (pu_simulation_status)
 *   - simulation election data ([SIM] election, its submissions,
 *     canonicals, party rows, verifications, agent assignments,
 *     dead-letter jobs, sim observer accounts)
 *
 * NEVER touches: real elections, live results, users (except sim
 * observer accounts `sim_obs_%`), audit logs, system_config.
 *
 * A RUNNING run cannot be purged — stop it first (that finalizes the
 * ledger and releases the lock). If run_id is omitted, the most recent
 * non-running run is purged.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";
import { createClient } from "@supabase/supabase-js";
import { invalidateAllCaches } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;

    const body = await request.json().catch(() => ({}));
    if (body.confirm !== "PURGE") {
      return NextResponse.json(
        {
          error:
            "Confirmation required: send { confirm: 'PURGE', run_id? }. This permanently deletes the simulation run's data.",
        },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let runId: string | null = body.run_id || null;

    if (!runId) {
      // Default target: most recent run that is not RUNNING
      const { data: latest, error: latestErr } = await supabase
        .from("simulation_runs")
        .select("id, status, label")
        .neq("status", "RUNNING")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestErr || !latest) {
        return NextResponse.json(
          { error: "No completed/stopped simulation run found to purge." },
          { status: 404 }
        );
      }
      runId = latest.id;
    } else {
      // Refuse to purge a run that is still running
      const { data: run } = await supabase
        .from("simulation_runs")
        .select("status, label")
        .eq("id", runId)
        .maybeSingle();
      if (!run) {
        return NextResponse.json({ error: "Unknown run_id." }, { status: 404 });
      }
      if (run.status === "RUNNING") {
        return NextResponse.json(
          { error: "Run is still RUNNING — stop it first (POST /api/admin/simulate/stop)." },
          { status: 409 }
        );
      }
    }

    const { data, error } = await supabase.rpc("purge_simulation_run", { p_run: runId });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    invalidateAllCaches();
    return NextResponse.json({ success: true, result: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to purge simulation run" },
      { status: 500 }
    );
  }
}
