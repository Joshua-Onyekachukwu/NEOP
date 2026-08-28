/**
 * GET /api/public/party-results
 * Returns accumulated vote totals for each party.
 * Tries RPC first; falls back to efficient aggregation.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

let cachedResult: any = null;
let cacheTime = 0;
const CACHE_TTL = 30_000;

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    if (cachedResult && now - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedResult);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Try RPC first (fastest path) ──
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "get_party_totals"
    );

    if (!rpcError && rpcData && rpcData.length > 0) {
      // Deduplicate by abbreviation — keep highest vote count per party
      const deduped: Record<string, any> = {};
      for (const p of rpcData) {
        const abbr = p.party_abbreviation;
        if (!deduped[abbr] || Number(p.total_votes) > Number(deduped[abbr].total_votes)) {
          deduped[abbr] = p;
        }
      }
      const parties = Object.values(deduped).sort(
        (a, b) => Number(b.total_votes) - Number(a.total_votes)
      );
      const grandTotal = parties.reduce(
        (s: number, r: any) => s + Number(r.total_votes),
        0
      );
      const result = {
        parties: parties.map((p: any) => ({
          name: p.party_name,
          abbreviation: p.party_abbreviation,
          color: p.party_color,
          total_votes: Number(p.total_votes),
          percentage: grandTotal > 0 ? Number(((Number(p.total_votes) / grandTotal) * 100).toFixed(1)) : 0,
        })),
        grand_total: grandTotal,
        last_updated: new Date().toISOString(),
      };
      cachedResult = result;
      cacheTime = now;
      return NextResponse.json(result);
    }

    // ── Fallback: fetch unique party abbreviations, then aggregate via batched reads ──
    const { data: allParties } = await supabase
      .from("parties")
      .select("id, official_name, abbreviation, color");

    // Deduplicate by abbreviation — take the first occurrence
    const seen = new Set<string>();
    const partyMap: Record<
      string,
      { name: string; abbreviation: string; color: string; total_votes: number }
    > = {};

    for (const p of allParties || []) {
      if (!seen.has(p.abbreviation)) {
        seen.add(p.abbreviation);
        partyMap[p.abbreviation] = {
          name: p.official_name,
          abbreviation: p.abbreviation,
          color: p.color || "#6B7280",
          total_votes: 0,
        };
      }
    }

    // Map party_id → abbreviation
    const idToAbbr: Record<string, string> = {};
    for (const p of allParties || []) {
      if (partyMap[p.abbreviation]) {
        idToAbbr[p.id] = p.abbreviation;
      }
    }

    // Paginate through party_results — aggregate client-side
    let offset = 0;
    const pageSize = 10000;
    const startTime = Date.now();
    const MAX_TIME = 25000;

    while (Date.now() - startTime < MAX_TIME) {
      const { data: batch, error } = await supabase
        .from("party_results")
        .select("votes, party_id")
        .range(offset, offset + pageSize - 1);

      if (error || !batch || batch.length === 0) break;

      for (const pr of batch) {
        const abbr = idToAbbr[pr.party_id];
        if (abbr && partyMap[abbr]) {
          partyMap[abbr].total_votes += pr.votes;
        }
      }

      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    const sorted = Object.values(partyMap).sort(
      (a, b) => b.total_votes - a.total_votes
    );

    const grandTotal = sorted.reduce((sum, p) => sum + p.total_votes, 0);

    const withPercentages = sorted.map((p) => ({
      ...p,
      percentage:
        grandTotal > 0
          ? Number(((p.total_votes / grandTotal) * 100).toFixed(1))
          : 0,
    }));

    const result = {
      parties: withPercentages,
      grand_total: grandTotal,
      last_updated: new Date().toISOString(),
    };

    cachedResult = result;
    cacheTime = now;
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in party results API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
