"use client";

/**
 * SectionNav — sticky quick-jump bar for the live-results page.
 *
 * Lets users jump straight to Map / Feed / Leaderboard / State Breakdown.
 * - Sticky directly under the main navbar (56px).
 * - Active section tracked with an IntersectionObserver; clicking smooth-
 *   scrolls to the target with an explicit offset.
 *
 * Each item carries a short label below sm: with the full words the strip
 * needed ~380px, so a 320px phone had to swipe the bar horizontally to reach
 * "State Breakdown". The compact labels fit in one row, so nothing is hidden
 * behind a horizontal gesture any more. (overflow-x-auto stays as a safety
 * net for very large text / zoom levels.)
 */

import React, { useEffect, useState, useCallback } from "react";

const SECTIONS = [
  { id: "section-map", label: "Map", short: "Map" },
  { id: "section-feed", label: "Feed", short: "Feed" },
  { id: "section-leaderboard", label: "Leaderboard", short: "Parties" },
  { id: "section-states", label: "State Breakdown", short: "States" },
] as const;

const SectionNav: React.FC = () => {
  const [active, setActive] = useState<string>("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => !!el
    );
    if (targets.length === 0) return;

    // Track the most recently intersecting section as active.
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const current = SECTIONS.find((s) => visible.get(s.id));
        if (current) setActive(current.id);
      },
      // Trigger near the top third of the viewport.
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  const jump = useCallback((id: string) => {
    setActive(id);
    const el = document.getElementById(id);
    if (!el) return;
    // Manual offset scroll: some embedded webviews ignore scroll-margin on
    // scrollIntoView, so we clear the fixed navbar (56px) + this bar (~48px)
    // ourselves.
    const STICKY_OFFSET = 116;
    const y = el.getBoundingClientRect().top + window.scrollY - STICKY_OFFSET;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }, []);

  if (!mounted) return null;

  return (
    <nav
      aria-label="Jump to section"
      className="sticky top-[56px] z-40 bg-[var(--color-ink)]/95 backdrop-blur-sm border-b border-[var(--color-gray-100)]"
    >
      <div className="container-x">
        <div className="flex items-center justify-start gap-[4px] overflow-x-auto scrollbar-none py-[6px]">
          {SECTIONS.map((s) => {
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => jump(s.id)}
                aria-current={isActive ? "true" : undefined}
                aria-controls={s.id}
                className={`flex-shrink-0 font-mono text-[11px] uppercase tracking-wider px-[10px] py-[5px] rounded-[4px] transition-colors ${
                  isActive
                    ? "bg-[var(--color-green)]/15 text-[var(--color-green-bright)] font-bold"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-ink-light)]"
                }`}
              >
                <span className="sm:hidden">{s.short}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            );
          })}
          <div className="flex-shrink-0 ml-auto hidden md:flex items-center gap-[6px] font-mono text-[10px] text-[var(--color-text-dim)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green-bright)] animate-pulse" />
            LIVE
          </div>
        </div>
      </div>
    </nav>
  );
};

export default SectionNav;
