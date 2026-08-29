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

    // Direct query — check staleness
    const { data: config } = await supabase
      .from("simulation_config")
      .select("*")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single();

    let status = config?.status || "IDLE";

    // Detect stale simulations — if RUNNING but no tick in 60s, mark completed
    if (status === "RUNNING" && config?.last_tick_at) {
      const lastTick = new Date(config.last_tick_at).getTime();
      const staleThreshold = 60 * 1000; // 60 seconds
      if (Date.now() - lastTick > staleThreshold) {
        status = "COMPLETED";
        // Auto-reset in background (fire and forget)
        supabase
          .from("simulation_config")
          .update({ status: "COMPLETED", updated_at: new Date().toISOString() })
          .eq("id", "00000000-0000-0000-0000-000000000001")
          .then(() => {});
      }
    }

    // If there are no results, always show IDLE regardless of config status
    const hasResults = (config?.total_results_submitted || 0) > 0;
    if (!hasResults && status === "COMPLETED") {
      status = "IDLE";
    }

    const isRunning = status === "RUNNING";
    const isLive = status === "COMPLETED" && hasResults;

    const result = {
      status,
      election_type: config?.election_type || "PRESIDENTIAL",
      title: "Presidential & National Assembly Election",
      subtitle: isRunning
        ? "Simulation in progress — data updating live"
        : isLive
        ? "Simulation complete — reviewing results"
        : "Awaiting election data — observers will report from polling units",
      date: "2027-01-16",
      total_polling_units: 176846,
      total_results: config?.total_results_submitted || 0,
      display_status: isRunning ? "SIMULATION" : isLive ? "LIVE" : "WAITING",
      status_label: isRunning
        ? "SIMULATION RUNNING"
        : isLive
        ? "LIVE ELECTION DATA"
        : "AWAITING DATA",
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
