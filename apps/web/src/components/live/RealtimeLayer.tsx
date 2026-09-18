"use client";

/**
 * RealtimeLayer
 *
 * Wraps the live dashboard and provides real-time data via React context.
 * Only renders on the client side (no SSR issues).
 * Polls the results API every 10 seconds for live data.
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
  published_pus?: number | null;
  disputed_pus?: number | null;
  failed_pus?: number | null;
  disrupted_pus?: number | null;
  unavailable_pus?: number | null;
  awaiting_pus?: number | null;
  accounted_pus?: number | null;
  sim_run_status?: string | null;
  /**
   * Data-health signal from the results API:
   *   OK          — computed from the database this cycle
   *   STALE       — an older snapshot was served because the DB read failed
   *   UNAVAILABLE — no contact with the database and nothing cached to serve
   * Absent on payloads cached before this field existed.
   */
  data_status?: "OK" | "STALE" | "UNAVAILABLE" | null;
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
  source: "live" | "seeded";
  connected: boolean;
  /** Surfaces a degraded data plane to the UI — never silently shows zeros. */
  dataStatus: "OK" | "STALE" | "UNAVAILABLE";
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
  dataStatus: "OK" as const,
});

export function useRealtimeData() {
  return useContext(RealtimeContext);
}

// ── Provider ──

export function RealtimeLayer({
  children,
}: {
  children: React.ReactNode;
}) {  // REST API fallback polling — always runs
  const [restParties, setRestParties] = useState<PartyTotal[]>([]);
  const [restStats, setRestStats] = useState<GlobalStats | null>(null);
  const [restConfig, setRestConfig] = useState<SimConfig | null>(null);
  const [restStates, setRestStates] = useState<any[]>([]);
  const [restLoaded, setRestLoaded] = useState(false);
  const [dataStatus, setDataStatus] = useState<"OK" | "STALE" | "UNAVAILABLE">("OK");

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
      let restStatsData: any = null;
      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        const statsData = await statsRes.value.json();
        restStatsData = statsData;
        setRestStats({
          inec_total_polling_units: statsData.inec_total_polling_units || INEC_TOTAL_PUS,
          total_polling_units: statsData.total_polling_units || INEC_TOTAL_PUS,
          covered_polling_units: statsData.covered_polling_units || 0,
          verified_polling_units: statsData.verified_polling_units || 0,
          coverage_percent: statsData.coverage_percent || 0,
          verification_percent: statsData.verification_percent || 0,
          total_votes: statsData.total_votes || 0,
          published_pus: statsData.published_pus,
          disputed_pus: statsData.disputed_pus,
          failed_pus: statsData.failed_pus,
          disrupted_pus: statsData.disrupted_pus,
          unavailable_pus: statsData.unavailable_pus,
          awaiting_pus: statsData.awaiting_pus,
          accounted_pus: statsData.accounted_pus,
          sim_run_status: statsData.sim_run_status,
          data_status: statsData.data_status,
        });
        setRestStates(statsData.state_breakdown || []);
      }

      // Data health. The API computes data_status per cycle: UNAVAILABLE when
      // it could not reach the database and had no snapshot to fall back on,
      // STALE when it served an older snapshot. If this cycle's stats request
      // failed outright we are equally without numbers — show the outage
      // rather than a confident wall of zeros.
      const statsOk = statsRes.status === "fulfilled" && statsRes.value.ok;
      if (!statsOk) {
        setDataStatus("UNAVAILABLE");
      } else {
        const ds = restStatsData?.data_status;
        setDataStatus(
          ds === "UNAVAILABLE" ? "UNAVAILABLE" : ds === "STALE" ? "STALE" : "OK"
        );
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

  // Use grandTotal for stats.total_votes so StatsBar shows real numbers
  const statsWithVotes = restStats
    ? { ...restStats, total_votes: grandTotal || restStats.total_votes }
    : {
        inec_total_polling_units: INEC_TOTAL_PUS,
        total_polling_units: INEC_TOTAL_PUS,
        covered_polling_units: 0,
        verified_polling_units: 0,
        coverage_percent: 0,
        verification_percent: 0,
        total_votes: grandTotal,
      };

  const value: RealtimeData = {
    parties: restParties,
    grandTotal,
    stats: statsWithVotes,
    config: restConfig || {
      display_status: "WAITING",
      status_label: "Awaiting data",
      election_type: "PRESIDENTIAL",
      scenario: "random",
      progress_percent: 0,
      total_results: 0,
    },
    states: restStates,
    source: restLoaded ? "live" : "seeded",
    connected: restLoaded,
    dataStatus,
  };

  return (
    <RealtimeContext.Provider value={value}>
      {/*
        Degraded-data notice. Without this, a database outage rendered as a
        confident wall of zeros ("0 votes"), which on an election-results site
        is misleading. Amber = degraded, never fabricated numbers.
      */}
      {restLoaded && dataStatus !== "OK" && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-[8px] px-[16px] md:px-[24px] py-[10px] border-b border-[color-mix(in_srgb,var(--color-amber,#d97706)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-amber,#d97706)_12%,transparent)]"
        >
          <span
            className="inline-block w-[8px] h-[8px] rounded-full bg-[var(--color-amber,#d97706)] animate-pulse"
            aria-hidden="true"
          />
          <span className="font-mono text-[11px] md:text-xs text-[var(--color-text)] tracking-[0.02em]">
            {dataStatus === "STALE"
              ? "Live data delayed — showing last known snapshot"
              : "Live data temporarily unavailable — reconnecting"}
          </span>
        </div>
      )}
      {children}
    </RealtimeContext.Provider>
  );
}
