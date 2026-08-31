"use client";

/**
 * SimulationTicker — Live progress bar + status ticker
 *
 * Shows on the main page when a simulation is running.
 * Auto-refreshes every 3 seconds to show:
 * - Progress bar with percentage
 * - Current phase (voting → counting → submitted → verified)
 * - Status distribution counts
 * - Elapsed time
 *
 * Disappears when simulation completes.
 */

import React, { useEffect, useState, useRef } from "react";

interface SimProgress {
  status: string;
  total_results: number;
  total_votes: number;
  progress_percent: number;
  scenario: string;
  election_type: string;
  status_distribution: Record<string, number>;
  elapsed_seconds: number;
  is_running: boolean;
}

const STATUS_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  NOT_STARTED: { color: "#6B7280", label: "Not Started", icon: "○" },
  VOTING: { color: "#3B82F6", label: "Voting", icon: "🗳" },
  COUNTING: { color: "#FBBF24", label: "Counting", icon: "🔢" },
  RESULT_ANNOUNCED: { color: "#06B6D4", label: "Announced", icon: "📢" },
  RESULT_SUBMITTED: { color: "#8B5CF6", label: "Submitted", icon: "📤" },
  VERIFICATION_PENDING: { color: "#F472B6", label: "Pending", icon: "⏳" },
  VERIFIED: { color: "#22C55E", label: "Verified", icon: "✓" },
  DISPUTED: { color: "#F97316", label: "Disputed", icon: "⚠" },
  DISRUPTED: { color: "#EF4444", label: "Disrupted", icon: "⛔" },
};

const SimulationTicker: React.FC = () => {
  const [progress, setProgress] = useState<SimProgress | null>(null);
  const [visible, setVisible] = useState(false);
  const [flash, setFlash] = useState(false);
  const prevResults = useRef(0);

  useEffect(() => {
    let active = true;
    let interval: NodeJS.Timeout;

    const checkStatus = async () => {
      try {
        const res = await fetch("/api/public/config");
        if (!res.ok) return;
        const config = await res.json();

        const isRunning = config.display_status === "SIMULATION" || config.status === "RUNNING";

        if (isRunning) {
          setVisible(true);

          // Fetch detailed progress from stats
          const statsRes = await fetch("/api/public/stats");
          if (statsRes.ok) {
            const stats = await statsRes.json();

            // Fetch status distribution from results
            const resultsRes = await fetch("/api/public/results?limit=1");
            let totalResults = config.total_results || 0;
            let totalVotes = 0;
            let statusDist: Record<string, number> = {};

            if (resultsRes.ok) {
              const resultsData = await resultsRes.json();
              totalResults = resultsData.pagination?.total || totalResults;
            }

            // Flash effect when new results arrive
            if (totalResults > prevResults.current && prevResults.current > 0) {
              setFlash(true);
              setTimeout(() => setFlash(false), 500);
            }
            prevResults.current = totalResults;

            // Estimate progress based on results count
            const expectedResults = 188042;
            const progressPct = Math.min(100, Math.round((totalResults / expectedResults) * 100));

            setProgress({
              status: config.status || "RUNNING",
              total_results: totalResults,
              total_votes: 0,
              progress_percent: progressPct,
              scenario: config.scenario || "random",
              election_type: config.election_type || "PRESIDENTIAL",
              status_distribution: statusDist,
              elapsed_seconds: 0,
              is_running: true,
            });
          }
        } else {
          // Simulation completed — show completion message briefly then hide
          if (visible) {
            setVisible(false);
            setProgress(null);
          }
        }
      } catch {
        // silently fail
      }
    };

    checkStatus();
    interval = setInterval(checkStatus, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (!visible || !progress) return null;

  const elapsed = progress.elapsed_seconds;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <section className={`border-b border-[var(--color-gray-100)] transition-all duration-300 ${flash ? "bg-[var(--color-green)]/5" : ""}`}>
      <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[16px]">
        {/* Header row */}
        <div className="flex items-center justify-between mb-[12px]">
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
          <div className="flex items-center gap-[12px]">
            <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
              {progress.total_results.toLocaleString()} / 188,042 PUs
            </span>
            {elapsed > 0 && (
              <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                {minutes}:{String(seconds).padStart(2, "0")}
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="relative h-[6px] bg-[var(--color-gray-100)] rounded-full overflow-hidden mb-[12px]">
          <div
            className="h-full bg-gradient-to-r from-[var(--color-green)] to-[var(--color-green-bright)] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress.progress_percent}%` }}
          />
          {/* Animated shimmer */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2s_ease-in-out_infinite]" />
        </div>

        {/* Status ticker — scrolling phase indicators */}
        <div className="flex items-center gap-[16px] overflow-x-auto scrollbar-hide pb-[4px]">
          {Object.entries(STATUS_CONFIG)
            .filter(([key]) => key !== "NOT_STARTED")
            .map(([key, config]) => {
              const count = progress.status_distribution[key] || 0;
              const isActive = key === "VOTING" || key === "COUNTING" || key === "RESULT_SUBMITTED";

              return (
                <div
                  key={key}
                  className={`flex items-center gap-[6px] flex-shrink-0 transition-opacity ${
                    count > 0 ? "opacity-100" : "opacity-30"
                  }`}
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: config.color }}
                  />
                  <span className="font-mono text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">
                    {config.label}
                  </span>
                  {count > 0 && (
                    <span className="font-mono text-[10px] font-bold text-[var(--color-text)]">
                      {count.toLocaleString()}
                    </span>
                  )}
                  {isActive && count > 0 && (
                    <div className="w-1 h-1 rounded-full bg-[var(--color-green-bright)] animate-pulse" />
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
