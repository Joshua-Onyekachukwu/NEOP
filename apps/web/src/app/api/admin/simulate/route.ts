/**
 * POST /api/admin/simulate — Start or update simulation config
 * GET /api/admin/simulate — Get current simulation status
 * DELETE /api/admin/simulate — Stop simulation
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

// GET — current status
export async function GET() {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("simulation_config")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      config: data || null,
      isRunning: data?.status === "RUNNING",
    });
  } catch {
    return NextResponse.json({ config: null, isRunning: false });
  }
}

// POST — start simulation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { election_type = "PRESIDENTIAL", speed = 3, target_states = [] } = body;

    const supabase = getSupabase();

    // Stop any existing simulation first
    await supabase
      .from("simulation_config")
      .update({ status: "IDLE", updated_at: new Date().toISOString() })
      .eq("status", "RUNNING");

    // Create new simulation config
    const { data: config, error } = await supabase
      .from("simulation_config")
      .insert({
        election_type,
        status: "RUNNING",
        speed,
        target_states: target_states,
        started_at: new Date().toISOString(),
        last_tick_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating simulation:", error);
      return NextResponse.json({ error: "Failed to start simulation" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      config,
      message: `Simulation started: ${election_type} at speed ${speed} results/tick`,
    });
  } catch (error) {
    console.error("Error in simulation POST:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE — stop simulation
export async function DELETE() {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("simulation_config")
      .update({ status: "IDLE", updated_at: new Date().toISOString() })
      .eq("status", "RUNNING");

    if (error) {
      return NextResponse.json({ error: "Failed to stop simulation" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Simulation stopped" });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
