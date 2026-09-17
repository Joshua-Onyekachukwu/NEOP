"use client";

import { useEffect } from "react";

/**
 * Lock page scrolling while `active`, restoring the exact inline styles that
 * were present before.
 *
 * Centralised on purpose. The failure mode this guards against is the classic
 * one: a modal or drawer sets `document.body.style.overflow = "hidden"` and a
 * code path that unmounts early (route change, an error, a conditional render)
 * never puts it back — after which the page can never be scrolled again.
 *
 * Guarantees:
 *   · the previous inline values are captured and restored, not guessed
 *   · restoration runs on deactivate, on unmount, and on route change
 *   · the scrollbar's width is compensated so the layout does not jump the
 *     moment the lock engages
 *   · it is a no-op during SSR
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [active]);
}

export default useBodyScrollLock;
