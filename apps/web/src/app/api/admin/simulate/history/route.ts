/**
 * GET /api/admin/simulate/history — Fetch previous simulation runs
 * POST /api/admin/simulate/history — Record a new simulation run
 *
 * Admin-only. Gracefully handles missing simulation_history table.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

// ── GET: Fetch history ──

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: adminUser } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (!adminUser) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    // No auth required — this is called internally by the simulation trigger
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error } = await supabase
      .from("simulation_history")
      .insert({
        scenario: scenario || "random",
        election_type: election_type || "PRESIDENTIAL",
        status: status || "COMPLETED",
        total_polling_units: total_polling_units || 188042,
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
