/**
 * POST /api/admin/simulate
 *
 * Runs the election simulation via a single SQL function call.
 * The heavy work (188K PUs, millions of votes) happens inside Postgres.
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
import { invalidateAllCaches } from "@/lib/api-cache";

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

    // Verify admin — require auth header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.substring(7);

    // Create a Supabase client with 4-minute timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 230_000);

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
          return fetch(input, { ...init, signal: controller.signal });
        }) as typeof fetch,
      },
    });

    try {
      // Verify user is admin
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
        `[sim] Admin ${user.email} starting simulation: scenario=${scenarioKey || "random"}, voters=${total_voters || 100_000_000}, type=${election_type || "PRESIDENTIAL"}`
      );

      // Call the fast SQL function — runs entirely in Postgres
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

      console.log("[sim] Simulation complete:", JSON.stringify(data).slice(0, 500));

      // Invalidate all CDN/serverless caches so the live dashboard shows fresh data
      try {
        invalidateAllCaches();
        console.log("[sim] All caches invalidated");
      } catch (e) {
        console.error("[sim] Cache invalidation failed (non-fatal):", e);
      }

      return NextResponse.json(data);
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: any) {
    console.error("[sim] Error:", error);
    if (error.name === "AbortError") {
      return NextResponse.json(
        { error: "Simulation timed out after 4 minutes. The function may still be running in the database. Check the admin dashboard in a few minutes." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: error.message || "Simulation failed" },
      { status: 500 }
    );
  }
}
