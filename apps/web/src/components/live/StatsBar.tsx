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
    // Only poll on interval — refreshKey triggers refetch from parent
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

  const rawCoverage = stats.inecTotal > 0
    ? (stats.coveredPollingUnits / stats.inecTotal) * 100
    : 0;
  const coveragePercent = Math.min(rawCoverage, 100).toFixed(1);

  const rawVerification = stats.inecTotal > 0
    ? (stats.verifiedPollingUnits / stats.inecTotal) * 100
    : 0;
  const verificationPercent = Math.min(rawVerification, 100).toFixed(1);

  return (      <div className="flex flex-wrap items-stretch divide-x divide-[var(--color-gray-100)]" role="region" aria-label="Key statistics">
      {/* Coverage */}
      <div className="flex-1 min-w-[140px] py-[16px] pr-[16px]">
        <div className="stat-label mb-[4px]">Coverage</div>
        <div className="font-display font-bold text-2xl md:text-3xl text-[var(--color-green-bright)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {coveragePercent}%
        </div>
        <div className="font-mono text-xs text-[var(--color-text-dim)] mt-[2px]">
          {stats.coveredPollingUnits.toLocaleString()} covered
        </div>
      </div>

      {/* Verified */}
      <div className="flex-1 min-w-[140px] py-[16px] px-[16px]">
        <div className="stat-label mb-[4px]">Verified</div>
        <div className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {verificationPercent}%
        </div>
        <div className="font-mono text-xs text-[var(--color-text-dim)] mt-[2px]">
          {stats.verifiedPollingUnits.toLocaleString()} verified
        </div>
      </div>

      {/* Active Observers */}
      <div className="flex-1 min-w-[140px] py-[16px] px-[16px]">
        <div className="stat-label mb-[4px]">Active Observers</div>
        <div className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {stats.activeObservers.toLocaleString()}
        </div>
        <div className="font-mono text-xs text-[var(--color-text-dim)] mt-[2px]">
          in the field
        </div>
      </div>

      {/* Total PUs */}
      <div className="flex-1 min-w-[140px] py-[16px] pl-[16px]">
        <div className="stat-label mb-[4px]">Total PUs</div>
        <div className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {stats.inecTotal.toLocaleString()}
        </div>
        <div className="font-mono text-xs text-[var(--color-text-dim)] mt-[2px]">
          nationwide (INEC)
        </div>
      </div>
    </div>
  );
};

export default StatsBar;
