import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase } = auth;

    const url = new URL(request.url);
    const hoursAgoParam = url.searchParams.get("hours_ago");
    const verification_id = url.searchParams.get("verification_id");
    const event_type = url.searchParams.get("event_type");
    const limitParam = url.searchParams.get("limit");

    const hoursAgo = Math.max(1, parseInt(hoursAgoParam || "24", 10));
    const limit = Math.min(5000, Math.max(1, parseInt(limitParam || "500", 10)));

    let eventsQuery = supabase
      .from("verification_timeline_events")
      .select("*")
      .gte("created_at", new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);

    if (verification_id) eventsQuery = eventsQuery.eq("verification_id", verification_id);
    if (event_type) eventsQuery = eventsQuery.eq("event_type", event_type);

    const { data: events, error: evErr } = await eventsQuery;

    const eventsByVer: Record<string, any[]> = {};
    for (const e of events || []) {
      const vid = (e as any).verification_id || "unknown";
      if (!eventsByVer[vid]) eventsByVer[vid] = [];
      eventsByVer[vid].push(e);
    }

    let dashboard_hourly: any[] = [];
    try {
      const { data: mv, error: mvErr } = await supabase
        .from("mv_observability_pipeline_dashboard")
        .select("*")
        .gte("hour_bucket", new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString())
        .order("hour_bucket", { ascending: false });
      if (!mvErr && mv) {
        dashboard_hourly = mv as any[];
      }
    } catch {
      dashboard_hourly = [];
    }

    return NextResponse.json(
      { events: eventsByVer, dashboard_hourly },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
