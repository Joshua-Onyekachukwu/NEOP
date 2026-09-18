import { describe, it, expect } from "vitest";
import { resolveDataStatus, dataHealthNotice } from "./data-health";

/**
 * The live-results page must never present a database outage as a confident wall
 * of zeros ("0 votes", "AWAITING DATA") that looks identical to a genuinely
 * empty election. These tests pin both halves of that contract:
 *
 *   • the mapping from a stats payload to a data-health state, and
 *   • the exact sentence a viewer is shown, plus when we stay silent.
 *
 * No database, no browser, no jsdom. Everything asserted here is the same code
 * path the UI renders from (RealtimeLayer's DataHealthNotice), so the wording a
 * viewer sees cannot drift away from the wording these tests check.
 */

describe("data health: mapping from the stats payload", () => {
  it("reports UNAVAILABLE when the API says it cannot reach the database", () => {
    expect(resolveDataStatus("UNAVAILABLE", true)).toBe("UNAVAILABLE");
  });

  it("reports STALE when the API served an older snapshot", () => {
    expect(resolveDataStatus("STALE", true)).toBe("STALE");
  });

  it("reports OK for a healthy payload (success responses omit data_status)", () => {
    // api-cache.ts sets data_status only on fallback paths, so a healthy
    // payload omits it entirely.
    expect(resolveDataStatus(undefined, true)).toBe("OK");
    expect(resolveDataStatus(null, true)).toBe("OK");
    expect(resolveDataStatus("OK", true)).toBe("OK");
  });

  it("reports UNAVAILABLE when the stats request itself failed, whatever the payload said", () => {
    // The other endpoints may still answer, but without stats there are no
    // numbers to show — that is an outage, not a healthy cycle.
    expect(resolveDataStatus(undefined, false)).toBe("UNAVAILABLE");
    expect(resolveDataStatus("OK", false)).toBe("UNAVAILABLE");
  });

  it("ignores unknown future status values rather than guessing", () => {
    expect(resolveDataStatus("SOMETHING_ELSE", true)).toBe("OK");
  });
});

describe("data health: what the viewer is told", () => {
  it("SHOWS the outage notice when the API reports UNAVAILABLE", () => {
    const notice = dataHealthNotice("UNAVAILABLE", true);
    expect(notice).not.toBeNull();
    expect(notice!.text).toBe("Live data temporarily unavailable — reconnecting");
    expect(notice!.tone).toBe("degraded");
  });

  it("SHOWS a distinct notice for stale data", () => {
    const notice = dataHealthNotice("STALE", true);
    expect(notice!.text).toBe("Live data delayed — showing last known snapshot");
    // Stale and unavailable must be distinguishable at a glance.
    expect(notice!.text).not.toContain("temporarily unavailable");
  });

  it("HIDES the notice when the data is healthy", () => {
    expect(dataHealthNotice("OK", true)).toBeNull();
  });

  it("HIDES the notice before the first cycle lands", () => {
    // A flash of "unavailable" on every page load would train users to ignore it.
    expect(dataHealthNotice("UNAVAILABLE", false)).toBeNull();
    expect(dataHealthNotice("STALE", false)).toBeNull();
  });

  it("never fabricates numbers in the notice", () => {
    // It reports provenance, not results: nobody should read a vote count or a
    // percentage out of an outage message.
    for (const status of ["UNAVAILABLE", "STALE"] as const) {
      const text = dataHealthNotice(status, true)!.text;
      expect(text).not.toMatch(/\d/);
    }
  });
});
