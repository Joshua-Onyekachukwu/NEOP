/**
 * GET /api/public/polling-units/status-changes
 *
 * Returns LGA-level status changes for the live map (migration 246).
 * The response shape { active: [{ id, status }] } is consumed by
 * LiveMap's pollStatusUpdates to incrementally update LGA markers
 * without a full GeoJSON reload.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

let cachedActive: any = null;
let cacheTime = 0;
const CACHE_TTL = 10_000;

export async function GET(request: NextRequest) {
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const now = Date.now();
    if (cachedActive && now - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedActive, {
        headers: { "Cache-Control": "no-cache" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try the migration-246 RPC first (LGA-level)
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "get_map_status_changes"
    );

    if (!rpcError && rpcData) {
      // Transform { active: bool, lgas: [...] } → { active: [{id, status}] }
      const lgas = Array.isArray(rpcData.lgas) ? rpcData.lgas : [];
      const active = lgas
        .filter((l: any) => l.dominant_status && l.changed > 0)
        .map((l: any) => ({ id: l.lga_id, status: l.dominant_status }));

      const result = { active, count: active.length, timestamp: Date.now() };
      cachedActive = result;
      cacheTime = now;

      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-cache" },
      });
    }

    // Fallback: no data
    const result = { active: [], count: 0, timestamp: Date.now() };
    cachedActive = result;
    cacheTime = now;

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
        "Surrogate-Control": "max-age=10, stale-if-error=120",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error in status-changes API:", error);
    return NextResponse.json(
      { active: [], count: 0, timestamp: Date.now() },
      { status: 500 }
    );
  }
}
