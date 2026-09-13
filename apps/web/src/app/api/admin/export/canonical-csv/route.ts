import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminSuccess } from "@/lib/admin-auth";
import { createClient } from "@supabase/supabase-js";
import { getCachedPartyResults, getCachedConfig } from "@/lib/api-cache";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function timestampFilenameSuffix(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function rfc4180Escape(value: any): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (
    s.indexOf(",") >= 0 ||
    s.indexOf('"') >= 0 ||
    s.indexOf("\n") >= 0 ||
    s.indexOf("\r") >= 0
  ) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function rowToCsv(cells: any[]): string {
  return cells.map(rfc4180Escape).join(",") + "\r\n";
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!isAdminSuccess(auth)) return auth.error;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const [cachedParties, cachedConfig] = await Promise.all([
      getCachedPartyResults(),
      getCachedConfig(),
    ]);

    const partyAbbrs = (cachedParties?.parties || [])
      .map((p: any) => p.abbreviation)
      .filter(Boolean);

    const electionName = cachedConfig?.title || "Election";
    const electionDate = cachedConfig?.date || "";

    const { data: mvRows, error: mvErr } = await supabase
      .from("mv_public_published_results")
      .select(
        `
        id,
        election_id,
        published_at,
        valid_votes,
        rejected_votes,
        total_votes,
        state_id,
        state_name,
        lga_id,
        lga_name,
        ward_id,
        ward_name,
        polling_unit_id,
        polling_unit_code,
        polling_unit_name,
        latitude,
        longitude,
        registered_voters,
        source_submission_1,
        source_submission_2
      `
      )
      .order("published_at", { ascending: false, nullsFirst: false })
      .returns<any[]>();

    if (mvErr) {
      return NextResponse.json(
        { error: mvErr?.message || "MV query failed" },
        { status: 500 }
      );
    }

    const rows = mvRows || [];
    const canonicalIds = rows
      .map((r: any) => r.id)
      .filter(Boolean);

    const partyMap = new Map<string, Record<string, number>>();
    if (canonicalIds.length > 0) {
      try {
        const { data: partyRows } = await supabase
          .from("canonical_party_results")
          .select(
            `
            canonical_result_id,
            votes,
            parties ( id, abbreviation, name )
          `
          )
          .in("canonical_result_id", canonicalIds)
          .returns<any[]>();

        if (partyRows) {
          for (const pr of partyRows) {
            const cid = pr.canonical_result_id;
            if (!cid) continue;
            if (!partyMap.has(cid)) partyMap.set(cid, {});
            const abbr = pr?.parties?.abbreviation;
            if (abbr) {
              partyMap.get(cid)![abbr] = Number(pr?.votes || 0);
            }
          }
        }
      } catch {}
    }

    const headers = [
      "canonical_id",
      "election_name",
      "election_date",
      "published_at",
      "state_code",
      "state_name",
      "lga_name",
      "ward_name",
      "polling_unit_code",
      "polling_unit_name",
      "latitude",
      "longitude",
      "registered_voters",
      "valid_votes",
      "rejected_votes",
      "total_votes",
      ...partyAbbrs,
      "source_submission_1",
      "source_submission_2",
    ];

    let csv = "";
    csv += rowToCsv(headers);

    for (const r of rows) {
      const cid = r.id;
      const partiesForRow = partyMap.get(cid) || {};
      const partyCells = partyAbbrs.map((abbr: string) =>
        partiesForRow[abbr] !== undefined ? partiesForRow[abbr] : 0
      );

      const stateCode = r.state_code || r.state_id || "";
      const puCode = r.polling_unit_code || "";
      const puName = r.polling_unit_name || "";

      const row = [
        cid,
        electionName,
        electionDate,
        r.published_at || "",
        stateCode,
        r.state_name || "",
        r.lga_name || "",
        r.ward_name || "",
        puCode,
        puName,
        r.latitude ?? "",
        r.longitude ?? "",
        r.registered_voters ?? 0,
        r.valid_votes ?? 0,
        r.rejected_votes ?? 0,
        r.total_votes ?? 0,
        ...partyCells,
        r.source_submission_1 || "",
        r.source_submission_2 || "",
      ];
      csv += rowToCsv(row);
    }

    const filename = `canonical-published-${timestampFilenameSuffix()}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8; header=present",
        "Content-Disposition": `attachment; filename=${filename}`,
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
