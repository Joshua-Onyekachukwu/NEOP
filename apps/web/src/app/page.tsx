"use client";

import React, { useEffect, useState, useCallback } from "react";
import StatsBar from "@/components/live/StatsBar";
import ResultFeed from "@/components/live/ResultFeed";
import StateTable from "@/components/live/StateTable";
import PartyResults from "@/components/live/PartyResults";
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

  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const isSimulation = config.display_status === "SIMULATION";

  useEffect(() => {
    fetchConfig();
    const interval = setInterval(fetchConfig, isSimulation ? 5000 : 30000);
    return () => clearInterval(interval);
  }, [isSimulation]);

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
  const glowClass =
    config.display_status === "LIVE"
      ? "glow-live"
      : config.display_status === "SIMULATION"
        ? "glow-simulation"
        : "glow-waiting";

  return (
    <div className="min-h-screen pt-[56px]">
      <main id="main-content">
        {/* ── Disclaimer ── */}
        <Disclaimer />

        {/* ── Simulation Ticker ── */}
        <SimulationTicker />

        {/* ═══════════════════════════════════════════════════════
            SECTION 1: ELECTION HEADER — Broadcast-style top bar
            ═══════════════════════════════════════════════════════ */}
        <section className="border-b border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
          <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[16px] md:py-[20px]">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-[12px]">
              {/* Left: Election identity */}
              <div className="flex items-center gap-[12px] min-w-0">
                {/* Election type badge */}
                <div
                  className={`flex-shrink-0 px-[10px] py-[4px] border font-mono text-[10px] font-bold uppercase tracking-wider ${
                    config.election_type === "GOVERNORSHIP"
                      ? "border-[var(--color-blue)]/40 text-[var(--color-blue)] bg-[var(--color-blue)]/10"
                      : "border-[var(--color-green)]/40 text-[var(--color-green-bright)] bg-[var(--color-green)]/10"
                  }`}
                >
                  {config.election_type === "GOVERNORSHIP" ? "GOVERNOR" : "PRESIDENT"}
                </div>
                {/* Election title */}
                <div className="min-w-0">
                  <h1 className="font-display font-bold text-base md:text-lg text-[var(--color-text)] truncate">
                    {config.title}
                  </h1>
                  <div className="font-mono text-[10px] text-[var(--color-text-dim)]">
                    {config.subtitle}
                  </div>
                </div>
              </div>

              {/* Right: Status + Clock */}
              <div className="flex items-center gap-[16px] flex-shrink-0">
                {/* Status badge */}
                <div
                  className={`flex items-center gap-[6px] px-3 py-1.5 border ${statusStyle.bg} ${glowClass}`}
                >
                  <div
                    className={`w-[6px] h-[6px] rounded-full ${statusStyle.dot} ${
                      isSimulation ? "animate-pulse" : ""
                    }`}
                  />
                  <span
                    className={`font-mono text-[10px] font-bold uppercase tracking-wider ${statusStyle.text}`}
                  >
                    {statusStyle.label}
                  </span>
                </div>

                {/* Connection + Clock */}
                <div className="hidden md:flex items-center gap-[12px]">
                  <div className="flex items-center gap-[6px]">
                    <div
                      className={
                        isLive ? "live-dot" : "w-2 h-2 rounded-full bg-[var(--color-gray-400)]"
                      }
                    />
                    <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                      {isLive ? "CONNECTED" : "CONNECTING"}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--color-text-dim)]">
                    {currentTime} WAT
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            SECTION 2: STATS STRIP — Key metrics ribbon
            ═══════════════════════════════════════════════════════ */}
        <section className="border-b border-[var(--color-gray-100)]">
          <div className="max-w-[1400px] mx-auto">
            <StatsBar refreshKey={refreshKey} />
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            SECTION 3: PARTY LEADERBOARD — The hero element
            ═══════════════════════════════════════════════════════ */}
        <section className="border-b border-[var(--color-gray-100)]">
          <div className="max-w-[1400px] mx-auto">
            <PartyResults refreshKey={refreshKey} />
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            SECTION 4: MAP + LIVE FEED — Side by side
            ═══════════════════════════════════════════════════════ */}
        <section className="border-b border-[var(--color-gray-100)]">
          <div className="max-w-[1400px] mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-5">
              {/* Map — 3 cols */}
              <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-[var(--color-gray-100)] overflow-hidden">
                <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)] flex items-center justify-between">
                  <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
                    NATIONAL MAP
                  </h3>
                  <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                    All 36 states + FCT
                  </span>
                </div>
                <LiveMap refreshKey={refreshKey} />
              </div>
              {/* Live Feed — 2 cols */}
              <div className="lg:col-span-2">
                <ResultFeed refreshKey={refreshKey} />
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            SECTION 5: STATE BREAKDOWN — Full width table
            ═══════════════════════════════════════════════════════ */}
        <section className="border-b border-[var(--color-gray-100)]">
          <div className="max-w-[1400px] mx-auto">
            <StateTable refreshKey={refreshKey} />
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            SECTION 6: DISRUPTIONS — Only shown if there are incidents
            ═══════════════════════════════════════════════════════ */}
        <section className="border-b border-[var(--color-gray-100)]">
          <div className="max-w-[1400px] mx-auto">
            <DisruptionFeed refreshKey={refreshKey} />
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            SECTION 7: EXPORT + METHODOLOGY — Footer area
            ═══════════════════════════════════════════════════════ */}
        <section className="border-b border-[var(--color-gray-100)]">
          <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[24px]">
            <ExportPanel variant="public" />
          </div>
        </section>

        {/* Methodology — compact version */}
        <section id="methodology">
          <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[24px] md:py-[32px]">
            <div className="flex items-center gap-[8px] mb-[16px]">
              <h2 className="font-display font-bold text-lg text-[var(--color-text)]">
                How We Collect Data
              </h2>
              <a
                href="/about/methodology"
                className="font-mono text-[10px] text-[var(--color-green)] hover:text-[var(--color-green-bright)] transition-colors"
              >
                Read full methodology →
              </a>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
              {[
                {
                  step: "01",
                  title: "Recruit & Verify",
                  desc: "Volunteers register and verify identity as qualified observers.",
                  icon: "📋",
                },
                {
                  step: "02",
                  title: "Train & Assign",
                  desc: "Each volunteer completes training and is assigned to a polling unit.",
                  icon: "🎓",
                },
                {
                  step: "03",
                  title: "Observe & Report",
                  desc: "Observers submit structured field reports with evidence.",
                  icon: "📝",
                },
                {
                  step: "04",
                  title: "Verify & Publish",
                  desc: "Two-observer comparison, OCR, and mathematical validation.",
                  icon: "✅",
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="border border-[var(--color-gray-100)] p-[16px] hover:border-[var(--color-green)]/30 transition-colors"
                >
                  <div className="flex items-center gap-[8px] mb-[8px]">
                    <span className="text-lg" aria-hidden="true">
                      {item.icon}
                    </span>
                    <div className="font-mono text-[9px] font-bold text-[var(--color-green)] uppercase tracking-wider">
                      {item.step}
                    </div>
                  </div>
                  <h3 className="font-display font-semibold text-sm text-[var(--color-text)] mb-[4px]">
                    {item.title}
                  </h3>
                  <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Limitations — compact inline */}
            <div className="mt-[20px] p-[16px] border border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
              <div className="font-mono text-[10px] font-bold text-[var(--color-amber)] uppercase tracking-wider mb-[8px]">
                Important Limitations
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px] text-xs text-[var(--color-text-muted)]">
                <div>
                  <strong className="text-[var(--color-text)]">Coverage Gaps:</strong>{" "}
                  We cannot guarantee coverage of every polling unit.
                </div>
                <div>
                  <strong className="text-[var(--color-text)]">Not Official:</strong>{" "}
                  Official results are declared by INEC. This is independent parallel observation.
                </div>
                <div>
                  <strong className="text-[var(--color-text)]">Anomaly Flags:</strong>{" "}
                  Unusual patterns are flagged for human review — not automatically evidence of irregularity.
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default HomePage;
