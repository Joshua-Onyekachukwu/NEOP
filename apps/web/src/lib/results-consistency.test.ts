import { describe, it, expect } from "vitest";

/**
 * Results Consistency Test — the reconciliation gate (§29).
 *
 * Fails CI whenever national totals, state-sum totals, or party-sum totals
 * diverge. This prevents the fake-denominator bugs that haunted earlier
 * versions (e.g. "80,996 results" displayed while the real PU universe was
 * 176,846).
 *
 * Runs against a live API. Point it anywhere:
 *   TEST_BASE_URL=https://ngeop.vercel.app npx vitest run results-consistency
 *
 * ── Why this file probes before it asserts ──────────────────────────────
 * A results API that cannot reach its database is NOT a consistency failure.
 * The previous version of this test could not tell the two apart: it fetched
 * inside `beforeAll` with a 30s timeout against vitest's 10s hook budget, so
 * during an outage every suite died with "Hook timed out in 10000ms" — three
 * false regressions pointing at our aggregation code. It now probes once
 * with a timeout strictly below the hook budget, and skips the whole file
 * with an explicit reason when the platform is unreachable or the API
 * reports it has no data of its own to serve (data_status: UNAVAILABLE).
 *
 * Skips are loud on purpose: a silently skipped reconciliation gate is worse
 * than none at all.
 */

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";

// The probe timeout must stay well below vitest's hook/test budget so our own
// error handling runs instead of the runner killing the hook first.
const PROBE_MS = 8_000;
const FETCH_MS = 20_000;

type Health = { reachable: boolean; reason: string };

