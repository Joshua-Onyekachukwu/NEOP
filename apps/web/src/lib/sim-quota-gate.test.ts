import { describe, it, expect } from "vitest";
import { evaluateQuotaGate, type QuotaProjection } from "./sim-quota-gate";

/**
 * Pre-flight quota guard — refusal/acceptance contract.
 *
 * Fully isolated: evaluateQuotaGate is pure and does no I/O, so these assertions
 * never touch a database. That matters because the guard's whole job is to
 * protect the plan envelope, and the cheapest way to verify it is to feed it
 * projections directly rather than to provoke real over-quota states.
 *
 * Real values from production, for calibration:
 *   ceiling (quota_bytes)      891,289,600  (850 MB, with a 120 MB margin)
 *   a 20%-coverage projection  ~584,000,000
 *   a published dataset        ~223,832,500 (retained during a run, migration 262)
 */

const CEILING = 891_289_600;
const MB = 1_000_000;

const projection = (over: Partial<QuotaProjection> = {}): QuotaProjection => ({
  ok: true,
  quota_bytes: CEILING,
  projected_peak_bytes: 426_809_211, // observed for 10% coverage
  recommended_max_coverage_pct: 40,
  projected_published_pus: 17_684,
  ...over,
});

describe("quota gate: accepts a workable launch", () => {
  it("allows a comfortable coverage", () => {
    const verdict = evaluateQuotaGate({ quota: projection(), coveragePct: 10 });
    expect(verdict.allowed).toBe(true);
    expect(verdict.message).toBeUndefined();
    expect(verdict.degraded).toBe(false);
  });

  it("allows a launch that lands exactly on the ceiling", () => {
    // The boundary is `>`, not `>=`: a projection that exactly fits is allowed.
    const verdict = evaluateQuotaGate({
      quota: projection({ projected_peak_bytes: CEILING }),
      coveragePct: 30,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("ignores a negative retained-bytes reading instead of trusting it", () => {
    const verdict = evaluateQuotaGate({
      quota: projection({ projected_peak_bytes: CEILING - 10 * MB }),
      retainedBytes: -50 * MB,
      coveragePct: 10,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.retainedBytes).toBe(0);
  });
});

describe("quota gate: refuses an oversized launch", () => {
  it("refuses when the projection function itself says no", () => {
    const verdict = evaluateQuotaGate({
      quota: projection({ ok: false, projected_peak_bytes: 1_200_000_000 }),
      coveragePct: 60,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("Coverage 60%");
    expect(verdict.message).toContain("over the plan ceiling");
    expect(verdict.message).toContain("refused BEFORE any data was changed");
  });

  it("names a coverage that would work, so the admin is not left guessing", () => {
    const verdict = evaluateQuotaGate({
      quota: projection({ ok: false, recommended_max_coverage_pct: 40 }),
      coveragePct: 60,
    });
    expect(verdict.message).toContain("coverage ≤ 40%");
    expect(verdict.message).toContain("17,684"); // projected published PUs
  });

  it("refuses purely because of the retained published dataset", () => {
    // This is the trade-off accepted for persistence: the dataset live on the
    // site is kept for the whole run, so it competes for the same envelope.
    // 700 MB + 224 MB = 924 MB > 891 MB, even though the projection alone passed.
    const verdict = evaluateQuotaGate({
      quota: projection({ ok: true, projected_peak_bytes: 700 * MB }),
      retainedBytes: 223_832_500,
      coveragePct: 25,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("currently published on the live site");
    expect(verdict.projectedPeakBytes).toBe(700 * MB + 223_832_500);
  });

  it("does not mention the retained dataset when there is none", () => {
    const verdict = evaluateQuotaGate({
      quota: projection({ ok: false }),
      retainedBytes: 0,
      coveragePct: 60,
    });
    expect(verdict.message).not.toContain("currently published on the live site");
  });

  it("still refuses safely when the recommendation is missing", () => {
    const verdict = evaluateQuotaGate({
      quota: projection({ ok: false, recommended_max_coverage_pct: null }),
      coveragePct: 90,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("the recommended maximum");
  });

  it("never emits NaN into the admin-facing message", () => {
    const verdict = evaluateQuotaGate({
      quota: { ok: true } as QuotaProjection, // projection fields absent entirely
      retainedBytes: 500 * MB,
      coveragePct: 50,
    });
    expect(verdict.allowed).toBe(true);
    const refused = evaluateQuotaGate({
      quota: { ok: false } as QuotaProjection,
      coveragePct: 50,
    });
    expect(refused.message).not.toMatch(/NaN|undefined/);
  });
});

describe("quota gate: degrades predictably when the guard cannot run", () => {
  it("proceeds (flagged degraded) when the RPC errored", () => {
    const verdict = evaluateQuotaGate({
      quota: null,
      quotaError: 'function public.simulation_quota_check(integer) does not exist',
      coveragePct: 20,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.degraded).toBe(true);
  });

  it("proceeds (flagged degraded) when the RPC returned nothing", () => {
    const verdict = evaluateQuotaGate({ quota: null, coveragePct: 20 });
    expect(verdict.allowed).toBe(true);
    expect(verdict.degraded).toBe(true);
  });

  it("is never degraded when the guard actually produced a verdict", () => {
    expect(evaluateQuotaGate({ quota: projection(), coveragePct: 10 }).degraded).toBe(false);
    expect(evaluateQuotaGate({ quota: projection({ ok: false }), coveragePct: 90 }).degraded).toBe(
      false
    );
  });
});
