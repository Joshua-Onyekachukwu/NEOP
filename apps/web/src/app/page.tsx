"use client";

import React, { useEffect, useState, useCallback } from "react";
import StatsBar from "@/components/live/StatsBar";
import ResultFeed from "@/components/live/ResultFeed";
import StateTable from "@/components/live/StateTable";
import PartyResults from "@/components/live/PartyResults";
import IncidentBar from "@/components/live/IncidentBar";
import Disclaimer from "@/components/live/Disclaimer";
import LiveMap from "@/components/live/LiveMap";
import ExportPanel from "@/components/live/ExportPanel";
import DisruptionFeed from "@/components/live/DisruptionFeed";
import SimulationTicker from "@/components/live/SimulationTicker";
import { supabase } from "@/lib/supabase-browser";

interface ElectionConfig {
  election_type: string;
  title: string;
  subtitle: string;
  date: string;
  total_polling_units: number;
  display_status: string;
  status_label: string;
  total_results: number;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  LIVE: {
    bg: "bg-[var(--color-green)]/10 border-[var(--color-green)]/30",
    text: "text-[var(--color-green-bright)]",
    dot: "bg-[var(--color-green-bright)]",
    label: "LIVE ELECTION DATA",
  },
  SIMULATION: {
    bg: "bg-[var(--color-amber)]/10 border-[var(--color-amber)]/30",
    text: "text-[var(--color-amber)]",
    dot: "bg-[var(--color-amber)]",
    label: "SIMULATION RUNNING",
  },
  WAITING: {
    bg: "bg-[var(--color-gray-400)]/10 border-[var(--color-gray-400)]/30",
    text: "text-[var(--color-text-dim)]",
    dot: "bg-[var(--color-gray-400)]",
    label: "AWAITING DATA",
  },
};

