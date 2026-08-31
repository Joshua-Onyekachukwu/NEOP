/**
 * POST /api/admin/simulate
 *
 * Runs the election simulation via a single SQL function call.
 * The heavy work (188K PUs, millions of votes) happens inside Postgres.
 * This API returns in <5 seconds instead of timing out.
 *
 * Body: {
 *   scenario?: "landslide" | "close" | "sweep" | "random",
 *   duration_minutes?: number,
 *   total_voters?: number,
 *   election_type?: "PRESIDENTIAL" | "GOVERNORSHIP",
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const dynamic = "force-dynamic";
// Allow up to 4 minutes — simulation processes 188K PUs in Postgres
export const maxDuration = 240;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      scenario: scenarioKey,
      duration_minutes,
      total_voters,
      election_type,
    } = body;

    // Create a client with longer timeout for simulation
    const customFetch = (url: string, init: RequestInit) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 240000);
      return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
    };
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { fetch: customFetch as any },
    });

    // Verify admin — require auth header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: adminUser } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();
    if (!adminUser) {
      return NextResponse.json({ error: "Not authorized as admin" }, { status: 403 });
    }

    console.log(
      `[sim] Starting simulation: scenario=${scenarioKey || "random"}, voters=${total_voters || 100_000_000}, type=${election_type || "PRESIDENTIAL"}`
    );

    // Call the fast SQL function — runs entirely in Postgres (1-3 min for 188K PUs)
    const { data, error } = await supabase.rpc("run_fast_simulation", {
      p_scenario: scenarioKey || "random",
      p_duration_minutes: duration_minutes || 5,
      p_total_voters: total_voters || 100_000_000,
      p_election_type: election_type || "PRESIDENTIAL",
    });

    if (error) {
      console.error("[sim] SQL function error:", error);
      return NextResponse.json(
        { error: `Simulation failed: ${error.message}` },
        { status: 500 }
      );
    }

    console.log("[sim] Simulation complete:", data);

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[sim] Error:", error);
    return NextResponse.json(
      { error: error.message || "Simulation failed" },
      { status: 500 }
    );
  }
}