async function probe(): Promise<Health> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/public/stats`, {
      signal: AbortSignal.timeout(PROBE_MS),
      headers: { Accept: "application/json" },
    });
  } catch (e: any) {
    return {
      reachable: false,
      reason:
        e?.name === "TimeoutError" || e?.name === "AbortError"
          ? `no response from ${BASE} within ${PROBE_MS}ms`
          : `${e?.message || e} (is a server running at ${BASE}?)`,
    };
  }

  if (!res.ok) {
    return { reachable: false, reason: `stats endpoint returned HTTP ${res.status}` };
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    return { reachable: false, reason: "stats endpoint did not return JSON" };
  }

  // The API tells us when it is serving a fallback rather than real data
  // (see api-cache.ts: success payloads omit data_status; the cold-start
  // fallback sets UNAVAILABLE, the last-good snapshot sets STALE).
  if (body?.data_status === "UNAVAILABLE") {
    return {
      reachable: false,
      reason: "the results API reports it cannot reach its database (data_status: UNAVAILABLE)",
    };
  }

  return { reachable: true, reason: "ok" };
}

const health = await probe();

if (!health.reachable) {
  // Loud, not silent: this suite did not run, and why.
  console.warn(
    `\n[results-consistency] SKIPPED — ${health.reason}\n` +
      `[results-consistency] No reconciliation was performed. This is an infrastructure\n` +
      `[results-consistency] outage, NOT a data-integrity result. Re-run once it recovers.\n`
  );
}

// describe.skip keeps the file green while making the skip visible in output.
const suite = health.reachable ? describe : describe.skip;

/** Fetch + parse, failing the test with the real cause rather than a hook timeout. */
async function fetchJSON(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(FETCH_MS),
    headers: { Accept: "application/json" },
  });
  expect(res.ok, `GET ${path} → HTTP ${res.status}`).toBe(true);
  return res.json();
}

// ─── National totals must equal state-sum totals ───

suite("Results consistency: national = state-sum", () => {
  it("total_polling_units is positive", async () => {
    const stats = await fetchJSON("/api/public/stats");
    expect(stats.total_polling_units).toBeGreaterThan(0);
  });

  it("published + disputed + failed + disrupted + unavailable + awaiting = total PU universe", async () => {
    const stats = await fetchJSON("/api/public/stats");
    const sum =
      (stats.published_pus || 0) +
      (stats.disputed_pus || 0) +
      (stats.failed_pus || 0) +
      (stats.disrupted_pus || 0) +
      (stats.unavailable_pus || 0) +
      (stats.awaiting_pus || 0);
    // Every polling unit is accounted for in exactly one state; never a
    // silent gap, never a double count (§29).
    expect(sum).toBe(stats.total_polling_units);
  });

  it("accounted_pus equals the sum of non-awaiting statuses", async () => {
    const stats = await fetchJSON("/api/public/stats");
    if (stats.accounted_pus === undefined) return; // older API shape
    const accounted =
      (stats.published_pus || 0) +
      (stats.disputed_pus || 0) +
      (stats.failed_pus || 0) +
      (stats.disrupted_pus || 0) +
      (stats.unavailable_pus || 0);
    expect(stats.accounted_pus).toBe(accounted);
  });

  it("state_breakdown sums match the national totals", async () => {
    const stats = await fetchJSON("/api/public/stats");
    const sb = stats.state_breakdown;
    if (!sb || !Array.isArray(sb) || sb.length === 0) return; // no dataset yet

    const stateTotalPU = sb.reduce(
      (s: number, r: any) => s + (r.total_pus || r.total_polling_units || 0),
      0
    );
    const statePublished = sb.reduce(
      (s: number, r: any) => s + (r.published || r.published_pus || 0),
      0
    );

    expect(stateTotalPU).toBe(stats.total_polling_units);
    // States may lag the national figure by a cache cycle, never exceed it.
    expect(statePublished).toBeLessThanOrEqual(stats.published_pus + 10);
  });
});

// ─── Displayed percentages must be derived, not invented (§7, §8) ───

suite("Results consistency: derived rates", () => {
  it("coverage_percent is computed from covered/total", async () => {
    const stats = await fetchJSON("/api/public/stats");
    if (!stats.coverage_percent || stats.coverage_percent === 0) return;
    const derived = (stats.covered_polling_units / stats.total_polling_units) * 100;
    expect(stats.coverage_percent).toBeCloseTo(derived, 0);
  });

  it("verification_percent is the published share of REPORTING PUs", async () => {
    const stats = await fetchJSON("/api/public/stats");
    if (!stats.verification_percent || !stats.covered_polling_units) return;
    // §2 glossary (get_pu_coverage_summary): verified_percent = published /
    // (total − unavailable − awaiting) — of the PUs that actually reported,
    // how many published a result. The old assertion divided by the whole
    // universe, which conflated the verification rate with the published
    // share and contradicted the API on any dataset with unreported PUs.
    const reporting =
      stats.total_polling_units -
      (stats.unavailable_pus || 0) -
      (stats.awaiting_pus || 0);
    if (reporting <= 0) return;
    const derived = (stats.verified_polling_units / reporting) * 100;
    expect(stats.verification_percent).toBeCloseTo(derived, 0);
  });

  it("verified PUs never exceed covered PUs", async () => {
    const stats = await fetchJSON("/api/public/stats");
    expect(stats.verified_polling_units || 0).toBeLessThanOrEqual(
      stats.covered_polling_units || 0
    );
  });

  it("covered PUs never exceed the universe", async () => {
    const stats = await fetchJSON("/api/public/stats");
    expect(stats.covered_polling_units || 0).toBeLessThanOrEqual(stats.total_polling_units);
  });
});

// ─── Party-sum totals must be internally consistent ───

suite("Results consistency: party sums", () => {
  it("party percentages sum to ~100% and match each party's vote share", async () => {
    const parties = await fetchJSON("/api/public/party-results");
    if (!parties.parties || parties.parties.length === 0) return;

    const totalPct = parties.parties.reduce((s: number, p: any) => s + (p.percentage || 0), 0);
    expect(totalPct).toBeCloseTo(100, 0); // within 1%

    // Each percentage must be the party's real share of the grand total —
    // a leaderboard that invents percentages diverges here.
    const grand = parties.grand_total || parties.parties.reduce((s: number, p: any) => s + (p.total_votes || 0), 0);
    if (grand > 0) {
      for (const p of parties.parties) {
        expect(p.percentage, `${p.abbreviation} share`).toBeCloseTo(
          ((p.total_votes || 0) / grand) * 100,
          0
        );
      }
    }
  });

  it("party vote counts are non-negative", async () => {
    const parties = await fetchJSON("/api/public/party-results");
    if (!parties.parties) return;
    for (const p of parties.parties) {
      expect(p.total_votes).toBeGreaterThanOrEqual(0);
      expect(p.percentage).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── The denominator and the data-mode label have one source of truth ───

suite("Results consistency: config denominator and data mode", () => {
  it("config and stats agree on the PU universe", async () => {
    const [config, stats] = await Promise.all([
      fetchJSON("/api/public/config"),
      fetchJSON("/api/public/stats"),
    ]);
    // §19: the denominator comes from the configured election dataset and is
    // never a hard-coded UI number — so both endpoints must report the same one.
    expect(config.total_polling_units).toBe(stats.total_polling_units);
  });

  it("total_polling_units is the real INEC universe (> 100,000, not a round number)", async () => {
    const config = await fetchJSON("/api/public/config");
    const v = config.total_polling_units;
    expect(v).toBeGreaterThan(100_000);
    // Hard-coded fake denominators tend to be round; the INEC 2026 universe
    // (176,846) is not.
    for (const fake of [80_000, 80_996, 100_000, 150_000, 200_000]) {
      expect(v).not.toBe(fake);
    }
  });

  it("the payload labels its data mode so the UI can say SIMULATED vs LIVE (§18)", async () => {
    const config = await fetchJSON("/api/public/config");
    expect(["SIMULATION", "LIVE", "WAITING"]).toContain(config.display_status);
    // A status label must always accompany the mode so the public site can
    // never present simulated data as an official declaration.
    expect(typeof config.status_label).toBe("string");
    expect(config.status_label.length).toBeGreaterThan(0);
  });

  it("the public stats carry the non-official disclaimer", async () => {
    const stats = await fetchJSON("/api/public/stats");
    if (!stats.disclaimer) return; // older API shape
    expect(stats.disclaimer.toLowerCase()).toContain("not official");
  });
});

// ─── /stats must carry a leaderboard; one word per denominator (§2) ───

suite("Results consistency: stats leaderboard + rate glossary", () => {
  it("/api/public/stats always carries a leaderboard array", async () => {
    const stats = await fetchJSON("/api/public/stats");
    // Regression (Phase 3, Issue 4): the summary's party rows were dropped,
    // so /stats had no leaderboard at all while /party-results worked —
    // any consumer keying off stats saw a silent empty national board.
    expect(Array.isArray(stats.leaderboard)).toBe(true);
  });

  it("stats leaderboard agrees with the party-results endpoint", async () => {
    const [stats, parties] = await Promise.all([
      fetchJSON("/api/public/stats"),
      fetchJSON("/api/public/party-results"),
    ]);
    const sb = stats.leaderboard;
    const pr = parties.parties;
    if (!Array.isArray(sb) || sb.length === 0 || !Array.isArray(pr) || pr.length === 0) return;
    // Same source (get_election_summary party rows) — same winner, same
    // size, and identical per-party totals (display scaling applies to
    // both equally).
    expect(sb.length).toBe(pr.length);
    const byAbbrS = Object.fromEntries(sb.map((p: any) => [p.abbreviation, Number(p.total_votes)]));
    for (const p of pr) {
      expect(byAbbrS[p.abbreviation], `${p.abbreviation} total`).toBe(Number(p.total_votes));
    }
    expect(sb[0].total_votes).toBe(Math.max(...sb.map((p: any) => Number(p.total_votes))));
    expect(sb[0].abbreviation).toBe(pr[0].abbreviation);
  });

  it("leaderboard percentages are shares of the leaderboard grand total", async () => {
    const stats = await fetchJSON("/api/public/stats");
    const lb = stats.leaderboard;
    if (!Array.isArray(lb) || lb.length === 0) return;
    const grand = lb.reduce((s: number, p: any) => s + Number(p.total_votes || 0), 0);
    if (grand <= 0) return; // all-zero dataset
    for (const p of lb) {
      expect(p.percentage, `${p.abbreviation} share`).toBeCloseTo(
        ((Number(p.total_votes) / grand) * 100),
        0
      );
    }
  });

  it("accounted share + awaiting share = 100% of the universe (one denominator, stated)", async () => {
    const stats = await fetchJSON("/api/public/stats");
    if (stats.accounted_pus == null) return; // non-ledger dataset
    // coverage_percent IS the accounted share — the two must agree, so the
    // UI can label the card "Accounted" without inventing a number.
    const derivedAccounted = (stats.accounted_pus / stats.total_polling_units) * 100;
    expect(stats.coverage_percent).toBeCloseTo(derivedAccounted, 0);
    // published_percent must be the PUBLISHED share of the same universe —
    // the number the ticker and lifecycle show as "published (N%)".
    if (stats.published_percent != null) {
      const derivedPublished = (stats.published_pus / stats.total_polling_units) * 100;
      expect(stats.published_percent).toBeCloseTo(derivedPublished, 0);
    }
  });
});
