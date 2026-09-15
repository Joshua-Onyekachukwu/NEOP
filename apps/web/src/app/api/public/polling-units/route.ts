/**
 * GET /api/public/polling-units
 *
 * Live map data. Serves the LGA-aggregated GeoJSON from
 * `get_map_lga_geojson()` (migration 246): one feature per LGA (774),
 * colored by the DOMINANT per-PU status and carrying per-status counts.
 *
 * Why LGA aggregates instead of 176,846 individual points:
 *  - the full PU universe as points is ~40 MB — unusable in a browser;
 *  - at zooms where all PUs are visible, individual pins are
 *    indistinguishable anyway;
 *  - every PU is still accounted for: each LGA feature aggregates ALL
 *    of its PUs' ledger states (nothing silently disappears, §3/§8).
 *
 * While a simulation is RUNNING, statuses come from the active run's
 * coverage ledger; otherwise from each PU's own status. Single-row RPC
 * response avoids PostgREST's 1,000-row cap entirely.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

let cachedGeoJSON: any = null;
let cacheTime = 0;
let cacheTtl = 300_000; // 5 minutes (30s while a simulation is RUNNING)

export async function GET(request: NextRequest) {
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const now = Date.now();
    if (cachedGeoJSON && now - cacheTime < cacheTtl) {
      return NextResponse.json(cachedGeoJSON, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // One row: { type, features[774], meta } — no PostgREST row cap
    const { data, error } = await supabase.rpc("get_map_lga_geojson");

    if (error || !data) {
      console.error("get_map_lga_geojson failed:", error);
      return NextResponse.json(
        { type: "FeatureCollection", features: [], meta: { lga_count: 0, error: true } },
        { status: 502 }
      );
    }

    const geojson =
      typeof data === "string" ? JSON.parse(data) : data;

    const activeRun = geojson?.meta?.active_run === true;
    cachedGeoJSON = geojson;
    cacheTime = now;
    // While a simulation RUNS, ledger statuses change continuously —
    // shorten the cache so the map reflects transitions.
    cacheTtl = activeRun ? 30_000 : 300_000;

    const res = NextResponse.json(geojson, {
      headers: {
        "Cache-Control": activeRun
          ? "public, s-maxage=30, stale-while-revalidate=60"
          : "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
    addRateLimitHeaders(res, { ok: true } as any);
    return res;
  } catch (error) {
    console.error("Error in polling-units API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
