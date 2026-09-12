import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SYSTEM_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

export const dynamic = "force-dynamic";

let cachedConfig: any = null;
let cacheTime = 0;
const CACHE_TTL = 5_000;

function legacySimConfigFallback(config: any, totalPUCount: number) {
  let status = config?.status || "IDLE";
  if (status === "RUNNING" && config?.last_tick_at) {
    const lastTick = new Date(config.last_tick_at).getTime();
    if (Date.now() - lastTick > 60_000) {
      status = "COMPLETED";
    }
  }
  const hasResults = (config?.total_results_submitted || 0) > 0;
  if (!hasResults && status === "COMPLETED") status = "IDLE";
  const isRunning = status === "RUNNING";
  const isLive = status === "COMPLETED" && hasResults;
  return {
    status,
    election_type: config?.election_type || "PRESIDENTIAL",
    title:
      config?.election_type === "GOVERNORSHIP"
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
    last_updated: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
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

    const [sysConfigRes, fastStatsRes, simConfigRes] = await Promise.all([
      supabase
        .from("system_config")
        .select("data_mode, active_election_id, last_published_at, last_updated_at")
        .eq("id", SYSTEM_CONFIG_ID)
        .maybeSingle(),
      supabase.rpc("get_fast_stats"),
      supabase
        .from("simulation_config")
        .select("*")
        .eq("id", SYSTEM_CONFIG_ID)
        .maybeSingle(),
    ]);

    const sysConfig: any = sysConfigRes.data;
    const totalPUCount = fastStatsRes.data?.total_polling_units ?? 176846;
    const simConfig: any = simConfigRes.data;

    if (!sysConfig) {
      const fallback = legacySimConfigFallback(simConfig, totalPUCount);
      cachedConfig = fallback;
      cacheTime = now;
      const response = NextResponse.json(fallback, {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
          "Surrogate-Control": "max-age=300, stale-if-error=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
      return addRateLimitHeaders(response, rateResult);
    }

    const active_election_id = sysConfig.active_election_id;
    const data_mode = sysConfig.data_mode || "AWAITING_DATA";
    const last_published_at = sysConfig.last_published_at;

    let total_published_results = 0;
    try {
      if (active_election_id) {
        const { count, error: cntErr } = await supabase
          .from("canonical_pu_results")
          .select("polling_unit_id", { count: "exact", head: true })
          .eq("status", "PUBLISHED")
          .eq("election_id", active_election_id);
        if (!cntErr) total_published_results = Number(count || 0);
      }
    } catch {}

    const simTotalResults = simConfig?.total_results_submitted || 0;
    const mergedTotalResults = Math.max(total_published_results, simTotalResults);

    let display_status = "WAITING";
    let status_label = "AWAITING DATA";
    let subtitle = "Awaiting election data — observers reporting soon";

    if (data_mode === "AWAITING_DATA") {
      display_status = "WAITING";
      status_label = "AWAITING DATA";
      subtitle = "Awaiting election data — observers reporting soon";
    } else if (data_mode === "SIMULATED") {
      display_status = "SIMULATION";
      status_label = "SIMULATED DATA";
      subtitle = "Simulation mode — rehearsal/testing data only";
    } else if (data_mode === "LIVE_ELECTION") {
      display_status = "LIVE";
      status_label = "LIVE ELECTION";
      subtitle = "Live election results — official observer data";
    }

    const last_updated = last_published_at || new Date().toISOString();

    const result = {
      status: data_mode,
      election_type: simConfig?.election_type || "PRESIDENTIAL",
      title:
        simConfig?.election_type === "GOVERNORSHIP"
          ? "Governorship & State Assembly Election"
          : "Presidential & National Assembly Election",
      subtitle,
      date: simConfig?.election_type === "GOVERNORSHIP" ? "2027-02-06" : "2027-01-16",
      total_polling_units: totalPUCount,
      total_results: mergedTotalResults,
      total_published_results,
      display_status,
      status_label,
      data_mode,
      active_election_id,
      last_updated,
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
  } catch (error: any) {
    console.error("Error in config API:", error);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    let totalPUCount = 176846;
    let simConfig: any = null;
    try {
      const [statsR, simR] = await Promise.all([
        supabase.rpc("get_fast_stats"),
        supabase
          .from("simulation_config")
          .select("*")
          .eq("id", SYSTEM_CONFIG_ID)
          .maybeSingle(),
      ]);
      totalPUCount = statsR?.data?.total_polling_units ?? 176846;
      simConfig = simR.data;
    } catch {}
    const fallback = legacySimConfigFallback(simConfig, totalPUCount);
    return NextResponse.json(
      {
        status: fallback.status,
        election_type: fallback.election_type,
        title: fallback.title,
        subtitle: fallback.subtitle,
        date: fallback.date,
        total_polling_units: fallback.total_polling_units,
        total_results: fallback.total_results,
        display_status: fallback.display_status,
        status_label: fallback.status_label,
        last_updated: fallback.last_updated,
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
