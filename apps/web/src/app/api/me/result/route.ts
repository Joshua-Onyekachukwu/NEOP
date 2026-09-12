/**
 * POST /api/me/result
 * Submit election results for a polling unit.
 *
 * P0 fixes applied (2026-09-12 audit):
 *  - S6: Volunteer SUSPENDED/WITHDRAWN/REJECTED => 403
 *  - S7: Zod ResultSubmissionSchema validation at head; accepts both
 *        abbreviation object ({APC:182,...}) OR array [{party_id:UUID,votes:int}]
 *  - S5: Atomic DB submit via RPC submit_result_atomic() — both inserts in one tx
 *  - S11: idempotency_key dedup handled inside RPC (200 repeat, not 500)
 *  - S4: state transitions enforced by DB trigger trg_result_state_machine
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { ResultSubmissionSchema } from "@platform/validation";
import { revalidateTag, revalidatePath } from "next/cache";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // P0 #S6: Get volunteer + status (revoked accounts 403 later)
    const { data: volunteer } = await supabase
      .from("volunteers")
      .select("id, status")
      .eq("user_id", user.id)
      .single();

    if (!volunteer) {
      return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });
    }

    if (
      ["SUSPENDED", "WITHDRAWN", "REJECTED", "TRAINING_EXPIRED", "VERIFICATION_FAILED"].includes(
        volunteer.status
      )
    ) {
      return NextResponse.json(
        { error: "Account not eligible to submit. Status: " + volunteer.status },
        { status: 403 }
      );
    }

    const rawBody = await request.json();
    const assignmentId = rawBody.assignment_id;

    if (!assignmentId) {
      return NextResponse.json(
        { error: "Missing required field: assignment_id" },
        { status: 400 }
      );
    }

    const { data: assignment } = await supabase
      .from("agent_assignments")
      .select("id, polling_unit_id, election_id, status")
      .eq("id", assignmentId)
      .eq("volunteer_id", volunteer.id)
      .single();

    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }
    if (assignment.status !== "CHECKED_IN") {
      return NextResponse.json(
        { error: "Must be checked in to submit results", current_assignment_status: assignment.status },
        { status: 400 }
      );
    }

    // P0 #S7: Normalize party_results shape then Zod validate
    let normalizedBody = {
      ...rawBody,
      election_id: assignment.election_id,
      polling_unit_id: assignment.polling_unit_id,
    };

    if (
      rawBody.party_results &&
      !Array.isArray(rawBody.party_results) &&
      typeof rawBody.party_results === "object"
    ) {
      // Legacy backward-compat: { APC: 182, PDP: 143 } abbreviation keyed
      const { data: parties } = await supabase.from("parties").select("id, abbreviation");
      const abbrToId = new Map(
        (parties || []).map((p: any) => [(p.abbreviation || "").toUpperCase(), p.id])
      );
      const arr: Array<{ party_id: string; votes: number }> = [];
      for (const [abbr, votes] of Object.entries(
        rawBody.party_results as Record<string, number>
      )) {
        const pid = abbrToId.get(abbr.toUpperCase());
        if (pid) arr.push({ party_id: pid, votes: Number(votes) || 0 });
      }
      normalizedBody.party_results = arr;
    }

    const vv = Number(normalizedBody.valid_votes ?? 0);
    const rv = Number(normalizedBody.rejected_votes ?? 0);
    normalizedBody.valid_votes = vv;
    normalizedBody.rejected_votes = rv;
    if (!normalizedBody.idempotency_key) {
      normalizedBody.idempotency_key = rawBody.idempotency_key || randomUUID();
    }

    const parsed = ResultSubmissionSchema.safeParse(normalizedBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
          received: normalizedBody,
        },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const idemKey = body.idempotency_key || rawBody.idempotency_key;

    // P0 #S5: atomic submission via RPC (signature matches 220 patched — param=p_idem, out cols out_*, 9 core params only)
    const { data: rpcRows, error: rpcErr } = await supabase.rpc("submit_result_atomic", {
      p_idem: idemKey,
      p_assignment_id: assignment.id,
      p_volunteer_id: volunteer.id,
      p_election_id: assignment.election_id,
      p_polling_unit_id: assignment.polling_unit_id,
      p_valid_votes: body.valid_votes,
      p_rejected_votes: body.rejected_votes,
      p_total_votes: body.valid_votes + body.rejected_votes,
      p_party_results: JSON.stringify(body.party_results),
    });

    if (rpcErr || !Array.isArray(rpcRows) || rpcRows.length === 0) {
      console.error("[me/result] submit_result_atomic failed:", rpcErr?.message || rpcErr);
      return NextResponse.json(
        { error: "Database failed to record submission" },
        { status: 500 }
      );
    }

    const row = rpcRows[0];
    const resultId = row.out_submission_id;
    const wasRepeat = !!row.out_is_repeat;

    // audit
    try {
      await supabase.from("audit_log").insert({
        actor_id: volunteer.id,
        actor_type: "VOLUNTEER",
        action: wasRepeat ? "RESULT_RESUBMISSION_IDEMPOTENT_HIT" : "RESULT_SUBMITTED",
        resource_type: "result_submissions",
        resource_id: resultId,
        metadata: {
          valid_votes: body.valid_votes,
          rejected_votes: body.rejected_votes,
          total_votes: body.valid_votes + body.rejected_votes,
          idempotency_key: idemKey,
          repeat: wasRepeat,
        },
      });
    } catch (err) {
      console.warn("[me/result] audit_log insert failed", err);
    }

    // Non-blocking verification pipeline + cache invalidation
    try {
      if (!wasRepeat) {
        revalidateTag("stats");
        revalidateTag("party-results");
        revalidatePath("/");
        revalidatePath("/live");
        revalidatePath("/results");
      }

      const verifyUrl = `${request.nextUrl.origin}/api/verify/result`;
      fetch(verifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ result_id: resultId }),
      }).catch((err) =>
        console.error("[me/result] verification trigger failed:", err?.message || err)
      );
    } catch {
      /* non-critical — retry later via admin dashboard */
    }

    return NextResponse.json({
      success: true,
      id: resultId,
      status: row.status || "UNVERIFIED",
      idempotent_repeat: wasRepeat,
      message: wasRepeat
        ? "Result already recorded (idempotent repeat)"
        : "Result submitted successfully",
      party_count: row.party_row_count ?? body.party_results.length,
    });
  } catch (error: any) {
    console.error("[me/result] uncaught:", error?.message || error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
