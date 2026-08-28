"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

interface AdminStats {
  totalVolunteers: number;
  activeVolunteers: number;
  totalAssignments: number;
  checkedInAssignments: number;
  totalResults: number;
  verifiedResults: number;
  pendingVerification: number;
  totalIncidents: number;
}

interface SimResult {
  scenario: string;
  description: string;
  duration_minutes: number;
  target_voters: number;
  total_polling_units: number;
  results_created: number;
  party_results_created: number;
  total_votes: number;
  final_status_distribution: Record<string, number>;
  ndc_wins: boolean;
}

const AdminDashboard: React.FC = () => {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats>({
    totalVolunteers: 0, activeVolunteers: 0, totalAssignments: 0,
    checkedInAssignments: 0, totalResults: 0, verifiedResults: 0,
    pendingVerification: 0, totalIncidents: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "verification" | "volunteers" | "locations" | "incidents" | "simulation">("overview");
  const [agentLocations, setAgentLocations] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [volunteers, setVolunteers] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [batchVerifying, setBatchVerifying] = useState(false);

  // Simulation state
  const [simScenario, setSimScenario] = useState<string>("random");
  const [simDuration, setSimDuration] = useState<number>(5);
  const [simVoters, setSimVoters] = useState<number>(100);
  const [simRunning, setSimRunning] = useState(false);
  const [simProgress, setSimProgress] = useState<string>("");
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simError, setSimError] = useState<string>("");

  useEffect(() => { checkAuth(); fetchStats(); }, []);

  useEffect(() => {
    if (activeTab === "verification") fetchResults();
    if (activeTab === "volunteers") fetchVolunteers();
    if (activeTab === "incidents") fetchIncidents();
  }, [activeTab]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/admin/login"); return; }
    const { data: admin } = await supabase.from("admin_users").select("id").eq("user_id", session.user.id).eq("is_active", true).single();
    if (!admin) router.push("/admin/login");
  };

  const fetchStats = async () => {
    try {
      const [tv, av, ta, ci, tr, vr, pv, ti] = await Promise.all([
        supabase.from("volunteers").select("*", { count: "exact", head: true }),
        supabase.from("volunteers").select("*", { count: "exact", head: true }).eq("status", "ACTIVE"),
        supabase.from("agent_assignments").select("*", { count: "exact", head: true }),
        supabase.from("agent_assignments").select("*", { count: "exact", head: true }).eq("status", "CHECKED_IN"),
        supabase.from("result_submissions").select("*", { count: "exact", head: true }),
        supabase.from("result_submissions").select("*", { count: "exact", head: true }).eq("status", "VERIFIED"),
        supabase.from("result_submissions").select("*", { count: "exact", head: true }).eq("status", "UNVERIFIED"),
        supabase.from("incidents").select("*", { count: "exact", head: true }),
      ]);
      setStats({
        totalVolunteers: tv.count || 0, activeVolunteers: av.count || 0,
        totalAssignments: ta.count || 0, checkedInAssignments: ci.count || 0,
        totalResults: tr.count || 0, verifiedResults: vr.count || 0,
        pendingVerification: pv.count || 0, totalIncidents: ti.count || 0,
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchResults = async () => {
    const { data } = await supabase.from("result_submissions").select(`*, polling_units (official_code, name), volunteers (user_accounts (email, full_name))`).order("submitted_at", { ascending: false }).limit(100);
    if (data) setResults(data);
  };

  const fetchVolunteers = async () => {
    const { data } = await supabase.from("volunteers").select(`*, user_accounts (email, full_name), states (name)`).order("created_at", { ascending: false }).limit(100);
    if (data) setVolunteers(data);
  };

  const fetchIncidents = async () => {
    const { data } = await supabase.from("incidents").select(`*, polling_units (official_code, name)`).order("submitted_at", { ascending: false }).limit(100);
    if (data) setIncidents(data);
  };

  const handleVerify = async (id: string) => {
    if (!window.confirm("Verify this result?")) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch("/api/verify/result", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ result_id: id }),
    });
    fetchResults();
  };

  const handleBatchVerify = async () => {
    setBatchVerifying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch("/api/verify/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ limit: 50 }),
      });
      fetchResults();
      fetchStats();
    } finally { setBatchVerifying(false); }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); router.push("/admin/login"); };

  // ── Simulation ──
  const runSimulation = async () => {
    setSimRunning(true);
    setSimError("");
    setSimResult(null);
    setSimProgress("Clearing old data and loading polling units…");

    // Simulate progress messages while the API works
    const progressMessages = [
      "Clearing old data and loading polling units…",
      "Loading 188,042 polling units across 37 states…",
      "Applying regional vote patterns for NDC coalition…",
      "Generating results for each polling unit…",
      "Creating party-level vote breakdowns (9 parties)…",
      "Inserting results into database…",
      "This may take 5-10 minutes for 100M+ votes…",
    ];

    let msgIdx = 0;
    const progressInterval = setInterval(() => {
      msgIdx = Math.min(msgIdx + 1, progressMessages.length - 1);
      setSimProgress(progressMessages[msgIdx]);
    }, 30000);

    try {
      const res = await fetch("/api/admin/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: simScenario,
          duration_minutes: simDuration,
          total_voters: simVoters * 1_000_000,
        }),
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const err = await res.json();
        setSimError(err.error || "Simulation failed");
        return;
      }

      const data: SimResult = await res.json();
      setSimResult(data);
      fetchStats(); // refresh stats
    } catch (e: any) {
      setSimError(e.message || "Network error");
    } finally {
      setSimRunning(false);
      setSimProgress("");
    }
  };

  const tabs = ["overview", "verification", "volunteers", "locations", "incidents", "simulation"] as const;

  const fetchAgentLocations = async () => {
    try {
      const res = await fetch("/api/admin/agent-locations");
      if (res.ok) {
        const data = await res.json();
        setAgentLocations(data.agents || []);
      }
    } catch {}
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--color-gray-100)] px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-sm text-[var(--color-text)]">NG<span className="text-[var(--color-green)]">EO</span></span>
            <span className="font-mono text-[10px] text-[var(--color-text-dim)]">ADMIN</span>
          </div>
          <button onClick={handleLogout} className="font-mono text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]">Sign out</button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-[var(--color-gray-100)] px-4">
        <div className="max-w-6xl mx-auto flex gap-4">
          {tabs.map((t) => (
            <button key={t} onClick={() => setActiveTab(t)} className={`py-2 font-mono text-xs border-b-2 transition-colors ${
              activeTab === t ? "border-[var(--color-green)] text-[var(--color-green-bright)]" : "border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]"
            }`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {loading ? (
          <div className="font-mono text-sm text-[var(--color-text-dim)] text-center py-16">Loading…</div>
        ) : (
          <>
            {/* Overview */}
            {activeTab === "overview" && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Volunteers", value: stats.totalVolunteers, sub: `${stats.activeVolunteers} active` },
                  { label: "Assignments", value: stats.totalAssignments, sub: `${stats.checkedInAssignments} checked in` },
                  { label: "Results", value: stats.totalResults, sub: `${stats.verifiedResults} verified` },
                  { label: "Incidents", value: stats.totalIncidents, sub: `${stats.pendingVerification} pending`, red: true },
                ].map((s) => (
                  <div key={s.label} className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-3">
                    <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">{s.label}</div>
                    <div className={`font-display font-bold text-2xl mt-1 ${s.red ? "text-[var(--color-red)]" : "text-[var(--color-text)]"}`}>{s.value}</div>
                    <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-0.5">{s.sub}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Verification */}
            {activeTab === "verification" && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">
                    {results.filter((r: any) => r.status === "UNVERIFIED").length} pending
                  </span>
                  <button onClick={handleBatchVerify} disabled={batchVerifying} className="px-3 py-1.5 bg-[var(--color-green)] text-white font-mono text-[10px] font-bold disabled:opacity-50">
                    {batchVerifying ? "Verifying…" : "⚡ RUN PIPELINE"}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-gray-100)]">
                        {["PU", "Agent", "Valid", "Rejected", "Total", "Status", "Action"].map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left font-mono text-[10px] text-[var(--color-text-dim)] uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r: any) => (
                        <tr key={r.id} className="border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)]">
                          <td className="px-2 py-1.5 font-mono text-[var(--color-text-muted)]">{(r.polling_units as any)?.official_code || "—"}</td>
                          <td className="px-2 py-1.5 text-[var(--color-text-muted)]">{(r.volunteers as any)?.user_accounts?.full_name || "—"}</td>
                          <td className="px-2 py-1.5 font-mono text-[var(--color-text-muted)]">{r.valid_votes.toLocaleString()}</td>
                          <td className="px-2 py-1.5 font-mono text-[var(--color-text-dim)]">{r.rejected_votes.toLocaleString()}</td>
                          <td className="px-2 py-1.5 font-mono font-bold text-[var(--color-text)]">{r.total_votes.toLocaleString()}</td>
                          <td className="px-2 py-1.5 font-mono text-[10px]">
                            <span className={
                              r.status === "VERIFIED" ? "text-[var(--color-green-bright)]" :
                              r.status === "DISPUTED" ? "text-[var(--color-red)]" :
                              "text-[var(--color-amber)]"
                            }>{r.status}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            {r.status === "UNVERIFIED" && (
                              <button onClick={() => handleVerify(r.id)} className="px-2 py-0.5 bg-[var(--color-green-dim)] text-[var(--color-green-bright)] font-mono text-[10px] hover:bg-[var(--color-green)] hover:text-white transition-colors">VERIFY</button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {results.length === 0 && (
                        <tr><td colSpan={7} className="px-2 py-8 text-center font-mono text-[var(--color-text-dim)]">No results yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Volunteers */}
            {activeTab === "volunteers" && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--color-gray-100)]">
                      {["Name", "Email", "State", "Status", "Verification", "Training"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-mono text-[10px] text-[var(--color-text-dim)] uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {volunteers.map((v: any) => (
                      <tr key={v.id} className="border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)]">
                        <td className="px-2 py-1.5 text-[var(--color-text-muted)]">{(v.user_accounts as any)?.full_name || "—"}</td>
                        <td className="px-2 py-1.5 text-[var(--color-text-dim)]">{(v.user_accounts as any)?.email || "—"}</td>
                        <td className="px-2 py-1.5 text-[var(--color-text-muted)]">{(v.states as any)?.name || "—"}</td>
                        <td className="px-2 py-1.5 font-mono text-[10px]">
                          <span className={v.status === "ACTIVE" ? "text-[var(--color-green-bright)]" : "text-[var(--color-text-dim)]"}>{v.status}</span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px]">
                          <span className={v.verification_status === "VERIFIED" ? "text-[var(--color-green-bright)]" : "text-[var(--color-text-dim)]"}>{v.verification_status}</span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px]">
                          <span className={v.training_status === "COMPLETED" ? "text-[var(--color-green-bright)]" : "text-[var(--color-text-dim)]"}>{v.training_status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Incidents */}
            {activeTab === "incidents" && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--color-gray-100)]">
                      {["Category", "Severity", "Description", "PU", "Status"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-mono text-[10px] text-[var(--color-text-dim)] uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map((i: any) => (
                      <tr key={i.id} className="border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)]">
                        <td className="px-2 py-1.5 font-mono text-[var(--color-text-muted)]">{i.category}</td>
                        <td className="px-2 py-1.5 font-mono text-[10px]">
                          <span className={i.severity === "CRITICAL" ? "text-[var(--color-red)]" : i.severity === "HIGH" ? "text-[var(--color-amber)]" : "text-[var(--color-text-dim)]"}>{i.severity}</span>
                        </td>
                        <td className="px-2 py-1.5 text-[var(--color-text-muted)] max-w-[200px] truncate">{i.what_observed}</td>
                        <td className="px-2 py-1.5 font-mono text-[var(--color-text-dim)]">{(i.polling_units as any)?.official_code || "—"}</td>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--color-text-dim)]">{i.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── AGENT LOCATIONS TAB ── */}
            {activeTab === "locations" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">
                    Agent GPS Check-ins
                  </h3>
                  <button
                    onClick={fetchAgentLocations}
                    className="font-mono text-[10px] px-3 py-1 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors"
                  >
                    REFRESH
                  </button>
                </div>

                {agentLocations.length === 0 ? (
                  <div className="border border-[var(--color-gray-100)] p-8 text-center">
                    <div className="font-mono text-sm text-[var(--color-text-dim)] mb-1">No agents checked in</div>
                    <div className="font-mono text-[10px] text-[var(--color-text-dim)]">
                      Agents will appear here when they check in with GPS at their polling unit
                    </div>
                  </div>
                ) : (
                  <div className="border border-[var(--color-gray-100)] overflow-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--color-gray-100)]">
                          {["Agent", "Polling Unit", "State", "Distance", "Status", "Time"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-mono text-[10px] text-[var(--color-text-dim)] uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {agentLocations.map((a: any) => (
                          <tr key={a.assignment_id} className="border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)]">
                            <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">{a.volunteer_name}</td>
                            <td className="px-3 py-2">
                              <div className="font-mono text-xs text-[var(--color-text)]">{a.polling_unit_code}</div>
                              <div className="font-mono text-[10px] text-[var(--color-text-dim)]">{a.polling_unit_name}</div>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">{a.state_name}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className={`font-mono text-xs ${
                                  a.location_verified ? "text-[var(--color-green-bright)]" : "text-[var(--color-amber)]"
                                }`}>
                                  {a.distance_from_pu ? `${a.distance_from_pu.toLocaleString()}m` : "—"}
                                </span>
                                {a.location_verified ? (
                                  <span className="font-mono text-[10px] px-1.5 py-0.5 bg-[var(--color-green-dim)] text-[var(--color-green-bright)]">VERIFIED</span>
                                ) : (
                                  <span className="font-mono text-[10px] px-1.5 py-0.5 bg-[var(--color-amber-dim)] text-[var(--color-amber)]">FAR</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px]">
                              <span className={a.location_verified ? "text-[var(--color-green-bright)]" : "text-[var(--color-amber)]"}>
                                {a.location_verified ? "✓ AT LOCATION" : "⚠ NOT AT PU"}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-dim)]">
                              {a.checked_in_at ? new Date(a.checked_in_at).toLocaleTimeString() : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Summary */}
                {agentLocations.length > 0 && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="border border-[var(--color-gray-100)] p-3">
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)]">TOTAL CHECKED IN</div>
                      <div className="font-mono text-lg font-bold text-[var(--color-text)]">{agentLocations.length}</div>
                    </div>
                    <div className="border border-[var(--color-gray-100)] p-3">
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)]">VERIFIED AT PU</div>
                      <div className="font-mono text-lg font-bold text-[var(--color-green-bright)]">{agentLocations.filter((a: any) => a.location_verified).length}</div>
                    </div>
                    <div className="border border-[var(--color-gray-100)] p-3">
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)]">FAR FROM PU</div>
                      <div className="font-mono text-lg font-bold text-[var(--color-amber)]">{agentLocations.filter((a: any) => !a.location_verified).length}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── SIMULATION TAB ── */}
            {activeTab === "simulation" && (
              <div className="space-y-4">
                {/* Election Type Selector */}
                <div className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">
                      Active Election
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key: "PRESIDENTIAL", label: "Presidential & National Assembly", date: "16 January 2027" },
                      { key: "GOVERNORSHIP", label: "Governorship & State Assembly", date: "6 February 2027" },
                    ].map((e) => (
                      <button
                        key={e.key}
                        onClick={async () => {
                          await fetch("/api/admin/config", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ election_type: e.key }),
                          });
                          alert(`Switched to: ${e.label}`);
                        }}
                        disabled={simRunning}
                        className="text-left p-3 border border-[var(--color-gray-200)] hover:border-[var(--color-green)] transition-colors disabled:opacity-50"
                      >
                        <div className="font-mono text-xs font-bold text-[var(--color-text)]">{e.label}</div>
                        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-0.5">{e.date}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scenario selector */}
                <div className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">
                      2027 Election Simulation
                    </h3>
                    {simRunning && (
                      <span className="font-mono text-[10px] px-2 py-0.5 bg-[var(--color-green-dim)] text-[var(--color-green-bright)] animate-pulse">
                        RUNNING
                      </span>
                    )}
                  </div>

                  {/* Duration & Voter Count Controls */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div className="p-3 border border-[var(--color-gray-200)]">
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                        Simulation Duration
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={1}
                          max={60}
                          value={simDuration}
                          onChange={(e) => setSimDuration(Number(e.target.value))}
                          disabled={simRunning}
                          className="flex-1 accent-[var(--color-green)]"
                        />
                        <span className="font-mono text-sm text-[var(--color-text)] min-w-[40px] text-right">
                          {simDuration} min
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-1">
                        How long the simulation runs (status transitions happen over this period)
                      </div>
                    </div>
                    <div className="p-3 border border-[var(--color-gray-200)]">
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                        Target Voters (millions)
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={10}
                          max={200}
                          step={5}
                          value={simVoters}
                          onChange={(e) => setSimVoters(Number(e.target.value))}
                          disabled={simRunning}
                          className="flex-1 accent-[var(--color-green)]"
                        />
                        <span className="font-mono text-sm text-[var(--color-text)] min-w-[50px] text-right">
                          {simVoters}M
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-1">
                        ~{Math.round(simVoters * 1_000_000 / 176846).toLocaleString()} votes per polling unit on average
                      </div>
                    </div>
                  </div>

                  {/* Scenario cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    {[
                      { key: "landslide", name: "NDC LANDSLIDE", desc: "NDC wins by 20+ points — massive coalition victory across all regions", color: "var(--color-green-bright)" },
                      { key: "sweep", name: "NDC SWEEP", desc: "NDC carries every region except SW — Peter Obi + Kwankwaso coalition dominance", color: "var(--color-green)" },
                      { key: "close", name: "NDC NARROW WIN", desc: "A tight race — NDC edges APC by 2-5 points in a nail-biter", color: "var(--color-amber)" },
                    ].map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setSimScenario(s.key)}
                        disabled={simRunning}
                        className={`text-left p-3 border transition-all disabled:opacity-50 ${
                          simScenario === s.key
                            ? "border-[var(--color-green)] bg-[var(--color-ink)]"
                            : "border-[var(--color-gray-200)] hover:border-[var(--color-gray-300)]"
                        }`}
                      >
                        <div className="font-mono text-xs font-bold" style={{ color: s.color }}>
                          {s.name}
                        </div>
                        <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-1">
                          {s.desc}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Run / View Live buttons */}
                  {simRunning ? (
                    <button
                      disabled
                      className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold opacity-70 cursor-not-allowed"
                    >
                      ⏳ SIMULATION RUNNING — DO NOT CLOSE THIS PAGE
                    </button>
                  ) : simResult ? (
                    <div className="flex gap-3">
                      <a
                        href="/"
                        target="_blank"
                        className="flex-1 py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold text-center hover:bg-[var(--color-green-dim)] transition-colors"
                      >
                        📊 VIEW LIVE DASHBOARD →
                      </a>
                      <button
                        onClick={runSimulation}
                        className="flex-1 py-3 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-sm font-bold hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors"
                      >
                        ▶ RUN AGAIN
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={runSimulation}
                      className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green-dim)] transition-colors"
                    >
                      ▶ RUN {simScenario.toUpperCase()} SIMULATION
                    </button>
                  )}

                  {/* Progress */}
                  {simRunning && simProgress && (
                    <div className="mt-3 p-3 bg-[var(--color-ink)] border border-[var(--color-gray-200)]">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[var(--color-green)] animate-pulse" />
                        <span className="font-mono text-xs text-[var(--color-text-muted)]">{simProgress}</span>
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {simError && (
                    <div className="mt-3 p-3 bg-[var(--color-red)]/10 border border-[var(--color-red)]/30">
                      <span className="font-mono text-xs text-[var(--color-red)]">Error: {simError}</span>
                    </div>
                  )}

                  {/* Result */}
                  {simResult && (
                    <div className="mt-4 p-4 border border-[var(--color-green)] bg-[var(--color-green)]/5">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xl">✅</span>
                        <h4 className="font-display font-bold text-sm text-[var(--color-green-bright)]">SIMULATION COMPLETE</h4>
                      </div>
                      <div className="font-mono text-xs text-[var(--color-text-muted)] mb-3">
                        Scenario: <strong className="text-[var(--color-text)]">{simResult.scenario}</strong> — {simResult.description}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] mb-3">
                        Data is now fixed in the database. The live dashboard shows these results permanently until you run a new simulation.
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div>
                          <div className="font-mono text-[10px] text-[var(--color-text-dim)]">POLLING UNITS</div>
                          <div className="font-mono text-lg font-bold text-[var(--color-text)]">{simResult.total_polling_units.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="font-mono text-[10px] text-[var(--color-text-dim)]">RESULTS</div>
                          <div className="font-mono text-lg font-bold text-[var(--color-text)]">{simResult.results_created.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="font-mono text-[10px] text-[var(--color-text-dim)]">TOTAL VOTES</div>
                          <div className="font-mono text-lg font-bold text-[var(--color-green-bright)]">{(simResult.total_votes / 1_000_000).toFixed(1)}M</div>
                        </div>
                        <div>
                          <div className="font-mono text-[10px] text-[var(--color-text-dim)]">DURATION</div>
                          <div className="font-mono text-lg font-bold text-[var(--color-text)]">{simResult.duration_minutes || simDuration} min</div>
                        </div>
                        <div>
                          <div className="font-mono text-[10px] text-[var(--color-text-dim)]">NDC WINS</div>
                          <div className="font-mono text-lg font-bold text-[var(--color-green-bright)]">YES ✓</div>
                        </div>
                      </div>

                      {/* Status distribution */}
                      {simResult.final_status_distribution && (
                        <div className="mt-3 pt-3 border-t border-[var(--color-gray-200)]">
                          <div className="font-mono text-[10px] text-[var(--color-text-dim)] mb-2">POLLING UNIT STATUS DISTRIBUTION</div>
                          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                            {Object.entries(simResult.final_status_distribution)
                              .sort((a, b) => b[1] - a[1])
                              .map(([status, count]) => (
                                <div key={status} className="flex items-center gap-1.5">
                                  <div
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{
                                      backgroundColor: status === "VERIFIED" ? "#10B981"
                                        : status === "RESULT_SUBMITTED" ? "#60A5FA"
                                        : status === "RESULT_ANNOUNCED" ? "#10B981"
                                        : status === "DISPUTED" ? "#F97316"
                                        : status === "DISRUPTED" ? "#EF4444"
                                        : status === "VOTING" ? "#3B82F6"
                                        : status === "COUNTING" ? "#F59E0B"
                                        : "#6B7280",
                                    }}
                                  />
                                  <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                                    {status.replace(/_/g, " ").toLowerCase()}: {(count as number).toLocaleString()}
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* How it works */}
                <div className="border border-[var(--color-gray-100)] p-4">
                  <h4 className="font-display font-semibold text-xs text-[var(--color-text-muted)] mb-2">How It Works</h4>
                  <ul className="space-y-1 font-mono text-[10px] text-[var(--color-text-dim)]">
                    <li>• Generates results for ALL polling units across 36 states + FCT</li>
                    <li>• 9 parties compete: APC, NDC, PDP, LP, NNPP, APGA, SDP, YPP, ADC</li>
                    <li>• NDC (Peter Obi + Kwankwaso) always wins — margin varies by scenario</li>
                    <li>• Each PU goes through random statuses: voting → counting → result announced → submitted → verified (or disputed/disrupted)</li>
                    <li>• ~15% of PUs experience disputes or disruptions for realism</li>
                    <li>• Regional vote patterns reflect real Nigerian political geography</li>
                    <li>• Configurable duration (1-60 min) and voter count (10-200M)</li>
                    <li>• The live dashboard shows real-time status transitions as the simulation runs</li>
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
