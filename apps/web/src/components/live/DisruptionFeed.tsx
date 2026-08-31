"use client";

import React, { useEffect, useState } from "react";

interface Disruption {
  id: string;
  category: string;
  category_label: string;
  category_icon: string;
  severity: string;
  severity_color: string;
  description: string;
  status: string;
  agent_safe: boolean;
  polling_unit: {
    code: string;
    name: string;
    state: string;
    state_code: string;
  };
  reported_at: string;
}

interface CategoryCount {
  category: string;
  label: string;
  icon: string;
  count: number;
}

interface DisruptionSummary {
  total: number;
  by_category: CategoryCount[];
  by_severity: { severity: string; count: number; color: string }[];
  agents_unsafe: number;
}

interface DisruptionData {
  disruptions: Disruption[];
  summary: DisruptionSummary;
}

const DisruptionFeed: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [data, setData] = useState<DisruptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetchDisruptions();
    const interval = setInterval(fetchDisruptions, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [refreshKey]);

  const fetchDisruptions = async () => {
    try {
      const res = await fetch("/api/public/disruptions?limit=50");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border border-[var(--color-gray-100)] p-3 animate-pulse">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-4 w-4 bg-[var(--color-gray-200)] rounded" />
              <div className="h-3 w-24 bg-[var(--color-gray-200)] rounded" />
              <div className="h-3 w-16 bg-[var(--color-gray-100)] rounded ml-auto" />
            </div>
            <div className="h-2 w-full bg-[var(--color-gray-100)] rounded mb-1" />
            <div className="h-2 w-3/4 bg-[var(--color-gray-100)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!data || data.disruptions.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-2xl mb-2">✅</div>
        <div className="font-mono text-sm text-[var(--color-green-bright)]">
          No disruptions reported
        </div>
        <div className="text-xs text-[var(--color-text-dim)] mt-1">
          All polling units operating normally
        </div>
      </div>
    );
  }

  const displayDisruptions = showAll ? data.disruptions : data.disruptions.slice(0, 10);

  const formatTime = (iso: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-NG", {
      timeZone: "Africa/Lagos",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex flex-col">
      {/* Summary bar */}
      <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
            DISRUPTIONS & INCIDENTS
          </h3>
          <span className="font-mono text-[10px] text-[var(--color-amber)]">
            {data.summary.total} REPORTED
          </span>
        </div>

        {/* Category badges */}
        {data.summary.by_category.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.summary.by_category.map((cat) => (
              <div
                key={cat.category}
                className="flex items-center gap-1 px-2 py-0.5 border border-[var(--color-gray-200)] bg-[var(--color-ink-light)]"
              >
                <span className="text-xs">{cat.icon}</span>
                <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                  {cat.label}
                </span>
                <span className="font-mono text-[10px] font-bold text-[var(--color-text)]">
                  {cat.count}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Agent safety warning */}
        {data.summary.agents_unsafe > 0 && (
          <div className="mt-2 p-2 bg-[var(--color-red)]/10 border border-[var(--color-red)]/30">
            <span className="font-mono text-[10px] text-[var(--color-red-bright)]">
              🚨 {data.summary.agents_unsafe} agent(s) reported feeling unsafe
            </span>
          </div>
        )}
      </div>

      {/* Incident list */}
      <div className="flex-1 overflow-y-auto max-h-[500px]">
        {displayDisruptions.map((d) => (
          <div
            key={d.id}
            className="px-[16px] md:px-[24px] py-[10px] border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)] transition-colors"
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-sm">{d.category_icon}</span>
                <span className="font-mono text-[10px] font-bold text-[var(--color-text)] uppercase">
                  {d.category_label}
                </span>
                <span
                  className="font-mono text-[9px] px-1.5 py-0.5 font-bold uppercase"
                  style={{
                    color: d.severity_color,
                    backgroundColor: `${d.severity_color}1A`,
                  }}
                >
                  {d.severity}
                </span>
              </div>
              <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                {formatTime(d.reported_at)}
              </span>
            </div>

            {/* PU info */}
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs font-bold text-[var(--color-text)]">
                {d.polling_unit.code}
              </span>
              <span className="text-xs text-[var(--color-text-dim)]">
                {d.polling_unit.state}
              </span>
            </div>

            {/* Description */}
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              {d.description}
            </p>

            {/* Agent safety */}
            {!d.agent_safe && (
              <div className="mt-1 font-mono text-[9px] text-[var(--color-red-bright)]">
                ⚠ Agent reported feeling unsafe
              </div>
            )}
          </div>
        ))}

        {data.disruptions.length > 10 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full py-3 font-mono text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors"
          >
            {showAll
              ? "SHOW LESS"
              : `SHOW ALL ${data.disruptions.length} DISRUPTIONS`}
          </button>
        )}
      </div>
    </div>
  );
};

export default DisruptionFeed;
