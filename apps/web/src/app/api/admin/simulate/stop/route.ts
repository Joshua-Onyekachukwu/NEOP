/**
 * POST /api/admin/simulate/stop
 *
 * Admin: safely stop the active simulation run.
 *
 * - Finalizes the coverage ledger: every PU the engine never reached
 *   becomes UNAVAILABLE (never silently missing — migration 245 §20).
 * - Marks the run STOPPED (kept for history; use purge to delete).
 * - Releases the single-active lock so a new simulation can start.
 * - Idempotent: stopping with no active run succeeds harmlessly.
 *
 * Never touches real election data, users, audit logs, or config —
 * only the simulation run's own ledger rows.
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase.rpc("stop_simulation_run");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    invalidateAllCaches();
    return NextResponse.json({ success: true, result: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to stop simulation" },
      { status: 500 }
    );
  }
}
