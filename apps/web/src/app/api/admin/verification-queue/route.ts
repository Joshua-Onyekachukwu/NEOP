import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const RUNNING_STATUSES = [
  "DETERMINISTIC_RUNNING",
  "NVIDIA_RUNNING",
];

const FLAGGED_STATUSES = ["FLAGGED_AI", "NVIDIA_FAILED", "DISCREPANCY"];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, state_id, global } = auth;

    const stateScopePu = <T extends { eq?: any; or?: any }>(q: T, col = "polling_units.state_id"): T => {
      if (global || state_id == null) return q;
      return (q as any).eq(col, state_id);
    };

    const stateScopeVerPu = <T extends { eq?: any }>(q: T): T => {
      if (global || state_id == null) return q;
      return (q as any).eq("polling_units.state_id", state_id);
    };

    const [{ count: awaiting }, { count: verifyingCnt }, { count: flagged }, hrRes, { count: published }] =
      await Promise.all([
        stateScopePu(
          supabase
            .from("canonical_pu_results")
            .select("id, polling_units!inner(state_id)", { count: "exact", head: true })
            .eq("status", "ONE_SUBMISSION")
        ),
        stateScopeVerPu(
          supabase
            .from("verifications")
            .select("polling_unit_id, polling_units!inner(state_id)", { count: "exact", head: true })
            .in("status", RUNNING_STATUSES)
        ),
        stateScopeVerPu(
          supabase
            .from("verifications")
            .select("polling_unit_id, polling_units!inner(state_id)", { count: "exact", head: true })
            .in("status", FLAGGED_STATUSES)
        ),
        stateScopeVerPu(
          supabase
            .from("verifications")
            .select("polling_unit_id, canonical_result_id, status, id, updated_at, polling_units!inner(state_id)")
            .or("status.eq.DISCREPANCY,status.eq.FLAGGED_AI,status.eq.NVIDIA_FAILED")
            .order("updated_at", { ascending: false })
            .limit(200)
        ),
        stateScopePu(
          supabase
            .from("canonical_pu_results")
            .select("id, polling_units!inner(state_id)", { count: "exact", head: true })
            .eq("status", "PUBLISHED")
        ),
      ]);

    const { data: hrCanonical } = await stateScopePu(
      supabase
        .from("canonical_pu_results")
        .select("polling_unit_id, polling_units!inner(state_id)")
        .eq("status", "HUMAN_REVIEW")
    );

    const hrPuSet = new Set<string>();
    for (const r of hrRes?.data || []) hrPuSet.add((r as any).polling_unit_id);
    for (const r of hrCanonical || []) hrPuSet.add((r as any).polling_unit_id);
    const human_review_count = hrPuSet.size;

    const buckets = {
      awaiting_second_agent: Number(awaiting || 0),
      verifying: Number(verifyingCnt || 0),
      flagged_ai: Number(flagged || 0),
      human_review: human_review_count,
      published: Number(published || 0),
    };

    const severityOrder: Record<string, number> = {
      DISCREPANCY: 10,
      NVIDIA_FAILED: 9,
      FLAGGED_AI: 8,
      HUMAN_REVIEW: 7,
    };

    const detailPuIds = new Set<string>();
    for (const r of hrRes?.data || []) detailPuIds.add((r as any).polling_unit_id);
    for (const r of hrCanonical || []) detailPuIds.add((r as any).polling_unit_id);

    let items: any[] = [];

    if (detailPuIds.size > 0) {
      const combinedIds = Array.from(detailPuIds).slice(0, 200);

      const { data: canRows } = await stateScopePu(
        supabase
          .from("canonical_pu_results")
          .select(
            `id, polling_unit_id, status, source_submission_1, source_submission_2, election_id,
             polling_units!inner ( id, official_code, name, ward_id, lga_id, state_id,
               wards (name), lgas (name, state_id), states (name, code) )`
          )
          .in("polling_unit_id", combinedIds)
          .in("status", ["ONE_SUBMISSION", "HUMAN_REVIEW", "FLAGGED", "PUBLISHED", "AWAITING_AGENTS", "VERIFYING"])
      );

      const { data: verRows } = await stateScopeVerPu(
        supabase
          .from("verifications")
          .select(
            `id, canonical_result_id, polling_unit_id, election_id, status, discrepancy_score, submissions_identical, submission_id_1, submission_id_2,
             created_at, updated_at, polling_units!inner(state_id)`
          )
          .in("polling_unit_id", combinedIds)
      );

      const puToCan = new Map<string, any>();
      for (const c of canRows || []) puToCan.set((c as any).polling_unit_id, c);
      const puToVer = new Map<string, any>();
      for (const v of verRows || []) puToVer.set((v as any).polling_unit_id, v);

      const subIds = new Set<string>();
      for (const c of canRows || []) {
        if ((c as any).source_submission_1) subIds.add((c as any).source_submission_1);
        if ((c as any).source_submission_2) subIds.add((c as any).source_submission_2);
      }
      for (const v of verRows || []) {
        if ((v as any).submission_id_1) subIds.add((v as any).submission_id_1);
        if ((v as any).submission_id_2) subIds.add((v as any).submission_id_2);
      }

      const subMap = new Map<string, any>();
      if (subIds.size > 0) {
        const { data: subs } = await supabase
          .from("result_submissions")
          .select(
            `id, valid_votes, rejected_votes, total_votes, volunteer_id, assignment_id,
             volunteers ( id, user_accounts ( email, full_name ) ),
             party_results ( votes, parties ( id, abbreviation, name, color ) )`
          )
          .in("id", Array.from(subIds));
        for (const s of subs || []) subMap.set((s as any).id, s);
      }

      const buildAgent = (sid: string | null) => {
        if (!sid) return null;
        const s = subMap.get(sid);
        if (!s) return { submission_id: sid };
        const parties = (s.party_results || []).map((pr: any) => ({
          abbr: pr?.parties?.abbreviation || "?",
          votes: Number(pr?.votes || 0),
        }));
        return {
          submission_id: sid,
          volunteer_email: s?.volunteers?.user_accounts?.email || "",
          volunteer_name: s?.volunteers?.user_accounts?.full_name || "",
          valid: Number(s?.valid_votes || 0),
          rejected: Number(s?.rejected_votes || 0),
          total: Number(s?.total_votes || 0),
          parties,
        };
      };

      for (const pu_id of combinedIds) {
        const can = puToCan.get(pu_id);
        const ver = puToVer.get(pu_id);
        const pu = can?.polling_units;
        const s1id = can?.source_submission_1 || ver?.submission_id_1;
        const s2id = can?.source_submission_2 || ver?.submission_id_2;
        const a1 = buildAgent(s1id);
        const a2 = buildAgent(s2id);

        const status_flag = ver?.status === "DISCREPANCY"
          ? "DISCREPANCY"
          : ver?.status === "NVIDIA_FAILED"
          ? "NVIDIA_FAILED"
          : ver?.status === "FLAGGED_AI"
          ? "FLAGGED_AI"
          : "HUMAN_REVIEW";

        if (!a2) {
          items.push({
            canonical_id: can?.id,
            pu_code: pu?.official_code || "?",
            status_flag: "AWAITING_SECOND",
          });
          continue;
        }

        const partyMap1 = new Map((a1?.parties || []).map((p: any) => [p.abbr, p.votes]));
        const partyMap2 = new Map((a2?.parties || []).map((p: any) => [p.abbr, p.votes]));
        const allP = Array.from(new Set([...partyMap1.keys(), ...partyMap2.keys()]));
        let max_d = 0;
        const party_diffs = allP.map((abbr) => {
          const v1 = Number(partyMap1.get(abbr) || 0);
          const v2 = Number(partyMap2.get(abbr) || 0);
          const d = Math.abs(v1 - v2);
          if (d > max_d) max_d = d;
          return { abbr, v1, v2, diff: v1 - v2, abs: d };
        });
        const totals_diff =
          Math.abs(Number(a1?.valid || 0) - Number(a2?.valid || 0)) +
          Math.abs(Number(a1?.rejected || 0) - Number(a2?.rejected || 0));
        if (totals_diff > max_d) max_d = totals_diff;

        const math_ok_agent1 =
          (a1?.parties || []).reduce((s: number, p: any) => s + p.votes, 0) === (a1?.valid || 0);
        const math_ok_agent2 =
          (a2?.parties || []).reduce((s: number, p: any) => s + p.votes, 0) === (a2?.valid || 0);

        items.push({
          verification_id: ver?.id,
          canonical_id: can?.id || ver?.canonical_result_id,
          polling_unit_code: pu?.official_code || "?",
          polling_unit_name: pu?.name || "",
          state_name: pu?.states?.name || "",
          lga_name: pu?.lgas?.name || "",
          status_flag,
          agent_1: a1,
          agent_2: a2,
          diff: {
            party_diffs,
            max_diff: Number(ver?.discrepancy_score ?? max_d),
            totals_diff,
            valid_diff: (a1?.valid || 0) - (a2?.valid || 0),
            rejected_diff: (a1?.rejected || 0) - (a2?.rejected || 0),
            math_ok_agent1,
            math_ok_agent2,
          },
          evidence_links: [],
          created_at: ver?.created_at || can?.created_at,
          updated_at: ver?.updated_at || can?.updated_at,
          _severity: severityOrder[status_flag] || 5,
        });
      }
    }

    const { data: awaitingMinimal } = await stateScopePu(
      supabase
        .from("canonical_pu_results")
        .select(
          `id, polling_unit_id, polling_units!inner ( state_id, official_code )`
        )
        .eq("status", "ONE_SUBMISSION")
        .order("updated_at", { ascending: false })
        .limit(50)
    );

    for (const a of awaitingMinimal || []) {
      items.push({
        canonical_id: (a as any).id,
        pu_code: (a as any).polling_units?.official_code || "?",
        status_flag: "AWAITING_SECOND",
        _severity: 3,
      });
    }

    items.sort((a, b) => {
      const sd = (b._severity || 0) - (a._severity || 0);
      if (sd !== 0) return sd;
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    });

    items = items.slice(0, 200).map(({ _severity, ...rest }) => rest);

    return NextResponse.json(
      { buckets, items },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
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
