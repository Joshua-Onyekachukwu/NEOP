"use client";

import React, { useState, useEffect } from "react";

interface ExportFilters {
  state: string;
  lga: string;
  ward: string;
  pu: string;
  party: string;
  status: string;
  election: string;
  format: "csv" | "json";
}

interface StateOption {
  id: string;
  name: string;
}

interface LgaOption {
  id: string;
  name: string;
}

interface WardOption {
  id: string;
  name: string;
}

const PU_STATUSES = [
  "VERIFIED",
  "DISPUTED",
  "RESULT_SUBMITTED",
  "RESULT_ANNOUNCED",
  "VERIFICATION_PENDING",
  "COUNTING",
  "VOTING",
  "NOT_STARTED",
  "DISRUPTED",
];

const PARTIES = ["NDC", "APC", "PDP", "LP", "NNPP", "APGA", "SDP", "YPP", "ADC"];

interface ExportPanelProps {
  variant?: "admin" | "public";
}

const ExportPanel: React.FC<ExportPanelProps> = ({ variant = "admin" }) => {
  const [filters, setFilters] = useState<ExportFilters>({
    state: "",
    lga: "",
    ward: "",
    pu: "",
    party: "",
    status: "",
    election: "",
    format: "csv",
  });

  const [states, setStates] = useState<StateOption[]>([]);
  const [lgas, setLgas] = useState<LgaOption[]>([]);
  const [wards, setWards] = useState<WardOption[]>([]);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<any>(null);

  // Load states
  useEffect(() => {
    fetch("/api/public/polling-units")
      .then((r) => r.json())
      .then(() => {
        // Just need state names — fetch from stats
        return fetch("/api/public/stats");
      })
      .then((r) => r.json())
      .then((data) => {
        if (data.state_breakdown) {
          setStates(
            data.state_breakdown.map((s: any) => ({
              id: s.state_id,
              name: s.state_name,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Load LGAs when state changes
  useEffect(() => {
    if (!filters.state) {
      setLgas([]);
      return;
    }
    const stateObj = states.find((s) => s.name.toLowerCase() === filters.state.toLowerCase());
    if (!stateObj) return;

    fetch(`/api/public/polling-units?state=${stateObj.id}`)
      .then(() => fetch("/api/public/stats"))
      .then((r) => r.json())
      .then((data) => {
        if (data.state_breakdown) {
          // LGAs come from the full dataset
          const { createClient } = require("@supabase/supabase-js");
          // Just clear since we can't easily get LGAs from the public API
          setLgas([]);
        }
      })
      .catch(() => setLgas([]));
  }, [filters.state, states]);

  const updateFilter = (key: keyof ExportFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const buildExportUrl = () => {
    const params = new URLSearchParams();
    params.set("format", filters.format);
    if (filters.state) params.set("state", filters.state);
    if (filters.lga) params.set("lga", filters.lga);
    if (filters.ward) params.set("ward", filters.ward);
    if (filters.pu) params.set("pu", filters.pu);
    if (filters.party) params.set("party", filters.party);
    if (filters.status) params.set("status", filters.status);
    if (filters.election) params.set("election", filters.election);
    params.set("limit", "50000");
    return `/api/public/export?${params.toString()}`;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const url = buildExportUrl();
      const response = await fetch(url);
      if (!response.ok) {
        const err = await response.text();
        alert("Export failed: " + err);
        return;
      }

      if (filters.format === "json") {
        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        downloadBlob(blob, `neop-results-${new Date().toISOString().split("T")[0]}.json`);
      } else {
        const text = await response.text();
        const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, `neop-results-${new Date().toISOString().split("T")[0]}.csv`);
      }
    } catch (e: any) {
      alert("Export failed: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const handlePreview = async () => {
    try {
      const url = buildExportUrl() + "&format=json";
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      setPreview(data);
      setExpanded(true);
    } catch {}
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--color-ink)]/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">📥</span>
          <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">
            Export Results
          </h3>
        </div>
        <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
          {expanded ? "▼ COLLAPSE" : "▶ EXPAND"}
        </span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-gray-100)] pt-3">
          {/* Quick summary */}
          {preview && (
            <div className="p-3 border border-[var(--color-green)]/20 bg-[var(--color-green-dim)]">
              <div className="font-mono text-[10px] text-[var(--color-green-bright)] mb-1">PREVIEW</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-[var(--color-text-dim)]">Results: </span>
                  <span className="font-mono font-bold text-[var(--color-text)]">
                    {preview.summary?.total_results?.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-text-dim)]">Votes: </span>
                  <span className="font-mono font-bold text-[var(--color-text)]">
                    {preview.summary?.total_votes?.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-text-dim)]">Winner: </span>
                  <span className="font-mono font-bold text-[var(--color-green-bright)]">
                    {preview.summary?.winner}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-text-dim)]">Margin: </span>
                  <span className="font-mono font-bold text-[var(--color-text)]">
                    {preview.summary?.margin?.toLocaleString()} votes
                  </span>
                </div>
              </div>

              {/* Leaderboard */}
              {preview.leaderboard && preview.leaderboard.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--color-green)]/20">
                  <div className="font-mono text-[10px] text-[var(--color-green-bright)] mb-2">LEADERBOARD</div>
                  <div className="space-y-1">
                    {preview.leaderboard.map((p: any, i: number) => (
                      <div key={p.party} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-[var(--color-text-dim)] w-4">{i + 1}.</span>
                        <span className={`font-mono font-bold ${i === 0 ? "text-[var(--color-green-bright)]" : "text-[var(--color-text)]"}`}>
                          {p.party}
                        </span>
                        <span className="text-[var(--color-text-dim)]">{p.name}</span>
                        <span className="flex-1" />
                        <span className="font-mono font-bold text-[var(--color-text)]">
                          {p.total_votes?.toLocaleString()}
                        </span>
                        <span className="font-mono text-[var(--color-text-dim)] w-12 text-right">
                          {p.percentage}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Filters grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                State
              </label>
              <select
                value={filters.state}
                onChange={(e) => updateFilter("state", e.target.value)}
                className="w-full px-2 py-2 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs focus:outline-none focus:border-[var(--color-green)]"
              >
                <option value="">All states</option>
                {states.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                Polling Unit Code
              </label>
              <input
                type="text"
                value={filters.pu}
                onChange={(e) => updateFilter("pu", e.target.value)}
                placeholder="e.g. LA-PU-001234"
                className="w-full px-2 py-2 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs focus:outline-none focus:border-[var(--color-green)] placeholder:text-[var(--color-gray-300)]"
              />
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                Party
              </label>
              <select
                value={filters.party}
                onChange={(e) => updateFilter("party", e.target.value)}
                className="w-full px-2 py-2 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs focus:outline-none focus:border-[var(--color-green)]"
              >
                <option value="">All parties</option>
                {PARTIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                PU Status
              </label>
              <select
                value={filters.status}
                onChange={(e) => updateFilter("status", e.target.value)}
                className="w-full px-2 py-2 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs focus:outline-none focus:border-[var(--color-green)]"
              >
                <option value="">All statuses</option>
                {PU_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                Election Type
              </label>
              <select
                value={filters.election}
                onChange={(e) => updateFilter("election", e.target.value)}
                className="w-full px-2 py-2 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs focus:outline-none focus:border-[var(--color-green)]"
              >
                <option value="">All elections</option>
                <option value="PRESIDENTIAL">Presidential</option>
                <option value="GOVERNORSHIP">Governorship</option>
              </select>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                Format
              </label>
              <select
                value={filters.format}
                onChange={(e) => updateFilter("format", e.target.value as "csv" | "json")}
                className="w-full px-2 py-2 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs focus:outline-none focus:border-[var(--color-green)]"
              >
                <option value="csv">CSV (Spreadsheet)</option>
                <option value="json">JSON (Developer)</option>
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handlePreview}
              className="flex-1 py-2.5 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-xs font-bold hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors"
            >
              👁 PREVIEW
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex-1 py-2.5 bg-[var(--color-green)] text-white font-mono text-xs font-bold hover:bg-[var(--color-green-dim)] transition-colors disabled:opacity-50"
            >
              {exporting ? "⏳ EXPORTING..." : "📥 DOWNLOAD"}
            </button>
          </div>

          <div className="font-mono text-[9px] text-[var(--color-text-dim)]">
            Exports up to 50,000 rows. Includes all party vote breakdowns, PU details, and verification status.
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportPanel;
