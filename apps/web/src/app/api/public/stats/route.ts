/**
 * GET /api/public/stats
 *
 * Dashboard statistics endpoint.
 * Uses shared api-cache layer — database hit only once per 30 seconds.
 * CDN serves from edge for 30s, stale for 120s.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCachedStats } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const stats = await getCachedStats();
    return NextResponse.json(stats, {
      headers: {
        // Extra safety: route handler cache headers override middleware
        "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
        "Surrogate-Control": "max-age=30, stale-if-error=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error in stats API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
