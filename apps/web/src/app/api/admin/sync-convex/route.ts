/**
 * POST /api/admin/sync-convex
 *
 * Syncs simulation results from Supabase to Convex for real-time dashboard.
 * Called by admin after running simulation, or automatically if CONVEX_URL is set.
 *
 * Requires admin auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // Check if Convex is configured
    if (!convexUrl) {
      return NextResponse.json(
        { error: "Convex not configured. Set NEXT_PUBLIC_CONVEX_URL in .env.local" },
        { status: 400 }
      );
    }

    // Verify admin auth
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
    const { data: adminUser } = await supabase
      .from("admin_users").select("id")
      .eq("user_id", user.id).eq("is_active", true).single();
    if (!adminUser) {
      return NextResponse.json({ error: "Not authorized as admin" }, { status: 403 });
    }

    console.log(`[sync-convex] Admin ${user.email} starting sync...`);

    // Fetch aggregated data from Supabase
    const [partyResults, stateBreakdown, configData] = await Promise.all([
      // Party totals
      supabase.rpc("get_party_totals"),
      // State breakdown
      supabase.rpc("get_state_breakdown_from_results"),
      // Config
      supabase.from("simulation_config").select("*")
        .eq("id", "00000000-0000-0000-0000-000000000001").single(),
    ]);

    // Call Convex HTTP endpoint to upsert data
    const convexApi = `${convexUrl}/api/mutation`;

    const mutations: any[] = [];

    // Upsert party totals
    if (partyResults.data && partyResults.data.length > 0) {
      const grandTotal = partyResults.data.reduce(
        (sum: number, p: any) => sum + Number(p.total_votes), 0
      );
      const parties = partyResults.data.map((p: any) => ({
        party_id: p.party_abbreviation,
        party_name: p.party_name,
        party_abbreviation: p.party_abbreviation,
        party_color: p.party_color,
        total_votes: Number(p.total_votes),
        percentage: grandTotal > 0
          ? Number(((Number(p.total_votes) / grandTotal) * 100).toFixed(1))
          : 0,
      }));
      mutations.push({
        path: "stats:upsertPartyTotals",
        args: { parties },
      });
    }

    // Upsert state stats
    if (stateBreakdown.data && stateBreakdown.data.length > 0) {
      const REGION_MAP: Record<string, string> = {
        Kano: "NW", Katsina: "NW", Sokoto: "NW", Zamfara: "NW", Kebbi: "NW", Jigawa: "NW", Kaduna: "NW",
        Borno: "NE", Yobe: "NE", Adamawa: "NE", Gombe: "NE", Taraba: "NE", Bauchi: "NE",
        Niger: "NC", Kwara: "NC", Kogi: "NC", Benue: "NC", Plateau: "NC", Nasarawa: "NC",
        Lagos: "SW", Ogun: "SW", Oyo: "SW", Ondo: "SW", Osun: "SW", Ekiti: "SW",
        Abia: "SE", Anambra: "SE", Ebonyi: "SE", Enugu: "SE", Imo: "SE",
        Rivers: "SS", Delta: "SS", Bayelsa: "SS", "Akwa Ibom": "SS", "Cross River": "SS", Edo: "SS",
        FCT: "FC",
      };
      const states = stateBreakdown.data.map((s: any) => ({
        state_id: s.state_id || "",
        state_name: s.state_name,
        region: REGION_MAP[s.state_name] || "NC",
        total_pus: Number(s.total_pus || 0),
        covered_pus: Number(s.total_pus || 0), // all PUs have results
        verified_pus: Number(s.verified || 0),
        total_votes: 0, // Will be computed from party_results
        ndc_votes: 0, apc_votes: 0, pdp_votes: 0, lp_votes: 0,
        nnpp_votes: 0, apga_votes: 0, sdp_votes: 0, ypp_votes: 0, adc_votes: 0,
      }));
      mutations.push({
        path: "stats:upsertStateStats",
        args: { states },
      });
    }

    // Upsert global stats
    const totalPU = 188042;
    const covered = partyResults.data
      ? partyResults.data.reduce((sum: number, p: any) => sum + Number(p.total_votes), 0)
      : 0;
    mutations.push({
      path: "stats:upsertGlobalStats",
      args: {
        covered_polling_units: stateBreakdown.data?.length || 0,
        verified_polling_units: 0,
        total_votes: covered,
        active_pu_count: stateBreakdown.data?.length || 0,
        simulation_running: false,
      },
    });

    // Update sim config
    mutations.push({
      path: "stats:updateSimConfig",
      args: {
        status: configData.data?.status || "COMPLETED",
        scenario: "landslide",
        election_type: configData.data?.election_type || "PRESIDENTIAL",
        progress_percent: 100,
      },
    });

    // Send all mutations to Convex
    let successCount = 0;
    let errorCount = 0;
    for (const mutation of mutations) {
      try {
        const res = await fetch(convexApi, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CONVEX_DEPLOY_KEY || ""}`,
          },
          body: JSON.stringify(mutation),
        });
        if (res.ok) successCount++;
        else {
          const err = await res.text();
          console.error(`[sync-convex] Mutation ${mutation.path} failed:`, err);
          errorCount++;
        }
      } catch (e: any) {
        console.error(`[sync-convex] Mutation ${mutation.path} error:`, e.message);
        errorCount++;
      }
    }

    console.log(`[sync-convex] Done: ${successCount} succeeded, ${errorCount} failed`);

    return NextResponse.json({
      success: true,
      mutations_sent: mutations.length,
      mutations_succeeded: successCount,
      mutations_failed: errorCount,
    });
  } catch (error: any) {
    console.error("[sync-convex] Error:", error);
    return NextResponse.json(
      { error: error.message || "Sync failed" },
      { status: 500 }
    );
  }
}
