/**
 * GET /api/public/config
 * Returns the current election configuration for the public dashboard.
 * Admin can change the election type; this endpoint reads from simulation_config.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ELECTION_TYPES: Record<string, { title: string; subtitle: string; date: string }> = {
  PRESIDENTIAL: {
    title: "Presidential & National Assembly Election",
    subtitle: "16 January 2027",
    date: "2027-01-16",
  },
  GOVERNORSHIP: {
    title: "Governorship & State Assembly Election",
    subtitle: "6 February 2027",
    date: "2027-02-06",
  },
};

export async function GET(_request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get current election type from simulation_config
    const { data: config } = await supabase
      .from("simulation_config")
      .select("election_type")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const electionType = config?.election_type || "PRESIDENTIAL";
    const electionInfo = ELECTION_TYPES[electionType] || ELECTION_TYPES.PRESIDENTIAL;

    // Get total PUs for the hero number
    const { count: totalPUs } = await supabase
      .from("polling_units")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      election_type: electionType,
      title: electionInfo.title,
      subtitle: electionInfo.subtitle,
      date: electionInfo.date,
      total_polling_units: totalPUs || 188042,
      available_types: Object.keys(ELECTION_TYPES),
    });
  } catch (error) {
    // Default to presidential if config table doesn't exist
    return NextResponse.json({
      election_type: "PRESIDENTIAL",
      title: "Presidential & National Assembly Election",
      subtitle: "16 January 2027",
      date: "2027-01-16",
      total_polling_units: 176846,
      available_types: ["PRESIDENTIAL", "GOVERNORSHIP"],
    });
  }
}
