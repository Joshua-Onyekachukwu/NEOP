"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import StatsBarSkeleton from "@/components/live/skeletons/StatsBarSkeleton";

interface Stats {
  totalPollingUnits: number;
  coveredPollingUnits: number;
  verifiedPollingUnits: number;
  activeObservers: number;
}

const StatsBar: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    totalPollingUnits: 176846,
    coveredPollingUnits: 0,
    verifiedPollingUnits: 0,
    activeObservers: 0,
  });

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/public/stats");
      if (!res.ok) return;
      const data = await res.json();
      setStats({
        totalPollingUnits: data.total_polling_units || 176846,
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

  const coveragePercent = stats.totalPollingUnits > 0
    ? ((stats.coveredPollingUnits / stats.totalPollingUnits) * 100).toFixed(1)
    : "0.0";

  const verificationPercent = stats.totalPollingUnits > 0
    ? ((stats.verifiedPollingUnits / stats.totalPollingUnits) * 100).toFixed(1)
    : "0.0";

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
          {stats.totalPollingUnits.toLocaleString()}
        </div>
        <div className="font-mono text-xs text-[var(--color-text-dim)] mt-[2px]">
          nationwide
        </div>
      </div>
    </div>
  );
};

export default StatsBar;
