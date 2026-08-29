/**
 * GET /api/public/config
 * Returns election config and simulation status.
 * Uses SQL function for speed.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

let cachedConfig: any = null;
let cacheTime = 0;
const CACHE_TTL = 3_000;

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    if (cachedConfig && now - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedConfig);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try SQL function
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_simulation_status");

    if (!rpcError && rpcData) {
      cachedConfig = rpcData;
      cacheTime = now;
      return NextResponse.json(rpcData);
    }

    // Fallback
    const { data: config } = await supabase
      .from("simulation_config")
      .select("*")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single();

    const status = config?.status || "IDLE";
    const result = {
      status,
      election_type: config?.election_type || "PRESIDENTIAL",
      title: "Presidential & National Assembly Election",
      subtitle:
        status === "RUNNING"
          ? "Simulation in progress — data updating live"
          : "Awaiting election data — observers will report from polling units",
      date: "2027-01-16",
      total_polling_units: 176846,
      total_results: config?.total_results_submitted || 0,
      display_status: status === "RUNNING" ? "SIMULATION" : "IDLE",
      status_label: status === "RUNNING" ? "SIMULATION RUNNING" : "AWAITING DATA",
    };

    cachedConfig = result;
    cacheTime = now;

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in config API:", error);
    return NextResponse.json(
      {
        status: "IDLE",
        election_type: "PRESIDENTIAL",
        title: "Presidential & National Assembly Election",
        subtitle: "Awaiting election data",
        date: "2027-01-16",
        total_polling_units: 176846,
        total_results: 0,
        display_status: "IDLE",
        status_label: "AWAITING DATA",
      },
      { status: 200 }
    );
  }
}
