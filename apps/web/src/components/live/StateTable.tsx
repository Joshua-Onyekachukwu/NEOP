"use client";

import React from "react";
import { useRealtimeData } from "@/components/live/ConvexRealtimeLayer";
import StateTableSkeleton from "@/components/live/skeletons/StateTableSkeleton";

const StateTable: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const { states, connected, source } = useRealtimeData();

  return (
    <div>
      {/* Header */}
      <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)] sticky top-0 bg-[var(--color-ink)] z-10">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
            STATE BREAKDOWN
          </h3>
          <div className="flex items-center gap-[8px]">
            {source === "convex" && (
              <span className="font-mono text-[9px] text-[var(--color-green-bright)]">● LIVE</span>
            )}
            <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
              {states.length} STATES + FCT
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px]">
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
            {!connected ? (
              <tr>
                <td colSpan={5} className="p-0!">
                  <StateTableSkeleton />
                </td>
              </tr>
            ) : states.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-[24px] py-[32px] text-center font-mono text-sm text-[var(--color-text-dim)]">
                  No state data available
                </td>
              </tr>
            ) : (
              states.map((state: any, index: number) => {
                const totalPUs = state.total_pus || state.total_polling_units || 0;
                const covered = state.covered_pus || state.covered_polling_units || 0;
                const verified = state.verified_pus || state.verified_polling_units || 0;
                const covPct = state.coverage_percent || 0;

                return (
                  <tr
                    key={state.state_id || state.state_name}
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
                            {state.state_code || state.region || ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-[8px] md:px-[12px] py-[8px] text-right font-mono text-xs md:text-sm text-[var(--color-text-muted)]">
                      {totalPUs.toLocaleString()}
                    </td>
                    <td className="hidden sm:table-cell px-[8px] md:px-[12px] py-[8px] text-right font-mono text-xs md:text-sm text-[var(--color-text-muted)]">
                      {covered.toLocaleString()}
                    </td>
                    <td className="hidden sm:table-cell px-[8px] md:px-[12px] py-[8px] text-right font-mono text-xs md:text-sm text-[var(--color-text-muted)]">
                      {verified.toLocaleString()}
                    </td>
                    <td className="px-[16px] md:px-[24px] py-[8px] text-right">
                      <div className="flex items-center justify-end gap-[4px] md:gap-[8px]">
                        <div className="hidden md:block w-[50px] h-[3px] bg-[var(--color-gray-100)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(covPct, 100)}%`,
                              backgroundColor:
                                covPct >= 50
                                  ? "var(--color-green-bright)"
                                  : covPct >= 20
                                    ? "var(--color-green)"
                                    : "var(--color-gray-400)",
                            }}
                          />
                        </div>
                        <span className="font-mono text-xs text-[var(--color-text-muted)] min-w-[36px] text-right">
                          {covPct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StateTable;
