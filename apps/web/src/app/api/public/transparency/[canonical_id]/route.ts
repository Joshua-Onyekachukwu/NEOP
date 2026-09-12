import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { canonical_id: string } }
) {
  try {
    const { canonical_id } = params;

    if (!UUID_RE.test(canonical_id)) {
      return NextResponse.json(
        { error: "Invalid canonical_id format (expected UUID v4)" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    const { data: row, error } = await supabase
      .from("canonical_pu_results")
      .select(
        `
        id,
        transparency_hash,
        published_at,
        published_by,
        valid_votes,
        rejected_votes,
        total_votes,
        published_proof_chain,
        status
      `
      )
      .eq("id", canonical_id)
      .eq("status", "PUBLISHED")
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "Lookup failed" },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json(
        { error: "Not found or not published" },
        { status: 404 }
      );
    }

    let partyVotesMap: Record<string, number> = {};
    try {
      const { data: partyRows, error: partyErr } = await supabase
        .from("canonical_party_results")
        .select(
          `
          votes,
          parties ( abbreviation )
        `
        )
        .eq("canonical_result_id", canonical_id);

      if (!partyErr && partyRows) {
        for (const pr of partyRows as any[]) {
          const abbr = pr?.parties?.abbreviation;
          if (abbr) {
            partyVotesMap[abbr] = Number(pr?.votes || 0);
          }
        }
      }
    } catch {}

    return NextResponse.json(
      {
        canonical_id: row.id,
        transparency_hash: row.transparency_hash || null,
        published_at: row.published_at,
        published_by: row.published_by,
        party_votes: partyVotesMap,
        valid_votes: Number(row.valid_votes || 0),
        rejected_votes: Number(row.rejected_votes || 0),
        total_votes: Number(row.total_votes || 0),
        proof_chain: (row as any).published_proof_chain || [],
        verify_sig: "sha256-hex",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
