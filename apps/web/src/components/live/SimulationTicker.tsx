"use client";

/**
 * SimulationTicker — Live progress bar + status ticker
 *
 * Shows on the main page while a simulation is running. All numbers come
 * from the authoritative full-coverage ledger (migration 245) via
 * /api/public/stats — every polling unit in the universe is accounted
 * for, with explicit states:
 *
 *   accounted = published + disputed + failed + disrupted + unavailable
 *             (+ awaiting while the run is still progressing)
 *
 * Terminology (§2): "covered" = PUs accounted for by the simulation;
 * "published" = PUs with verified, countable results. A PU can be
 * covered without ever publishing — never conflated here.
 */

import React, { useEffect, useState, useRef } from "react";

interface SimProgress {
  total_pus: number;
  accounted_pus: number;
  published_pus: number;
  disputed_pus: number;
  failed_pus: number;
  disrupted_pus: number;
  unavailable_pus: number;
  awaiting_pus: number;
  published_percent: number;
  scenario: string;
  election_type: string;
}

const LEDGER_STATES: { key: keyof SimProgress & string; color: string; label: string }[] = [
  { key: "published_pus", color: "#16A34A", label: "Published" },
  { key: "disputed_pus", color: "#F97316", label: "Disputed" },
  { key: "failed_pus", color: "#B91C1C", label: "Failed verification" },
  { key: "disrupted_pus", color: "#EF4444", label: "Disrupted" },
  { key: "unavailable_pus", color: "#374151", label: "Unavailable" },
  { key: "awaiting_pus", color: "#6B7280", label: "Awaiting data" },
];

