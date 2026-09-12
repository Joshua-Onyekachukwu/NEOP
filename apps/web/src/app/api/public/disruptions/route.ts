/**
 * GET /api/public/disruptions
 * Public endpoint for disruption/incident data on the live dashboard.
 *
 * Returns:
 *   - disruptions: recent incidents with PU details
 *   - summary: counts by category and severity
 *   - map_markers: PUs with disruptions for map overlay
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CATEGORY_LABELS: Record<string, string> = {
  VIOLENCE: "Violence",
  INTIMIDATION: "Intimidation",
  DISRUPTION: "Disruption",
  ELECTION_NOT_HELD: "Election Not Held",
  MATERIAL_SHORTAGE: "Material Shortage",
  POLLING_UNIT_RELOCATION: "PU Relocation",
  ACCESS_PROBLEM: "Access Problem",
  SECURITY_INCIDENT: "Security Incident",
  OTHER: "Other",
};

const CATEGORY_ICONS: Record<string, string> = {
  VIOLENCE: "🔴",
  INTIMIDATION: "🟠",
  DISRUPTION: "🟡",
  ELECTION_NOT_HELD: "⛔",
  MATERIAL_SHORTAGE: "📦",
  POLLING_UNIT_RELOCATION: "🔄",
  ACCESS_PROBLEM: "🚫",
  SECURITY_INCIDENT: "🚨",
  OTHER: "⚠️",
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#EF4444",
  HIGH: "#F97316",
  MEDIUM: "#F59E0B",
  LOW: "#6B7280",
};

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const category = searchParams.get("category")?.toUpperCase();
    const severity = searchParams.get("severity")?.toUpperCase();
    const state = searchParams.get("state");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch recent disruptions with PU details
    let query = supabase
      .from("incidents")
      .select(`
        id, category, severity, what_observed, when_observed, status, agent_safe, submitted_at,
        polling_units (
          id, official_code, name, state_id, latitude, longitude,
          states ( id, name, code )
        )
      `)
      .order("submitted_at", { ascending: false })
      .limit(limit);

    if (category) query = query.eq("category", category);
    if (severity) query = query.eq("severity", severity);

    const { data: incidents, error: incError } = await query;

    if (incError) {
      console.error("Disruptions fetch error:", incError);
      return NextResponse.json({ error: "Failed to fetch disruptions" }, { status: 500 });
    }

    // Apply state filter post-query
    let filtered = incidents || [];
    if (state) {
      filtered = filtered.filter((i: any) => {
        return i.polling_units?.states?.name?.toLowerCase().includes(state.toLowerCase());
      });
    }

    // 2. Format disruptions for display
    const disruptions = filtered.map((i: any) => ({
      id: i.id,
      category: i.category,
      category_label: CATEGORY_LABELS[i.category] || i.category,
      category_icon: CATEGORY_ICONS[i.category] || "⚠️",
      severity: i.severity,
      severity_color: SEVERITY_COLORS[i.severity] || "#6B7280",
      description: i.what_observed,
      status: i.status,
      agent_safe: i.agent_safe,
      polling_unit: {
        code: i.polling_units?.official_code || "Unknown",
        name: i.polling_units?.name || "Unknown",
        state: i.polling_units?.states?.name || "Unknown",
        state_code: i.polling_units?.states?.code || "",
      },
      reported_at: i.submitted_at || i.when_observed,
    }));

    // 3. Build summary counts
    const categoryCounts: Record<string, number> = {};
    const severityCounts: Record<string, number> = {};
    let unsafeCount = 0;

    for (const i of filtered) {
      categoryCounts[i.category] = (categoryCounts[i.category] || 0) + 1;
      severityCounts[i.severity] = (severityCounts[i.severity] || 0) + 1;
      if (i.agent_safe === false) unsafeCount++;
    }

    const summary = {
      total: filtered.length,
      by_category: Object.entries(categoryCounts)
        .map(([cat, count]) => ({
          category: cat,
          label: CATEGORY_LABELS[cat] || cat,
          icon: CATEGORY_ICONS[cat] || "⚠️",
          count,
        }))
        .sort((a, b) => b.count - a.count),
      by_severity: Object.entries(severityCounts)
        .map(([sev, count]) => ({
          severity: sev,
          count,
          color: SEVERITY_COLORS[sev] || "#6B7280",
        }))
        .sort((a, b) => b.count - a.count),
      agents_unsafe: unsafeCount,
    };

    // 4. Map markers — PUs with disruptions for overlay
    const mapMarkers = filtered
      .filter((i: any) => i.polling_units?.latitude && i.polling_units?.longitude)
      .map((i: any) => ({
        id: i.id,
        latitude: i.polling_units.latitude,
        longitude: i.polling_units.longitude,
        category: i.category,
        severity: i.severity,
        color: SEVERITY_COLORS[i.severity] || "#6B7280",
        code: i.polling_units.official_code,
        name: i.polling_units.name,
        state: i.polling_units.states?.name || "",
      }));

    return NextResponse.json({
      disruptions,
      summary,
      map_markers: mapMarkers,
      disclaimer: "Incident reports are filed by field observers in real time. They are unverified until reviewed by administrators.",
    }, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
        "Surrogate-Control": "max-age=10, stale-if-error=120",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Disruptions error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
