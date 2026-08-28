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

const AdminDashboard: React.FC = () => {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats>({
    totalVolunteers: 0, activeVolunteers: 0, totalAssignments: 0,
    checkedInAssignments: 0, totalResults: 0, verifiedResults: 0,
    pendingVerification: 0, totalIncidents: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "verification" | "volunteers" | "incidents" | "simulation">("overview");
  const [simConfig, setSimConfig] = useState<any>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simElectionType, setSimElectionType] = useState<"PRESIDENTIAL" | "HOUSE_OF_REPS" | "GOVERNORSHIP">("PRESIDENTIAL");
  const [simSpeed, setSimSpeed] = useState(3);
  const [simTargetStates, setSimTargetStates] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [volunteers, setVolunteers] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [batchVerifying, setBatchVerifying] = useState(false);

  useEffect(() => { checkAuth(); fetchStats(); }, []);

  useEffect(() => {
    if (activeTab === "verification") fetchResults();
    if (activeTab === "volunteers") fetchVolunteers();
    if (activeTab === "incidents") fetchIncidents();
    if (activeTab === "simulation") fetchSimStatus();
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
        supabase.from("result_submissions").select("*", { count: "exact", head: true }).eq("verification_status", "VERIFIED"),
        supabase.from("result_submissions").select("*", { count: "exact", head: true }).eq("verification_status", "UNVERIFIED"),
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
    if (!window.confirm("Verify this result? This action cannot be undone.")) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch("/api/verify/result", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ limit: 50 }),
      });
      fetchResults();
      fetchStats();
    } finally { setBatchVerifying(false); }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); router.push("/admin/login"); };

  // --- Simulation ---
  const fetchSimStatus = async () => {
    try {
      const res = await fetch("/api/admin/simulate");
      const data = await res.json();
      setSimConfig(data.config);
      setSimRunning(data.isRunning);
    } catch { /* silently fail */ }
  };

  const startSimulation = async () => {
    setSimLoading(true);
    try {
      const targetStateCodes = simTargetStates
        ? simTargetStates.split(",").map((s) => s.trim().toUpperCase())
        : [];
      const res = await fetch("/api/admin/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          election_type: simElectionType,
          speed: simSpeed,
          target_states: targetStateCodes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSimRunning(true);
        setSimConfig(data.config);
      }
    } finally { setSimLoading(false); }
  };

  const stopSimulation = async () => {
    setSimLoading(true);
    try {
      await fetch("/api/admin/simulate", { method: "DELETE" });
      setSimRunning(false);
      fetchSimStatus();
    } finally { setSimLoading(false); }
  };

  const tickSimulation = async () => {
    try {
      await fetch("/api/admin/simulate/tick", { method: "POST" });
      fetchSimStatus();
      fetchStats();
    } catch { /* silently fail */ }
  };

  // Auto-tick while simulation is running
  useEffect(() => {
    if (!simRunning) return;
    const interval = setInterval(tickSimulation, 5000);
    return () => clearInterval(interval);
  }, [simRunning]);

  const tabs = ["overview", "verification", "volunteers", "incidents", "simulation"] as const;

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
                            }>
                              {r.status}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            {r.status === "UNVERIFIED" && (
                              <button onClick={() => handleVerify(r.id)} className="px-2 py-0.5 bg-[var(--color-green-dim)] text-[var(--color-green-bright)] font-mono text-[10px] hover:bg-[var(--color-green)] hover:text-white transition-colors">
                                VERIFY
                              </button>
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
                    {volunteers.length === 0 && (
                      <tr><td colSpan={6} className="px-2 py-8 text-center font-mono text-[var(--color-text-dim)]">No volunteers</td></tr>
                    )}
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
                          <span className={
                            i.severity === "CRITICAL" ? "text-[var(--color-red)]" :
                            i.severity === "HIGH" ? "text-[var(--color-amber)]" :
                            "text-[var(--color-text-dim)]"
                          }>{i.severity}</span>
                        </td>
                        <td className="px-2 py-1.5 text-[var(--color-text-muted)] max-w-[200px] truncate">{i.what_observed}</td>
                        <td className="px-2 py-1.5 font-mono text-[var(--color-text-dim)]">{(i.polling_units as any)?.official_code || "—"}</td>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--color-text-dim)]">{i.status}</td>
                      </tr>
                    ))}
                    {incidents.length === 0 && (
                      <tr><td colSpan={5} className="px-2 py-8 text-center font-mono text-[var(--color-text-dim)]">No incidents</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Simulation */}
            {activeTab === "simulation" && (
              <div className="space-y-4">
                {/* Status card */}
                <div className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">
                        Election Simulation
                      </h3>
                      {simRunning && (
                        <span className="font-mono text-[10px] px-2 py-0.5 bg-[var(--color-green-dim)] text-[var(--color-green-bright)]">
                          RUNNING
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {simRunning ? (
                        <button
                          onClick={stopSimulation}
                          disabled={simLoading}
                          className="px-3 py-1.5 bg-[var(--color-red)] text-white font-mono text-[10px] font-bold disabled:opacity-50"
                        >
                          {simLoading ? "Stopping…" : "■ STOP"}
                        </button>
                      ) : (
                        <button
                          onClick={startSimulation}
                          disabled={simLoading}
                          className="px-3 py-1.5 bg-[var(--color-green)] text-white font-mono text-[10px] font-bold disabled:opacity-50"
                        >
                          {simLoading ? "Starting…" : "▶ START"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Config */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-1">
                        Election Type
                      </label>
                      <select
                        value={simElectionType}
                        onChange={(e) => setSimElectionType(e.target.value as any)}
                        disabled={simRunning}
                        className="w-full px-2 py-1.5 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs disabled:opacity-50"
                      >
                        <option value="PRESIDENTIAL">Presidential & National Assembly</option>
                        <option value="HOUSE_OF_REPS">House of Representatives</option>
                        <option value="GOVERNORSHIP">Governorship & State Assembly</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-1">
                        Speed (results/tick)
                      </label>
                      <select
                        value={simSpeed}
                        onChange={(e) => setSimSpeed(Number(e.target.value))}
                        disabled={simRunning}
                        className="w-full px-2 py-1.5 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs disabled:opacity-50"
                      >
                        <option value={1}>1 — Slow</option>
                        <option value={3}>3 — Normal</option>
                        <option value={5}>5 — Fast</option>
                        <option value={10}>10 — Very Fast</option>
                        <option value={20}>20 — Burst</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-1">
                        Target States (comma-separated codes)
                      </label>
                      <input
                        type="text"
                        value={simTargetStates}
                        onChange={(e) => setSimTargetStates(e.target.value)}
                        disabled={simRunning}
                        placeholder="e.g. KN, ZF, SO or leave empty for all"
                        className="w-full px-2 py-1.5 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-xs disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {/* Stats */}
                  {simConfig && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-3 border-t border-[var(--color-gray-100)]">
                      <div>
                        <div className="font-mono text-[10px] text-[var(--color-text-dim)]">TYPE</div>
                        <div className="font-mono text-xs text-[var(--color-text)]">
                          {simConfig.election_type === "PRESIDENTIAL" ? "Presidential" :
                           simConfig.election_type === "HOUSE_OF_REPS" ? "House of Reps" : "Governorship"}
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-[var(--color-text-dim)]">RESULTS</div>
                        <div className="font-mono text-xs font-bold text-[var(--color-text)]">
                          {(simConfig.total_results_submitted || 0).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-[var(--color-text-dim)]">INCIDENTS</div>
                        <div className="font-mono text-xs font-bold text-[var(--color-amber)]">
                          {(simConfig.total_incidents_submitted || 0).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-[var(--color-text-dim)]">ASSIGNMENTS</div>
                        <div className="font-mono text-xs font-bold text-[var(--color-text)]">
                          {(simConfig.total_assignments_created || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* How it works */}
                <div className="border border-[var(--color-gray-100)] p-4">
                  <h4 className="font-display font-semibold text-xs text-[var(--color-text-muted)] mb-2">
                    How Simulation Works
                  </h4>
                  <ul className="space-y-1 font-mono text-[10px] text-[var(--color-text-dim)]">
                    <li>• Each tick (5 seconds), the engine picks random polling units</li>
                    <li>• Agents are auto-assigned to polling units that need observers</li>
                    <li>• Results are generated with realistic vote distributions per party</li>
                    <li>• ~5% chance of an incident per result submitted</li>
                    <li>• The live dashboard updates in real time as data flows in</li>
                    <li>• Stop the simulation anytime — data stays in the database</li>
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
