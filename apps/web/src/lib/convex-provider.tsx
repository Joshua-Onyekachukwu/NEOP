"use client";

/**
 * Convex Provider for Next.js
 *
 * Wraps the app with ConvexClientProvider so all children
 * can use useQuery and useMutation from Convex.
 *
 * Falls back gracefully if CONVEX_URL is not configured.
 */

import React, { createContext, useContext, useMemo } from "react";

let ConvexClientProvider: React.ComponentType<any> | null = null;

try {
  const convexReact = require("convex/react");
  ConvexClientProvider = convexReact.ConvexClientProvider;
} catch {
  // Convex not installed — provider will be a no-op
}

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

const IS_CONFIGURED = Boolean(CONVEX_URL && ConvexClientProvider);

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  const ctxValue = useMemo(
    () => ({ isConfigured: IS_CONFIGURED }),
    []
  );

  // If Convex is not configured, render children without provider
  if (!IS_CONFIGURED || !ConvexClientProvider) {
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
