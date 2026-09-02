"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import { waitForSession } from "@/lib/auth-helpers";
import ExportPanel from "@/components/live/ExportPanel";
import SimulationHistory from "@/components/admin/SimulationHistory";

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
  const [activeTab, setActiveTab] = useState<string>("overview");
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
  const [simElectionType, setSimElectionType] = useState<string>("PRESIDENTIAL");
  const [simProgress, setSimProgress] = useState<string>("");
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simError, setSimError] = useState<string>("");

  // Simulation loop state
  const [loopCount, setLoopCount] = useState<number>(5);
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopProgress, setLoopProgress] = useState<{ current: number; total: number; scenario: string } | null>(null);
  // Live simulation progress
  const [liveProgress, setLiveProgress] = useState<{
    progress_percent: number;
    total_results: number;
    total_votes: number;
    elapsed_seconds: number;
    status_distribution: Record<string, number>;
    is_running: boolean;
  } | null>(null);

  useEffect(() => {
    const init = async () => {
      const session = await waitForSession();
      if (!session) { router.push("/admin/login"); return; }
      // Check admin role — use parallel queries
      const [adminCheck, configCheck] = await Promise.all([
        supabase.from("admin_users").select("id")
          .eq("user_id", session.user.id)
          .eq("is_active", true).single(),
        supabase.from("simulation_config")
          .select("election_type")
          .eq("id", "00000000-0000-0000-0000-000000000001")
          .single(),
      ]);
      if (!adminCheck.data) { router.push("/admin/login"); return; }
      if (configCheck.data?.election_type) setSimElectionType(configCheck.data.election_type);
      fetchStats();
    };
    init();  }, []);

  // Poll live progress every 5 seconds while simulation is running
  useEffect(() => {
    if (!simRunning) { setLiveProgress(null); return; }

    let active = true;
    let interval: NodeJS.Timeout;

    const fetchProgress = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch("/api/admin/simulate/progress", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (active) {
            setLiveProgress(data);

          }
          // Detect simulation completion
          if (!data.is_running && active) {
            setSimRunning(false);
            setSimResult({
              scenario: data.scenario || "random",
              description: "Simulation completed",
              duration_minutes: Math.round((data.elapsed_seconds || 0) / 60),
              target_voters: 100_000_000,
              total_polling_units: 176846,
              results_created: data.total_results || 0,
              party_results_created: 0,
              total_votes: data.total_votes || 0,
              final_status_distribution: data.status_distribution || {},
              ndc_wins: true,
            });
            fetchStats();
          }
        }
      } catch {}
    };

    fetchProgress();
    interval = setInterval(fetchProgress, 5000);

    return () => { active = false; clearInterval(interval); };
  }, [simRunning]);

  useEffect(() => {
    if (activeTab === "verification") fetchResults();
    if (activeTab === "volunteers") fetchVolunteers();
    if (activeTab === "incidents") fetchIncidents();
  }, [activeTab]);

  const fetchStats = async () => {
    try {
      // Single RPC call replaces 8 separate COUNT queries
      const { data, error } = await supabase.rpc("get_admin_stats");
      if (data) {
        setStats({
          totalVolunteers: data.total_volunteers || 0,
          activeVolunteers: data.active_volunteers || 0,
          totalAssignments: data.total_assignments || 0,
          checkedInAssignments: data.checked_in_assignments || 0,
          totalResults: data.total_results || 0,
          verifiedResults: data.verified_results || 0,
          pendingVerification: data.pending_verification || 0,
          totalIncidents: data.total_incidents || 0,
        });
      } else {
        // Fallback: parallel individual queries if RPC not available
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
      }
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
    setSimProgress("Starting simulation via Supabase...");

    // Simulate progress messages while the API works
    const progressMessages = [
      "Querying Supabase for real INEC polling unit hierarchy...",
      "Distributing voters across states based on population...",
      "Applying regional vote patterns for NDC coalition...",
      "Processing polling units in batches...",
      "Computing party-level vote breakdowns (9 parties)...",
      "Updating live aggregations...",
      "Simulation running on Supabase (fire-and-forget)...",
    ];

    let msgIdx = 0;
    const progressInterval = setInterval(() => {
      msgIdx = Math.min(msgIdx + 1, progressMessages.length - 1);
      setSimProgress(progressMessages[msgIdx]);
    }, 30000);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Use trigger-v2 endpoint — runs via Supabase
      const res = await fetch("/api/admin/simulate/trigger-v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          scenario: simScenario,
          election_type: simElectionType,
          target_voters: simVoters * 1_000_000,
          random_seed: Date.now(),
          batch_size: 2000,
          pu_failure_rate: 0.03,
          turnout_min: 0.3,
          turnout_max: 0.8,
          geographic_scope: "national",
          simulation_speed: 1,
        }),
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const err = await res.json();
        setSimError(err.error || "Simulation failed");
        return;
      }

      const data = await res.json();
      // Simulation started — progress bar will poll for updates
      setSimProgress("Simulation started on Supabase. Monitoring progress...");
      fetchStats(); // refresh stats
    } catch (e: any) {
      setSimError(e.message || "Network error");
      setSimRunning(false);
      setSimProgress("");
    }
    // Note: simRunning stays true — the progress polling useEffect
    // will detect completion and set simRunning = false
  };

  // ── Simulation Loop ──
  const scenarios = ["landslide", "sweep", "close"] as const;
  const runSimulationLoop = async () => {
    if (loopRunning) return;
    setLoopRunning(true);
    setSimError("");
    let completedCount = 0;

    for (let i = 0; i < loopCount; i++) {
      const scenario = scenarios[i % scenarios.length];
      setLoopProgress({ current: i + 1, total: loopCount, scenario });

      try {
        // Trigger simulation via API
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/admin/simulate/trigger-v2", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            scenario,
            election_type: simElectionType,
            target_voters: simVoters * 1_000_000,
            random_seed: Date.now() + i,
            batch_size: 2000,
            pu_failure_rate: 0.03,
            turnout_min: 0.3,
            turnout_max: 0.8,
            geographic_scope: "national",
            simulation_speed: 1,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          console.error(`[loop] Simulation ${i + 1} failed to start:`, err.error);
          continue; // Skip this sim, try next
        }

        // Poll progress until completion        
        let maxWait = 600; // 10 minute timeout per sim
        while (maxWait > 0) {
          await new Promise(r => setTimeout(r, 5000));
          maxWait -= 5;
          try {
            const progressRes = await fetch("/api/admin/simulate/progress", {
              headers: { Authorization: `Bearer ${session?.access_token}` },
            });
            if (progressRes.ok) {
              const data = await progressRes.json();
              if (!data.is_running) {
                completedCount++;
                break;
              }
            }
          } catch {}
        }

        if (maxWait <= 0) {
          console.error(`[loop] Simulation ${i + 1} timed out`);
        }
      } catch (e: any) {
        console.error(`[loop] Simulation ${i + 1} error:`, e.message);
      }
    }

    setLoopRunning(false);
    setLoopProgress(null);
    setSimResult({
      scenario: "loop",
      description: `Completed ${completedCount}/${loopCount} simulations`,
      duration_minutes: 0,
      target_voters: simVoters * 1_000_000,
      total_polling_units: 176846,
      results_created: 0,
      party_results_created: 0,
      total_votes: 0,
      final_status_distribution: {},
      ndc_wins: true,
    });
    fetchStats();
  };

  const tabs = ["overview", "verification", "volunteers", "agent-mgmt", "locations", "incidents", "audit", "simulation"] as const;

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
          <div className="flex items-center gap-3">
            <a href="/" target="_self" className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-green-bright)] hover:text-[var(--color-green)] transition-colors">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green-bright)] animate-pulse" />
              LIVE
            </a>
            <button onClick={handleLogout} className="font-mono text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]">Sign out</button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-6xl mx-auto flex overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
          {tabs.map((t) => (
            <button key={t} onClick={() => setActiveTab(t)} className={`flex-shrink-0 px-3 py-3 font-mono text-[11px] border-b-2 transition-colors whitespace-nowrap min-h-[44px] ${
              activeTab === t ? "border-[var(--color-green)] text-[var(--color-green-bright)]" : "border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]"
            }`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {loading ? (
          <div className="space-y-4">
            {/* Skeleton stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-3 animate-pulse">
                  <div className="h-2 w-16 bg-[var(--color-gray-200)] rounded mb-2" />
                  <div className="h-7 w-12 bg-[var(--color-gray-200)] rounded" />
                  <div className="h-2 w-20 bg-[var(--color-gray-100)] rounded mt-1" />
                </div>
              ))}
            </div>
            <div className="font-mono text-[10px] text-[var(--color-text-dim)] text-center">Loading dashboard…</div>
          </div>
        ) : (
          <>
            {/* Overview */}
            {activeTab === "overview" && (
              <>
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
              <div className="mt-4">
                <ExportPanel variant="admin" />
              </div>
              </>
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
                      { key: "PRESIDENTIAL", label: "Presidential & National Assembly", date: "16 January 2027", color: "green" },
                      { key: "GOVERNORSHIP", label: "Governorship & State Assembly", date: "6 February 2027", color: "blue" },
                    ].map((e) => {
                      const isActive = simElectionType === e.key;
                      return (
                        <button
                          key={e.key}
                          onClick={async () => {
                          await fetch("/api/admin/config", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ election_type: e.key }),
                          });
                          setSimElectionType(e.key);
                          alert(`Switched to: ${e.label}`);
                          }}
                          disabled={simRunning}
                          className={`text-left p-3 border transition-all disabled:opacity-50 ${
                            isActive
                              ? e.color === "blue"
                                ? "border-[var(--color-blue)] bg-[var(--color-blue)]/10 ring-1 ring-[var(--color-blue)]/30"
                                : "border-[var(--color-green)] bg-[var(--color-green)]/10 ring-1 ring-[var(--color-green)]/30"
                              : "border-[var(--color-gray-200)] hover:border-[var(--color-green)]/50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-mono text-xs font-bold text-[var(--color-text)]">{e.label}</div>
                            {isActive && (
                              <div className={`w-2 h-2 rounded-full ${
                                e.color === "blue" ? "bg-[var(--color-blue)]" : "bg-[var(--color-green-bright)]"
                              }`} />
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-0.5">{e.date}</div>
                          {isActive && (
                            <div className={`mt-2 font-mono text-[9px] font-bold uppercase tracking-wider ${
                              e.color === "blue" ? "text-[var(--color-blue)]" : "text-[var(--color-green-bright)]"
                            }`}>
                              ACTIVE
                            </div>
                          )}
                        </button>
                      );
                    })}
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
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
                    <div className="flex gap-3 flex-wrap">
                      <a
                        href="/"
                        target="_blank"
                        className="flex-1 py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold text-center hover:bg-[var(--color-green-dim)] transition-colors"
                      >
                        📊 VIEW LIVE DASHBOARD
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



                  {/* Live Progress Bar */}
                  {simRunning && (
                    <div className="mt-4 p-4 bg-[var(--color-ink)] border border-[var(--color-green)]/30 space-y-3">
                      {/* Progress header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <div className="w-3 h-3 rounded-full bg-[var(--color-green)] animate-pulse" />
                            <div className="absolute inset-0 w-3 h-3 rounded-full bg-[var(--color-green)] animate-ping opacity-30" />
                          </div>
                          <span className="font-mono text-xs font-bold text-[var(--color-green-bright)] uppercase">Simulating</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                            {liveProgress ? `${liveProgress.total_results.toLocaleString()} / 188,042 PUs` : simProgress || "Starting..."}
                          </span>
                          {liveProgress && liveProgress.elapsed_seconds > 0 && (
                            <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                              {Math.floor(liveProgress.elapsed_seconds / 60)}:{String(liveProgress.elapsed_seconds % 60).padStart(2, "0")}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="relative h-[8px] bg-[var(--color-gray-100)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[var(--color-green)] to-[var(--color-green-bright)] rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${liveProgress?.progress_percent || 0}%` }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2s_ease-in-out_infinite]" />
                      </div>

                      {/* Percentage */}
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-lg font-bold text-[var(--color-green-bright)]">
                          {liveProgress?.progress_percent || 0}%
                        </span>
                        <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                          {liveProgress?.total_votes ? `${(liveProgress.total_votes / 1_000_000).toFixed(1)}M votes` : ""}
                        </span>
                      </div>

                      {/* Status distribution chips */}
                      {liveProgress && Object.keys(liveProgress.status_distribution).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(liveProgress.status_distribution)
                            .filter(([key]) => key !== "NOT_STARTED")
                            .sort((a, b) => b[1] - a[1])
                            .map(([status, count]) => {
                              const colors: Record<string, string> = {
                                VOTING: "#3B82F6",
                                COUNTING: "#FBBF24",
                                RESULT_ANNOUNCED: "#06B6D4",
                                RESULT_SUBMITTED: "#8B5CF6",
                                VERIFIED: "#22C55E",
                                DISPUTED: "#F97316",
                                DISRUPTED: "#EF4444",
                                VERIFICATION_PENDING: "#F472B6",
                              };
                              return (
                                <div key={status} className="flex items-center gap-1.5 px-2 py-1 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)]">
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[status] || "#6B7280" }} />
                                  <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                                    {status.replace(/_/g, " ").toLowerCase()}: {count.toLocaleString()}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      )}


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
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                            {Object.entries(simResult.final_status_distribution)
                              .sort((a, b) => b[1] - a[1])
                              .map(([status, count]) => (
                                <div key={status} className="flex items-center gap-1.5">
                                  <div
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{
                                      backgroundColor: status === "VERIFIED" ? "#22C55E"
                                        : status === "RESULT_SUBMITTED" ? "#8B5CF6"
                                        : status === "RESULT_ANNOUNCED" ? "#06B6D4"
                                        : status === "VERIFICATION_PENDING" ? "#F472B6"
                                        : status === "DISPUTED" ? "#F97316"
                                        : status === "DISRUPTED" ? "#EF4444"
                                        : status === "VOTING" ? "#3B82F6"
                                        : status === "COUNTING" ? "#FBBF24"
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

                {/* Simulation Loop */}
                <div className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">
                      Simulation Loop
                    </h3>
                    {loopRunning && (
                      <span className="font-mono text-[10px] px-2 py-0.5 bg-[var(--color-amber)]/20 text-[var(--color-amber)] animate-pulse">
                        LOOP RUNNING
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-[var(--color-text-dim)] mb-3">
                    Run multiple simulations back-to-back. Cycles through landslide → sweep → close scenarios.
                  </p>
                  <div className="flex items-center gap-3 mb-3">
                    <label className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Count:</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={loopCount}
                      onChange={(e) => setLoopCount(Math.max(1, Math.min(50, Number(e.target.value))))}
                      disabled={loopRunning || simRunning}
                      className="w-16 px-2 py-1 bg-[var(--color-ink)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm text-center"
                    />
                    <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                      simulations ({scenarios.join(" → ")} repeated)
                    </span>
                  </div>
                  {loopProgress && (
                    <div className="mb-3 p-2 bg-[var(--color-ink)] border border-[var(--color-amber)]/30">
                      <div className="font-mono text-[10px] text-[var(--color-amber)]">
                        Running {loopProgress.current}/{loopProgress.total} — Scenario: {loopProgress.scenario.toUpperCase()}
                      </div>
                      <div className="mt-1 h-1.5 bg-[var(--color-gray-100)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--color-amber)] rounded-full transition-all"
                          style={{ width: `${(loopProgress.current / loopProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <button
                    onClick={runSimulationLoop}
                    disabled={loopRunning || simRunning}
                    className="w-full py-3 bg-[var(--color-amber)] text-white font-mono text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {loopRunning ? `⏳ Running ${loopProgress?.current || 0}/${loopCount}...` : `🔄 RUN ${loopCount} SIMULATIONS IN LOOP`}
                  </button>
                </div>

                {/* Simulation History */}
                <SimulationHistory />

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

            {/* ── AGENT MANAGEMENT TAB ── */}
            {activeTab === "agent-mgmt" && (
              <AgentManagementTab />
            )}

            {/* ── AUDIT TRAIL TAB ── */}
            {activeTab === "audit" && (
              <AuditTrailTab />
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Agent Management Sub-Component ──

function AgentManagementTab() {
  const [agents, setAgents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAgents(); }, []);

  const fetchAgents = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/volunteers?limit=200`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAgents(data.volunteers || []);
      }
    } finally { setLoading(false); }
  };

  const handleVerify = async (id: string, status: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`/api/admin/volunteers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ verification_status: status }),
    });
    fetchAgents();
    if (selectedAgent?.id === id) setSelectedAgent(null);
  };

  const filtered = agents.filter((v: any) => {
    const name = (v.user_accounts as any)?.full_name || "";
    const email = (v.user_accounts as any)?.email || "";
    const matchesSearch = !search || name.toLowerCase().includes(search.toLowerCase()) || email.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || v.verification_status === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-4">
      {/* Search & Filter */}
      <div className="flex gap-3 flex-wrap">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents..." className="flex-1 min-w-[200px] px-3 py-2 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] font-mono text-xs text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-green)]" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] font-mono text-xs text-[var(--color-text-muted)]">
          <option value="all">All</option>
          <option value="VERIFIED">Verified</option>
          <option value="PENDING">Pending</option>
          <option value="REJECTED">Rejected</option>
          <option value="NOT_REQUESTED">Not Requested</option>
        </select>
      </div>

      {/* Agent List */}
      <div className="border border-[var(--color-gray-100)] overflow-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--color-gray-100)]">
              {["Name", "Email", "State", "Status", "Verification", "Actions"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-mono text-[10px] text-[var(--color-text-dim)] uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((v: any) => (
              <tr key={v.id} className="border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)]">
                <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">{(v.user_accounts as any)?.full_name || "—"}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-dim)]">{(v.user_accounts as any)?.email || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">{(v.states as any)?.name || "—"}</td>
                <td className="px-3 py-2 font-mono text-[10px]">
                  <span className={v.status === "ACTIVE" ? "text-[var(--color-green-bright)]" : "text-[var(--color-text-dim)]"}>{v.status}</span>
                </td>
                <td className="px-3 py-2 font-mono text-[10px]">
                  <span className={v.verification_status === "VERIFIED" ? "text-[var(--color-green-bright)]" : v.verification_status === "PENDING" ? "text-[var(--color-amber)]" : v.verification_status === "REJECTED" ? "text-[var(--color-red)]" : "text-[var(--color-text-dim)]"}>{v.verification_status}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {v.verification_status === "PENDING" && (
                      <>
                        <button onClick={() => handleVerify(v.id, "VERIFIED")} className="px-2 py-0.5 bg-[var(--color-green-dim)] text-[var(--color-green-bright)] font-mono text-[10px] hover:bg-[var(--color-green)] hover:text-white">VERIFY</button>
                        <button onClick={() => handleVerify(v.id, "REJECTED")} className="px-2 py-0.5 bg-[var(--color-red)]/10 text-[var(--color-red)] font-mono text-[10px] hover:bg-[var(--color-red)] hover:text-white">REJECT</button>
                      </>
                    )}
                    <button onClick={async () => {
                      const { data: { session } } = await supabase.auth.getSession();
                      const res = await fetch(`/api/admin/volunteers/${v.id}`, {
                        headers: { Authorization: `Bearer ${session?.access_token}` },
                      });
                      if (res.ok) { const data = await res.json(); setSelectedAgent(data); }
                    }} className="px-2 py-0.5 border border-[var(--color-gray-200)] text-[var(--color-text-dim)] font-mono text-[10px] hover:border-[var(--color-green)]">DETAILS</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center font-mono text-[var(--color-text-dim)]">No agents found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedAgent(null)}>
          <div className="bg-[var(--color-ink)] border border-[var(--color-gray-200)] max-w-lg w-full max-h-[80vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-sm">Agent Details</h3>
              <button onClick={() => setSelectedAgent(null)} className="font-mono text-xs text-[var(--color-text-dim)]">✕ Close</button>
            </div>
            <div className="space-y-3">
              <div className="font-mono text-xs"><span className="text-[var(--color-text-dim)]">Name:</span> <span className="text-[var(--color-text)]">{(selectedAgent.volunteer?.user_accounts as any)?.full_name}</span></div>
              <div className="font-mono text-xs"><span className="text-[var(--color-text-dim)]">Email:</span> <span className="text-[var(--color-text)]">{(selectedAgent.volunteer?.user_accounts as any)?.email}</span></div>
              <div className="font-mono text-xs"><span className="text-[var(--color-text-dim)]">Status:</span> <span className="text-[var(--color-text)]">{selectedAgent.volunteer?.status}</span></div>
              <div className="font-mono text-xs"><span className="text-[var(--color-text-dim)]">Verification:</span> <span className="text-[var(--color-text)]">{selectedAgent.volunteer?.verification_status}</span></div>
              <div className="font-mono text-xs"><span className="text-[var(--color-text-dim)]">Training:</span> <span className="text-[var(--color-text)]">{selectedAgent.volunteer?.training_status}</span></div>
              <hr className="border-[var(--color-gray-100)]" />
              <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Assignments ({selectedAgent.assignments?.length || 0})</div>
              {selectedAgent.assignments?.map((a: any) => (
                <div key={a.id} className="p-2 border border-[var(--color-gray-100)] font-mono text-[10px]">
                  <span className="text-[var(--color-text-muted)]">{(a.polling_units as any)?.official_code}</span> — <span className={a.status === "CHECKED_IN" ? "text-[var(--color-green-bright)]" : "text-[var(--color-text-dim)]"}>{a.status}</span>
                </div>
              ))}
              <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Submissions ({selectedAgent.submissions?.length || 0})</div>
              {selectedAgent.submissions?.map((s: any) => (
                <div key={s.id} className="p-2 border border-[var(--color-gray-100)] font-mono text-[10px]">
                  <span className="text-[var(--color-text-muted)]">{s.total_votes?.toLocaleString()} votes</span> — <span className={s.status === "VERIFIED" ? "text-[var(--color-green-bright)]" : "text-[var(--color-amber)]"}>{s.status}</span>
                  <span className="text-[var(--color-text-dim)] ml-2">{s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : ""}</span>
                </div>
              ))}
              <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Recent Activity ({selectedAgent.audit_log?.length || 0})</div>
              {selectedAgent.audit_log?.slice(0, 10).map((log: any, i: number) => (
                <div key={i} className="flex justify-between font-mono text-[10px]">
                  <span className="text-[var(--color-text-muted)]">{log.action}</span>
                  <span className="text-[var(--color-text-dim)]">{new Date(log.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Audit Trail Sub-Component ──

function AuditTrailTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const url = filter ? `/api/admin/audit?action=${filter}&limit=100` : `/api/admin/audit?limit=100`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
        }
      } finally { setLoading(false); }
    };
    fetchLogs();
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">Audit Trail</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-1.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] font-mono text-[10px] text-[var(--color-text-muted)]">
          <option value="">All Actions</option>
          <option value="RESULT_SUBMITTED">Result Submitted</option>
          <option value="RESULT_VERIFIED">Result Verified</option>
          <option value="VOLUNTEER_VERIFICATION_STATUS_UPDATED">Agent Verified</option>
          <option value="AGENT_CHECKED_IN">Agent Checked In</option>
        </select>
      </div>

      <div className="border border-[var(--color-gray-100)] overflow-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--color-gray-100)]">
              {["Action", "Actor", "Resource", "Time", "Details"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-mono text-[10px] text-[var(--color-text-dim)] uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log: any) => (
              <tr key={log.id} className="border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink-light)]">
                <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">{log.action}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-dim)]">{log.actor_type}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-dim)]">{log.resource_type}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-dim)]">{new Date(log.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-dim)] max-w-[200px] truncate">
                  {log.metadata ? (typeof log.metadata === "string" ? log.metadata : JSON.stringify(log.metadata)).substring(0, 60) : "—"}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center font-mono text-[var(--color-text-dim)]">No audit entries</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminDashboard;
