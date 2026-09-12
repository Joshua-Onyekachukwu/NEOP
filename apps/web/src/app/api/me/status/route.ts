/**
 * GET /api/me/status
 *
 * Returns the agent's complete operational status:
 * - Profile info
 * - Onboarding status
 * - Verification status
 * - Assignment details
 * - Submission history
 * - Available actions
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user account
    const { data: account } = await supabase
      .from("user_accounts")
      .select("id, email, full_name, avatar_url")
      .eq("id", user.id)
      .single();

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Get volunteer profile
    const { data: volunteer } = await supabase
      .from("volunteers")
      .select(`
        id, status, phone, verification_status, training_status,
        training_completed_at, created_at,
        states ( name ),
        lgas ( name )
      `)
      .eq("user_id", user.id)
      .single();

    // Get latest assignment
    const { data: assignment } = await supabase
      .from("agent_assignments")
      .select(`
        id, status, observer_number, assigned_at, checked_in_at, checked_out_at,
        polling_units (
          name, official_code, registered_voters,
          states ( name ),
          lgas ( name ),
          wards ( name )
        ),
        elections ( name, type )
      `)
      .eq("volunteer_id", volunteer?.id || "")
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get submission history for this volunteer
    const { data: submissions } = await supabase
      .from("result_submissions")
      .select(`
        id, valid_votes, rejected_votes, total_votes, status,
        submitted_at, verified_at, created_at,
        polling_units ( official_code, name )
      `)
      .eq("volunteer_id", volunteer?.id || "")
      .order("submitted_at", { ascending: false })
      .limit(10);

    // Get incident count
    const { count: incidentCount } = await supabase
      .from("incidents")
      .select("*", { count: "exact", head: true })
      .eq("volunteer_id", volunteer?.id || "");

    // Determine onboarding status
    let onboardingStatus = "NOT_STARTED";
    if (volunteer) {
      if (volunteer.status === "ACTIVE" || volunteer.status === "ASSIGNED") {
        onboardingStatus = "COMPLETED";
      } else if (volunteer.status === "REGISTERED") {
        onboardingStatus = "IN_PROGRESS";
      } else {
        onboardingStatus = volunteer.status;
      }
    }

    // Determine available actions
    const actions: string[] = [];
    if (!volunteer) {
      actions.push("REGISTER");
    } else {
      if (onboardingStatus !== "COMPLETED") {
        actions.push("COMPLETE_ONBOARDING");
      }
      if (volunteer.verification_status === "NOT_REQUESTED" || volunteer.verification_status === "REJECTED") {
        actions.push("REQUEST_VERIFICATION");
      }
      if (volunteer.verification_status === "PENDING") {
        actions.push("WAIT_VERIFICATION");
      }
      if (assignment?.status === "ASSIGNED" || assignment?.status === "ACTIVATED") {
        actions.push("CHECK_IN");
      }
      if (assignment?.status === "CHECKED_IN") {
        actions.push("SUBMIT_RESULT");
        actions.push("REPORT_INCIDENT");
        actions.push("CHECK_OUT");
      }
      // Check if there's an existing submission for this assignment
      const latestSubmission = submissions?.[0];
      if (assignment?.status === "CHECKED_IN" && latestSubmission) {
        if (latestSubmission.status === "UNVERIFIED") {
          actions.push("WAIT_VERIFICATION");
        } else if (latestSubmission.status === "REJECTED") {
          actions.push("RESUBMIT_RESULT");
        }
      }
    }

    return NextResponse.json({
      account: {
        email: account.email,
        full_name: account.full_name,
        avatar_url: account.avatar_url,
      },
      volunteer: volunteer ? {
        id: volunteer.id,
        status: volunteer.status,
        phone: volunteer.phone,
        state_name: (volunteer.states as any)?.name || null,
        lga_name: (volunteer.lgas as any)?.name || null,
        created_at: volunteer.created_at,
      } : null,
      onboarding: {
        status: onboardingStatus,
        training_status: volunteer?.training_status || "NOT_STARTED",
      },
      verification: {
        status: volunteer?.verification_status || "NOT_REQUESTED",
      },
      assignment: assignment ? {
        id: assignment.id,
        status: assignment.status,
        observer_number: assignment.observer_number,
        polling_unit_name: (assignment.polling_units as any)?.name || null,
        polling_unit_code: (assignment.polling_units as any)?.official_code || null,
        registered_voters: (assignment.polling_units as any)?.registered_voters || null,
        state_name: (assignment.polling_units as any)?.states?.name || null,
        lga_name: (assignment.polling_units as any)?.lgas?.name || null,
        ward_name: (assignment.polling_units as any)?.wards?.name || null,
        election_name: (assignment.elections as any)?.name || null,
        election_type: (assignment.elections as any)?.type || null,
        assigned_at: assignment.assigned_at,
        checked_in_at: assignment.checked_in_at,
      } : null,
      submissions: (submissions || []).map((s) => ({
        id: s.id,
        valid_votes: s.valid_votes,
        rejected_votes: s.rejected_votes,
        total_votes: s.total_votes,
        status: s.status,
        submitted_at: s.submitted_at,
        verified_at: s.verified_at,
        polling_unit_code: (s.polling_units as any)?.official_code || null,
        polling_unit_name: (s.polling_units as any)?.name || null,
      })),
      stats: {
        total_submissions: submissions?.length || 0,
        verified_submissions: submissions?.filter((s) => s.status === "VERIFIED").length || 0,
        total_incidents: incidentCount || 0,
      },
      actions,
    });
  } catch (error: any) {
    console.error("[api/me/status] Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
