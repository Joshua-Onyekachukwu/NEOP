/**
 * GET /api/public/party-results
 *
 * Returns accumulated vote totals for each party.
 * Uses shared api-cache layer — database hit only once per 30 seconds.
 * CDN serves from edge for 30s, stale for 120s.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCachedPartyResults } from "@/lib/api-cache";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const result = await getCachedPartyResults();
    const response = NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
        "Surrogate-Control": "max-age=30, stale-if-error=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
    return addRateLimitHeaders(response, rateResult);
  } catch (error) {
    console.error("Error in party results API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
