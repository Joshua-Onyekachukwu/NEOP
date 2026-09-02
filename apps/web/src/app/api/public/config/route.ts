/**
 * GET /api/public/config
 *
 * Returns election config and simulation status.
 * Uses shared api-cache for 5-minute serverless cache.
 * CDN serves from edge for 5 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

// In-memory cache with stale detection
let cachedConfig: any = null;
let cacheTime = 0;
const CACHE_TTL = 5_000; // 5 seconds serverless-level cache

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const now = Date.now();
    if (cachedConfig && now - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedConfig, {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
          "Surrogate-Control": "max-age=300, stale-if-error=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const [configResult, puCountResult] = await Promise.all([
      supabase
        .from("simulation_config")
        .select("*")
        .eq("id", "00000000-0000-0000-0000-000000000001")
        .single(),
      supabase.rpc("get_fast_stats"),
    ]);

    const config = configResult.data;
    const totalPUCount = puCountResult.data?.total_polling_units ?? 176846;
    if (puCountResult.error) {
      console.warn("[config] Failed to get PU count from DB, using fallback:", puCountResult.error.message);
    }

    let status = config?.status || "IDLE";

    // Detect stale simulations — if RUNNING but no tick in 60s, mark completed
    if (status === "RUNNING" && config?.last_tick_at) {
      const lastTick = new Date(config.last_tick_at).getTime();
      if (Date.now() - lastTick > 60_000) {
        status = "COMPLETED";
        // Auto-reset in background
        supabase
          .from("simulation_config")
          .update({ status: "COMPLETED", updated_at: new Date().toISOString() })
          .eq("id", "00000000-0000-0000-0000-000000000001")
          .then(() => {});
      }
    }

    const hasResults = (config?.total_results_submitted || 0) > 0;
    if (!hasResults && status === "COMPLETED") status = "IDLE";

    const isRunning = status === "RUNNING";
    const isLive = status === "COMPLETED" && hasResults;

    const result = {
      status,
      election_type: config?.election_type || "PRESIDENTIAL",
      title: config?.election_type === "GOVERNORSHIP"
        ? "Governorship & State Assembly Election"
        : "Presidential & National Assembly Election",
      subtitle: isRunning
        ? "Simulation in progress — data updating live"
        : isLive
        ? "Simulation complete — reviewing results"
        : "Awaiting election data — observers will report from polling units",
      date: config?.election_type === "GOVERNORSHIP" ? "2027-02-06" : "2027-01-16",
      total_polling_units: totalPUCount,
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

    const response = NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
        "Surrogate-Control": "max-age=300, stale-if-error=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
    return addRateLimitHeaders(response, rateResult);
  } catch (error) {
    console.error("Error in config API:", error);
    return NextResponse.json(
      {
        status: "IDLE",
        election_type: "PRESIDENTIAL",
        title: "Presidential & National Assembly Election",
        subtitle: "Awaiting election data",
        date: "2027-01-16",
        total_polling_units: 176846, // INEC 2026 official count
        total_results: 0,
        display_status: "IDLE",
        status_label: "AWAITING DATA",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
          "Surrogate-Control": "max-age=300, stale-if-error=3600",
        },
      }
    );
  }
}
