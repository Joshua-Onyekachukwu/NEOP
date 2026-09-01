/**
 * Server-side Convex HTTP client
 *
 * Used as a fallback when Supabase is down.
 * Queries Convex's HTTP API directly from Next.js serverless functions.
 */

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://flexible-guineapig-4.convex.cloud";

export async function convexQuery<T = any>(
  path: string,
  args?: Record<string, any>
): Promise<T | null> {
  try {
    const response = await fetch(`${CONVEX_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, args: args || {} }),
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (!response.ok) {
      console.error(`Convex query ${path} failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.value as T;
  } catch (error) {
    console.error(`Convex query ${path} error:`, error);
    return null;
  }
}

export async function convexMutation(
  path: string,
  args?: Record<string, any>
): Promise<any> {
  try {
    const response = await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, args: args || {} }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Convex mutation ${path} failed: ${response.status} ${text}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`Convex mutation ${path} error:`, error);
    return null;
  }
}

// ── Pre-built query helpers ──

export interface ConvexPartyTotal {
  name: string;
  abbreviation: string;
  color: string;
  total_votes: number;
  percentage: number;
}

export interface ConvexGlobalStats {
  inec_total_polling_units: number;
  total_polling_units: number;
  covered_polling_units: number;
  verified_polling_units: number;
  total_votes: number;
  active_pu_count: number;
  coverage_percent: number;
  verification_percent: number;
  simulation_running: boolean;
  scenario?: string;
  election_type?: string;
  last_updated: number;
}

export async function getConvexPartyTotals(): Promise<ConvexPartyTotal[] | null> {
  return convexQuery<ConvexPartyTotal[]>("stats:getPartyTotals");
}

export async function getConvexGlobalStats(): Promise<ConvexGlobalStats | null> {
  return convexQuery<ConvexGlobalStats>("stats:getGlobalStats");
}

export async function getConvexStateBreakdown(): Promise<any[] | null> {
  return convexQuery("stats:getStateBreakdown");
}

export async function getConvexSimConfig(): Promise<any | null> {
  return convexQuery("stats:getSimConfig");
}
