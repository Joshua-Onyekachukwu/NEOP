/**
 * GET /api/admin/volunteers/[id]
 * GET + PATCH for individual agent management
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, isAdminSuccess } from "@/lib/admin-auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAdmin(request);
    if (!isAdminSuccess(auth)) return auth.error;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { id } = params;

    const { data: volunteer, error } = await supabase
      .from("volunteers")
      .select(`
        id, status, phone, verification_status, training_status,
        training_completed_at, selected_polling_unit_id,
        created_at, updated_at,
        user_accounts ( id, email, full_name, avatar_url ),
        states ( name ),
        lgas ( name )
      `)
      .eq("id", id)
      .single();

    if (error || !volunteer) {
      return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });
    }

    // Get assignments
    const { data: assignments } = await supabase
      .from("agent_assignments")
      .select(`
        id, status, observer_number, assigned_at, checked_in_at, checked_out_at,
        polling_units ( name, official_code ),
        elections ( name, type )
      `)
      .eq("volunteer_id", id)
      .order("assigned_at", { ascending: false });

    // Get submissions
    const { data: submissions } = await supabase
      .from("result_submissions")
      .select(`
        id, valid_votes, rejected_votes, total_votes, status,
        submitted_at, verified_at,
        polling_units ( official_code, name )
      `)
      .eq("volunteer_id", id)
      .order("submitted_at", { ascending: false });

    // Get incidents
    const { data: incidents } = await supabase
      .from("incidents")
      .select(`
        id, category, severity, what_observed, status, submitted_at,
        polling_units ( official_code )
      `)
      .eq("volunteer_id", id)
      .order("submitted_at", { ascending: false });

    // Get audit log
    const { data: auditLog } = await supabase
      .from("audit_log")
      .select("action, resource_type, metadata, created_at")
      .eq("actor_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    return NextResponse.json({
      volunteer: {
        ...volunteer,
        user_accounts: volunteer.user_accounts,
      },
      assignments: assignments || [],
      submissions: submissions || [],
      incidents: incidents || [],
      audit_log: auditLog || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAdmin(request);
    if (!isAdminSuccess(auth)) return auth.error;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { id } = params;
    const body = await request.json();

    const { verification_status, status, training_status } = body;
    const updates: Record<string, any> = {};

    if (verification_status) {
      updates.verification_status = verification_status;
    }
    if (status) {
      updates.status = status;
    }
    if (training_status) {
      updates.training_status = training_status;
      if (training_status === "COMPLETED") {
        updates.training_completed_at = new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid updates provided" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data: volunteer, error } = await supabase
      .from("volunteers")
      .update(updates)
      .eq("id", id)
      .select("id, verification_status, status, training_status")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log
    await supabase.from("audit_log").insert({
      actor_id: auth.userId,
      actor_type: "ADMIN",
      action: `VOLUNTEER_${Object.keys(updates).filter(k => k !== "updated_at").join("_").toUpperCase()}_UPDATED`,
      resource_type: "volunteers",
      resource_id: id,
      metadata: JSON.stringify(updates),
    });

    return NextResponse.json({ success: true, volunteer });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
