/**
 * GET /api/public/polling-units
 * Returns GeoJSON of all polling units.
 * Uses cursor-based pagination to fetch all 176K+ PUs.
 * Result is cached for 5 minutes.
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
const CACHE_TTL = 300_000; // 5 minutes

export async function GET(_request: NextRequest) {
  // Rate limiting
  const rateResult = publicLimiter.check(_request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const now = Date.now();
    if (cachedGeoJSON && now - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedGeoJSON, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Paginated fetch — grab all PUs in batches ──
    const PAGE_SIZE = 50000; // large batch to minimise round trips
    const allUnits: any[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from("polling_units")
        .select("id, official_code, name, latitude, longitude, status, state_id")
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !data || data.length === 0) break;
      allUnits.push(...data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // Fetch state names
    const { data: states } = await supabase.from("states").select("id, name");
    const stateMap = new Map((states || []).map((s) => [s.id, s.name]));

    // Build GeoJSON — only include PUs with valid coordinates
    const geojson = {
      type: "FeatureCollection",
      features: allUnits
        .filter((pu) => pu.latitude != null && pu.longitude != null)
        .map((pu) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [pu.longitude, pu.latitude],
          },
          properties: {
            id: pu.id,
            official_code: pu.official_code,
            name: pu.name,
            status: pu.status,
            state_name: stateMap.get(pu.state_id) || "Unknown",
          },
        })),
      meta: {
        total_pu_count: allUnits.length,
        geocoded_count: allUnits.filter((pu) => pu.latitude != null).length,
      },
    };

    cachedGeoJSON = geojson;
    cacheTime = now;
    return NextResponse.json(geojson, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    console.error("Error in polling-units API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
