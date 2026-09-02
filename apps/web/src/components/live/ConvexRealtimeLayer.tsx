"use client";

/**
 * RealtimeLayer
 *
 * Wraps the live dashboard and provides real-time data via React context.
 * Only renders on the client side (no SSR issues).
 * Polls Supabase REST API every 10 seconds for live data.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { INEC_TOTAL_PUS } from "@/lib/party-config";

// ── Types ──

interface PartyTotal {
  name: string;
  abbreviation: string;
  color: string;
  total_votes: number;
  percentage: number;
}

interface GlobalStats {
  inec_total_polling_units: number;
  total_polling_units: number;
  covered_polling_units: number;
  verified_polling_units: number;
  coverage_percent: number;
  verification_percent: number;
  total_votes: number;
}

interface SimConfig {
  display_status: string;
  status_label: string;
  election_type: string;
  scenario: string;
  progress_percent: number;
  total_results: number;
}

interface RealtimeData {
  parties: PartyTotal[];
  grandTotal: number;
  stats: GlobalStats;
  config: SimConfig;
  states: any[];
  source: "supabase" | "seeded";
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeData>({
  parties: [],
  grandTotal: 0,
  stats: {
    inec_total_polling_units: INEC_TOTAL_PUS,
    total_polling_units: INEC_TOTAL_PUS,
    covered_polling_units: 0,
    verified_polling_units: 0,
    coverage_percent: 0,
    verification_percent: 0,
    total_votes: 0,
  },
  config: {
    display_status: "WAITING",
    status_label: "Awaiting data",
    election_type: "PRESIDENTIAL",
    scenario: "random",
    progress_percent: 0,
    total_results: 0,
  },
  states: [],
  source: "seeded" as const,
  connected: false,
});

export function useRealtimeData() {
  return useContext(RealtimeContext);
}

// ── Provider ──

export function ConvexRealtimeLayer({
  children,
}: {
  children: React.ReactNode;
}) {  // REST API fallback polling — always runs
  const [restParties, setRestParties] = useState<PartyTotal[]>([]);
  const [restStats, setRestStats] = useState<GlobalStats | null>(null);
  const [restConfig, setRestConfig] = useState<SimConfig | null>(null);
  const [restStates, setRestStates] = useState<any[]>([]);
  const [restLoaded, setRestLoaded] = useState(false);

  const fetchRestData = useCallback(async () => {
    try {
      const [partyRes, statsRes, configRes] = await Promise.allSettled([
        fetch("/api/public/party-results"),
        fetch("/api/public/stats"),
        fetch("/api/public/config"),
      ]);

      if (partyRes.status === "fulfilled" && partyRes.value.ok) {
        const partyData = await partyRes.value.json();
        setRestParties(partyData.parties || []);
      }
      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        const statsData = await statsRes.value.json();
        setRestStats({
          inec_total_polling_units: statsData.inec_total_polling_units || INEC_TOTAL_PUS,
          total_polling_units: statsData.total_polling_units || INEC_TOTAL_PUS,
          covered_polling_units: statsData.covered_polling_units || 0,
          verified_polling_units: statsData.verified_polling_units || 0,
          coverage_percent: statsData.coverage_percent || 0,
          verification_percent: statsData.verification_percent || 0,
          total_votes: 0,
        });
        setRestStates(statsData.state_breakdown || []);
      }
      if (configRes.status === "fulfilled" && configRes.value.ok) {
        const configData = await configRes.value.json();
        setRestConfig({
          display_status: configData.display_status || "WAITING",
          status_label: configData.status_label || "Awaiting data",
          election_type: configData.election_type || "PRESIDENTIAL",
          scenario: configData.scenario || "random",
          progress_percent: configData.progress_percent || 0,
          total_results: configData.total_results || 0,
        });
      }
      setRestLoaded(true);
    } catch {
      // Silent fail — will retry on next interval
    }
  }, []);

  useEffect(() => {
    fetchRestData();
    const interval = setInterval(fetchRestData, 10000);
    return () => clearInterval(interval);
  }, [fetchRestData]);

  // Build the context value from REST data
  const grandTotal = restParties.reduce(
    (sum: number, p: any) => sum + (p.total_votes || 0),
    0
  );

  const value: RealtimeData = {
    parties: restParties,
    grandTotal,
    stats: restStats || {
      inec_total_polling_units: INEC_TOTAL_PUS,
      total_polling_units: INEC_TOTAL_PUS,
      covered_polling_units: 0,
      verified_polling_units: 0,
      coverage_percent: 0,
      verification_percent: 0,
      total_votes: 0,
    },
    config: restConfig || {
      display_status: "WAITING",
      status_label: "Awaiting data",
      election_type: "PRESIDENTIAL",
      scenario: "random",
      progress_percent: 0,
      total_results: 0,
    },
    states: restStates,
    source: restLoaded ? "supabase" : "seeded",
    connected: restLoaded,
  };

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}
