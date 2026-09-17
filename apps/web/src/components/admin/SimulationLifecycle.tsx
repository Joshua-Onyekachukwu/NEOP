"use client";

/**
 * SimulationLifecycle — admin pre-flight + control card (§13/§14/§18).
 *
 * Shows the current coverage-ledger run (what is active, what a new
 * simulation will archive), then exposes Start / Stop / Purge with
 * confirmation and explicit impact statements. Dangerous operations
 * (purge) require typed confirmation and never run implicitly.
 */

import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

interface Lifecycle {
  current: {
    active: boolean;
    run_id?: string;
    run_status?: string;
    label?: string;
    scenario?: string;
    total_pus?: number;
    accounted_pus?: number;
    published_pus?: number;
    disputed_pus?: number;
    failed_pus?: number;
    disrupted_pus?: number;
    unavailable_pus?: number;
    awaiting_pus?: number;
    published_percent?: number;
    started_at?: string;
    completed_at?: string;
  };
  lock: { locked_at: string | null; run_id: string | null };
  history: {
    id: string;
    label: string | null;
    scenario: string;
    status: string;
    total_pus: number | null;
    published_pus: number | null;
    started_at: string;
  }[];
}

const fmt = (n?: number | null) => (n == null ? "—" : Number(n).toLocaleString());

export default function SimulationLifecycle() {
  const [data, setData] = useState<Lifecycle | null>(null);
  const [busy, setBusy] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeText, setPurgeText] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/simulate/lifecycle", {
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.ok) setData(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (path: string, body?: any) => {
    setBusy(true);
    setMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      setMessage(res.ok ? `${path.split("/").pop()} OK` : json.error || `HTTP ${res.status}`);
      await load();
      return res.ok;
    } catch (e: any) {
      setMessage(e.message || "Network error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cur = data?.current;
  const isRunning = cur?.run_status === "RUNNING" || !!data?.lock.locked_at;

  return (
    <div className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">
          Simulation Lifecycle
        </h3>
        {cur?.run_status && (
          <span
            className={`font-mono text-[10px] px-2 py-0.5 ${
              isRunning
                ? "bg-[var(--color-green-dim)] text-[var(--color-green-bright)] animate-pulse"
                : "bg-[var(--color-gray-100)] text-[var(--color-text-muted)]"
            }`}
          >
            {cur.run_status}
          </span>
        )}
      </div>

      {cur?.active ? (
        <div className="font-mono text-[10px] text-[var(--color-text-muted)] space-y-1 mb-3">
          <div className="text-[var(--color-text)]">
            {cur.label || "(unlabelled run)"} — {cur.scenario?.toUpperCase()}
          </div>
          <div>
            Run <span className="text-[var(--color-text-dim)]">{cur.run_id?.slice(0, 8)}</span> ·
            started {cur.started_at ? new Date(cur.started_at).toLocaleString() : "—"}
          </div>
          <div>
            <span className="text-[var(--color-text)]">{fmt(cur.accounted_pus)}</span> /{" "}
            {fmt(cur.total_pus)} PUs covered ·{" "}
            <span className="text-[var(--color-green-bright)]">
              {fmt(cur.published_pus)} published ({cur.published_percent ?? 0}%)
            </span>
          </div>
          <div className="text-[var(--color-text-dim)]">
            disputed {fmt(cur.disputed_pus)} · failed {fmt(cur.failed_pus)} · disrupted{" "}
            {fmt(cur.disrupted_pus)} · unavailable {fmt(cur.unavailable_pus)} · awaiting{" "}
            {fmt(cur.awaiting_pus)}
          </div>
          <div className="text-[var(--color-text-dim)] pt-1">
            Starting a new simulation archives this run and materializes a fresh full
            ledger. Nothing is deleted.
          </div>
        </div>
      ) : (
        <p className="font-mono text-[10px] text-[var(--color-text-dim)] mb-3">
          No simulation run yet. Starting one creates a ledger row for every one of the
          176,846 polling units — each PU gets an explicit outcome (published, disputed,
          failed, disrupted, or unavailable). The public site keeps rendering the last
          finished dataset until the new run publishes results.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => post("/api/admin/simulate/stop")}
          disabled={busy || !isRunning}
          className="px-3 py-2 bg-[var(--color-amber)]/90 text-white font-mono text-[11px] font-bold disabled:opacity-40 hover:opacity-90"
        >
          ⏹ STOP RUN
        </button>
        <button
          onClick={() => {
            setPurgeOpen(true);
            setPurgeText("");
          }}
          disabled={busy || !cur?.run_id || cur?.run_status === "RUNNING"}
          className="px-3 py-2 border border-[var(--color-red)] text-[var(--color-red)] font-mono text-[11px] font-bold disabled:opacity-40 hover:bg-[var(--color-red)] hover:text-white transition-colors"
        >
          🗑 PURGE LAST RUN…
        </button>
      </div>

      {purgeOpen && (
        <div className="mt-3 p-3 border border-[var(--color-red)]/50 bg-[var(--color-red)]/5">
          <div className="font-mono text-[10px] text-[var(--color-red)] font-bold mb-2">
            DANGER — permanently deletes the last finished run: its ledger rows, the [SIM]
            election, all its submissions/results/verifications and sim observer accounts.
            Real elections, users and audit logs are never touched.
          </div>
          <div className="flex items-center gap-2">
            <input
              value={purgeText}
              onChange={(e) => setPurgeText(e.target.value)}
              placeholder='type PURGE to confirm'
              className="flex-1 px-2 py-1.5 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs"
            />
            <button
              onClick={async () => {
                const ok = await post("/api/admin/simulate/purge", {
                  confirm: purgeText,
                });
                if (ok) {
                  setPurgeOpen(false);
                  setPurgeText("");
                }
              }}
              disabled={busy || purgeText !== "PURGE"}
              className="px-3 py-1.5 bg-[var(--color-red)] text-white font-mono text-[11px] font-bold disabled:opacity-40"
            >
              DELETE RUN DATA
            </button>
            <button
              onClick={() => setPurgeOpen(false)}
              className="px-2 py-1.5 font-mono text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">{message}</div>
      )}

      {data?.history && data.history.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--color-gray-100)]">
          <div className="font-mono text-[9px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
            Recent runs (archived automatically when a new one starts)
          </div>
          <div className="space-y-0.5">
            {data.history.slice(0, 5).map((h) => (
              <div key={h.id} className="font-mono text-[10px] text-[var(--color-text-muted)] flex justify-between gap-2">
                <span className="truncate">
                  {h.label || h.id.slice(0, 8)} — {h.scenario} · {h.status}
                </span>
                <span className="text-[var(--color-text-dim)] flex-shrink-0">
                  {fmt(h.published_pus)}/{fmt(h.total_pus)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
