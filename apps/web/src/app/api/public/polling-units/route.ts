/**
 * GET /api/public/polling-units
 * Returns GeoJSON of all polling units.
 * Uses RPC function that returns rows (bypasses 1000-row REST limit).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

let cachedGeoJSON: any = null;
let cacheTime = 0;
const CACHE_TTL = 300_000; // 5 minutes

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    if (cachedGeoJSON && now - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedGeoJSON, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Try RPC function that returns rows (fast, no 1000-row limit) ──
    const { data: rows, error: rpcError } = await supabase.rpc(
      "get_polling_unit_rows"
    );

    if (!rpcError && rows && Array.isArray(rows) && rows.length > 0) {
      console.log(`[polling-units] RPC returned ${rows.length} rows`);
      const geojson = {
        type: "FeatureCollection",
        features: rows.map((pu: any) => ({
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
            state_name: pu.state_name || "Unknown",
          },
        })),
      };
      cachedGeoJSON = geojson;
      cacheTime = now;
      return NextResponse.json(geojson, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      });
    }

    // ── Fallback: paginated fetch (slow for 188K PUs) ──
    console.log("[polling-units] RPC not available, falling back to paginated fetch");
    const allUnits: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from("polling_units")
        .select("id, official_code, name, latitude, longitude, status, state_id")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .range(offset, offset + pageSize - 1);

      if (error || !data || data.length === 0) break;
      allUnits.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    const { data: states } = await supabase.from("states").select("id, name");
    const stateMap = new Map((states || []).map((s) => [s.id, s.name]));

    const geojson = {
      type: "FeatureCollection",
      features: allUnits.map((pu) => ({
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
