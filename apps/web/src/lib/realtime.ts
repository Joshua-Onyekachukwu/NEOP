"use client";

/**
 * Central Supabase Realtime module — THE only place channels are created.
 *
 * Rules enforced here (do not bypass by calling supabase.channel() directly):
 *
 * 1. Channel names are namespaced `neop:<topic>:<scope>` and unique per
 *    scope. supabase-js reuses channels by topic name: two components
 *    sharing a channel name makes the second .on() call throw
 *    "cannot add postgres_changes callbacks ... after subscribe()" and
 *    crash the page. Unique per-scope names make that impossible.
 * 2. Every subscribe is wrapped in try/catch — Realtime is a progressive
 *    enhancement on top of polling and must never take down a page.
 * 3. Every helper returns an unsubscribe function; call it in the useEffect
 *    cleanup so channels never survive unmount (no leaks, no duplicate
 *    event processing).
 * 4. Realtime events only signal "authoritative data changed" — consumers
 *    refetch from the central results APIs. They never mutate totals
 *    locally, so numbers can never diverge between surfaces.
 */

import { supabase } from "./supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RealtimeTopic =
  | "canonical-pu-results"
  | "dashboard"
  | "incidents";

/** Active channels by name — guards against accidental duplicate subscribes. */
const activeChannels = new Map<string, RealtimeChannel>();

function buildChannelName(topic: RealtimeTopic, scope: string): string {
  return `neop:${topic}:${scope}`;
}

/**
 * Creates (or returns) a guarded channel and registers it. The returned
 * disposer MUST be called on unmount.
 */
function makeChannel(
  name: string,
  wire: (channel: RealtimeChannel) => RealtimeChannel,
  onStatus?: (status: string) => void
): () => void {
  try {
    const existing = activeChannels.get(name);
    if (existing) {
      // Same scope subscribed twice without cleanup — dispose the old one
      // so callbacks never double-fire.
      supabase.removeChannel(existing);
      activeChannels.delete(name);
    }
    const channel = wire(supabase.channel(name));
    activeChannels.set(name, channel);
    channel.subscribe((status) => {
      if (onStatus) {
        try {
          onStatus(status);
        } catch {
          /* status handlers must not throw */
        }
      }
    });
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* already removed */
      }
      activeChannels.delete(name);
    };
  } catch (e) {
    console.warn(`[realtime] subscribe failed for ${name}:`, e);
    return () => {};
  }
}

/**
 * Fires for every published canonical PU result (INSERT or UPDATE with
 * status=PUBLISHED). Scope must be unique per consumer, e.g. "map", "feed".
 */
export function subscribePublishedResults(options: {
  scope: string;
  onPublishedResult: (record: {
    id: string;
    polling_unit_id?: string;
    status?: string;
  }) => void;
  onStatus?: (status: string) => void;
}): () => void {
  const name = buildChannelName("canonical-pu-results", options.scope);
  return makeChannel(
    name,
    (channel) =>
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "canonical_pu_results",
          filter: "status=eq.PUBLISHED",
        },
        (payload: any) => {
          try {
            const record = payload.new || payload.old;
            if (!record) return;
            options.onPublishedResult({
              id: record.id,
              polling_unit_id: record.polling_unit_id,
              status: record.status,
            });
          } catch (e) {
            console.warn("[realtime] canonical result handler error:", e);
          }
        }
      ),
    options.onStatus
  );
}

/**
 * Dashboard-level signal: any of submissions / polling units / party rows
 * changed. Consumers should refetch the central results state.
 */
export function subscribeDashboardEvents(options: {
  scope: string;
  onChange: () => void;
  onStatus?: (status: string) => void;
}): () => void {
  const name = buildChannelName("dashboard", options.scope);
  const onChange = options.onChange;
  return makeChannel(
    name,
    (channel) =>
      channel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "result_submissions" },
          () => onChange()
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "polling_units" },
          () => onChange()
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "party_results" },
          () => onChange()
        ),
    options.onStatus
  );
}

/** Incident inserts (public safety bar). */
export function subscribeIncidents(options: {
  scope: string;
  onInsert: () => void;
  onStatus?: (status: string) => void;
}): () => void {
  const name = buildChannelName("incidents", options.scope);
  return makeChannel(
    name,
    (channel) =>
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "incidents" },
        () => options.onInsert()
      ),
    options.onStatus
  );
}

/**
 * Id-dedupe helper for refresh signaling: a canonical result id (or any
 * id) should trigger exactly one downstream refresh even if the event is
 * delivered more than once (reconnect replay, multiple handlers).
 */
export function createIdDedupe() {
  const seen = new Set<string>();
  return (id: string | undefined | null): boolean => {
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };
}

/** Test/diagnostic helper: names of currently active channels. */
export function activeChannelNames(): string[] {
  return Array.from(activeChannels.keys());
}
