"use client";

/**
 * useRealtimeStats — Hybrid real-time data hook
 *
 * Strategy: Polls Supabase REST API every 10 seconds for live data.
 */

import { useState, useEffect } from "react";

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
 * Polls Supabase REST API.
 */
export function useRealtimeStats(refreshKey = 0): LiveStats | null {
  const [stats, setStats] = useState<LiveStats | null>(null);

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
