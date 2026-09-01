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

const PARTY_NAMES: Record<string, string> = {
  NDC: "Nigeria Democratic Congress",
  APC: "All Progressives Congress",
  PDP: "Peoples Democratic Party",
  LP: "Labour Party",
  NNPP: "New Nigeria Peoples Party",
  APGA: "All Progressives Grand Alliance",
  SDP: "Social Democratic Party",
  YPP: "Young Progressives Party",
  ADC: "African Democratic Congress",
};

const PartyResults: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [data, setData] = useState<PartyResultsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPartyResults();
    const interval = setInterval(fetchPartyResults, 10000);
    return () => clearInterval(interval);
  }, [refreshKey]);

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
            PARTY RESULTS — NATIONAL LEADERBOARD
          </h3>
        </div>
        <div className="p-[40px] text-center">
          <div className="text-2xl mb-[8px]">🗳</div>
          <div className="font-mono text-sm text-[var(--color-text-dim)]">
            Awaiting results
          </div>
          <div className="text-xs text-[var(--color-text-dim)] mt-[4px]">
            Results will appear as observers submit them
          </div>
        </div>
      </div>
    );
  }

  const maxVotes = data.parties[0]?.total_votes || 1;

  return (
    <div>
      {/* ── Header ── */}
      <div className="px-[16px] md:px-[24px] py-[14px] border-b border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
        <div className="flex items-center justify-between gap-[12px]">
          <div className="min-w-0">
            <h3 className="font-display font-bold text-sm md:text-base text-[var(--color-text)]">
              NATIONAL LEADERBOARD
            </h3>
            <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[2px]">
              {data.total_results?.toLocaleString() ?? "—"} submissions
              {" · "}
              {data.verified_results?.toLocaleString() ?? "—"} verified
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-mono text-[9px] text-[var(--color-text-dim)] uppercase tracking-wider">
              Total Votes
            </div>
            <div className="font-display font-bold text-lg md:text-xl text-[var(--color-green-bright)] tabular-nums">
              {data.grand_total.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* ── Party rows — Leaderboard ── */}
      <div className="divide-y divide-[var(--color-gray-100)]">
        {data.parties.map((party, index) => {
          const barWidth = maxVotes > 0 ? (party.total_votes / maxVotes) * 100 : 0;
          const isWinner = index === 0;
          const isRunnerUp = index === 1;

          return (
            <div
              key={party.abbreviation}
              className={`px-[16px] md:px-[24px] transition-colors ${
                isWinner
                  ? "py-[14px] bg-[var(--color-green)]/[0.04] border-l-[3px] border-l-[var(--color-green-bright)]"
                  : isRunnerUp
                    ? "py-[12px] bg-[var(--color-ink-light)]/50 border-l-[3px] border-l-[var(--color-green)]/40"
                    : "py-[10px] hover:bg-[var(--color-ink-light)] border-l-[3px] border-l-transparent"
              }`}
            >
              {/* Top row: Rank + Party + Votes + Percentage */}
              <div className="flex items-center justify-between mb-[8px]">
                <div className="flex items-center gap-[10px] min-w-0">
                  {/* Rank */}
                  <div
                    className={`w-[28px] h-[28px] rounded-full flex items-center justify-center flex-shrink-0 font-mono text-[11px] font-bold ${
                      isWinner
                        ? "bg-[var(--color-green-bright)] text-white"
                        : isRunnerUp
                          ? "bg-[var(--color-green)]/30 text-[var(--color-green-bright)]"
                          : "bg-[var(--color-gray-100)] text-[var(--color-text-muted)]"
                    }`}
                  >
                    {index + 1}
                  </div>

                  {/* Color swatch + Party name */}
                  <div className="flex items-center gap-[8px] min-w-0">
                    <div
                      className="w-[14px] h-[14px] rounded-[3px] flex-shrink-0 ring-1 ring-white/10"
                      style={{ backgroundColor: party.color }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-[8px]">
                        <span
                          className={`font-display font-bold ${
                            isWinner ? "text-base md:text-lg" : "text-sm"
                          } text-[var(--color-text)]`}
                        >
                          {party.abbreviation}
                        </span>
                        {isWinner && (
                          <span className="font-mono text-[8px] font-bold text-[var(--color-green-bright)] bg-[var(--color-green)]/15 px-[6px] py-[2px] uppercase tracking-wider">
                            Leading
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-[var(--color-text-dim)] hidden sm:inline">
                        {party.name || PARTY_NAMES[party.abbreviation] || party.name}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Votes + Percentage */}
                <div className="flex items-center gap-[16px] flex-shrink-0">
                  <div className="text-right">
                    <div
                      className={`font-mono font-bold tabular-nums ${
                        isWinner ? "text-lg md:text-xl" : "text-sm md:text-base"
                      } text-[var(--color-text)]`}
                    >
                      {party.total_votes.toLocaleString()}
                    </div>
                    <div className="font-mono text-[10px] text-[var(--color-text-dim)]">
                      votes
                    </div>
                  </div>
                  <div className="text-right min-w-[48px]">
                    <div
                      className={`font-mono font-bold tabular-nums ${
                        isWinner ? "text-lg md:text-xl text-[var(--color-green-bright)]" : "text-sm text-[var(--color-text-muted)]"
                      }`}
                    >
                      {party.percentage}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="ml-[38px]">
                <div className="h-[6px] bg-[var(--color-gray-100)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: party.color,
                      boxShadow: isWinner ? `0 0 8px ${party.color}40` : "none",
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="px-[16px] md:px-[24px] py-[10px] border-t border-[var(--color-gray-100)] flex items-center justify-between bg-[var(--color-ink-light)]/50">
        <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
          {data.verified_results?.toLocaleString() ?? "—"} verified of{" "}
          {data.total_results?.toLocaleString() ?? "—"} total
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
          Updated{" "}
          {new Date(data.last_updated).toLocaleTimeString("en-NG", {
            timeZone: "Africa/Lagos",
          })}
        </span>
      </div>
    </div>
  );
};

export default PartyResults;
