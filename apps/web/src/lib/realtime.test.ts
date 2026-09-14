import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Mock of @/lib/supabase-browser (resolved identically to the relative
 * "./supabase-browser" import inside lib/realtime.ts via the @ alias).
 *
 * Faithful to supabase-js: the builder chain object IS the channel —
 * .on() and .subscribe() return the same object, and removeChannel
 * receives that object back. Records channel names and lets tests emit
 * postgres_changes events filtered by table.
 */
type Handler = (payload: any) => void;
type StatusCb = (status: string) => void;

interface FakeChannel {
  name: string;
  handlers: Array<{ event: string; table: string; handler: Handler }>;
  statusCbs: StatusCb[];
  removed: boolean;
}

const fakeChannels = new Map<string, FakeChannel>();

function makeFakeSupabase() {
  return {
    channel(name: string) {
      // The channel object IS the builder chain (supabase-js behavior).
      const ch: any = { name, handlers: [], statusCbs: [], removed: false };
      ch.on = (event: string, opts: any, handler: Handler) => {
        ch.handlers.push({ event, table: opts?.table || "", handler });
        return ch;
      };
      ch.subscribe = (cb?: StatusCb) => {
        if (cb) ch.statusCbs.push(cb);
        setTimeout(() => ch.statusCbs.forEach((c: StatusCb) => c("SUBSCRIBED")), 0);
        return ch;
      };
      fakeChannels.set(name, ch);
      return ch;
    },
    async removeChannel(ch: FakeChannel) {
      ch.removed = true;
      // Identity check: a replaced channel with the same name must not
      // delete its replacement (mirrors supabase-js removeChannel semantics).
      if (fakeChannels.get(ch.name) === ch) fakeChannels.delete(ch.name);
    },
  };
}

vi.mock("@/lib/supabase-browser", () => ({
  supabase: makeFakeSupabase(),
}));

import {
  subscribePublishedResults,
  subscribeDashboardEvents,
  subscribeIncidents,
  createIdDedupe,
  activeChannelNames,
} from "./realtime";

/** Emit an INSERT on the given channel name, only to handlers for that table. */
function emit(name: string, table: string, record: any) {
  const ch = fakeChannels.get(name);
  if (!ch) throw new Error(`no channel ${name}`);
  for (const h of ch.handlers) {
    if (h.table === table) h.handler({ new: record });
  }
}

afterEach(async () => {
  // Drain pending subscribe-status timers, then clear.
  await new Promise((r) => setTimeout(r, 5));
  fakeChannels.clear();
});

describe("central realtime module", () => {
  it("Test A: two components subscribing get distinct channels; one event reaches each exactly once", () => {
    const feedEvents: string[] = [];
    const mapEvents: string[] = [];
    const unsub1 = subscribePublishedResults({
      scope: "feed",
      onPublishedResult: (r) => feedEvents.push(r.id),
    });
    const unsub2 = subscribePublishedResults({
      scope: "map",
      onPublishedResult: (r) => mapEvents.push(r.id),
    });
    emit("neop:canonical-pu-results:feed", "canonical_pu_results", { id: "abc" });
    emit("neop:canonical-pu-results:map", "canonical_pu_results", { id: "abc" });
    expect(feedEvents).toEqual(["abc"]);
    expect(mapEvents).toEqual(["abc"]);
    // Distinct channel names — the shared-name crash is impossible.
    expect(activeChannelNames().sort()).toEqual([
      "neop:canonical-pu-results:feed",
      "neop:canonical-pu-results:map",
    ]);
    unsub1();
    unsub2();
  });

  it("Test A2: same scope subscribing twice replaces the old channel (no duplicate events)", async () => {
    const events: string[] = [];
    const unsub1 = subscribePublishedResults({
      scope: "feed",
      onPublishedResult: (r) => events.push("first:" + r.id),
    });
    const unsub2 = subscribePublishedResults({
      scope: "feed",
      onPublishedResult: (r) => events.push("second:" + r.id),
    });
    await unsub1(); // dispose of the replaced (first) subscription
    emit("neop:canonical-pu-results:feed", "canonical_pu_results", { id: "x" });
    expect(events).toEqual(["second:x"]);
    await unsub2();
  });

  it("Test B: repeated mount/unmount cycles leak nothing", async () => {
    for (let i = 0; i < 25; i++) {
      const unsub = subscribePublishedResults({ scope: "feed", onPublishedResult: () => {} });
      await unsub();
    }
    expect(activeChannelNames()).toEqual([]);
    expect(fakeChannels.size).toBe(0);
  });

  it("Test C: events arriving before SUBSCRIBED confirmation are still delivered", () => {
    const events: string[] = [];
    const unsub = subscribePublishedResults({ scope: "feed", onPublishedResult: (r) => events.push(r.id) });
    // No awaits — status callback is async but delivery must not depend on it.
    emit("neop:canonical-pu-results:feed", "canonical_pu_results", { id: "early" });
    expect(events).toEqual(["early"]);
    unsub();
  });

  it("Test D (id-dedupe): reconnect replay of the same id refreshes once", () => {
    const should = createIdDedupe();
    expect(should("id1")).toBe(true);
    expect(should("id1")).toBe(false); // replay suppressed
    expect(should("id2")).toBe(true);
    expect(should(undefined as any)).toBe(false);
  });

  it("Test E: two rapid events are both delivered in order", () => {
    const events: string[] = [];
    const unsub = subscribePublishedResults({ scope: "feed", onPublishedResult: (r) => events.push(r.id) });
    emit("neop:canonical-pu-results:feed", "canonical_pu_results", { id: "e1" });
    emit("neop:canonical-pu-results:feed", "canonical_pu_results", { id: "e2" });
    expect(events).toEqual(["e1", "e2"]);
    unsub();
  });

  it("dashboard topic fires per-table handler exactly once per matching event", () => {
    const changes: string[] = [];
    const u = subscribeDashboardEvents({ scope: "home", onChange: () => changes.push("x") });
    // Three different tables wired on one channel; emit to each table.
    emit("neop:dashboard:home", "result_submissions", { id: "1" });
    emit("neop:dashboard:home", "polling_units", { id: "2" });
    emit("neop:dashboard:home", "party_results", { id: "3" });
    // An unrelated table must NOT fire.
    emit("neop:dashboard:home", "canonical_party_results", { id: "4" });
    expect(changes).toEqual(["x", "x", "x"]);
    u();
  });

  it("incidents topic delivers inserts", () => {
    const incidents: number[] = [];
    const u = subscribeIncidents({ scope: "bar", onInsert: () => incidents.push(1) });
    emit("neop:incidents:bar", "incidents", { id: "i1" });
    expect(incidents).toEqual([1]);
    u();
  });

  it("subscribe failures are contained (no throw, safe disposer)", async () => {
    // Poison the client so channel() throws — the module must not throw
    // and must return a safe no-op disposer.
    const { supabase } = (await import("@/lib/supabase-browser")) as any;
    const orig = supabase.channel;
    supabase.channel = () => {
      throw new Error("boom");
    };
    let unsub: () => void = () => {};
    expect(() => {
      unsub = subscribePublishedResults({ scope: "boom", onPublishedResult: () => {} });
    }).not.toThrow();
    expect(() => unsub()).not.toThrow();
    supabase.channel = orig;
  });
});
