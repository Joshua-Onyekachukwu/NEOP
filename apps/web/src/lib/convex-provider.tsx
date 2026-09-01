"use client";

/**
 * Convex Provider for Next.js
 *
 * Wraps the app with ConvexClientProvider so all children
 * can use useQuery and useMutation from Convex.
 *
 * Falls back gracefully if CONVEX_URL is not configured.
 */

import React, { createContext, useContext, useMemo, useState, useEffect } from "react";

interface ConvexContextValue {
  isConfigured: boolean;
}

const ConvexContext = createContext<ConvexContextValue>({
  isConfigured: false,
});

export function useConvexContext() {
  return useContext(ConvexContext);
}

/**
 * Check for Convex URL synchronously.
 * NEXT_PUBLIC_ env vars are inlined at build time, so this is safe.
 */
const CONVEX_URL =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_CONVEX_URL || ""
    : "";

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  const [ConvexClientProvider, setConvexClientProvider] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    // Dynamically import convex/react only on the client
    import("convex/react").then((mod) => {
      setConvexClientProvider(() => mod.ConvexClientProvider);
    }).catch(() => {
      // Convex not available — will render children without provider
    });
  }, []);

  const isConfigured = Boolean(CONVEX_URL && ConvexClientProvider);

  const ctxValue = useMemo(
    () => ({ isConfigured }),
    [isConfigured]
  );

  // If Convex is not configured or not loaded yet, render children without provider
  if (!isConfigured || !ConvexClientProvider) {
    return (
      <ConvexContext.Provider value={ctxValue}>
        {children}
      </ConvexContext.Provider>
    );
  }

  return (
    <ConvexContext.Provider value={ctxValue}>
      <ConvexClientProvider url={CONVEX_URL}>
        {children}
      </ConvexClientProvider>
    </ConvexContext.Provider>
  );
}
