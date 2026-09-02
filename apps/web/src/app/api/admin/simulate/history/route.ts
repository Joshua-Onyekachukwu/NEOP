/**
 * GET /api/admin/simulate/history — Fetch previous simulation runs
 * POST /api/admin/simulate/history — Record a new simulation run
 *
 * Admin-only. Gracefully handles missing simulation_history table.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, isAdminSuccess, requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

// ── GET: Fetch history ──

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!isAdminSuccess(auth)) return auth.error;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from("simulation_history")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20);

    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return NextResponse.json({ runs: [], table_exists: false });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ runs: data || [], table_exists: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// ── POST: Record a simulation run ──
// Requires admin auth — prevents unauthorized history manipulation

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      scenario,
      election_type,
      status,
      total_polling_units,
      results_created,
      total_votes,
      duration_seconds,
      started_at,
      completed_at,
      error_message,
    } = body;

    // Verify admin auth (required for POST)
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, adminUser } = auth;

    const { error } = await supabase
      .from("simulation_history")
      .insert({
        scenario: scenario || "random",
        election_type: election_type || "PRESIDENTIAL",
        status: status || "COMPLETED",
        total_polling_units: total_polling_units || 176846,
        results_created: results_created || 0,
        total_votes: total_votes || 0,
        duration_seconds: duration_seconds || 0,
        ndc_wins: true,
        error_message: error_message || null,
        started_at: started_at || new Date().toISOString(),
        completed_at: completed_at || new Date().toISOString(),
      });

    if (error) {
      // Table might not exist — that's ok
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        console.log("[sim-history] Table does not exist — skipping record");
        return NextResponse.json({ recorded: false, reason: "table_missing" });
      }
      console.error("[sim-history] Insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[sim-history] Recorded simulation: ${scenario} (${status})`);
    return NextResponse.json({ recorded: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to record" },
      { status: 500 }
    );
  }
}
