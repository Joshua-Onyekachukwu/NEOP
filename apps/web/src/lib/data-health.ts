/**
 * Data-health state for the live results surfaces.
 *
 * Kept in a plain module (not the component) for two reasons:
 *   1. It is the single source of truth for what a viewer is told when the data
 *      plane degrades, so the wording and the visibility rule can be asserted
 *      directly.
 *   2. Tests run in the suite's node environment, where JSX in an imported
 *      .tsx cannot be transformed (Next sets `jsx: "preserve"`), so the logic
 *      worth testing must not live inside JSX.
 *
 * The failure this guards against is subtle and expensive: a database outage
 * rendering as a confident wall of zeros ("0 votes", "AWAITING DATA") that a
 * viewer cannot distinguish from a genuinely empty election.
 */

/**
 *   OK          — computed from the database this cycle
 *   STALE       — an older snapshot was served because the database read failed
 *   UNAVAILABLE — no contact with the database and nothing cached to serve
 */
export type DataStatus = "OK" | "STALE" | "UNAVAILABLE";

/**
 * Map one polling cycle onto the surfaceable data-health state.
 *
 * A stats request that did not come back OK means we are out of contact
 * regardless of what the other endpoints managed to return — without stats
 * there are no numbers to show.
 */
export function resolveDataStatus(payloadStatus: unknown, statsOk: boolean): DataStatus {
  if (!statsOk) return "UNAVAILABLE";
  if (payloadStatus === "UNAVAILABLE") return "UNAVAILABLE";
  if (payloadStatus === "STALE") return "STALE";
  return "OK";
}

export interface DataHealthNoticeSpec {
  /** Exact sentence shown to the viewer. */
  text: string;
  /** Visual weight: amber (degraded) — never an error red. */
  tone: "degraded";
}

/**
 * What, if anything, to tell the viewer about data health.
 *
 * Returns null when there is nothing to say: before the first cycle lands (a
 * flash of "unavailable" on every page load would train users to ignore it) and
 * whenever the data is healthy.
 *
 * It deliberately carries no numbers — it reports provenance, not results.
 */
export function dataHealthNotice(
  dataStatus: DataStatus,
  restLoaded: boolean
): DataHealthNoticeSpec | null {
  if (!restLoaded || dataStatus === "OK") return null;

  return {
    tone: "degraded",
    text:
      dataStatus === "STALE"
        ? "Live data delayed — showing last known snapshot"
        : "Live data temporarily unavailable — reconnecting",
  };
}
