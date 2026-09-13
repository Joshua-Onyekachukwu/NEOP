import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, state_id, global } = auth;

    const url = new URL(request.url);
    const hoursAgoParam = url.searchParams.get("hours_ago");
    const verification_id = url.searchParams.get("verification_id");
    const event_type = url.searchParams.get("event_type");
    const limitParam = url.searchParams.get("limit");

    const hoursAgo = Math.max(1, parseInt(hoursAgoParam || "24", 10));
    const limit = Math.min(5000, Math.max(1, parseInt(limitParam || "500", 10)));
    const since = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();

    let eventsQuery = supabase
      .from("verification_timeline_events")
      .select(
        global && state_id == null
          ? "*"
          : "*, verifications!inner ( polling_unit_id, polling_units!inner ( state_id ) )"
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!global && state_id != null) {
      eventsQuery = eventsQuery.eq("verifications.polling_units.state_id", state_id);
    }
    if (verification_id) eventsQuery = eventsQuery.eq("verification_id", verification_id);
    if (event_type) eventsQuery = eventsQuery.eq("event_type", event_type);

    const { data: events, error: evErr } = await eventsQuery;

    const eventsByVer: Record<string, any[]> = {};
    const hourlyBuckets = new Map<string, Map<string, number>>();
    for (const e of events || []) {
      const ev: any = e;
      const vid = ev.verification_id || "unknown";
      if (!eventsByVer[vid]) eventsByVer[vid] = [];
      eventsByVer[vid].push(ev);

      if (!global && state_id != null) {
        const hb = new Date(ev.created_at || Date.now()).toISOString().slice(0, 13) + ":00:00Z";
        if (!hourlyBuckets.has(hb)) hourlyBuckets.set(hb, new Map());
        const perType = hourlyBuckets.get(hb)!;
        perType.set(ev.event_type, (perType.get(ev.event_type) || 0) + 1);
      }
    }

    let dashboard_hourly: any[] = [];
    if (!global && state_id != null) {
      for (const [hb, perType] of hourlyBuckets) {
        for (const [et, c] of perType) {
          dashboard_hourly.push({
            hour_bucket: hb,
            event_type: et,
            count: c,
          });
        }
      }
    } else {
      try {
        const { data: mv, error: mvErr } = await supabase
          .from("mv_observability_pipeline_dashboard")
          .select("*")
          .gte("hour_bucket", since)
          .order("hour_bucket", { ascending: false });
        if (!mvErr && mv) {
          dashboard_hourly = mv as any[];
        }
      } catch {
        dashboard_hourly = [];
      }
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