const HomePage: React.FC = () => {
  const [currentTime, setCurrentTime] = useState("");
  const [isLive, setIsLive] = useState(false);
  const [config, setConfig] = useState<ElectionConfig>({
    election_type: "PRESIDENTIAL",
    title: "Presidential & National Assembly Election",
    subtitle: "16 January 2027",
    date: "2027-01-16",
    total_polling_units: 0,
    display_status: "WAITING",
    status_label: "Awaiting data",
    total_results: 0,
  });

  // Refresh key — bumped whenever data changes, children refetch when this changes
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const isSimulation = config.display_status === "SIMULATION";

  // Adaptive polling: fast during simulation, slow when idle
  useEffect(() => {
    fetchConfig();
    const interval = setInterval(fetchConfig, isSimulation ? 5000 : 30000);
    return () => clearInterval(interval);
  }, [isSimulation]);

  // Clock
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("en-NG", {
          timeZone: "Africa/Lagos",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    updateTime();
    const t = setInterval(updateTime, 1000);
    return () => clearInterval(t);
  }, []);

  // Supabase Realtime — subscribe to table changes for instant updates
  useEffect(() => {
    const channel = supabase
      .channel("live-results")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "result_submissions" },
        () => bumpRefresh()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "polling_units" },
        () => bumpRefresh()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "party_results" },
        () => bumpRefresh()
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setIsLive(true);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bumpRefresh]);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/public/config");
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch {
      // Use defaults
    }
  };

  const statusStyle = STATUS_STYLES[config.display_status] || STATUS_STYLES.WAITING;
  const glowClass = config.display_status === "LIVE" ? "glow-live" : config.display_status === "SIMULATION" ? "glow-simulation" : "glow-waiting";

  return (
    <div className="min-h-screen pt-[56px]">
      <main id="main-content">
      {/* Disclaimer */}
      <Disclaimer />

      {/* Live Simulation Ticker — shows during simulation */}
      <SimulationTicker />

      {/* Hero */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[24px] md:py-[48px]">
          <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-[16px] md:gap-[24px]">
            <div>
              <div className="flex items-center gap-[10px] mb-[8px]">
                <div className={`stat-label`}>                    {config.title} — {config.subtitle}
                </div>
                <div className={`flex-shrink-0 px-2 py-0.5 border font-mono text-[9px] font-bold uppercase tracking-wider ${
                  config.election_type === "GOVERNORSHIP"
                    ? "border-[var(--color-blue)]/40 text-[var(--color-blue)] bg-[var(--color-blue)]/10"
                    : "border-[var(--color-green)]/40 text-[var(--color-green-bright)] bg-[var(--color-green)]/10"
                }`}>
                  {config.election_type === "GOVERNORSHIP" ? "GOVERNORSHIP" : "PRESIDENTIAL"}
                </div>
              </div>
              <h1 className="big-number">{config.total_polling_units.toLocaleString()}</h1>
              <div className="stat-label mt-[8px]">polling units across Nigeria (INEC 2026)</div>
            </div>

            <div className="flex flex-col items-end gap-[8px] pb-[8px]">
              <div className={`flex items-center gap-[6px] px-3 py-1.5 border ${statusStyle.bg} ${glowClass}`}>
                <div className={`w-2 h-2 rounded-full ${statusStyle.dot} ${isSimulation ? "animate-pulse" : ""}`} />
                <span className={`font-mono text-[10px] font-bold uppercase tracking-wider ${statusStyle.text}`}>
                  {statusStyle.label}
                </span>
                {config.total_results > 0 && (
                  <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                    • {config.total_results.toLocaleString()} results
                  </span>
                )}
              </div>

              <div className="flex items-center gap-[16px]">
                <div className="flex items-center gap-[8px]">
                  <div className={isLive ? "live-dot" : "w-2 h-2 rounded-full bg-[var(--color-gray-400)]"} />
                  <span className="font-mono text-[var(--color-text-muted)] text-sm">
                    {isLive ? "CONNECTED" : "CONNECTING"}
                  </span>
                </div>
                <span className="font-mono text-[var(--color-text-dim)] text-sm">
                  {currentTime} WAT
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats row */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px]">
          <StatsBar refreshKey={refreshKey} />
        </div>
      </section>

      {/* Map + Feed */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="border-b lg:border-b-0 lg:border-r border-[var(--color-gray-100)] overflow-hidden">
              <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)]">
                <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
                  NATIONAL MAP
                </h3>
              </div>
              <LiveMap refreshKey={refreshKey} />
            </div>
            <div>
              <ResultFeed refreshKey={refreshKey} />
            </div>
          </div>
        </div>
      </section>

      {/* State Breakdown + Party Results */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="border-b lg:border-b-0 lg:border-r border-[var(--color-gray-100)] max-h-[600px] overflow-auto">
              <StateTable refreshKey={refreshKey} />
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <PartyResults refreshKey={refreshKey} />
            </div>
          </div>
        </div>
      </section>

      {/* Disruptions & Incidents Feed */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto">
          <DisruptionFeed refreshKey={refreshKey} />
        </div>
      </section>

      {/* Export Results */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[24px]">
          <ExportPanel variant="public" />
        </div>
      </section>

      {/* Methodology */}
      <section id="methodology" className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[32px] md:py-[40px]">
          <h2 className="font-display font-bold text-xl md:text-2xl text-[var(--color-text)] mb-[24px]">
            How We Collect Data
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
            {[
              { step: "01", title: "Recruit & Verify", desc: "Volunteers register, verify their identity, and are confirmed as qualified observers.", icon: "📋" },
              { step: "02", title: "Train & Assign", desc: "Volunteers complete mandatory training. Each is assigned to a specific polling unit.", icon: "🎓" },
              { step: "03", title: "Observe & Report", desc: "Observers submit structured field reports with photographic evidence where permitted.", icon: "📝" },
              { step: "04", title: "Verify & Publish", desc: "Results are cross-checked using two-observer comparison, OCR, and mathematical validation.", icon: "✅" },
            ].map((item) => (
              <div
                key={item.step}
                className="border border-[var(--color-gray-100)] p-[20px] hover:border-[var(--color-green)]/30 transition-colors"
              >
                <div className="flex items-center gap-[12px] mb-[12px]">
                  <span className="text-xl" aria-hidden="true">{item.icon}</span>
                  <div className="font-mono text-[10px] font-bold text-[var(--color-green)] uppercase tracking-wider">
                    Step {item.step}
                  </div>
                </div>
                <h3 className="font-display font-semibold text-sm text-[var(--color-text)] mb-[8px]">
                  {item.title}
                </h3>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Limitations */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[32px] md:py-[40px]">
          <h2 className="font-display font-bold text-xl md:text-2xl text-[var(--color-text)] mb-[16px]">
            Our Limitations
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px]">
            {[
              { title: "Coverage Gaps", desc: "We cannot guarantee coverage of every polling unit. Some areas may be inaccessible due to security concerns, logistical challenges, or other factors." },
              { title: "Not Official Results", desc: "We do not determine official results. Official election results are declared by INEC. Our platform provides independent, parallel observation to complement — not replace — the official process." },
              { title: "Anomaly Flags", desc: "Anomaly detection flags unusual patterns for human review. An anomaly is not automatically evidence of fraud or irregularity." },
            ].map((item) => (
              <div key={item.title} className="border border-[var(--color-gray-100)] p-[20px]">
                <h3 className="font-display font-semibold text-sm text-[var(--color-text)] mb-[8px]">{item.title}</h3>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      </main>
    </div>
  );
};

export default HomePage;
