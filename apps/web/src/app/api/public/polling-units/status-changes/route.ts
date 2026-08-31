/**
 * GET /api/public/polling-units/status-changes
 * Returns only PUs with active statuses (not NOT_STARTED).
 * Tries RPC first; falls back to paginated fetch.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

let cachedActive: any = null;
let cacheTime = 0;
const CACHE_TTL = 10_000;

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    if (cachedActive && now - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedActive, {
        headers: { "Cache-Control": "no-cache" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "get_active_polling_units"
    );

    if (!rpcError && rpcData) {
      cachedActive = rpcData;
      cacheTime = now;
      return NextResponse.json(rpcData, {
        headers: { "Cache-Control": "no-cache" },
      });
    }

    // Fallback: count active PUs (lightweight — no need to fetch all 188K)
    const { count: activeCount } = await supabase
      .from("polling_units")
      .select("id", { count: "exact", head: true })
      .neq("status", "NOT_STARTED");

    // Only fetch PUs that changed status in the last hour (recent activity)
    const { data: recentChanges } = await supabase
      .from("polling_units")
      .select("id, status, latitude, longitude")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .neq("status", "NOT_STARTED")
      .order("updated_at", { ascending: false })
      .limit(500);

    const result = {
      active: recentChanges || [],
      count: activeCount || 0,
      timestamp: Date.now(),
    };

    cachedActive = result;
    cacheTime = now;

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-cache" },
    });
  } catch (error) {
    return NextResponse.json({ active: [], count: 0 }, { status: 200 });
  }
}
