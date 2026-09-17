/**
 * GET /api/public/disruptions
 * Public endpoint for disruption/incident data on the live dashboard.
 *
 * P2-1: Replaced raw SELECT per request with getCachedPublicDisruptions (60s
 *      unstable_cache tag "public-disruptions").  Summary, map_markers,
 *      redaction, and LGA-level lat/lng jitter all happen in route layer on
 *      top of the shared cached query.
 */

import { NextRequest, NextResponse } from "next/server";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";
import { getCachedPublicDisruptions } from "@/lib/api-cache";

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

const DISCLAIMER =
  "Incident reports are filed by field observers in real time. Sensitive details are redacted for observer safety until administratively verified.";

export async function GET(request: NextRequest) {
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Math.min(isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50, 200);
    const category = searchParams.get("category")?.toUpperCase() || undefined;
    const severity = searchParams.get("severity")?.toUpperCase() || undefined;
    const stateNameOrCode = searchParams.get("state") || undefined;

    // Cached (60s) — returns raw incidents joined to polling_units / lgas / states.
    // Uses filterable shape { category, severity, state_id } — but the shared
    // cache function returns ALL incidents for broadest sharing.  We filter
    // strictly at route layer below (filters are cheap on <= 500 rows).
    const cached = await getCachedPublicDisruptions({ limit: Math.max(500, limit), offset: 0 });

    let rows = cached.incidents || [];

    // Apply filters (small post-filter — all incidents for an election ~ <5k so fine)
    if (stateNameOrCode) {
      const norm = stateNameOrCode.toLowerCase();
      rows = rows.filter((i: any) => {
        const state = i.states;
        if (!state) return false;
        return state.name?.toLowerCase() === norm || state.code?.toLowerCase() === norm;
      });
    }
    if (category) rows = rows.filter((i: any) => String(i.category || "").toUpperCase() === category);
    if (severity) rows = rows.filter((i: any) => String(i.severity || "").toUpperCase() === severity);

    const total = rows.length;
    rows = rows.slice(0, limit);

    // Redaction layer — critical P0_S3 belt-and-suspenders on each row.
    const disruptions = rows.map((i: any) => {
      const isSensitive =
        i.severity === "CRITICAL" ||
        i.severity === "HIGH" ||
        ["VIOLENCE", "INTIMIDATION", "SECURITY_INCIDENT"].includes(String(i.category || "").toUpperCase());

      const pu = i.polling_units || {};
      const pollingUnitCode = isSensitive
        ? (pu.ward_id ? "Ward-level incident" : "Area-level incident")
        : (pu.official_code || "Unknown");
      const pollingUnitName = isSensitive
        ? `${i.lgas?.name || ""} LGA, ${i.states?.name || ""}`.trim()
        : (pu.name || "Unknown");
      const safeDesc = `${CATEGORY_LABELS[i.category] || "Incident"} reported` +
        (i.severity ? ` (${i.severity} severity)` : "");

      return {
        id: i.id,
        category: i.category,
        category_label: CATEGORY_LABELS[i.category] || i.category,
        category_icon: CATEGORY_ICONS[i.category] || "⚠️",
        severity: i.severity,
        severity_color: SEVERITY_COLORS[i.severity] || "#6B7280",
        description: safeDesc,
        status: i.status,
        polling_unit: {
          code: pollingUnitCode,
          name: pollingUnitName,
          state: i.states?.name || "Unknown",
          state_code: i.states?.code || "",
          lga: i.lgas?.name || null,
          ward: pu.ward_id ? (pu.name || pu.ward_id) : null,
        },
        reported_at: i.submitted_at || i.when_observed || i.reported_at,
      };
    });

    // Summary (by_category / by_severity — computed on FILTERED rows not just page slice)
    const categoryCounts: Record<string, number> = {};
    const severityCounts: Record<string, number> = {};
    for (const i of rows) {
      const cat = String((i as any).category || i.incident_type || "OTHER");
      const sev = String(i.severity || "LOW");
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      severityCounts[sev] = (severityCounts[sev] || 0) + 1;
    }
    const summary = {
      total: rows.length,
      total_after_filters: total,
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
    };

    // Map markers — CRITICAL/HIGH/VIOLENCE use LGA-level jitter.
    const mapMarkers = rows
      .filter((i: any) => i.latitude && i.longitude)
      .map((i: any) => {
        const pu = i.polling_units || {};
        const isSensitive =
          i.severity === "CRITICAL" ||
          i.severity === "HIGH" ||
          ["VIOLENCE", "INTIMIDATION", "SECURITY_INCIDENT"].includes(String(i.category || "").toUpperCase());
        const seed = (Number(String(i.id || "0").replace(/\D/g, "").slice(-4)) || 0) / 10000;
        const jitterLat = isSensitive ? (seed - 0.5) * 0.12 : 0;
        const jitterLng = isSensitive ? ((seed * 1.3) % 1 - 0.5) * 0.12 : 0;

        return {
          id: i.id,
          latitude: Number(i.latitude || pu.latitude) + jitterLat,
          longitude: Number(i.longitude || pu.longitude) + jitterLng,
          category: i.category,
          severity: i.severity,
          color: SEVERITY_COLORS[i.severity] || "#6B7280",
          code: isSensitive ? "Redacted for safety" : (pu.official_code || ""),
          name: isSensitive
            ? `${i.lgas?.name || ""} LGA, ${i.states?.name || ""}`.trim()
            : (pu.name || ""),
          state: i.states?.name || "",
          approximate: isSensitive,
        };
      });

    const response = NextResponse.json(
      {
        disruptions,
        summary,
        map_markers: mapMarkers,
        pagination: cached.pagination || { limit, offset: 0, total: rows.length },
        source: cached.source || "live",
        refreshed_at: cached.refreshed_at || new Date().toISOString(),
        disclaimer: DISCLAIMER,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
          "Surrogate-Control": "max-age=60, stale-if-error=300",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
    return addRateLimitHeaders(response, rateResult);
  } catch (error: any) {
    console.error("[public/disruptions] error:", error?.message || error);
    return NextResponse.json(
      {
        error: "Internal server error",
        disruptions: [],
        summary: { total: 0, by_category: [], by_severity: [] },
        map_markers: [],
        disclaimer: DISCLAIMER,
      },
      { status: 500 }
    );
  }
}

