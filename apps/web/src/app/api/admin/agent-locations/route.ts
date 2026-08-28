/**
 * GET /api/admin/agent-locations
 * Returns all currently checked-in agents with their GPS locations
 * and distance from polling unit.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try RPC first
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_agent_locations");

    if (!rpcError && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
      return NextResponse.json({ agents: rpcData });
    }

    // Fallback: direct query
    const { data: agents, error } = await supabase
      .from("agent_assignments")
      .select(`
        id,
        status,
        check_in_lat,
        check_in_lng,
        check_in_accuracy,
        distance_from_pu,
        location_verified,
        checked_in_at,
        volunteers ( user_accounts ( full_name ) ),
        polling_units ( name, official_code, latitude, longitude ),
        states:polling_units!polling_units_state_id_fkey ( name )
      `)
      .eq("status", "CHECKED_IN")
      .not("check_in_lat", "is", null)
      .order("checked_in_at", { ascending: false });

    if (error) {
      return NextResponse.json({ agents: [] });
    }

    const formatted = (agents || []).map((a: any) => ({
      assignment_id: a.id,
      volunteer_name: a.volunteers?.user_accounts?.full_name || "Unknown",
      polling_unit_name: a.polling_units?.name || "Unknown",
      polling_unit_code: a.polling_units?.official_code || "—",
      state_name: a.polling_units?.states?.name || "Unknown",
      check_in_lat: a.check_in_lat,
      check_in_lng: a.check_in_lng,
      check_in_accuracy: a.check_in_accuracy,
      distance_from_pu: a.distance_from_pu,
      location_verified: a.location_verified,
      checked_in_at: a.checked_in_at,
      status: a.status,
    }));

    return NextResponse.json({ agents: formatted });
  } catch (error) {
    console.error("Error fetching agent locations:", error);
    return NextResponse.json({ agents: [] });
  }
}
