/**
 * GET /api/public/config
 * Returns current election configuration, simulation status, and accurate PU count.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Official INEC polling unit count (as of 2026)
const INEC_TOTAL_PUS = 176846;

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

    // Get current config
    const { data: config } = await supabase
      .from("simulation_config")
      .select("election_type, status, started_at, last_tick_at, total_results_submitted")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const electionType = config?.election_type || "PRESIDENTIAL";
    const electionInfo = ELECTION_TYPES[electionType] || ELECTION_TYPES.PRESIDENTIAL;

    // Determine display status
    // If results exist and no simulation is running → LIVE DATA
    // If simulation_config.status is RUNNING → SIMULATION IN PROGRESS
    // If no results exist → WAITING
    let displayStatus = "WAITING";
    let statusLabel = "Awaiting data";
    const { count: resultCount } = await supabase
      .from("result_submissions")
      .select("*", { count: "exact", head: true });

    if (config?.status === "RUNNING") {
      displayStatus = "SIMULATION";
      statusLabel = "Simulation in progress";
    } else if (resultCount && resultCount > 0) {
      displayStatus = "LIVE";
      statusLabel = "Live election data";
    }

    return NextResponse.json({
      election_type: electionType,
      title: electionInfo.title,
      subtitle: electionInfo.subtitle,
      date: electionInfo.date,
      total_polling_units: INEC_TOTAL_PUS,
      display_status: displayStatus,
      status_label: statusLabel,
      total_results: resultCount || 0,
      simulation_started: config?.started_at || null,
      available_types: Object.keys(ELECTION_TYPES),
    });
  } catch (error) {
    return NextResponse.json({
      election_type: "PRESIDENTIAL",
      title: "Presidential & National Assembly Election",
      subtitle: "16 January 2027",
      date: "2027-01-16",
      total_polling_units: INEC_TOTAL_PUS,
      display_status: "WAITING",
      status_label: "Awaiting data",
      total_results: 0,
      simulation_started: null,
      available_types: ["PRESIDENTIAL", "GOVERNORSHIP"],
    });
  }
}
