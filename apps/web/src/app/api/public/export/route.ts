/**
 * GET /api/public/export
 * Export election results as CSV or JSON with filters.
 *
 * Query params:
 *   format    — "csv" (default) or "json"
 *   state     — filter by state name
 *   lga       — filter by LGA name
 *   ward      — filter by ward name
 *   party     — filter by party abbreviation (returns only that party's votes)
 *   status    — filter by PU status (VERIFIED, DISPUTED, etc.)
 *   pu        — filter by polling unit code
 *   election  — filter by election type (PRESIDENTIAL, GOVERNORSHIP)
 *   limit     — max rows (default 10000, max 50000)
 *
 * Returns:
 *   CSV with columns: PU Code, PU Name, State, LGA, Ward, Status, Valid, Rejected, Total, [Party votes...]
 *   or JSON with the same data structured as objects.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

// Standard Nigerian election parties (ordered for consistent columns)
const STANDARD_PARTIES = ["NDC", "APC", "PDP", "LP", "NNPP", "APGA", "SDP", "YPP", "ADC"];

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "csv";
    const stateFilter = searchParams.get("state") || "";
    const lgaFilter = searchParams.get("lga") || "";
    const wardFilter = searchParams.get("ward") || "";
    const partyFilter = (searchParams.get("party") || "").toUpperCase();
    const statusFilter = (searchParams.get("status") || "").toUpperCase();
    const puFilter = searchParams.get("pu") || "";
    const electionFilter = (searchParams.get("election") || "").toUpperCase();
    const limit = Math.min(parseInt(searchParams.get("limit") || "10000"), 50000);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch results with PU info
    let query = supabase
      .from("result_submissions")
      .select(`
        id, valid_votes, rejected_votes, total_votes, status, submitted_at, verified_at,
        polling_units (
          id, official_code, name, state_id, lga_id, ward_id,
          states ( id, name, code ),
          lgas ( id, name ),
          wards ( id, name )
        ),
        elections ( name, type )
      `)
      .order("submitted_at", { ascending: false })
      .limit(limit);

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data: results, error: resultsError } = await query;

    if (resultsError) {
      return NextResponse.json({ error: "Failed to fetch results" }, { status: 500 });
    }

    if (!results || results.length === 0) {
      if (format === "json") {
        return NextResponse.json({
          summary: { total_results: 0, total_votes: 0, winner: "N/A", margin: 0, leaderboard: [], filters: { state: stateFilter, lga: lgaFilter, ward: wardFilter, status: statusFilter, pu: puFilter }, exported_at: new Date().toISOString(), disclaimer: "No results match the given filters." },
          leaderboard: [],
          results: [],
        });
      }
      return new NextResponse("No results found with the given filters.", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 2. Apply post-query filters (PU hierarchy)
    let filtered = results;

    if (stateFilter) {
      filtered = filtered.filter((r: any) => {
        const st = r.polling_units?.states;
        return st?.name?.toLowerCase().includes(stateFilter.toLowerCase());
      });
    }
    if (lgaFilter) {
      filtered = filtered.filter((r: any) => {
        const lga = r.polling_units?.lgas;
        return lga?.name?.toLowerCase().includes(lgaFilter.toLowerCase());
      });
    }
    if (wardFilter) {
      filtered = filtered.filter((r: any) => {
        const w = r.polling_units?.wards;
        return w?.name?.toLowerCase().includes(wardFilter.toLowerCase());
      });
    }
    if (puFilter) {
      filtered = filtered.filter((r: any) => {
        return r.polling_units?.official_code?.toLowerCase().includes(puFilter.toLowerCase());
      });
    }
    if (electionFilter) {
      filtered = filtered.filter((r: any) => {
        return r.elections?.type?.toUpperCase() === electionFilter;
      });
    }

    if (filtered.length === 0) {
      if (format === "json") {
        return NextResponse.json({
          summary: { total_results: 0, total_votes: 0, winner: "N/A", margin: 0, leaderboard: [], filters: { state: stateFilter, lga: lgaFilter, ward: wardFilter, status: statusFilter, pu: puFilter }, exported_at: new Date().toISOString(), disclaimer: "No results match the given filters." },
          leaderboard: [],
          results: [],
        });
      }
      return new NextResponse("No results found with the given filters.", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 3. Fetch party results for all these submissions
    const resultIds = filtered.map((r: any) => r.id);
    const { data: partyResults } = await supabase
      .from("party_results")
      .select("result_submission_id, votes, party_id")
      .in("result_submission_id", resultIds);

    // Fetch party info
    const partyIds = [...new Set((partyResults || []).map((pr) => pr.party_id))];
    const { data: parties } = await supabase
      .from("parties")
      .select("id, abbreviation, official_name, color");

    const partyMap = new Map((parties || []).map((p) => [p.id, p]));
    const idToAbbr = new Map((parties || []).map((p) => [p.id, p.abbreviation]));

    // Group party results by submission
    const prByResult: Record<string, Record<string, number>> = {};
    for (const pr of partyResults || []) {
      if (!prByResult[pr.result_submission_id]) prByResult[pr.result_submission_id] = {};
      const abbr = idToAbbr.get(pr.party_id) || "?";
      prByResult[pr.result_submission_id][abbr] = (prByResult[pr.result_submission_id][abbr] || 0) + pr.votes;
    }

    // 4. Determine which party columns to include
    const activeParties = partyFilter
      ? [partyFilter]
      : STANDARD_PARTIES.filter((p) =>
          Object.values(prByResult).some((pr) => pr[p] !== undefined)
        );

    // 5. Build export rows
    const rows = filtered.map((r: any) => {
      const pu = r.polling_units as any;
      const pr = prByResult[r.id] || {};

      const row: Record<string, any> = {
        "PU Code": pu?.official_code || "",
        "PU Name": pu?.name || "",
        "State": pu?.states?.name || "",
        LGA: pu?.lgas?.name || "",
        Ward: pu?.wards?.name || "",
        Election: r.elections?.name || "",
        Status: r.status || "",
        "Valid Votes": r.valid_votes || 0,
        "Rejected Votes": r.rejected_votes || 0,
        "Total Votes": r.total_votes || 0,
      };

      // Add party columns
      for (const party of activeParties) {
        row[party] = pr[party] || 0;
      }

      // Add totals summary
      const winner = activeParties.reduce(
        (best, p) => (pr[p] || 0) > (pr[best] || 0) ? p : best,
        activeParties[0] || ""
      );
      row["Leading Party"] = winner;
      row["Margin"] = activeParties.length >= 2
        ? (pr[winner] || 0) - (pr[activeParties.find((p) => p !== winner) || ""] || 0)
        : 0;

      row["Submitted At"] = r.submitted_at || "";
      row["Verified At"] = r.verified_at || "";

      return row;
    });

    // 6. Generate output
    if (format === "json") {
      // Build summary
      const totalVotes = rows.reduce((sum, r) => sum + (r["Total Votes"] || 0), 0);
      const partyTotals: Record<string, number> = {};
      for (const party of activeParties) {
        partyTotals[party] = rows.reduce((sum, r) => sum + (r[party] || 0), 0);
      }

      const leaderboard = activeParties
        .map((p) => ({
          party: p,
          name: partyMap.get((parties || []).find((pt) => pt.abbreviation === p)?.id || "")?.official_name || p,
          total_votes: partyTotals[p] || 0,
          percentage: totalVotes > 0 ? ((partyTotals[p] || 0) / totalVotes * 100).toFixed(1) : "0",
        }))
        .sort((a, b) => b.total_votes - a.total_votes);

      return NextResponse.json({
        summary: {
          total_results: rows.length,
          total_votes: totalVotes,
          winner: leaderboard[0]?.party || "N/A",
          margin: leaderboard[0] && leaderboard[1]
            ? leaderboard[0].total_votes - leaderboard[1].total_votes
            : 0,
          election: rows[0]?.Election || "Unknown",
          filters: { state: stateFilter, lga: lgaFilter, ward: wardFilter, status: statusFilter, pu: puFilter },
          exported_at: new Date().toISOString(),
          disclaimer: "These are independently collected field observations, not official INEC results.",
        },
        leaderboard,
        results: rows,
      });
    }

    // CSV format
    const headers = Object.keys(rows[0] || {});
    const csvLines = [
      headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(","),
      ...rows.map((row) =>
        headers.map((h) => {
          const val = row[h];
          if (typeof val === "string" && (val.includes(",") || val.includes('"') || val.includes("\n"))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val ?? "";
        }).join(",")
      ),
    ];

    // Add summary footer
    const totalVotes = rows.reduce((sum, r) => sum + (r["Total Votes"] || 0), 0);
    csvLines.push("");
    csvLines.push(`"TOTAL RESULTS",${rows.length}`);
    csvLines.push(`"TOTAL VOTES",${totalVotes}`);
    csvLines.push(`"EXPORTED AT","${new Date().toISOString()}"`);
    csvLines.push(`"DISCLAIMER","These are independently collected field observations, not official INEC results."`);

    const csv = csvLines.join("\n");
    const filename = `neop-results-${new Date().toISOString().split("T")[0]}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
