"use client";

import React, { useEffect, useState } from "react";
import StateTableSkeleton from "@/components/live/skeletons/StateTableSkeleton";

interface StateData {
  state_id: string;
  state_name: string;
  state_code: string;
  total_polling_units: number;
  covered_polling_units: number;
  verified_polling_units: number;
  coverage_percent: number;
  verification_percent: number;
}

const StateTable: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [states, setStates] = useState<StateData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStateData();
  }, [refreshKey]);

  useEffect(() => {
    const interval = setInterval(fetchStateData, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchStateData = async () => {
    try {
      const res = await fetch("/api/public/stats");
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      const stateBreakdown = data.state_breakdown || [];

      const parsed: StateData[] = stateBreakdown.map((sb: any) => ({
        state_id: sb.state_id,
        state_name: sb.state_name,
        state_code: sb.state_code || "",
        total_polling_units: sb.total_polling_units || 0,
        covered_polling_units: sb.covered_polling_units || 0,
        verified_polling_units: sb.verified_polling_units || 0,
        coverage_percent: parseFloat(sb.coverage_percent) || 0,
        verification_percent: parseFloat(sb.verification_percent) || 0,
      }));

      // Sort by coverage descending so most active states appear first
      parsed.sort((a, b) => b.coverage_percent - a.coverage_percent);

      setStates(parsed);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Header — sticky */}
      <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)] sticky top-0 bg-[var(--color-ink)] z-10">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
            STATE BREAKDOWN
          </h3>
          <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
            {states.length} STATES + FCT
          </span>
        </div>
      </div>

      {/* Table */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--color-gray-100)]">
            <th className="px-[16px] md:px-[24px] py-[8px] text-left font-mono text-[10px] font-medium text-[var(--color-text-dim)] uppercase tracking-wider">
              State
            </th>
            <th className="px-[8px] md:px-[12px] py-[8px] text-right font-mono text-[10px] font-medium text-[var(--color-text-dim)] uppercase tracking-wider">
              PUs
            </th>
            <th className="hidden sm:table-cell px-[8px] md:px-[12px] py-[8px] text-right font-mono text-[10px] font-medium text-[var(--color-text-dim)] uppercase tracking-wider">
              Covered
            </th>
            <th className="hidden sm:table-cell px-[8px] md:px-[12px] py-[8px] text-right font-mono text-[10px] font-medium text-[var(--color-text-dim)] uppercase tracking-wider">
              Verified
            </th>
            <th className="px-[8px] md:px-[16px] py-[8px] text-right font-mono text-[10px] font-medium text-[var(--color-text-dim)] uppercase tracking-wider">
              Cov%
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className="p-0!">
                <StateTableSkeleton />
              </td>
            </tr>
          ) : states.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-[24px] py-[32px] text-center font-mono text-sm text-[var(--color-text-dim)]">
                No data available
              </td>
            </tr>
          ) : (
            states.map((state, index) => (
              <tr
                key={state.state_id}
                className="border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)] transition-colors"
              >
                <td className="px-[16px] md:px-[24px] py-[8px]">
                  <div className="flex items-center gap-[8px]">
                    <span className="font-mono text-[10px] text-[var(--color-text-dim)] w-[18px]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="font-display font-semibold text-sm text-[var(--color-text)]">
                        {state.state_name}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)]">
                        {state.state_code}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-[8px] md:px-[12px] py-[8px] text-right font-mono text-xs md:text-sm text-[var(--color-text-muted)]">
                  {state.total_polling_units.toLocaleString()}
                </td>
                <td className="hidden sm:table-cell px-[8px] md:px-[12px] py-[8px] text-right font-mono text-xs md:text-sm text-[var(--color-text-muted)]">
                  {state.covered_polling_units.toLocaleString()}
                </td>
                <td className="hidden sm:table-cell px-[8px] md:px-[12px] py-[8px] text-right font-mono text-xs md:text-sm text-[var(--color-text-muted)]">
                  {state.verified_polling_units.toLocaleString()}
                </td>
                <td className="px-[16px] md:px-[24px] py-[8px] text-right">
                  <div className="flex items-center justify-end gap-[4px] md:gap-[8px]">
                    <div className="hidden md:block w-[50px] h-[3px] bg-[var(--color-gray-100)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(state.coverage_percent, 100)}%`,
                          backgroundColor:
                            state.coverage_percent >= 50
                              ? "var(--color-green-bright)"
                              : state.coverage_percent >= 20
                                ? "var(--color-green)"
                                : "var(--color-gray-400)",
                        }}
                      />
                    </div>
                    <span className="font-mono text-xs text-[var(--color-text-muted)] min-w-[36px] text-right">
                      {state.coverage_percent.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default StateTable;
