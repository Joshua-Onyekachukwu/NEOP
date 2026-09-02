"use client";

import React from "react";
import { useRealtimeData } from "@/components/live/ConvexRealtimeLayer";
import StatsBarSkeleton from "@/components/live/skeletons/StatsBarSkeleton";

const StatsBar: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const { stats, connected } = useRealtimeData();

  if (!connected) return <StatsBarSkeleton />;

  const inecTotal = stats.inec_total_polling_units;
  const covered = stats.covered_polling_units;
  const verified = stats.verified_polling_units;
  const hasData = covered > 0 || verified > 0;

  const coveragePercent = inecTotal > 0 ? Math.min((covered / inecTotal) * 100, 100) : 0;
  const verificationPercent = inecTotal > 0 ? Math.min((verified / inecTotal) * 100, 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4" role="region" aria-label="Key statistics">
      {/* Coverage */}
      <div className="py-[14px] md:py-[16px] px-[14px] md:px-[20px] border-r border-[var(--color-gray-100)]">
        <div className="stat-label mb-[4px]">Coverage</div>
        <div
          className="font-display font-bold text-2xl md:text-3xl text-[var(--color-green-bright)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {hasData ? `${coveragePercent.toFixed(1)}%` : "—"}
        </div>
        <div className="mt-[6px] h-[3px] bg-[var(--color-gray-100)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-green-bright)] rounded-full transition-all duration-700"
            style={{ width: `${Math.min(coveragePercent, 100)}%` }}
          />
        </div>
        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[4px]">
          {hasData ? `${covered.toLocaleString()} of ${inecTotal.toLocaleString()} PUs` : `Awaiting simulation data`}
        </div>
      </div>

      {/* Verified */}
      <div className="py-[14px] md:py-[16px] px-[14px] md:px-[20px] border-r border-[var(--color-gray-100)]">
        <div className="stat-label mb-[4px]">Verified</div>
        <div
          className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {hasData ? `${verificationPercent.toFixed(1)}%` : "—"}
        </div>
        <div className="mt-[6px] h-[3px] bg-[var(--color-gray-100)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-green)] rounded-full transition-all duration-700"
            style={{ width: `${Math.min(verificationPercent, 100)}%` }}
          />
        </div>
        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[4px]">
          {hasData ? `${verified.toLocaleString()} results confirmed` : `No results yet`}
        </div>
      </div>

      {/* Total Votes */}
      <div className="py-[14px] md:py-[16px] px-[14px] md:px-[20px] border-r border-[var(--color-gray-100)]">
        <div className="stat-label mb-[4px]">Total Votes</div>
        <div
          className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {stats.total_votes > 0 ? `${(stats.total_votes / 1_000_000).toFixed(1)}M` : "—"}
        </div>
        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[10px]">
          {stats.total_votes > 0 ? `across all polling units` : `awaiting results`}
        </div>
      </div>

      {/* Total PUs */}
      <div className="py-[14px] md:py-[16px] px-[14px] md:px-[20px]">
        <div className="stat-label mb-[4px]">Total PUs</div>
        <div
          className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {inecTotal.toLocaleString()}
        </div>
        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[10px]">
          nationwide (INEC 2026)
        </div>
      </div>
    </div>
  );
};

export default StatsBar;
