/**
 * Pre-flight quota gate for simulation launches — pure decision logic.
 *
 * Extracted from POST /api/admin/simulate/trigger-v2 so it can be tested in
 * complete isolation. This module performs no I/O and never touches a database:
 * the route feeds it the results of simulation_quota_check() and
 * simulation_retained_bytes(), and acts on the verdict. That separation is what
 * lets us assert "refuses an oversized coverage, accepts a workable one"
 * without a live Postgres.
 *
 * Why the guard exists: storage tracks COVERAGE (published PUs × ~6.2 KB plus
 * the full ledger), not voters — target/display voters are never materialised.
 * Exceeding the plan envelope puts the project into read-only mode and degrades
 * PostgREST, so a launch that would breach it is refused BEFORE any data is
 * changed.
 */

export interface QuotaProjection {
  ok?: boolean | null;
  quota_bytes?: number | null;
  projected_peak_bytes?: number | null;
  recommended_max_coverage_pct?: number | null;
  projected_published_pus?: number | null;
  [key: string]: unknown;
}

export interface GateInput {
  /** Result of simulation_quota_check(coverage_pct); null if it returned nothing. */
  quota: QuotaProjection | null | undefined;
  /** Error message when the quota RPC itself is unavailable. */
  quotaError?: string | null;
  /**
   * Footprint of the dataset currently published on the live site. It is
   * retained for the whole run (migration 262) so the demo never goes blank,
   * which means it competes for the same envelope.
   */
  retainedBytes?: number | null;
  coveragePct: number;
}

export interface GateVerdict {
  allowed: boolean;
  /** Human-readable refusal, present only when allowed === false. */
  message?: string;
  /** Projected peak including the retained dataset. */
  projectedPeakBytes: number;
  retainedBytes: number;
  /**
   * True when the guard could not run at all (RPC missing/unavailable). The
   * launch proceeds — matching the route's long-standing behaviour of warning
   * and continuing rather than blocking every simulation on a missing helper.
   * Surfaced explicitly so callers can log it and tests can pin it.
   */
  degraded: boolean;
}

const gb = (n: number) => (n / 1e9).toFixed(2) + " GB";

export function evaluateQuotaGate(input: GateInput): GateVerdict {
  const retainedBytes = Math.max(0, Number(input.retainedBytes ?? 0) || 0);

  // Guard unavailable (e.g. migration not applied): proceed, but say so.
  if (input.quotaError || !input.quota) {
    return { allowed: true, projectedPeakBytes: 0, retainedBytes, degraded: true };
  }

  const quota = input.quota;
  const projectedPeakBytes =
    Math.max(0, Number(quota.projected_peak_bytes ?? 0) || 0) + retainedBytes;
  const ceiling = Math.max(0, Number(quota.quota_bytes ?? 0) || 0);

  // Refuse when the projection function itself says no, or when adding the
  // retained dataset pushes the total past the envelope. The second condition
  // is the cost of persistence: a smaller max coverage per batch, never a
  // blanked live site.
  const overCeiling = ceiling > 0 && projectedPeakBytes > ceiling;
  if (!quota.ok || overCeiling) {
    const retainedNote =
      retainedBytes > 0
        ? ` Of that, ${gb(retainedBytes)} is the simulation currently published on the live ` +
          `site, which is kept intact for the whole run so the demo never goes blank. `
        : " ";

    const recommended =
      quota.recommended_max_coverage_pct === null ||
      quota.recommended_max_coverage_pct === undefined
        ? "the recommended maximum"
        : `${quota.recommended_max_coverage_pct}%`;

    return {
      allowed: false,
      projectedPeakBytes,
      retainedBytes,
      degraded: false,
      message:
        `Coverage ${input.coveragePct}% would push the database to ~${gb(projectedPeakBytes)} — ` +
        `over the plan ceiling (${gb(ceiling)}).${retainedNote}` +
        `The launch was refused BEFORE any data was changed. Re-run with coverage ≤ ` +
        `${recommended} ` +
        `(projected published PUs: ${(quota.projected_published_pus || 0).toLocaleString()}). ` +
        `Display figures do not depend on coverage — raise display_voters instead if you ` +
        `want bigger on-screen numbers.`,
    };
  }

  return { allowed: true, projectedPeakBytes, retainedBytes, degraded: false };
}
