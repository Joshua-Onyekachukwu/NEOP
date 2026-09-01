"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRealtimeData } from "@/components/live/ConvexRealtimeLayer";
import PartyResultsSkeleton from "@/components/live/skeletons/PartyResultsSkeleton";

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

// ── Animated Number Hook ──
// Smoothly interpolates between old and new values

function useAnimatedNumber(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = target;
    if (from === to) return;

    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * eased);
      setDisplay(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        prevRef.current = to;
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return display;
}

// ── Rank Change Indicator ──

function RankChange({ current, previous }: { current: number; previous: number }) {
  if (previous === -1 || current === previous) return null;

  const diff = previous - current; // positive = moved up
  if (diff > 0) {
    return (
      <span className="font-mono text-[9px] text-[var(--color-green-bright)] ml-[4px] animate-pulse">
        ▲{diff}
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span className="font-mono text-[9px] text-[var(--color-red)] ml-[4px] animate-pulse">
        ▼{Math.abs(diff)}
      </span>
    );
  }
  return null;
}

// ── Flash Effect Hook ──
// Returns true briefly when value changes

function useFlashEffect(value: any, duration = 800): boolean {
  const [flash, setFlash] = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current !== value && prevRef.current !== undefined) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), duration);
      prevRef.current = value;
      return () => clearTimeout(timer);
    }
    prevRef.current = value;
  }, [value, duration]);

  return flash;
}

// ── Animated Party Row ──

function AnimatedPartyRow({
  party,
  index,
  maxVotes,
  prevRank,
}: {
  party: any;
  index: number;
  maxVotes: number;
  prevRank: number;
}) {
  const animatedVotes = useAnimatedNumber(party.total_votes, 600);
  const barWidth = maxVotes > 0 ? (party.total_votes / maxVotes) * 100 : 0;
  const isWinner = index === 0;
  const isRunnerUp = index === 1;
  const flash = useFlashEffect(party.total_votes);

  return (
    <div
      className={`px-[16px] md:px-[24px] transition-all duration-500 ease-out ${
        flash ? "bg-[var(--color-green)]/[0.08]" : ""
      } ${
        isWinner
          ? "py-[14px] border-l-[3px] border-l-[var(--color-green-bright)]"
          : isRunnerUp
            ? "py-[12px] bg-[var(--color-ink-light)]/50 border-l-[3px] border-l-[var(--color-green)]/40"
            : "py-[10px] hover:bg-[var(--color-ink-light)] border-l-[3px] border-l-transparent"
      }`}
    >
      <div className="flex items-center justify-between mb-[8px]">
        <div className="flex items-center gap-[10px] min-w-0">
          {/* Rank badge */}
          <div
            className={`w-[28px] h-[28px] rounded-full flex items-center justify-center flex-shrink-0 font-mono text-[11px] font-bold transition-all duration-500 ${
              isWinner
                ? "bg-[var(--color-green-bright)] text-white scale-110"
                : isRunnerUp
                  ? "bg-[var(--color-green)]/30 text-[var(--color-green-bright)]"
                  : "bg-[var(--color-gray-100)] text-[var(--color-text-muted)]"
            }`}
          >
            {index + 1}
          </div>

          {/* Party info */}
          <div className="flex items-center gap-[8px] min-w-0">
            <div
              className="w-[14px] h-[14px] rounded-[3px] flex-shrink-0 ring-1 ring-white/10 transition-transform duration-300"
              style={{
                backgroundColor: party.color,
                transform: flash ? "scale(1.3)" : "scale(1)",
              }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-[8px]">
                <span
                  className={`font-display font-bold transition-all duration-300 ${
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
                <RankChange current={index} previous={prevRank} />
              </div>
              <span className="font-mono text-[10px] text-[var(--color-text-dim)] hidden sm:inline">
                {PARTY_NAMES[party.abbreviation] || party.name}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Votes + Percentage */}
        <div className="flex items-center gap-[16px] flex-shrink-0">
          <div className="text-right">
            <div
              className={`font-mono font-bold tabular-nums transition-colors duration-300 ${
                isWinner ? "text-lg md:text-xl" : "text-sm md:text-base"
              } ${flash ? "text-[var(--color-green-bright)]" : "text-[var(--color-text)]"}`}
            >
              {animatedVotes.toLocaleString()}
            </div>
            <div className="font-mono text-[10px] text-[var(--color-text-dim)]">votes</div>
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
}

// ── Main Component ──

const PartyResults: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const { parties, grandTotal, connected, source } = useRealtimeData();

  // Track previous rankings for change indicators
  const [prevRanks, setPrevRanks] = useState<Record<string, number>>({});
  const prevRanksRef = useRef<Record<string, number>>({});

  // Update previous ranks when parties change
  useEffect(() => {
    const newRanks: Record<string, number> = {};
    parties.forEach((p: any, i: number) => {
      newRanks[p.abbreviation] = i;
    });

    // Only update if we had previous data
    if (Object.keys(prevRanksRef.current).length > 0) {
      setPrevRanks({ ...prevRanksRef.current });
    }

    // Store current ranks for next update (after a delay so the indicator shows)
    const timer = setTimeout(() => {
      prevRanksRef.current = newRanks;
    }, 1500);

    return () => clearTimeout(timer);
  }, [parties]);

  if (!connected) return <PartyResultsSkeleton />;

  if (parties.length === 0) {
    return (
      <div>
        <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)]">
          <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
            NATIONAL LEADERBOARD
          </h3>
        </div>
        <div className="p-[40px] text-center">
          <div className="text-2xl mb-[8px]">🗳</div>
          <div className="font-mono text-sm text-[var(--color-text-dim)]">Awaiting results</div>
        </div>
      </div>
    );
  }

  const maxVotes = parties[0]?.total_votes || 1;

  return (
    <div>
      {/* Header */}
      <div className="px-[16px] md:px-[24px] py-[14px] border-b border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
        <div className="flex items-center justify-between gap-[12px]">
          <div className="min-w-0">
            <h3 className="font-display font-bold text-sm md:text-base text-[var(--color-text)]">
              NATIONAL LEADERBOARD
            </h3>
            <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-[2px]">
              {source === "convex" ? (
                <>Real-time via Convex <span className="text-[var(--color-green-bright)]">● LIVE</span></>
              ) : (
                <>Polling every 10s</>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-mono text-[9px] text-[var(--color-text-dim)] uppercase tracking-wider">
              Total Votes
            </div>
            <div className="font-display font-bold text-lg md:text-xl text-[var(--color-green-bright)] tabular-nums">
              {grandTotal.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Party rows — animated */}
      <div className="divide-y divide-[var(--color-gray-100)]">
        {parties.map((party: any, index: number) => (
          <AnimatedPartyRow
            key={party.abbreviation}
            party={party}
            index={index}
            maxVotes={maxVotes}
            prevRank={prevRanks[party.abbreviation] ?? -1}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-[16px] md:px-[24px] py-[10px] border-t border-[var(--color-gray-100)] flex items-center justify-between bg-[var(--color-ink-light)]/50">
        <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
          {source === "convex" ? "Real-time updates • No polling" : "Polling every 10 seconds"}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
          {new Date().toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos" })}
        </span>
      </div>
    </div>
  );
};

export default PartyResults;
