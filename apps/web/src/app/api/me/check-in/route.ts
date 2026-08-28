/**
 * POST /api/me/check-in
 * Agent checks in at their assigned polling unit with GPS verification.
 * Body: { assignment_id, latitude, longitude, accuracy }
 * Validates GPS is within 2km of the polling unit.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    const body = await request.json();
    const { assignment_id, latitude, longitude, accuracy } = body;

    if (!assignment_id) {
      return NextResponse.json({ error: "assignment_id is required" }, { status: 400 });
    }

    if (!latitude || !longitude) {
      return NextResponse.json({ error: "GPS coordinates (latitude, longitude) are required" }, { status: 400 });
    }

    // Get volunteer
    const { data: volunteer } = await supabase
      .from("volunteers").select("id").eq("user_id", user.id).single();

    if (!volunteer) {
      return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });
    }

    // Verify assignment belongs to this volunteer and get polling unit
    const { data: assignment } = await supabase
      .from("agent_assignments")
      .select("id, status, polling_unit_id")
      .eq("id", assignment_id)
      .eq("volunteer_id", volunteer.id)
      .single();

    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    if (assignment.status === "CHECKED_IN") {
      return NextResponse.json({ error: "Already checked in" }, { status: 400 });
    }

    // Get polling unit coordinates
    const { data: pu } = await supabase
      .from("polling_units")
      .select("latitude, longitude, name, official_code")
      .eq("id", assignment.polling_unit_id)
      .single();

    if (!pu || !pu.latitude || !pu.longitude) {
      return NextResponse.json({ error: "Polling unit coordinates not available" }, { status: 400 });
    }

    // Calculate Haversine distance
    const R = 6371000; // Earth radius in meters
    const dLat = ((latitude - pu.latitude) * Math.PI) / 180;
    const dLng = ((longitude - pu.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((pu.latitude * Math.PI) / 180) *
        Math.cos((latitude * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceMeters = R * c;

    // Verification threshold: 2km for check-in
    const VERIFIED_THRESHOLD = 2000;
    const locationVerified = distanceMeters <= VERIFIED_THRESHOLD;

    // Update assignment with GPS data
    const { error: updateError } = await supabase
      .from("agent_assignments")
      .update({
        status: "CHECKED_IN",
        checked_in_at: new Date().toISOString(),
        check_in_lat: latitude,
        check_in_lng: longitude,
        check_in_accuracy: accuracy || null,
        distance_from_pu: Math.round(distanceMeters),
        location_verified: locationVerified,
      })
      .eq("id", assignment_id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to check in" }, { status: 500 });
    }

    // Log audit event
    await supabase.from("audit_log").insert({
      actor_id: volunteer.id,
      actor_type: "VOLUNTEER",
      action: "CHECKED_IN",
      resource_type: "agent_assignments",
      resource_id: assignment_id,
    });

    return NextResponse.json({
      success: true,
      location: {
        latitude,
        longitude,
        accuracy: accuracy || null,
        distance_from_pu: Math.round(distanceMeters),
        location_verified: locationVerified,
        polling_unit: {
          name: pu.name,
          code: pu.official_code,
          latitude: pu.latitude,
          longitude: pu.longitude,
        },
      },
      message: locationVerified
        ? `Checked in — ${Math.round(distanceMeters)}m from ${pu.name}`
        : `WARNING: ${Math.round(distanceMeters)}m from ${pu.name} (threshold: ${VERIFIED_THRESHOLD}m)`,
    });
  } catch (error) {
    console.error("Error checking in:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
