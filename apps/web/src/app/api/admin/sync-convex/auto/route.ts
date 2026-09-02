/**
 * POST /api/admin/sync-convex/auto
 *
 * Lightweight endpoint that syncs Supabase simulation data to Convex.
 * Called automatically when simulation completes, or manually by admin.
 *
 * Flow:
 *   1. Read party_totals RPC from Supabase
 *   2. Read state breakdown from Supabase
 *   3. Read simulation_config for status
 *   4. Upsert all into Convex via HTTP mutations
 *   5. Mark sim_config as synced
 *
 * Designed to complete within Vercel Hobby's 10-second timeout by
 * keeping queries lean and Convex mutations batched.
 *
 * No admin auth required — this is an internal endpoint called by the
 * progress polling loop. Protected by obscurity + rate limiting.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexDeployKey = process.env.CONVEX_DEPLOY_KEY || "";

export const dynamic = "force-dynamic";

// Prevent duplicate syncs within 60 seconds
let lastSyncAt = 0;
const SYNC_COOLDOWN_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    if (!convexUrl) {
      return NextResponse.json({ error: "Convex not configured" }, { status: 400 });
    }

    // Basic internal auth — this endpoint should only be called by the server
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.substring(7);
    const authClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Cooldown check
    const now = Date.now();
    if (now - lastSyncAt < SYNC_COOLDOWN_MS) {
      return NextResponse.json({
        skipped: true,
        reason: "Sync cooldown — last sync was " + Math.round((now - lastSyncAt) / 1000) + "s ago",
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Verify simulation just completed
    const { data: config } = await supabase
      .from("simulation_config")
      .select("status, election_type, scenario, total_results_submitted")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single();

    if (!config || config.status !== "COMPLETED") {
      return NextResponse.json({
        skipped: true,
        reason: "Simulation not completed (status: " + (config?.status || "none") + ")",
      });
    }

    console.log(`[auto-sync] Starting sync — simulation status: ${config.status}`);

    // Step 2: Fetch data from Supabase in parallel
    const [partyResult, stateResult, coveredResult, verifiedResult] = await Promise.all([
      supabase.rpc("get_party_totals"),
      supabase.rpc("get_state_breakdown_from_results"),
      supabase.from("result_submissions").select("id", { count: "exact", head: true }),
      supabase.from("result_submissions").select("id", { count: "exact", head: true }).eq("status", "VERIFIED"),
    ]);

    // Step 3: Build Convex mutations
    const convexApi = `${convexUrl}/api/mutation`;
    const mutations: Array<{ path: string; args: any }> = [];

    // 3a: Party totals
    if (partyResult.data && partyResult.data.length > 0) {
      const grandTotal = partyResult.data.reduce(
        (sum: number, p: any) => sum + Number(p.total_votes), 0
      );
      mutations.push({
        path: "stats:upsertPartyTotals",
        args: {
          parties: partyResult.data.map((p: any) => ({
            party_id: p.party_abbreviation,
            party_name: p.party_name,
            party_abbreviation: p.party_abbreviation,
            party_color: p.party_color,
            total_votes: Number(p.total_votes),
            percentage: grandTotal > 0
              ? Number(((Number(p.total_votes) / grandTotal) * 100).toFixed(1))
              : 0,
          })),
        },
      });
    }

    // 3b: State breakdown
    if (stateResult.data && stateResult.data.length > 0) {
      const REGION_MAP: Record<string, string> = {
        Kano: "NW", Katsina: "NW", Sokoto: "NW", Zamfara: "NW", Kebbi: "NW", Jigawa: "NW", Kaduna: "NW",
        Borno: "NE", Yobe: "NE", Adamawa: "NE", Gombe: "NE", Taraba: "NE", Bauchi: "NE",
        Niger: "NC", Kwara: "NC", Kogi: "NC", Benue: "NC", Plateau: "NC", Nasarawa: "NC", FCT: "FC",
        Lagos: "SW", Ogun: "SW", Oyo: "SW", Ondo: "SW", Osun: "SW", Ekiti: "SW",
        Abia: "SE", Anambra: "SE", Ebonyi: "SE", Enugu: "SE", Imo: "SE",
        Rivers: "SS", Delta: "SS", Bayelsa: "SS", "Akwa Ibom": "SS", "Cross River": "SS", Edo: "SS",
      };

      mutations.push({
        path: "stats:upsertStateStats",
        args: {
          states: stateResult.data.map((s: any) => ({
            state_id: s.state_id || "",
            state_name: s.state_name,
            region: REGION_MAP[s.state_name] || "NC",
            total_pus: Number(s.total_pus || s.total_polling_units || 0),
            covered_pus: Number(s.total_pus || s.total_polling_units || 0),
            verified_pus: Number(s.verified || s.verified_polling_units || 0),
            total_votes: 0,
            ndc_votes: 0, apc_votes: 0, pdp_votes: 0, lp_votes: 0, nnpp_votes: 0, apga_votes: 0, sdp_votes: 0, ypp_votes: 0, adc_votes: 0,
          })),
        },
      });
    }

    // 3c: Global stats
    const coveredCount = coveredResult.count || 0;
    const verifiedCount = verifiedResult.count || 0;
    const grandTotal = partyResult.data
      ? partyResult.data.reduce((sum: number, p: any) => sum + Number(p.total_votes), 0)
      : 0;

    mutations.push({
      path: "stats:upsertGlobalStats",
      args: {
        covered_polling_units: coveredCount,
        verified_polling_units: verifiedCount,
        total_votes: grandTotal,
        active_pu_count: coveredCount,
        simulation_running: false,
        scenario: config.scenario || "random",
        election_type: config.election_type || "PRESIDENTIAL",
      },
    });

    // 3d: Sim config
    mutations.push({
      path: "stats:updateSimConfig",
      args: {
        status: "COMPLETED",
        scenario: config.scenario || "random",
        election_type: config.election_type || "PRESIDENTIAL",
        progress_percent: 100,
        results_processed: coveredCount,
        total_results: coveredCount,
      },
    });

    // Step 4: Send mutations to Convex (fire-and-forget for speed)
    let successCount = 0;
    let errorCount = 0;
    const results: string[] = [];

    for (const mutation of mutations) {
      try {
        const res = await fetch(convexApi, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${convexDeployKey}`,
          },
          body: JSON.stringify(mutation),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          successCount++;
          results.push(`✅ ${mutation.path}`);
        } else {
          const err = await res.text().catch(() => "unknown");
          errorCount++;
          results.push(`❌ ${mutation.path}: ${err.slice(0, 100)}`);
          console.error(`[auto-sync] ${mutation.path} failed:`, err.slice(0, 200));
        }
      } catch (e: any) {
        errorCount++;
        results.push(`❌ ${mutation.path}: ${e.message}`);
        console.error(`[auto-sync] ${mutation.path} error:`, e.message);
      }
    }

    lastSyncAt = Date.now();

    console.log(`[auto-sync] Complete: ${successCount}/${mutations.length} mutations succeeded`);

    return NextResponse.json({
      success: errorCount === 0,
      mutations_sent: mutations.length,
      mutations_succeeded: successCount,
      mutations_failed: errorCount,
      details: results,
      party_count: partyResult.data?.length || 0,
      state_count: stateResult.data?.length || 0,
      total_votes: grandTotal,
      covered_pus: coveredCount,
      verified_pus: verifiedCount,
      source: "supabase",
    });
  } catch (error: any) {
    console.error("[auto-sync] Error:", error);
    return NextResponse.json(
      { error: error.message || "Sync failed" },
      { status: 500 }
    );
  }
}

/** GET: Check sync status (is Convex populated?) */
export async function GET() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json({ configured: false });
  }

  try {
    const res = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "stats:getPartyTotals", args: {} }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    const parties = data.value || [];

    return NextResponse.json({
      configured: true,
      url: convexUrl,
      party_count: parties.length,
      total_votes: parties.reduce((sum: number, p: any) => sum + (p.total_votes || 0), 0),
      last_sync: lastSyncAt > 0 ? new Date(lastSyncAt).toISOString() : null,
    });
  } catch {
    return NextResponse.json({ configured: true, error: "Convex unreachable" });
  }
}
