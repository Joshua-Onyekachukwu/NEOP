"use client";

import React, { useEffect, useState } from "react";
import PartyResultsSkeleton from "@/components/live/skeletons/PartyResultsSkeleton";

interface PartyTotal {
  name: string;
  abbreviation: string;
  color: string;
  total_votes: number;
  percentage: string;
}

interface PartyResultsData {
  parties: PartyTotal[];
  grand_total: number;
  total_results: number;
  verified_results: number;
  last_updated: string;
}

const RANK_STYLES: Record<number, { badge: string; bar: string }> = {
  0: { badge: "bg-[var(--color-green)] text-white", bar: "h-[4px]" },
  1: { badge: "bg-[var(--color-green-dim)] text-[var(--color-green-bright)]", bar: "h-[3px]" },
  2: { badge: "bg-[var(--color-ink-lighter)] text-[var(--color-text-muted)]", bar: "h-[3px]" },
};

const PartyResults: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [data, setData] = useState<PartyResultsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPartyResults();
  }, [refreshKey]);

  useEffect(() => {
    const interval = setInterval(fetchPartyResults, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchPartyResults = async () => {
    try {
      const res = await fetch("/api/public/party-results");
      if (!res.ok) return;
      const result = await res.json();
      setData(result);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  if (loading && !data) {
    return <PartyResultsSkeleton />;
  }

  if (!data || data.parties.length === 0) {
    return (
      <div>
        <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)]">
          <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
            PARTY RESULTS
          </h3>
        </div>
        <div className="p-[24px] text-center font-mono text-sm text-[var(--color-text-dim)]">
          No results yet
        </div>
      </div>
    );
  }

  const maxVotes = data.parties[0]?.total_votes || 1;

  return (
    <div>
      {/* Header — sticky */}
      <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)] sticky top-0 bg-[var(--color-ink)] z-10 flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
            PARTY RESULTS
          </h3>
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-0.5">
            Accumulated votes across {data.total_results?.toLocaleString() ?? '—'} submissions
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] text-[var(--color-text-dim)]">GRAND TOTAL</div>
          <div className="font-display font-bold text-lg text-[var(--color-text)]">
            {data.grand_total.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Party rows — leaderboard */}
      <div className="divide-y divide-[var(--color-gray-100)]">
        {data.parties.map((party, index) => {
          const barWidth = maxVotes > 0 ? (party.total_votes / maxVotes) * 100 : 0;
          const isTop3 = index < 3;
          const rankStyle = RANK_STYLES[index] || RANK_STYLES[2];

          return (
            <div
              key={party.abbreviation}
              className={`px-[16px] md:px-[24px] py-[10px] hover:bg-[var(--color-ink-light)] transition-colors ${
                isTop3 ? "bg-[var(--color-ink-light)]" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-[6px]">
                {/* Left: rank + party info */}
                <div className="flex items-center gap-[10px] min-w-0">
                  {/* Rank badge */}
                  <div
                    className={`w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0 font-mono text-[10px] font-bold ${rankStyle.badge}`}
                  >
                    {index + 1}
                  </div>
                  {/* Color dot + name */}
                  <div
                    className="w-[10px] h-[10px] rounded-full flex-shrink-0"
                    style={{ backgroundColor: party.color }}
                  />
                  <div className="min-w-0">
                    <span className="font-display font-semibold text-sm text-[var(--color-text)]">
                      {party.abbreviation}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-text-dim)] ml-[8px] hidden sm:inline">
                      {party.name}
                    </span>
                  </div>
                </div>

                {/* Right: votes + percentage */}
                <div className="flex items-center gap-[12px] flex-shrink-0">
                  <span className="font-mono text-sm font-bold text-[var(--color-text)] tabular-nums">
                    {party.total_votes.toLocaleString()}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-muted)] w-[48px] text-right tabular-nums">
                    {party.percentage}%
                  </span>
                </div>
              </div>

              {/* Progress bar — wider for top 3 */}
              <div className="ml-[32px] h-[3px] bg-[var(--color-gray-100)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${rankStyle.bar}`}
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: party.color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-[16px] md:px-[24px] py-[10px] border-t border-[var(--color-gray-100)] flex items-center justify-between">
        <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
          {data.verified_results?.toLocaleString() ?? '—'} verified of {data.total_results?.toLocaleString() ?? '—'} total
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
          Updated {new Date(data.last_updated).toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos" })}
        </span>
      </div>
    </div>
  );
};

export default PartyResults;
