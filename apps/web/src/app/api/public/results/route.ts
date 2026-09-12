/**
 * GET /api/public/results
 * Public endpoint for fetching recent election results with party breakdown.
 * Uses service role to bypass RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const offset = parseInt(searchParams.get("offset") || "0");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch results — sort by submitted_at DESC with NULLs last so real results appear first
    const { data: results, error } = await supabase
      .from("result_submissions")
      .select(`
        id,
        polling_unit_id,
        valid_votes,
        rejected_votes,
        total_votes,
        party_votes,
        status,
        submitted_at,
        verified_at
      `)
      .gt("total_votes", 0)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Error fetching results:", error);
      return NextResponse.json(
        { error: "Failed to fetch results" },
        { status: 500 }
      );
    }

    if (!results || results.length === 0) {
      return NextResponse.json({
        results: [],
        pagination: { limit, offset, total: 0 },
        disclaimer:
          "These are independently collected field observations and are not official INEC election results.",
      });
    }

    // Fetch polling unit info for these results (batch)
    const puIds = [...new Set(results.map((r) => r.polling_unit_id))];
    const { data: pus } = await supabase
      .from("polling_units")
      .select("id, official_code, name, state_id")
      .in("id", puIds);

    const puMap = new Map((pus || []).map((p) => [p.id, p]));

    // Fetch state names
    const stateIds = [...new Set((pus || []).map((p) => p.state_id).filter(Boolean))];
    const { data: states } = await supabase
      .from("states")
      .select("id, name");
    const stateMap = new Map((states || []).map((s) => [s.id, s.name]));

    // Fetch party results for these submissions (batch)
    const resultIds = results.map((r) => r.id);
    const { data: partyResults } = await supabase
      .from("party_results")
      .select("result_submission_id, votes, party_id")
      .in("result_submission_id", resultIds);

    // Fetch parties for display
    const partyIds = [...new Set((partyResults || []).map((pr) => pr.party_id))];
    const { data: parties } = await supabase
      .from("parties")
      .select("id, official_name, abbreviation, color")
      .in("id", partyIds);
    const partyMap = new Map((parties || []).map((p) => [p.id, p]));

    // Group party results by submission from party_results table
    const prByResult: Record<string, any[]> = {};
    for (const pr of partyResults || []) {
      const key = pr.result_submission_id;
      if (!prByResult[key]) prByResult[key] = [];
      const party = partyMap.get(pr.party_id);
      prByResult[key].push({
        party_name: party?.official_name || "Unknown",
        party_abbreviation: party?.abbreviation || "?",
        party_color: party?.color || "#808080",
        votes: pr.votes,
      });
    }

    // Party color lookup for JSONB fallback
    const PARTY_COLOR_MAP: Record<string, string> = {
      NDC: "#1B5E20", APC: "#00A859", PDP: "#000080", LP: "#FF0000",
      NNPP: "#E53935", APGA: "#FFD600", SDP: "#1565C0", YPP: "#6A1B9A", ADC: "#00838F",
    };
    const PARTY_NAME_MAP: Record<string, string> = {
      NDC: "Nigeria Democratic Congress", APC: "All Progressives Congress",
      PDP: "Peoples Democratic Party", LP: "Labour Party",
      NNPP: "New Nigeria Peoples Party", APGA: "All Progressives Grand Alliance",
      SDP: "Social Democratic Party", YPP: "Young Progressives Party",
      ADC: "African Democratic Congress",
    };

    // Format results — use party_results table first, fall back to JSONB party_votes
    const formattedResults = results.map((r) => {
      const pu = puMap.get(r.polling_unit_id);
      let partyResultsList = prByResult[r.id] || [];

      // Fallback: parse party_votes JSONB if party_results table is empty
      if (partyResultsList.length === 0 && r.party_votes && typeof r.party_votes === "object") {
        partyResultsList = Object.entries(r.party_votes)
          .map(([abbr, votes]) => ({
            party_abbreviation: abbr,
            party_name: PARTY_NAME_MAP[abbr] || abbr,
            party_color: PARTY_COLOR_MAP[abbr] || "#808080",
            votes: Number(votes) || 0,
          }))
          .sort((a, b) => b.votes - a.votes);
      }

      return {
        id: r.id,
        polling_unit_code: pu?.official_code || "Unknown",
        polling_unit_name: pu?.name || "Unknown",
        state: stateMap.get(pu?.state_id) || "Unknown",
        valid_votes: r.valid_votes,
        rejected_votes: r.rejected_votes,
        total_votes: r.total_votes,
        status: r.status,
        submitted_at: r.submitted_at,
        verified_at: r.verified_at,
        party_results: partyResultsList,
      };
    });

    // Get actual total count from DB (only results with votes)
    let totalCount = formattedResults.length;
    try {
      const { count } = await supabase
        .from("result_submissions")
        .select("id", { count: "exact", head: true })
        .gt("total_votes", 0);
      if (count) totalCount = count;
    } catch {}

    const response = NextResponse.json({
      results: formattedResults,
      pagination: {
        limit,
        offset,
        total: totalCount,
      },
      disclaimer:
        "These are independently collected field observations and are not official INEC election results.",
    }, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
        "Surrogate-Control": "max-age=10, stale-if-error=120",
        "X-Content-Type-Options": "nosniff",
      },
    });
    return addRateLimitHeaders(response, rateResult);
  } catch (error) {
    console.error("Error in public results API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
