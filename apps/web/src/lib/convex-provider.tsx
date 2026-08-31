"use client";

/**
 * Convex Provider for Next.js
 *
 * Wraps the app with ConvexClientProvider so all children
 * can use useQuery and useMutation from Convex.
 *
 * Falls back gracefully if CONVEX_URL is not configured.
 */

import React, { createContext, useContext, useEffect, useState } from "react";

// Dynamically import Convex to avoid SSR issues
let ConvexClientProvider: React.ComponentType<any> | null = null;
let useConvexClient: (() => any) | null = null;

try {
  const convexReact = require("convex/react");
  ConvexClientProvider = convexReact.ConvexClientProvider;
  useConvexClient = convexReact.useConvexClient;
} catch {
  // Convex not installed — provider will be a no-op
}

interface ConvexContextValue {
  isConfigured: boolean;
  client: any;
}

const ConvexContext = createContext<ConvexContextValue>({
  isConfigured: false,
  client: null,
});

export function useConvexContext() {
  return useContext(ConvexContext);
}

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  const [isConfigured, setIsConfigured] = useState(false);
  const [client, setClient] = useState<any>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (url && ConvexClientProvider) {
      setIsConfigured(true);
    }
  }, []);

  // If Convex is not configured, render children without provider
  if (!isConfigured || !ConvexClientProvider) {
    return (
      <ConvexContext.Provider value={{ isConfigured: false, client: null }}>
        {children}
      </ConvexContext.Provider>
    );
  }

  return (
    <ConvexContext.Provider value={{ isConfigured, client }}>
      <ConvexClientProvider url={process.env.NEXT_PUBLIC_CONVEX_URL!}>
        {children}
      </ConvexClientProvider>
    </ConvexContext.Provider>
  );
}
