"use client";

/**
 * ConvexRealtimeLayer
 *
 * Wraps the live dashboard and provides real-time data via React context.
 * Only renders on the client side (no SSR issues).
 * Uses Convex useQuery for instant updates when available.
 * Components consume from this context instead of polling REST APIs.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

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
  // Party totals
  parties: PartyTotal[];
  grandTotal: number;

  // Global stats
  stats: GlobalStats;

  // Sim config
  config: SimConfig;

  // State breakdown
  states: any[];

  // Connection
  source: "convex" | "rest";
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeData>({
  parties: [],
  grandTotal: 0,
  stats: {
    inec_total_polling_units: 188042,
    total_polling_units: 188042,
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
  source: "rest",
  connected: false,
});

export function useRealtimeData() {
  return useContext(RealtimeContext);
}

// ── Provider ──

export function ConvexRealtimeLayer({ children }: { children: React.ReactNode }) {
  // Convex queries (these are subscriptions — auto-update)
  const convexPartyTotals = useQuery(api.stats.getPartyTotals);
  const convexGlobalStats = useQuery(api.stats.getGlobalStats);
  const convexSimConfig = useQuery(api.stats.getSimConfig);
  const convexStateBreakdown = useQuery(api.stats.getStateBreakdown);

  // REST fallback state
  const [restParties, setRestParties] = useState<PartyTotal[]>([]);
  const [restStats, setRestStats] = useState<GlobalStats | null>(null);
  const [restConfig, setRestConfig] = useState<SimConfig | null>(null);
  const [restStates, setRestStates] = useState<any[]>([]);
  const [restLoaded, setRestLoaded] = useState(false);

  // Determine if Convex is available
  const convexAvailable = convexPartyTotals !== undefined;

  // REST API fallback polling
  const fetchRestData = useCallback(async () => {
    try {
      const [partyRes, statsRes, configRes] = await Promise.all([
        fetch("/api/public/party-results"),
        fetch("/api/public/stats"),
        fetch("/api/public/config"),
      ]);

      if (partyRes.ok) {
        const partyData = await partyRes.json();
        setRestParties(partyData.parties || []);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setRestStats({
          inec_total_polling_units: statsData.inec_total_polling_units || 188042,
          total_polling_units: statsData.total_polling_units || 188042,
          covered_polling_units: statsData.covered_polling_units || 0,
          verified_polling_units: statsData.verified_polling_units || 0,
          coverage_percent: statsData.coverage_percent || 0,
          verification_percent: statsData.verification_percent || 0,
          total_votes: 0,
        });
        setRestStates(statsData.state_breakdown || []);
      }
      if (configRes.ok) {
        const configData = await configRes.json();
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
    } catch {}
  }, []);

  useEffect(() => {
    if (convexAvailable) return; // Convex working, no need for REST
    fetchRestData();
    const interval = setInterval(fetchRestData, 10000);
    return () => clearInterval(interval);
  }, [convexAvailable, fetchRestData]);

  // Build the context value
  const value: RealtimeData = (() => {
    if (convexAvailable && convexPartyTotals) {
      const grandTotal = convexPartyTotals.reduce(
        (sum: number, p: any) => sum + p.total_votes, 0
      );
      return {
        parties: convexPartyTotals,
        grandTotal,
        stats: convexGlobalStats || {
          inec_total_polling_units: 188042,
          total_polling_units: 188042,
          covered_polling_units: 0,
          verified_polling_units: 0,
          coverage_percent: 0,
          verification_percent: 0,
          total_votes: 0,
        },
        config: convexSimConfig
          ? {
              display_status: convexSimConfig.status === "RUNNING" ? "SIMULATION" : "LIVE",
              status_label: convexSimConfig.status === "RUNNING" ? "Simulation Running" : "Live Election Data",
              election_type: convexSimConfig.election_type || "PRESIDENTIAL",
              scenario: convexSimConfig.scenario || "random",
              progress_percent: convexSimConfig.progress_percent || 0,
              total_results: convexSimConfig.total_results || 0,
            }
          : {
              display_status: "LIVE",
              status_label: "Live Election Data",
              election_type: "PRESIDENTIAL",
              scenario: "random",
              progress_percent: 0,
              total_results: 0,
            },
        states: convexStateBreakdown || [],
        source: "convex",
        connected: true,
      };
    }

    // REST fallback
    const grandTotal = restParties.reduce(
      (sum: number, p: any) => sum + (p.total_votes || 0), 0
    );
    return {
      parties: restParties,
      grandTotal,
      stats: restStats || {
        inec_total_polling_units: 188042,
        total_polling_units: 188042,
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
      source: "rest",
      connected: restLoaded,
    };
  })();

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}
