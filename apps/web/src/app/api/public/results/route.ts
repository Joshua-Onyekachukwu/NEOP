/**
 * GET /api/public/results
 * Public endpoint for fetching recent election results with party breakdown.
 *
 * P2-1: Replaced 4 sequential SELECTS with getCachedPublicResults — 30s
 *      unstable_cache tag "public-results" invalidated on admin verify
 *      and new agent submission.  Reduces 5× the database read pressure on
 *      election day (millions of viewers → single cached query per 30 s).
 */

import { NextRequest, NextResponse } from "next/server";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";
import { getCachedPublicResults } from "@/lib/api-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DISCLAIMER =
  "Only administratively verified/approved observations are displayed. These are independently collected field observations and are not official INEC election results.";

export async function GET(request: NextRequest) {
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    const filters = {
      limit,
      offset,
      state_id: searchParams.get("state_id") || undefined,
      lga_id: searchParams.get("lga_id") || undefined,
      ward_id: searchParams.get("ward_id") || undefined,
      polling_unit_id: searchParams.get("polling_unit_id") || undefined,
    };

    const cached = await getCachedPublicResults(filters);

    // The cache returns full { polling_unit, party_results[] } nested shape.
    // Project back to route's contract for compatibility.
    const formattedResults = (cached.results || []).map((r: any) => {
      const pu = r.polling_unit || {};
      const parties = (r.party_results || [])
        .filter((pr: any) => pr?.party)
        .sort((a: any, b: any) => (b.votes || 0) - (a.votes || 0))
        .map((pr: any) => ({
          party_name: pr.party.name,
          party_abbreviation: pr.party.abbreviation,
          party_color: pr.party.color || "#808080",
          votes: Number(pr.votes || 0),
        }));

      return {
        id: r.id,
        polling_unit_code: pu.official_code || "Unknown",
        polling_unit_name: pu.name || "Unknown",
        state: pu.state_id ? (pu.state_name || pu.state_id) : "Unknown",
        state_id: pu.state_id || null,
        lga_id: pu.lga_id || null,
        ward_id: pu.ward_id || null,
        polling_unit_id: pu.id || r.polling_unit_id || null,
        latitude: pu.latitude || null,
        longitude: pu.longitude || null,
        registered_voters: Number(pu.registered_voters || 0),
        valid_votes: Number(r.valid_votes || 0),
        rejected_votes: Number(r.rejected_votes || 0),
        total_votes: Number(r.total_votes || 0),
        status: r.status,
        submitted_at: r.submitted_at,
        verified_at: r.verified_at,
        party_results: parties,
      };
    });

    const response = NextResponse.json(
      {
        results: formattedResults,
        pagination: {
          limit,
          offset,
          total: cached.pagination?.total ?? formattedResults.length,
          has_next: !!cached.pagination?.has_next,
          has_prev: !!cached.pagination?.has_prev,
        },
        disclaimer: DISCLAIMER,
        source: cached.source || "supabase",
        refreshed_at: cached.refreshed_at || new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
          "Surrogate-Control": "max-age=30, stale-if-error=180",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
    return addRateLimitHeaders(response, rateResult);
  } catch (error: any) {
    console.error("[public/results] error:", error?.message || error);
    return NextResponse.json(
      { error: "Internal server error", results: [], pagination: { limit: 50, offset: 0, total: 0 }, disclaimer: DISCLAIMER },
      { status: 500 }
    );
  }
}
