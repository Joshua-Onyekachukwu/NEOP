/**
 * Convex Real-Time Data Hooks
 *
 * All hooks use REST API polling for Supabase data.
 * Convex real-time subscriptions are handled by ConvexRealtimeLayer.
 *
 * Architecture:
 *   REST API polling (10s interval) — reliable, works everywhere
 *   Convex useQuery subscriptions — handled separately in ConvexRealtimeLayer
 */

"use client";

import { useEffect, useState } from "react";

// ── Party Totals Hook ──

export function usePartyTotals(refreshKey?: number) {
  const [restData, setRestData] = useState<any>(null);
  const [restLoading, setRestLoading] = useState(true);

  // REST API data
  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const res = await fetch("/api/public/party-results");
        if (res.ok && active) {
          const data = await res.json();
          setRestData(data);
        }
      } catch {} finally {
        if (active) setRestLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => { active = false; clearInterval(interval); };
  }, [refreshKey]);

  const parties = restData?.parties || [];
  const grandTotal = restData?.grand_total || 0;

  return {
    parties,
    grand_total: grandTotal,
    total_results: restData?.total_results || 0,
    verified_results: restData?.verified_results || 0,
    last_updated: restData?.last_updated || "",
    loading: restLoading,
    source: "rest" as const,
  };
}

// ── Global Stats Hook ──

export function useGlobalStats(refreshKey?: number) {
  const [restData, setRestData] = useState<any>(null);
  const [restLoading, setRestLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const res = await fetch("/api/public/stats");
        if (res.ok && active) {
          setRestData(await res.json());
        }
      } catch {} finally {
        if (active) setRestLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => { active = false; clearInterval(interval); };
  }, [refreshKey]);

  return {
    inec_total_polling_units: restData?.inec_total_polling_units || 188042,
    total_polling_units: restData?.total_polling_units || 188042,
    covered_polling_units: restData?.covered_polling_units || 0,
    verified_polling_units: restData?.verified_polling_units || 0,
    coverage_percent: restData?.coverage_percent || 0,
    verification_percent: restData?.verification_percent || 0,
    total_votes: 0,
    state_breakdown: restData?.state_breakdown || [],
    active_pu_count: restData?.active_observers || 0,
    loading: restLoading,
    source: "rest" as const,
  };
}

// ── State Breakdown Hook ──

export function useStateBreakdown(refreshKey?: number) {
  const [restStates, setRestStates] = useState<any[]>([]);
  const [restLoading, setRestLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const res = await fetch("/api/public/stats");
        if (res.ok && active) {
          const data = await res.json();
          const breakdown = (data.state_breakdown || []).map((sb: any) => ({
            state_id: sb.state_id,
            state_name: sb.state_name,
            state_code: sb.state_code || "",
            total_polling_units: sb.total_polling_units || 0,
            covered_polling_units: sb.covered_polling_units || 0,
            verified_polling_units: sb.verified_polling_units || 0,
            coverage_percent: parseFloat(sb.coverage_percent) || 0,
            verification_percent: parseFloat(sb.verification_percent) || 0,
          }));
          breakdown.sort((a: any, b: any) => b.coverage_percent - a.coverage_percent);
          setRestStates(breakdown);
        }
      } catch {} finally {
        if (active) setRestLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => { active = false; clearInterval(interval); };
  }, [refreshKey]);

  return {
    states: restStates,
    loading: restLoading,
    source: "rest" as const,
  };
}

// ── Simulation Config Hook ──

export function useSimConfig() {
  const [restData, setRestData] = useState<any>(null);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const res = await fetch("/api/public/config");
        if (res.ok && active) setRestData(await res.json());
      } catch {} finally {}
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  return {
    display_status: restData?.display_status || "WAITING",
    status_label: restData?.status_label || "Awaiting data",
    election_type: restData?.election_type || "PRESIDENTIAL",
    scenario: restData?.scenario,
    progress_percent: restData?.progress_percent,
    results_processed: restData?.total_results || 0,
    total_results: restData?.total_results || 0,
    source: "rest" as const,
  };
}
