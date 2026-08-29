"use client";

import React, { useEffect, useState } from "react";
import ResultFeedSkeleton from "@/components/live/skeletons/ResultFeedSkeleton";

interface PartyResult {
  party_abbreviation: string;
  party_name: string;
  votes: number;
  color: string;
}

interface Result {
  id: string;
  polling_unit_code: string;
  polling_unit_name: string;
  state_name: string;
  valid_votes: number;
  rejected_votes: number;
  total_votes: number;
  status: string;
  submitted_at: string;
  party_results: PartyResult[];
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNDER_REVIEW";
}

const ResultFeed: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [results, setResults] = useState<Result[]>([]);
  const [lastUpdate, setLastUpdate] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResults();
    const interval = setInterval(fetchResults, 10000);
    return () => clearInterval(interval);
  }, [refreshKey]);

  const fetchResults = async () => {
    try {
      const res = await fetch("/api/public/results/?limit=50");
      if (!res.ok) return;
      const data = await res.json();

      if (data.results) {
        const formatted: Result[] = data.results.map((r: any) => ({
          id: r.id,
          polling_unit_code: r.polling_unit_code || "—",
          polling_unit_name: r.polling_unit_name || "—",
          state_name: r.state || "—",
          valid_votes: r.valid_votes,
          rejected_votes: r.rejected_votes,
          total_votes: r.total_votes,
          status: r.status,
          submitted_at: r.submitted_at,
          party_results: (r.party_results || []).map((pr: any) => ({
            party_abbreviation: pr.party_abbreviation || "?",
            party_name: pr.party_name || "Unknown",
            votes: pr.votes,
            color: pr.party_color || "#6B7280",
          })),
          confidence:
            r.status === "VERIFIED"
              ? "HIGH"
              : r.status === "DISPUTED"
                ? "UNDER_REVIEW"
                : "MEDIUM",
        }));
        setResults(formatted);
        setLastUpdate(
          new Date().toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos" })
        );
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <ResultFeedSkeleton />;

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-NG", {
      timeZone: "Africa/Lagos",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const confidenceColor = (c: string) => {
    switch (c) {
      case "HIGH":
        return "text-[var(--color-green-bright)]";
      case "MEDIUM":
        return "text-[var(--color-amber)]";
      case "LOW":
        return "text-[var(--color-red)]";
      case "UNDER_REVIEW":
        return "text-[var(--color-red-bright)]";
      default:
        return "text-[var(--color-text-dim)]";
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)] flex items-center justify-between">
        <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
          LIVE RESULT FEED
        </h3>
        {lastUpdate && (
          <div className="flex items-center gap-[6px]">
            <div className="live-dot" style={{ width: 6, height: 6 }} />
            <span className="font-mono text-xs text-[var(--color-text-dim)]">
              {lastUpdate}
            </span>
          </div>
        )}
      </div>

      {/* Results */}
      <div
        className="flex-1 overflow-y-auto max-h-[600px]"
        aria-live="polite"
        aria-label="Latest election results"
      >
        {results.length === 0 ? (
          <div className="p-[40px] text-center">
            <div className="font-mono text-[var(--color-text-dim)] text-sm">
              Waiting for results…
            </div>
            <div className="text-xs text-[var(--color-text-dim)] mt-[4px]">
              Results will appear as observers submit them
            </div>
          </div>
        ) : (
          results.map((result) => (
            <div
              key={result.id}
              className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)] transition-colors"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-[6px]">
                <div className="flex items-center gap-[8px]">
                  <span className="font-mono text-sm font-bold text-[var(--color-text)]">
                    {result.polling_unit_code}
                  </span>
                  <span
                    className={`font-mono text-xs ${confidenceColor(result.confidence)}`}
                  >
                    {result.confidence}
                  </span>
                </div>
                <span className="font-mono text-xs text-[var(--color-text-dim)]">
                  {formatTime(result.submitted_at)}
                </span>
              </div>

              {/* Party results — tight grid */}
              <div className="flex flex-wrap gap-x-[12px] gap-y-[2px] mb-[6px]">
                {result.party_results.slice(0, 8).map((pr) => (
                  <div
                    key={pr.party_abbreviation}
                    className="flex items-center gap-[4px]"
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: pr.color }}
                    />
                    <span className="font-mono text-xs text-[var(--color-text-muted)]">
                      {pr.party_abbreviation}
                    </span>
                    <span className="font-mono text-xs font-bold text-[var(--color-text)]">
                      {pr.votes.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="flex items-center gap-[12px] font-mono text-xs">
                <span className="text-[var(--color-text-dim)]">
                  V:
                  <span className="text-[var(--color-text-muted)] ml-[2px]">
                    {result.valid_votes.toLocaleString()}
                  </span>
                </span>
                <span className="text-[var(--color-text-dim)]">
                  R:
                  <span className="text-[var(--color-text-muted)] ml-[2px]">
                    {result.rejected_votes.toLocaleString()}
                  </span>
                </span>
                <span className="text-[var(--color-text-dim)]">
                  T:
                  <span className="text-[var(--color-text)] font-bold ml-[2px]">
                    {result.total_votes.toLocaleString()}
                  </span>
                </span>
              </div>

              {/* State */}
              {result.state_name !== "—" && (
                <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[4px]">
                  {result.state_name}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ResultFeed;
