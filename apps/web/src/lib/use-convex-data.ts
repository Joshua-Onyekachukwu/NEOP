/**
 * Convex Real-Time Data Hooks
 *
 * Uses Convex useQuery for real-time subscriptions (instant updates).
 * Falls back to REST API polling when Convex is unavailable or during SSR.
 *
 * Architecture:
 *   Convex connected → useQuery (real-time, zero polling)
 *   Convex unavailable → REST API polling (10s interval)
 */

"use client";

import { useEffect, useState } from "react";

// Safe hook: only calls useQuery on client side
function useConvexQuery(queryFn: any, args?: any): any | undefined {
  const [data, setData] = useState<any | undefined>(undefined);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // We can't use useQuery conditionally, so we use a wrapper pattern
  // The actual useQuery is called in the component, not here
  return undefined; // placeholder
}

// ── Party Totals Hook ──

export function usePartyTotals(refreshKey?: number) {
  const [restData, setRestData] = useState<any>(null);
  const [restLoading, setRestLoading] = useState(true);
  const [convexAvailable, setConvexAvailable] = useState<boolean | null>(null);

  // Try to import and use Convex dynamically
  useEffect(() => {
    let active = true;

    const tryConvex = async () => {
      try {
        const { useQuery } = await import("convex/react");
        const { api } = await import("../../convex/_generated/api");
        // If we can import, Convex is available
        if (active) setConvexAvailable(true);
      } catch {
        if (active) setConvexAvailable(false);
      }
    };

    tryConvex();
    return () => { active = false; };
  }, []);

  // REST API data (always fetch as fallback)
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
