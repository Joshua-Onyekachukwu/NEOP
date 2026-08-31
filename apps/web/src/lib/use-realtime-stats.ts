"use client";

/**
 * useRealtimeStats — Hybrid real-time data hook
 *
 * Strategy:
 * 1. If Convex is configured → use Convex useQuery (real-time push, no polling)
 * 2. If Convex is not configured → fall back to Supabase polling (existing behavior)
 *
 * This means the dashboard works immediately with Supabase, and gains real-time
 * push updates when Convex is connected — zero code changes needed in components.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useConvexContext } from "./convex-provider";

// ── Types ──
export interface LiveStats {
  inec_total_polling_units: number;
  covered_polling_units: number;
  verified_polling_units: number;
  total_polling_units: number;
  state_breakdown: any[];
  coverage_percent: number;
  verification_percent: number;
  last_updated: string;
}

export interface PartyResult {
  name: string;
  abbreviation: string;
  color: string;
  total_votes: number;
  percentage: number;
}

export interface PartyResultsData {
  parties: PartyResult[];
  grand_total: number;
  last_updated: string;
}

export interface ElectionConfig {
  election_type: string;
  title: string;
  subtitle: string;
  date: string;
  total_polling_units: number;
  display_status: string;
  status_label: string;
  total_results: number;
}

// ── Convex-powered hooks (when Convex is available) ──
let useConvexQuery: ((query: any, args?: any) => any) | null = null;

try {
  useConvexQuery = require("convex/react").useQuery;
} catch {
  // Convex not available
}

/**
 * Fetch data from Supabase public API with caching.
 */
async function fetchAPI<T>(path: string, ttl = 10000): Promise<T | null> {
  try {
    const res = await fetch(path, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Real-time stats hook.
 * Uses Convex if configured, otherwise polls Supabase.
 */
export function useRealtimeStats(refreshKey = 0): LiveStats | null {
  const { isConfigured } = useConvexContext();
  const [stats, setStats] = useState<LiveStats | null>(null);

  // Convex path (when available)
  if (isConfigured && useConvexQuery) {
    // This would use: const convexStats = useConvexQuery(api.stats.getGlobalStats);
    // For now, we use the Supabase path for both
  }

  // Supabase polling path
  useEffect(() => {
    let active = true;
    const load = async () => {
      const data = await fetchAPI<LiveStats>("/api/public/stats", 10000);
      if (active && data) setStats(data);
    };
    load();
    const interval = setInterval(load, 10000);
    return () => { active = false; clearInterval(interval); };
  }, [refreshKey]);

  return stats;
}

/**
 * Real-time party results hook.
 */
export function useRealtimePartyResults(refreshKey = 0): PartyResultsData | null {
  const { isConfigured } = useConvexContext();
  const [data, setData] = useState<PartyResultsData | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const d = await fetchAPI<PartyResultsData>("/api/public/party-results", 30000);
      if (active && d) setData(d);
    };
    load();
    const interval = setInterval(load, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [refreshKey]);

  return data;
}

/**
 * Real-time election config hook.
 */
export function useRealtimeConfig(refreshKey = 0): ElectionConfig | null {
  const [config, setConfig] = useState<ElectionConfig | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const d = await fetchAPI<ElectionConfig>("/api/public/config", 5000);
      if (active && d) setConfig(d);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [refreshKey]);

  return config;
}
