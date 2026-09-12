"use client";

/**
 * SimulationHistory — Shows previous simulation runs
 *
 * Displays a table of past simulations with:
 * - Scenario type and election type
 * - Status (completed, running, failed)
 * - Results count and total votes
 * - Duration
 * - Timestamps
 */

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

interface SimulationRun {
  id: string;
  scenario: string;
  election_type: string;
  status: string;
  total_polling_units: number;
  results_created: number;
  total_votes: number;
  duration_seconds: number;
  ndc_wins: boolean;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  COMPLETED: { bg: "bg-[var(--color-green-dim)]", text: "text-[var(--color-green-bright)]" },
  RUNNING: { bg: "bg-[var(--color-amber-dim)]", text: "text-[var(--color-amber)]" },
  FAILED: { bg: "bg-[var(--color-red-dim)]", text: "text-[var(--color-red)]" },
};

const SCENARIO_LABELS: Record<string, string> = {
  landslide: "NDC LANDSLIDE",
  sweep: "NDC SWEEP",
  close: "NDC NARROW WIN",
  random: "RANDOM",
};

const SimulationHistory: React.FC = () => {
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("/api/admin/simulate/history", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch (e) {
      console.error("Failed to fetch simulation history:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="border border-[var(--color-gray-100)] p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-32 bg-[var(--color-gray-200)] rounded" />
          <div className="h-3 w-full bg-[var(--color-gray-100)] rounded" />
          <div className="h-3 w-3/4 bg-[var(--color-gray-100)] rounded" />
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="border border-[var(--color-gray-100)] p-4">
        <h3 className="font-display font-semibold text-sm text-[var(--color-text)] mb-2">
          Simulation History
        </h3>
        <div className="text-center py-6">
          <div className="text-xl mb-2">📋</div>
          <div className="font-mono text-sm text-[var(--color-text-dim)]">No simulation history yet</div>
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-1">
            History is recorded automatically after each simulation run
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-gray-100)]">
      <div className="px-4 py-3 border-b border-[var(--color-gray-100)] flex items-center justify-between">
        <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">
          Simulation History
        </h3>
        <button
          onClick={fetchHistory}
          className="font-mono text-[10px] px-2 py-1 border border-[var(--color-gray-200)] text-[var(--color-text-dim)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors"
        >
          REFRESH
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-gray-100)]">
              {["Scenario", "Type", "Status", "Results", "Votes", "Duration", "Started", ""].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-mono text-[10px] text-[var(--color-text-dim)] uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const colors = STATUS_COLORS[run.status] || STATUS_COLORS.COMPLETED;
              const durationMin = Math.floor((run.duration_seconds || 0) / 60);
              const durationSec = (run.duration_seconds || 0) % 60;
              const startedDate = new Date(run.started_at);

              return (
                <tr
                  key={run.id}
                  className="border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)]"
                >
                  <td className="px-3 py-2">
                    <span className="font-mono text-[10px] font-bold text-[var(--color-text)]">
                      {SCENARIO_LABELS[run.scenario] || run.scenario}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                      {run.election_type}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 ${colors.bg} ${colors.text}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                    {(run.results_created || 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] font-bold text-[var(--color-text)]">
                    {run.total_votes ? `${(run.total_votes / 1_000_000).toFixed(1)}M` : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                    {durationMin}:{String(durationSec).padStart(2, "0")}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-dim)]">
                    {startedDate.toLocaleDateString("en-NG", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    {run.status === "COMPLETED" && (
                      <button
                        onClick={() => {
                          // Dispatch custom event to parent to re-run this scenario
                          window.dispatchEvent(new CustomEvent("rerun-simulation", {
                            detail: { scenario: run.scenario, election_type: run.election_type },
                          }));
                        }}
                        className="font-mono text-[9px] px-2 py-1 border border-[var(--color-gray-200)] text-[var(--color-text-dim)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors"
                      >
                        RE-RUN
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SimulationHistory;
