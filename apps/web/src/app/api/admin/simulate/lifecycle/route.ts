/**
 * GET /api/admin/simulate/lifecycle
 *
 * Admin pre-flight view (§13): what is currently active, what a new
 * simulation would replace, and what purge would delete.
 *
 * Returns the latest coverage-ledger run (migration 245) plus lock state.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: covData } = await supabase.rpc("get_pu_coverage_summary");
    const cov = Array.isArray(covData) ? covData[0] : covData;

    const { data: lock } = await supabase
      .from("simulation_lock")
      .select("locked_at, run_id")
      .eq("id", 1)
      .maybeSingle();

    // Previous runs (archive candidates for purge)
    const { data: history } = await supabase
      .from("simulation_runs")
      .select("id, label, scenario, status, total_pus, published_pus, started_at, completed_at")
      .order("started_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      current: cov
        ? {
            active: cov.active,
            run_id: cov.run_id,
            run_status: cov.run_status,
            label: cov.label,
            scenario: cov.scenario,
            election_id: cov.election_id,
            total_pus: cov.total_pus,
            accounted_pus: cov.accounted_pus,
            published_pus: cov.published_pus,
            disputed_pus: cov.dispute_pus,
            failed_pus: cov.failed_pus,
            disrupted_pus: cov.disrupted_pus,
            unavailable_pus: cov.unavailable_pus,
            awaiting_pus: cov.awaiting_pus,
            published_percent: cov.published_percent,
            started_at: cov.started_at,
            completed_at: cov.completed_at,
          }
        : { active: false },
      lock: lock ?? { locked_at: null, run_id: null },
      history: history ?? [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load lifecycle" },
      { status: 500 }
    );
  }
}
