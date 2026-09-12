import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

type Decision = "ACCEPT_AGENT_1" | "ACCEPT_AGENT_2" | "MANUAL_VALUES";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, adminUser } = auth;

    const body = await request.json();
    const verification_id: string = body.verification_id;
    const decision: Decision = body.decision;
    const reason: string = body.reason;
    const manual_values: any = body.manual_values;

    if (!verification_id || !UUID_RE.test(verification_id)) {
      return NextResponse.json({ error: "valid verification_id required" }, { status: 400 });
    }
    if (!decision || !["ACCEPT_AGENT_1", "ACCEPT_AGENT_2", "MANUAL_VALUES"].includes(decision)) {
      return NextResponse.json({ error: "invalid decision" }, { status: 400 });
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason required (non-empty)" }, { status: 400 });
    }
    if (decision === "MANUAL_VALUES") {
      if (!manual_values) {
        return NextResponse.json({ error: "manual_values required" }, { status: 400 });
      }
      if (
        typeof manual_values.valid_votes !== "number" ||
        typeof manual_values.rejected_votes !== "number" ||
        typeof manual_values.total_votes !== "number" ||
        !Array.isArray(manual_values.party_votes)
      ) {
        return NextResponse.json(
          { error: "manual_values must contain valid/rejected/total votes and party_votes array" },
          { status: 400 }
        );
      }
    }

    const { data: ver, error: verErr } = await supabase
      .from("verifications")
      .select(
        `id, canonical_id, election_id, pu_id, status, identical, submission1_id, submission2_id,
         canonical_pu_results!inner ( id, election_id, pu_id, submission1_id, submission2_id ),
         sub1:result_submissions!verifications_submission1_id_fkey (
           id, valid_votes, rejected_votes, total_votes,
           party_results ( party_id, votes, parties ( id, abbreviation ) )
         ),
         sub2:result_submissions!verifications_submission2_id_fkey (
           id, valid_votes, rejected_votes, total_votes,
           party_results ( party_id, votes, parties ( id, abbreviation ) )
         )`
      )
      .eq("id", verification_id)
      .single();

    if (verErr || !ver) {
      return NextResponse.json({ error: "verification not found" }, { status: 404 });
    }

    const v: any = ver;
    const chosenSub =
      decision === "ACCEPT_AGENT_1"
        ? v.sub1
        : decision === "ACCEPT_AGENT_2"
        ? v.sub2
        : null;

    let final_valid: number;
    let final_rejected: number;
    let final_total: number;
    let final_party_votes: { party_id: string; votes: number }[];

    if (decision === "MANUAL_VALUES") {
      final_valid = Math.max(0, Math.floor(manual_values.valid_votes));
      final_rejected = Math.max(0, Math.floor(manual_values.rejected_votes));
      final_total = Math.max(0, Math.floor(manual_values.total_votes));
      final_party_votes = manual_values.party_votes.map((pv: any) => ({
        party_id: String(pv.party_id),
        votes: Math.max(0, Math.floor(Number(pv.votes || 0))),
      }));
    } else {
      const s: any = chosenSub;
      final_valid = Number(s?.valid_votes || 0);
      final_rejected = Number(s?.rejected_votes || 0);
      final_total = Number(s?.total_votes || 0);
      final_party_votes = (s?.party_results || []).map((pr: any) => ({
        party_id: pr?.party_id || pr?.parties?.id,
        votes: Number(pr?.votes || 0),
      }));
    }

    const { data: pubData, error: pubErr } = await supabase.rpc("publish_canonical_result", {
      p_election_id: v.election_id,
      p_pu_id: v.pu_id,
      p_status: "PUBLISHED",
      p_valid_votes: final_valid,
      p_rejected_votes: final_rejected,
      p_total_votes: final_total,
      p_source1_id: v.submission1_id,
      p_source2_id: v.submission2_id,
      p_party_votes: final_party_votes,
      p_admin_id: adminUser.id,
    });

    const pd: any = pubData || {};
    const canonical_id = pd?.out_canonical_id || pd?.canonical_id || v.canonical_id;
    const out_was_superseded_count = Number(pd?.out_superseded || pd?.superseded_count || 0);
    const out_party_count = Number(pd?.out_party_count || pd?.party_count || final_party_votes.length);

    const final_decision = v.identical
      ? "ADMIN_OVERRIDE_MATCH"
      : "ADMIN_OVERRIDE_DISCREPANCY";

    await supabase
      .from("verifications")
      .update({
        status: "RESOLVED_ADMIN",
        final_decision,
        decided_by: adminUser.id,
        decided_at: new Date().toISOString(),
        decision_notes: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", verification_id);

    try {
      revalidateTag("stats");
      revalidateTag("party-results");
      revalidateTag("public-results");
      revalidateTag("config");
      revalidatePath("/");
      revalidatePath("/results");
      revalidatePath("/live");
    } catch {}

    try {
      await supabase.from("audit_log").insert({
        action: "ADMIN_RESOLVE_DISCREPANCY",
        actor_id: adminUser.id,
        actor_type: "admin",
        resource_type: "verifications",
        resource_id: verification_id,
        metadata: {
          verification_id,
          decision,
          reason,
          canonical_id,
          final_valid,
          final_rejected,
          final_total,
          final_party_votes,
          out_was_superseded_count,
          out_party_count,
        },
        created_at: new Date().toISOString(),
      });
    } catch {}

    return NextResponse.json({
      success: true,
      canonical_id,
      out_was_superseded_count,
      out_party_count,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
