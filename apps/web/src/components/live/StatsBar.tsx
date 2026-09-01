"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import StatsBarSkeleton from "@/components/live/skeletons/StatsBarSkeleton";

interface Stats {
  inecTotal: number;
  dbTotal: number;
  coveredPollingUnits: number;
  verifiedPollingUnits: number;
  activeObservers: number;
}

const StatsBar: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    inecTotal: 188042,
    dbTotal: 188042,
    coveredPollingUnits: 0,
    verifiedPollingUnits: 0,
    activeObservers: 0,
  });

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [refreshKey]);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/public/stats");
      if (!res.ok) return;
      const data = await res.json();
      setStats({
        inecTotal: data.inec_total_polling_units || 188042,
        dbTotal: data.total_polling_units || 188042,
        coveredPollingUnits: data.covered_polling_units || 0,
        verifiedPollingUnits: data.verified_polling_units || 0,
        activeObservers: data.active_observers || 0,
      });
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <StatsBarSkeleton />;

  const rawCoverage =
    stats.inecTotal > 0 ? (stats.coveredPollingUnits / stats.inecTotal) * 100 : 0;
  const coveragePercent = Math.min(rawCoverage, 100);

  const rawVerification =
    stats.inecTotal > 0 ? (stats.verifiedPollingUnits / stats.inecTotal) * 100 : 0;
  const verificationPercent = Math.min(rawVerification, 100);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4" role="region" aria-label="Key statistics">
      {/* Coverage — primary metric */}
      <div className="py-[14px] md:py-[16px] px-[14px] md:px-[20px] border-r border-[var(--color-gray-100)]">
        <div className="stat-label mb-[4px]">Coverage</div>
        <div className="flex items-baseline gap-[6px]">
          <div
            className="font-display font-bold text-2xl md:text-3xl text-[var(--color-green-bright)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {coveragePercent.toFixed(1)}%
          </div>
        </div>
        {/* Mini progress bar */}
        <div className="mt-[6px] h-[3px] bg-[var(--color-gray-100)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-green-bright)] rounded-full transition-all duration-700"
            style={{ width: `${Math.min(coveragePercent, 100)}%` }}
          />
        </div>
        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[4px]">
          {stats.coveredPollingUnits.toLocaleString()} of {stats.inecTotal.toLocaleString()} PUs
        </div>
      </div>

      {/* Verified */}
      <div className="py-[14px] md:py-[16px] px-[14px] md:px-[20px] border-r border-[var(--color-gray-100)]">
        <div className="stat-label mb-[4px]">Verified</div>
        <div
          className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {verificationPercent.toFixed(1)}%
        </div>
        <div className="mt-[6px] h-[3px] bg-[var(--color-gray-100)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-green)] rounded-full transition-all duration-700"
            style={{ width: `${Math.min(verificationPercent, 100)}%` }}
          />
        </div>
        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[4px]">
          {stats.verifiedPollingUnits.toLocaleString()} results confirmed
        </div>
      </div>

      {/* Active Observers */}
      <div className="py-[14px] md:py-[16px] px-[14px] md:px-[20px] border-r border-[var(--color-gray-100)]">
        <div className="stat-label mb-[4px]">Observers</div>
        <div
          className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {stats.activeObservers.toLocaleString()}
        </div>
        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[10px]">
          in the field right now
        </div>
      </div>

      {/* Total PUs */}
      <div className="py-[14px] md:py-[16px] px-[14px] md:px-[20px]">
        <div className="stat-label mb-[4px]">Total PUs</div>
        <div
          className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {stats.inecTotal.toLocaleString()}
        </div>
        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[10px]">
          nationwide (INEC 2026)
        </div>
      </div>
    </div>
  );
};

export default StatsBar;
