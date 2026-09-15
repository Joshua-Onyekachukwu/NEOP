import { describe, it, expect, beforeAll } from "vitest";

/**
 * Results Consistency Test
 *
 * Fails CI whenever national totals, state-sum totals, or party-sum totals
 * diverge. This prevents the fake-denominator bugs that haunted earlier
 * versions (e.g. "80,996 results" displayed while the real PU universe
 * was 176,846).
 *
 * Runs against the live API (local dev server must be running on :3000).
 * In CI, the build step starts the server before tests run.
 */

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const TIMEOUT = 30_000;

async function fetchJSON(path: string) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(TIMEOUT) });
  expect(res.ok).toBe(true);
  return res.json();
}

// ─── National totals must equal state-sum totals ───

describe("Results consistency: national = state-sum", () => {
  let stats: any;

  beforeAll(async () => {
    stats = await fetchJSON("/api/public/stats");
  });

  it("total_polling_units is positive", () => {
    expect(stats.total_polling_units).toBeGreaterThan(0);
  });

  it("published_pus + disputed + failed + disrupted + unavailable + awaiting = total", () => {
    const sum =
      (stats.published_pus || 0) +
      (stats.disputed_pus || 0) +
      (stats.failed_pus || 0) +
      (stats.disrupted_pus || 0) +
      (stats.unavailable_pus || 0) +
      (stats.awaiting_pus || 0);
    expect(sum).toBe(stats.total_polling_units);
  });

  it("state_breakdown sums match national totals", () => {
    const sb = stats.state_breakdown;
    if (!sb || !Array.isArray(sb) || sb.length === 0) {
      // No state breakdown available — skip (no active sim)
      return;
    }

    const stateTotalPU = sb.reduce((s: number, r: any) => s + (r.total_pus || r.total_polling_units || 0), 0);
    const statePublished = sb.reduce((s: number, r: any) => s + (r.published || r.published_pus || 0), 0);

    expect(stateTotalPU).toBe(stats.total_polling_units);
    // published across states should be ≤ national published (some may be in-flight)
    expect(statePublished).toBeLessThanOrEqual(stats.published_pus + 10); // tolerance for caching
  });

  it("accounted_pus equals sum of non-awaiting statuses", () => {
    if (stats.accounted_pus === undefined) return; // old API shape
    const accounted =
      (stats.published_pus || 0) +
      (stats.disputed_pus || 0) +
      (stats.failed_pus || 0) +
      (stats.disrupted_pus || 0) +
      (stats.unavailable_pus || 0);
    expect(stats.accounted_pus).toBe(accounted);
  });
});

// ─── Party-sum totals must be internally consistent ───

describe("Results consistency: party sums", () => {
  let parties: any;

  beforeAll(async () => {
    parties = await fetchJSON("/api/public/party-results");
  });

  it("party percentages sum to ~100%", () => {
    if (!parties.parties || parties.parties.length === 0) return;
    const totalPct = parties.parties.reduce(
      (s: number, p: any) => s + (p.percentage || 0),
      0
    );
    expect(totalPct).toBeCloseTo(100, 0); // within 1%
  });

  it("all party vote counts are non-negative", () => {
    if (!parties.parties) return;
    for (const p of parties.parties) {
      expect(p.total_votes).toBeGreaterThanOrEqual(0);
    }
  });

  it("no party has a negative percentage", () => {
    if (!parties.parties) return;
    for (const p of parties.parties) {
      expect(p.percentage).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── Config must show the correct PU universe ───

describe("Results consistency: config denominator", () => {
  let config: any;

  beforeAll(async () => {
    config = await fetchJSON("/api/public/config");
  });

  it("total_polling_units is the real INEC universe (> 100,000)", () => {
    expect(config.total_polling_units).toBeGreaterThan(100_000);
  });

  it("total_polling_units is not a suspicious round number", () => {
    // Hard-coded fake denominators tend to be round: 80000, 80996, etc.
    // The real INEC 2026 universe is 176,846 — not a round number.
    const v = config.total_polling_units;
    expect(v).not.toBe(80_000);
    expect(v).not.toBe(80_996);
    expect(v).not.toBe(100_000);
    expect(v).not.toBe(150_000);
    expect(v).not.toBe(200_000);
  });
});