const SimulationTicker: React.FC = () => {
  const [progress, setProgress] = useState<SimProgress | null>(null);
  const [visible, setVisible] = useState(false);
  const [flash, setFlash] = useState(false);
  const prevPublished = useRef(0);

  useEffect(() => {
    let active = true;
    let interval: NodeJS.Timeout;

    const checkStatus = async () => {
      try {
        const res = await fetch("/api/public/config");
        if (!res.ok) return;
        const config = await res.json();

        const simMode = config.display_status === "SIMULATION" || config.status === "RUNNING";

        // SIMULATED mode keeps its result dataset on the site after a run
        // finishes, so config alone cannot tell us whether a run is live.
        // The ledger's run status is authoritative: this strip is a progress
        // indicator for an *active* run, never a completed one.
        let stats: any = null;
        if (simMode) {
          const statsRes = await fetch("/api/public/stats");
          if (statsRes.ok) stats = await statsRes.json();
        }
        const isRunning = simMode && stats?.sim_run_status === "RUNNING";

        if (isRunning) {
          setVisible(true);

          if (stats) {

            // Ledger counters (migration 245) are authoritative while a
            // run exists. With no active run the site must still show a
            // meaningful banner (§11 persistent dataset): fall back to
            // the result-derived counters.
            const hasLedger = stats.accounted_pus != null;
            const accounted = hasLedger
              ? Number(stats.accounted_pus) || 0
              : Number(stats.covered_polling_units) || 0;
            const published = hasLedger
              ? Number(stats.published_pus) || 0
              : Number(stats.verified_polling_units) || 0;
            const awaiting = hasLedger
              ? Number(stats.awaiting_pus) || 0
              : Math.max((Number(stats.total_polling_units) || 0) - accounted, 0);

            // Flash effect when newly published results arrive
            if (published > prevPublished.current && prevPublished.current > 0) {
              setFlash(true);
              setTimeout(() => setFlash(false), 500);
            }
            prevPublished.current = published;

            setProgress({
              // Full-coverage ledger (migration 245): every PU accounted for
              total_pus: Number(stats.total_polling_units) || 0,
              accounted_pus: accounted,
              published_pus: published,
              disputed_pus: Number(stats.disputed_pus) || 0,
              failed_pus: Number(stats.failed_pus) || 0,
              disrupted_pus: Number(stats.disrupted_pus) || 0,
              unavailable_pus: Number(stats.unavailable_pus) || 0,
              awaiting_pus: awaiting,
              published_percent: hasLedger
                ? Number(stats.published_percent) || 0
                : Number(stats.verification_percent) || 0,
              scenario: config.scenario || "random",
              election_type: config.election_type || "PRESIDENTIAL",
            });
          }
        } else {
          // Simulation completed — play sound and hide the ticker
          if (visible) {
            try {
              const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbsGczIjiNw9+3dE05bpy02Lt5UD5wl7DVvX5bRHeSrdLAhGVNe4ikyr2Ia1B9h57Ev4ptVIGBlL7FjXNagH2OucqUe2F+d4ivyZyBZXZ0h7LJm4VsfXOFscmbhW1/c4SxyZuFbYB0hLHJm4VtgHSDsMmbhW2AdIOwyZuFbYB0g7DJm4VtgHSDsMmbhW2AdIOwyZuFbYB0g7DJm4VtgHQ=");
              audio.volume = 0.3;
              audio.play().catch(() => {});
            } catch {}
            setVisible(false);
            setProgress(null);
          }
        }
      } catch {
        // silently fail
      }
    };

    checkStatus();
    // 10s polling: config+stats per tick keeps one client well under the
    // 120/min public rate budget even alongside the other live components.
    interval = setInterval(checkStatus, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (!visible || !progress) return null;

  const coveredPct =
    progress.total_pus > 0
      ? Math.round((progress.accounted_pus / progress.total_pus) * 100)
      : 0;

  return (
    <section className={`border-b border-[var(--color-gray-100)] transition-all duration-300 ${flash ? "bg-[var(--color-green)]/5" : ""}`}>
      <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[16px]">
        {/* Header row — explicit semantics: covered vs published */}
        <div className="flex items-center justify-between mb-[12px] gap-3 flex-wrap">
          <div className="flex items-center gap-[10px]">
            <div className="relative">
              <div className="w-3 h-3 rounded-full bg-[var(--color-amber)] animate-pulse" />
              <div className="absolute inset-0 w-3 h-3 rounded-full bg-[var(--color-amber)] animate-ping opacity-30" />
            </div>
            <div>
              <span className="font-mono text-xs font-bold text-[var(--color-amber)] uppercase tracking-wider">
                SIMULATION RUNNING
              </span>
              <span className="font-mono text-[10px] text-[var(--color-text-dim)] ml-2">
                {progress.scenario.toUpperCase()} • {progress.election_type}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-[12px] flex-wrap">
            <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
              {progress.accounted_pus.toLocaleString()} / {progress.total_pus.toLocaleString()} PUs covered
            </span>
            <span className="font-mono text-[10px] font-bold text-[var(--color-green)]">
              {progress.published_pus.toLocaleString()} published ({progress.published_percent}%)
            </span>
          </div>
        </div>

        {/* Progress bar — coverage of the full PU universe */}
        <div className="relative h-[6px] bg-[var(--color-gray-100)] rounded-full overflow-hidden mb-[12px]">
          <div
            className="h-full bg-gradient-to-r from-[var(--color-green)] to-[var(--color-green-bright)] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${coveredPct}%` }}
          />
          {/* Animated shimmer */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2s_ease-in-out_infinite]" />
        </div>

        {/* Ledger status chips — the complete PU accounting */}
        <div className="flex items-center gap-[16px] overflow-x-auto scrollbar-hide pb-[4px]">
          {LEDGER_STATES.map(({ key, color, label }) => {
            const count = Number(progress[key]) || 0;
            return (
              <div
                key={key}
                className={`flex items-center gap-[6px] flex-shrink-0 transition-opacity ${
                  count > 0 ? "opacity-100" : "opacity-30"
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="font-mono text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">
                  {label}
                </span>
                {count > 0 && (
                  <span className="font-mono text-[10px] font-bold text-[var(--color-text)]">
                    {count.toLocaleString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default SimulationTicker;
