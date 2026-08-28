/**
 * GET /api/public/config
 * Returns current election configuration and simulation status.
 * Fast — no slow count queries.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

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

// In-memory cache for config (refresh every 3s during simulation, 30s otherwise)
let cachedConfig: any = null;
let cacheTime = 0;

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    if (cachedConfig && now - cacheTime < 3000) {
      return NextResponse.json(cachedConfig);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fast query — just the config table, no count
    const { data: config } = await supabase
      .from("simulation_config")
      .select("election_type, status, started_at, total_results_submitted")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const electionType = config?.election_type || "PRESIDENTIAL";
    const electionInfo = ELECTION_TYPES[electionType] || ELECTION_TYPES.PRESIDENTIAL;

    let displayStatus = "WAITING";
    let statusLabel = "Awaiting data";
    const totalResults = config?.total_results_submitted || 0;

    if (config?.status === "RUNNING") {
      displayStatus = "SIMULATION";
      statusLabel = "Live simulation";
    } else if (config?.status === "COMPLETED" && totalResults > 0) {
      displayStatus = "LIVE";
      statusLabel = "Live election data";
    } else if (totalResults > 0) {
      displayStatus = "LIVE";
      statusLabel = "Live election data";
    }

    const result = {
      election_type: electionType,
      title: electionInfo.title,
      subtitle: electionInfo.subtitle,
      date: electionInfo.date,
      total_polling_units: INEC_TOTAL_PUS,
      display_status: displayStatus,
      status_label: statusLabel,
      total_results: totalResults,
      simulation_started: config?.started_at || null,
      available_types: Object.keys(ELECTION_TYPES),
    };

    cachedConfig = result;
    cacheTime = now;

    return NextResponse.json(result);
  } catch {
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
