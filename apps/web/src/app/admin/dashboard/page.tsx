"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import { waitForSession } from "@/lib/auth-helpers";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import ExportPanel from "@/components/live/ExportPanel";
import SimulationHistory from "@/components/admin/SimulationHistory";
import SimulationLifecycle from "@/components/admin/SimulationLifecycle";

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
  // Real voters stored in the DB (kept small — the Free-plan DB quota
  // cannot hold 100M+ rows); display voters are what the public site
  // renders (×display multiplier, SIMULATED mode only).
  const [simVoters, setSimVoters] = useState<number>(5);
  const [simDisplayVoters, setSimDisplayVoters] = useState<number>(50);
  const [simCoverage, setSimCoverage] = useState<number>(25);
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
    total_polling_units?: number;
    total_votes: number;
    elapsed_seconds: number;
    status_distribution: Record<string, number>;
    is_running: boolean;
  } | null>(null);

  const [vqData, setVqData] = useState<any>(null);
  const [obsData, setObsData] = useState<any>(null);
  const [simV2, setSimV2] = useState<any>(null);
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [electionsList, setElectionsList] = useState<any[]>([]);
  const [simV2Cfg, setSimV2Cfg] = useState({
    mode: "CONTROLLED",
    speed: "NORMAL",
    pu_count: 50,
    disc_rate: 0.05,
  });
  const [resolveOpen, setResolveOpen] = useState<any>(null);
  // The discrepancy dialog is a full-screen overlay: lock the page behind it
  // (the hook always restores scrolling on close/unmount).
  useBodyScrollLock(Boolean(resolveOpen));
  const [resolveDecision, setResolveDecision] = useState<string>("ACCEPT_AGENT_1");
  const [resolveReason, setResolveReason] = useState<string>("");
  const [resolveManualValues, setResolveManualValues] = useState<any>({
    valid_votes: 0, rejected_votes: 0, total_votes: 0, party_votes: [],
  });

  const fetchVQData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch("/api/admin/verification-queue", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setVqData(data);
      }
    } catch {}
  };

  const fetchObsData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch("/api/admin/observability?hours_ago=24&limit=500", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setObsData(data);
      }
    } catch {}
  };

  const fetchElections = async () => {
    try {
      const { data } = await supabase
        .from("elections")
        .select("id, name, type, status")
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setElectionsList(data);
    } catch {}
  };

  const handleResolve = async () => {
    if (!resolveOpen || !resolveReason.trim()) {
      alert("Please provide a reason");
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const body: any = {
        verification_id: resolveOpen.verification_id,
        decision: resolveDecision,
        reason: resolveReason,
      };
      if (resolveDecision === "MANUAL_VALUES") {
        body.manual_values = resolveManualValues;
      }
      const res = await fetch("/api/admin/verification/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setResolveOpen(null);
        setResolveReason("");
        fetchVQData();
        fetchStats();
      }
    } catch {}
  };

  const fetchSystemConfig = async () => {
    try {
      const { data } = await supabase
        .from("system_config")
        .select("data_mode, active_election_id, last_updated_at")
        .eq("id", "00000000-0000-0000-0000-000000000001")
        .single();
      if (data) setSystemConfig(data);
    } catch {}
  };

  const handleSetDataMode = async (mode: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ data_mode: mode }),
      });
      fetchSystemConfig();
    } catch {}
  };

  const handleSetActiveElection = async (eid: string) => {
    if (!eid) return;
    if (!window.confirm("Set this as the active election?")) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ active_election_id: eid }),
      });
      fetchSystemConfig();
    } catch {}
  };

  const handleStartSimV2 = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setSimV2({ status: "STARTING", progress_pct: 0, total_pus: simV2Cfg.pu_count });
      // AbortController caps the launch call at 8s: the route returns 202
      // immediately, so anything longer means a network stall — surface a
      // clear timeout message instead of a raw NetworkError.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8_000);
      let res: Response;
      try {
        res = await fetch("/api/admin/simulate/v2-pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            mode: simV2Cfg.mode,
            speed: simV2Cfg.speed,
            pu_count: simV2Cfg.pu_count,
            discrepancy_rate: simV2Cfg.disc_rate,
            require_ai: false,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.ok) {
        const data = await res.json();
        setSimV2({
          status: "RUNNING",
          sim_election_id: data.sim_election_id,
          total_pus: data.total_pus,
          expected_submissions: data.expected_submissions,
          start_time: data.start_time,
          progress_pct: 5,
          submitted: 0,
          verified: 0,
          disputed: 0,
          published: 0,
          errors: [],
          elapsed_seconds: 0,
        });
        fetchStats();
      } else {
        const body = await res.json().catch(() => ({}));
        setSimV2((prev: any) => ({ ...(prev || {}), status: "ERROR", errors: [...((prev as any)?.errors || []), { message: body.error || `v2-pipeline returned ${res.status}` }] }));
      }
    } catch (e: any) {
      const aborted = e?.name === "AbortError";
      setSimV2((prev: any) => ({ ...(prev || {}), status: "ERROR", errors: [...((prev as any)?.errors || []), { message: aborted ? "v2-pipeline timed out after 8s (retry, or use the Simulation tab)" : e?.message || "Start failed" }] }));
    }
  };

  useEffect(() => {
    const init = async () => {
      const session = await waitForSession();
      if (!session) { router.push("/admin/login"); return; }
      // Pre-flight checks: the admin gate (SECURITY DEFINER helper,
      // migration 260 — no RLS recursion) + current data mode.
      // Fail fast: the dashboard must paint within a heartbeat.
      const [adminCheck, configCheck] = await Promise.all([
        supabase.rpc("is_active_admin", { p_user: session.user.id }),
        supabase
          .from("system_config")
          .select("data_mode, active_election_id, last_updated_at, election_type")
          .eq("id", "00000000-0000-0000-0000-000000000001")
          .single(),
      ]);
      if (!adminCheck) { router.push("/admin/login"); return; }
      if (configCheck.data?.election_type) setSimElectionType(configCheck.data.election_type);
      fetchStats();
      fetchElections();
      fetchSystemConfig();
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
    if (activeTab === "verification-queue") fetchVQData();
    if (activeTab === "observability") fetchObsData();
  }, [activeTab]);

  const fetchStats = async () => {
    try {
      // Fast path (migration 261): planner estimates, no table scans —
      // paints the header instantly even while heavy sim writes run.
      const fast = await supabase.rpc("get_admin_stats_fast");
      if (fast.data) {
        setStats({
          totalVolunteers: fast.data.total_volunteers || 0,
          activeVolunteers: fast.data.active_volunteers || 0,
          totalAssignments: fast.data.total_assignments || 0,
          checkedInAssignments: fast.data.checked_in_assignments || 0,
          totalResults: fast.data.total_results || 0,
          verifiedResults: fast.data.verified_results || 0,
          pendingVerification: fast.data.pending_verification || 0,
          totalIncidents: fast.data.total_incidents || 0,
        });
      }
      // Exact counts in the background replace the estimates without
      // blocking the initial paint.
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
      } else if (!fast.data) {
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
    setSimProgress("Starting simulation on the backend...");

    // Simulate progress messages while the API works
    const progressMessages = [
      "Querying the INEC polling unit hierarchy...",
      "Distributing voters across states based on population...",
      "Applying regional vote patterns for NDC coalition...",
      "Processing polling units in batches...",
      "Computing party-level vote breakdowns (9 parties)...",
      "Updating live aggregations...",
      "Simulation running on the backend (fire-and-forget)...",
    ];

    let msgIdx = 0;
    const progressInterval = setInterval(() => {
      msgIdx = Math.min(msgIdx + 1, progressMessages.length - 1);
      setSimProgress(progressMessages[msgIdx]);
    }, 30000);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Use trigger-v2 endpoint — runs via the results backend.
      // 30s AbortController: the launch is queued work (202 in <1s normally);
      // if the request stalls, fail with a CLEAR message instead of the
      // browser's opaque "NetworkError when attempting to fetch resource".
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch("/api/admin/simulate/trigger-v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          scenario: simScenario,
          target_voters: Math.round(simVoters * 1_000_000),
          display_voters: simDisplayVoters * 1_000_000,
          duration_minutes: simDuration,
          waves: 6,
          discrepancy_rate: 0.05,
          coverage_pct: simCoverage,
          reset_first: true,
          release_published: true,
        }),
        signal: controller.signal,
      });

      clearInterval(progressInterval);
      clearTimeout(timeoutId);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSimError(err.error || `Simulation failed (HTTP ${res.status})`);
        setSimRunning(false);
        setSimProgress("");
        return;
      }

      await res.json();
      // Simulation started — progress bar will poll for updates
      setSimProgress("Simulation started. Monitoring progress...");
      fetchStats(); // refresh stats
    } catch (e: any) {
      clearInterval(progressInterval);
      const aborted = e?.name === "AbortError";
      setSimError(
        aborted
          ? "The launch request timed out after 30s. Nothing was lost — the run may still have been queued; check the progress panel, and retry only if it stays idle."
          : e?.message || "Network error while contacting the simulation API."
      );
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
        // Trigger simulation via API (same 30s guard as the single launch)
        const { data: { session } } = await supabase.auth.getSession();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000);
        const res = await fetch("/api/admin/simulate/trigger-v2", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            scenario,
            target_voters: Math.round(simVoters * 1_000_000),
            display_voters: simDisplayVoters * 1_000_000,
            duration_minutes: simDuration,
            waves: 6,
            discrepancy_rate: 0.05,
            coverage_pct: simCoverage,
            reset_first: true,
            release_published: true,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error(`[loop] Simulation ${i + 1} failed to start:`, err.error || res.status);
          setSimError(err.error || `Simulation ${i + 1} failed to start (HTTP ${res.status})`);
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
      target_voters: Math.round(simVoters * 1_000_000),
      total_polling_units: 176846,
      results_created: 0,
      party_results_created: 0,
      total_votes: 0,
      final_status_distribution: {},
      ndc_wins: true,
    });
    fetchStats();
  };

  const tabs = ["overview", "verification-queue", "verification", "volunteers", "agent-mgmt", "import-agents", "locations", "incidents", "audit", "observability", "simulation"] as const;

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
    <div className="min-h-dvh">
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
      <nav className="border-b border-[var(--color-gray-100)] overflow-x-auto scrollbar-hide">
        {/* Edge gutters live on a non-scrolling inner wrapper: padding on the
            scroll container itself would clip the first/last tab's focus ring
            and keep its padding from participating in the scroll length. */}
        <div className="max-w-6xl mx-auto flex px-4 md:px-0 min-w-max">
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
              <div className="mt-4 border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">System Data Mode</h3>
                  <span className={`font-mono text-[10px] px-2 py-0.5 ${
                    systemConfig?.data_mode === "LIVE_ELECTION" ? "bg-[var(--color-red)]/20 text-[var(--color-red)]"
                    : systemConfig?.data_mode === "SIMULATED" ? "bg-[var(--color-amber)]/20 text-[var(--color-amber)]"
                    : "bg-[var(--color-gray-200)] text-[var(--color-text-dim)]"
                  }`}>
                    {(systemConfig?.data_mode || "AWAITING_DATA").replace(/_/g, " ")}
                  </span>
                </div>
                {/* Stacked on phones: three mode buttons side by side squeezed
                    their labels into ~90px each. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                  {[
                    { key: "AWAITING_DATA", label: "AWAITING DATA", cls: "border-[var(--color-gray-200)] text-[var(--color-text-dim)] hover:border-[var(--color-text-dim)]" },
                    { key: "SIMULATED", label: "SIMULATED", cls: "border-[var(--color-amber)]/50 text-[var(--color-amber)] hover:border-[var(--color-amber)]" },
                    { key: "LIVE_ELECTION", label: "LIVE ELECTION", cls: "border-[var(--color-red)]/50 text-[var(--color-red)] hover:border-[var(--color-red)]" },
                  ].map((m) => (
                    <button
                      key={m.key}
                      onClick={() => handleSetDataMode(m.key)}
                      className={`px-2 py-2 border font-mono text-[10px] uppercase transition-colors ${
                        systemConfig?.data_mode === m.key ? "bg-[var(--color-ink)] font-bold" : ""
                      } ${m.cls}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Active Election:</label>
                  <select
                    value={systemConfig?.active_election_id || ""}
                    onChange={(e) => handleSetActiveElection(e.target.value)}
                    className="flex-1 px-2 py-1.5 bg-[var(--color-ink)] border border-[var(--color-gray-200)] font-mono text-[11px] text-[var(--color-text-muted)]"
                  >
                    <option value="">— Select —</option>
                    {electionsList.map((el: any) => (
                      <option key={el.id} value={el.id}>{el.name} [{el.type}/{el.status}]</option>
                    ))}
                  </select>
                </div>
              </div>
              </>
            )}

            {/* Verification Queue */}
            {activeTab === "verification-queue" && (
              <div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                  {[
                    { label: "AWAITING 2ND AGENT", val: vqData?.buckets?.awaiting_second_agent ?? 0, cls: "text-[var(--color-amber)]" },
                    { label: "VERIFYING", val: vqData?.buckets?.verifying ?? 0, cls: "text-[var(--color-blue)]" },
                    { label: "FLAGGED AI", val: vqData?.buckets?.flagged_ai ?? 0, cls: "text-[var(--color-red)]" },
                    { label: "HUMAN REVIEW", val: vqData?.buckets?.human_review ?? 0, cls: "text-[var(--color-red)]" },
                    { label: "PUBLISHED", val: vqData?.buckets?.published ?? 0, cls: "text-[var(--color-green-bright)]" },
                  ].map((b, i) => (
                    <div key={i} className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-3">
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">{b.label}</div>
                      <div className={`font-display font-bold text-2xl mt-1 ${b.cls}`}>{b.val}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">Verification Queue</h3>
                  <button
                    onClick={fetchVQData}
                    className="px-3 py-1.5 border border-[var(--color-gray-200)] font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-green)] hover:text-[var(--color-green-bright)]"
                  >
                    ↻ REFRESH
                  </button>
                </div>
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                  {(vqData?.items || []).map((item: any, idx: number) => (
                    <div key={idx} className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-[var(--color-green-bright)] font-bold">{item.polling_unit_code || item.pu_code}</span>
                          <span className="font-mono text-[10px] text-[var(--color-text-dim)]">{item.state_name || ""} · {item.lga_name || ""}</span>
                        </div>
                        <span className={`font-mono text-[10px] px-2 py-0.5 ${
                          item.status_flag === "FLAGGED_AI" ? "bg-[var(--color-red)]/20 text-[var(--color-red)]"
                          : item.status_flag === "DISCREPANCY" || item.status_flag === "HUMAN_REVIEW" ? "bg-[var(--color-orange)]/20 text-[var(--color-orange)]"
                          : item.status_flag === "AWAITING_SECOND" ? "bg-[var(--color-amber)]/20 text-[var(--color-amber)]"
                          : "bg-[var(--color-gray-200)] text-[var(--color-text-dim)]"
                        }`}>
                          {(item.status_flag || "UNKNOWN").replace(/_/g, " ")}
                        </span>
                      </div>
                      {item.agent_1 && item.agent_2 ? (
                        <div className="grid grid-cols-3 gap-2 items-start mb-2">
                          <div className="p-2 bg-[var(--color-ink)] border border-[var(--color-gray-200)]">
                            <div className="font-mono text-[10px] text-[var(--color-blue)] uppercase mb-1 font-bold">AGENT 1</div>
                            <div className="font-mono text-[10px] text-[var(--color-text)]">{item.agent_1.volunteer_name || "—"}</div>
                            <div className="font-mono text-[10px] text-[var(--color-text-dim)]">{item.agent_1.volunteer_email || ""}</div>
                            <div className="grid grid-cols-3 gap-1 mt-2 font-mono text-[10px]">
                              <div><span className="text-[var(--color-text-dim)]">V</span> <span className="text-[var(--color-text)] font-bold">{item.agent_1.valid}</span></div>
                              <div><span className="text-[var(--color-text-dim)]">R</span> <span className="text-[var(--color-text)] font-bold">{item.agent_1.rejected}</span></div>
                              <div><span className="text-[var(--color-text-dim)]">T</span> <span className="text-[var(--color-text)] font-bold">{item.agent_1.total}</span></div>
                            </div>
                            <div className="mt-1 space-y-0.5">
                              {(item.agent_1.parties || []).slice(0, 5).map((p: any, pi: number) => (
                                <div key={pi} className="flex justify-between font-mono text-[9px]">
                                  <span className="text-[var(--color-text-dim)]">{p.abbr}</span>
                                  <span className="text-[var(--color-text)] font-bold">{p.votes}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="p-2 border border-dashed border-[var(--color-gray-200)]">
                            <div className="font-mono text-[10px] text-[var(--color-amber)] uppercase mb-1 font-bold text-center">DIFF</div>
                            <div className="text-center font-display font-bold text-xl mb-1" style={{ color: (item.diff?.max_diff || 0) <= 2 ? "var(--color-green-bright)" : "var(--color-red)" }}>
                              {item.diff?.max_diff ?? 0}
                            </div>
                            <div className="font-mono text-[9px] text-center text-[var(--color-text-dim)] mb-1">MAX DIFF</div>
                            <div className="grid grid-cols-2 gap-1 font-mono text-[9px]">
                              <div className="text-center"><span className="text-[var(--color-text-dim)]">V:</span> <span className="text-[var(--color-text)]">{item.diff?.valid_diff ?? 0}</span></div>
                              <div className="text-center"><span className="text-[var(--color-text-dim)]">R:</span> <span className="text-[var(--color-text)]">{item.diff?.rejected_diff ?? 0}</span></div>
                            </div>
                            <div className="mt-1 space-y-0.5 max-h-[120px] overflow-y-auto">
                              {(item.diff?.party_diffs || []).map((p: any, pi: number) => (
                                <div key={pi} className="flex justify-between font-mono text-[9px]">
                                  <span className="text-[var(--color-text-dim)]">{p.abbr}</span>
                                  <span className={Math.abs(p.diff || 0) > 0 ? "text-[var(--color-red)] font-bold" : "text-[var(--color-text-muted)]"}>
                                    {p.diff >= 0 ? "+" : ""}{p.diff ?? 0}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="p-2 bg-[var(--color-ink)] border border-[var(--color-gray-200)]">
                            <div className="font-mono text-[10px] text-[var(--color-purple)] uppercase mb-1 font-bold">AGENT 2</div>
                            <div className="font-mono text-[10px] text-[var(--color-text)]">{item.agent_2.volunteer_name || "—"}</div>
                            <div className="font-mono text-[10px] text-[var(--color-text-dim)]">{item.agent_2.volunteer_email || ""}</div>
                            <div className="grid grid-cols-3 gap-1 mt-2 font-mono text-[10px]">
                              <div><span className="text-[var(--color-text-dim)]">V</span> <span className="text-[var(--color-text)] font-bold">{item.agent_2.valid}</span></div>
                              <div><span className="text-[var(--color-text-dim)]">R</span> <span className="text-[var(--color-text)] font-bold">{item.agent_2.rejected}</span></div>
                              <div><span className="text-[var(--color-text-dim)]">T</span> <span className="text-[var(--color-text)] font-bold">{item.agent_2.total}</span></div>
                            </div>
                            <div className="mt-1 space-y-0.5">
                              {(item.agent_2.parties || []).slice(0, 5).map((p: any, pi: number) => (
                                <div key={pi} className="flex justify-between font-mono text-[9px]">
                                  <span className="text-[var(--color-text-dim)]">{p.abbr}</span>
                                  <span className="text-[var(--color-text)] font-bold">{p.votes}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {item.verification_id && (
                        <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-gray-100)]">
                          <select
                            value={resolveDecision}
                            onChange={(e) => setResolveDecision(e.target.value)}
                            className="flex-1 px-2 py-1.5 bg-[var(--color-ink)] border border-[var(--color-gray-200)] font-mono text-[10px] text-[var(--color-text-muted)]"
                          >
                            <option value="ACCEPT_AGENT_1">ACCEPT AGENT 1</option>
                            <option value="ACCEPT_AGENT_2">ACCEPT AGENT 2</option>
                            <option value="MANUAL_VALUES">ENTER MANUAL VALUES</option>
                          </select>
                          <button
                            onClick={() => { setResolveOpen(item); setResolveDecision("ACCEPT_AGENT_1"); setResolveReason(""); }}
                            className="px-3 py-1.5 bg-[var(--color-green)] text-white font-mono text-[10px] font-bold hover:opacity-90"
                          >
                            RESOLVE
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {(!vqData?.items || vqData.items.length === 0) && (
                    <div className="text-center py-12 font-mono text-[11px] text-[var(--color-text-dim)]">
                      {vqData ? "No items in queue" : "Loading verification queue…"}
                    </div>
                  )}
                </div>
                {resolveOpen && (
                  /* z-[60] keeps the dialog above the fixed navbar (z-50).
                     The panel is height-capped and scrolls internally, so a
                     long form stays reachable on a phone and the close
                     control is never pushed off screen. */
                  <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-[60] p-4 overflow-y-auto" onClick={() => setResolveOpen(null)}>
                    <div className="bg-[var(--color-ink)] border border-[var(--color-gray-200)] max-w-lg w-full my-auto max-h-[85dvh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-display font-bold text-sm text-[var(--color-text)]">Resolve Discrepancy</h3>
                        <button onClick={() => setResolveOpen(null)} className="font-mono text-xs text-[var(--color-text-dim)]">✕ CLOSE</button>
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] mb-1">PU: <span className="text-[var(--color-green-bright)] font-bold">{resolveOpen.polling_unit_code || resolveOpen.pu_code}</span></div>
                      <div className="space-y-3 mt-3">
                        <div>
                          <label className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Decision</label>
                          <select
                            value={resolveDecision}
                            onChange={(e) => setResolveDecision(e.target.value)}
                            className="w-full mt-1 px-2 py-1.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] font-mono text-xs text-[var(--color-text-muted)]"
                          >
                            <option value="ACCEPT_AGENT_1">ACCEPT AGENT 1</option>
                            <option value="ACCEPT_AGENT_2">ACCEPT AGENT 2</option>
                            <option value="MANUAL_VALUES">ENTER MANUAL VALUES</option>
                          </select>
                        </div>
                        <div>
                          <label className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Reason</label>
                          <textarea
                            value={resolveReason}
                            onChange={(e) => setResolveReason(e.target.value)}
                            rows={3}
                            placeholder="Enter resolution reason..."
                            className="w-full mt-1 px-2 py-1.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] font-mono text-xs text-[var(--color-text)] resize-none"
                          />
                        </div>
                        {resolveDecision === "MANUAL_VALUES" && (
                          <div className="space-y-2 p-2 border border-[var(--color-amber)]/50 bg-[var(--color-amber)]/5">
                            <div className="grid grid-cols-3 gap-2">
                              {["valid_votes", "rejected_votes", "total_votes"].map((f) => (
                                <div key={f}>
                                  <label className="font-mono text-[9px] text-[var(--color-text-dim)] uppercase">{f.replace(/_/g, " ")}</label>
                                  <input
                                    type="number"
                                    value={(resolveManualValues as any)[f] || 0}
                                    onChange={(e) => setResolveManualValues((p: any) => ({ ...(p || {}), [f]: Number(e.target.value) || 0 }))}
                                    className="w-full mt-0.5 px-2 py-1 bg-[var(--color-ink)] border border-[var(--color-gray-200)] font-mono text-xs text-[var(--color-text)]"
                                  />
                                </div>
                              ))}
                            </div>
                            <div>
                              <label className="font-mono text-[9px] text-[var(--color-text-dim)] uppercase">Party Votes (JSON)</label>
                              <textarea
                                value={JSON.stringify(resolveManualValues?.party_votes || [], null, 2)}
                                onChange={(e) => {
                                  try { setResolveManualValues((p: any) => ({ ...(p || {}), party_votes: JSON.parse(e.target.value) })); } catch {}
                                }}
                                rows={5}
                                className="w-full mt-0.5 px-2 py-1 bg-[var(--color-ink)] border border-[var(--color-gray-200)] font-mono text-[10px] text-[var(--color-text)] resize-none font-mono"
                              />
                            </div>
                          </div>
                        )}
                        <button
                          onClick={handleResolve}
                          disabled={!resolveReason.trim()}
                          className="w-full py-2.5 bg-[var(--color-green)] text-white font-mono text-xs font-bold hover:opacity-90 disabled:opacity-40"
                        >
                          CONFIRM RESOLUTION
                        </button>
                      </div>
                    </div>
                  </div>
                )}
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
                <div className="border border-[var(--color-green)]/30 bg-[var(--color-green)]/5 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display font-bold text-sm text-[var(--color-green-bright)]">⚡ SIMULATION V2 — PIPELINE CONTROL CENTER</h3>
                    <span className={`font-mono text-[10px] px-2 py-0.5 ${
                      simV2?.status === "RUNNING" ? "bg-[var(--color-green)]/20 text-[var(--color-green-bright)] animate-pulse"
                      : simV2?.status === "ERROR" ? "bg-[var(--color-red)]/20 text-[var(--color-red)]"
                      : "bg-[var(--color-gray-200)] text-[var(--color-text-dim)]"
                    }`}>
                      {(simV2?.status || "IDLE").toUpperCase()}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                      { l: "POLLING UNITS", v: simV2Cfg.pu_count, c: "text-[var(--color-blue)]" },
                      { l: "AGENTS (N+S)", v: simV2Cfg.pu_count * 2, c: "text-[var(--color-purple)]" },
                      { l: "SUBMITTED", v: simV2?.submitted ?? 0, c: "text-[var(--color-text)]" },
                      { l: "AWAIT 2ND", v: vqData?.buckets?.awaiting_second_agent ?? 0, c: "text-[var(--color-amber)]" },
                      { l: "VERIFYING", v: vqData?.buckets?.verifying ?? 0, c: "text-[var(--color-blue)]" },
                      { l: "VERIFIED", v: simV2?.verified ?? 0, c: "text-[var(--color-green-bright)]" },
                      { l: "DISPUTED", v: simV2?.disputed ?? vqData?.buckets?.human_review ?? 0, c: "text-[var(--color-orange)]" },
                      { l: "PUBLISHED", v: vqData?.buckets?.published ?? 0, c: "text-[var(--color-green)]" },
                      { l: "ELAPSED (s)", v: simV2?.elapsed_seconds ?? 0, c: "text-[var(--color-text-dim)]" },
                    ].map((m, i) => (
                      <div key={i} className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-2.5">
                        <div className="font-mono text-[9px] text-[var(--color-text-dim)] uppercase leading-tight min-h-[22px]">{m.l}</div>
                        <div className={`font-display font-bold text-xl mt-0.5 ${m.c}`}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-1 block">Mode</label>
                      <select
                        value={simV2Cfg.mode}
                        onChange={(e) => setSimV2Cfg((p) => ({ ...p, mode: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[var(--color-ink)] border border-[var(--color-gray-200)] font-mono text-xs text-[var(--color-text-muted)]"
                      >
                        {["CONTROLLED", "REHEARSAL", "STRESS", "FAILURE", "FULL_SYSTEM"].map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-1 block">Speed</label>
                      <div className="grid grid-cols-4 gap-1">
                        {([
                          ["SLOW", "2.5s/wave"],
                          ["NORMAL", "1s/wave"],
                          ["FAST", "300ms/wave"],
                          ["STRESS", "no delay"],
                        ] as const).map(([sp, desc]) => (
                          <button
                            key={sp}
                            onClick={() => setSimV2Cfg((p) => ({ ...p, speed: sp }))}
                            className={`px-2 py-1.5 border font-mono text-[10px] uppercase transition-colors ${
                              simV2Cfg.speed === sp
                                ? "bg-[var(--color-green)]/10 border-[var(--color-green)] text-[var(--color-green-bright)] font-bold"
                                : "border-[var(--color-gray-200)] text-[var(--color-text-dim)] hover:border-[var(--color-text-dim)]"
                            }`}
                            title={desc}
                          >
                            {sp}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="font-mono text-[9px] text-[var(--color-text-dim)] mt-1">
                      Max: 12 waves, 30 min, 176,846 PUs per run. STRESS mode has no delay — use only for load testing.
                    </div>
                  </div>
                  <div className="space-y-3 mb-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Polling Units</label>
                        <span className="font-mono text-[10px] text-[var(--color-text)] font-bold">{simV2Cfg.pu_count} PUs</span>
                      </div>
                      <input
                        type="range"
                        min={5}
                        max={500}
                        step={5}
                        value={simV2Cfg.pu_count}
                        onChange={(e) => setSimV2Cfg((p) => ({ ...p, pu_count: Number(e.target.value) }))}
                        className="w-full accent-[var(--color-green)]"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Discrepancy Rate</label>
                        <span className="font-mono text-[10px] text-[var(--color-text)] font-bold">{Math.round(simV2Cfg.disc_rate * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={0.5}
                        step={0.01}
                        value={simV2Cfg.disc_rate}
                        onChange={(e) => setSimV2Cfg((p) => ({ ...p, disc_rate: Number(e.target.value) }))}
                        className="w-full accent-[var(--color-amber)]"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <button
                      onClick={handleStartSimV2}
                      disabled={simV2?.status === "RUNNING"}
                      className="flex-1 min-w-[120px] px-3 py-2 bg-[var(--color-green)] text-white font-mono text-xs font-bold hover:opacity-90 disabled:opacity-40"
                    >
                      ▶ START SIMULATION
                    </button>
                    <button
                      onClick={() => {}}
                      disabled={simV2?.status !== "RUNNING"}
                      className="px-3 py-2 border border-[var(--color-amber)]/50 text-[var(--color-amber)] font-mono text-xs hover:bg-[var(--color-amber)]/10 disabled:opacity-40"
                    >
                      ⏸ PAUSE
                    </button>
                    <button
                      onClick={() => {}}
                      disabled={simV2?.status !== "RUNNING"}
                      className="px-3 py-2 border border-[var(--color-red)]/50 text-[var(--color-red)] font-mono text-xs hover:bg-[var(--color-red)]/10 disabled:opacity-40"
                    >
                      ■ STOP
                    </button>
                    <button
                      onClick={() => { setSimV2(null); fetchVQData(); }}
                      className="px-3 py-2 border border-[var(--color-gray-200)] text-[var(--color-text-dim)] font-mono text-xs hover:border-[var(--color-text-dim)]"
                    >
                      ↺ RESET
                    </button>
                  </div>
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase">Progress</span>
                      <span className="font-mono text-[10px] text-[var(--color-text)] font-bold">{simV2?.progress_pct ?? 0}%</span>
                    </div>
                    <div className="h-2 bg-[var(--color-gray-100)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-green)] rounded-full transition-all duration-300"
                        style={{ width: `${simV2?.progress_pct ?? 0}%` }}
                      />
                    </div>
                  </div>
                  {simV2?.errors && simV2.errors.length > 0 && (
                    <div className="border border-[var(--color-red)]/30 bg-[var(--color-red)]/5">
                      <div className="px-3 py-2 border-b border-[var(--color-red)]/20">
                        <span className="font-mono text-[10px] text-[var(--color-red)] uppercase font-bold">Errors ({simV2.errors.length})</span>
                      </div>
                      <div className="overflow-x-auto max-h-[180px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-[var(--color-ink-light)] sticky top-0">
                            <tr className="border-b border-[var(--color-gray-100)]">
                              {["PU", "STEP", "AGENT", "MESSAGE"].map((h) => (
                                <th key={h} className="px-2 py-1 text-left font-mono text-[9px] text-[var(--color-text-dim)] uppercase">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {simV2.errors.slice(0, 20).map((er: any, i: number) => (
                              <tr key={i} className="border-b border-[var(--color-gray-100)]">
                                <td className="px-2 py-1 font-mono text-[9px] text-[var(--color-green-bright)]">{er.pu_code || "—"}</td>
                                <td className="px-2 py-1 font-mono text-[9px] text-[var(--color-text-muted)]">{er.step || "—"}</td>
                                <td className="px-2 py-1 font-mono text-[9px] text-[var(--color-blue)]">{er.agent || "—"}</td>
                                <td className="px-2 py-1 font-mono text-[9px] text-[var(--color-red)]">{er.message || String(er).slice(0, 80)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

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
                          max={30}
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
                        How long the simulation runs (1-30 min, status transitions paced across this period)
                      </div>
                    </div>
                    <div className="p-3 border border-[var(--color-gray-200)]">
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                        Real Voters Stored (millions)
                      </div>
                      <div className="flex items-center gap-3">
                        {/*
                          Backend work is deliberately separable from the
                          displayed total: a small real dataset (0.1M) with
                          a large display multiplier renders the same big
                          national numbers without writing millions of rows.
                          That is what keeps a full-coverage run inside the
                          database quota and comfortable on serverless.
                        */}
                        <input
                          type="range"
                          min={0.1}
                          max={10}
                          step={0.1}
                          value={simVoters}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setSimVoters(v);
                            if (simDisplayVoters < v) setSimDisplayVoters(v);
                          }}
                          disabled={simRunning}
                          className="flex-1 accent-[var(--color-green)]"
                        />
                        <span className="font-mono text-sm text-[var(--color-text)] min-w-[50px] text-right">
                          {simVoters}M
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-1">
                        0.1M–10M real votes written to the DB. Keep this small and raise Display Voters instead — the site multiplies, so big national numbers never need big rows on disk.
                      </div>
                    </div>
                    <div className="p-3 border border-[var(--color-gray-200)]">
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                        Display Voters (millions, × shown on site)
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={simVoters}
                          max={200}
                          step={5}
                          value={simDisplayVoters}
                          onChange={(e) => setSimDisplayVoters(Number(e.target.value))}
                          disabled={simRunning}
                          className="flex-1 accent-[var(--color-green)]"
                        />
                        <span className="font-mono text-sm text-[var(--color-text)] min-w-[50px] text-right">
                          {simDisplayVoters}M (×{Math.round(simDisplayVoters / Math.max(simVoters, 1))})
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-1">
                        ~{Math.round(simDisplayVoters * 1_000_000 / 176846).toLocaleString()} displayed votes per polling unit — simulation display only, never live elections
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
                            {liveProgress
                              ? `${liveProgress.total_results.toLocaleString()} / ${(
                                  liveProgress.total_polling_units || 176846
                                ).toLocaleString()} PUs`
                              : simProgress || "Starting..."}
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

                {/* Simulation Lifecycle (start pre-flight / stop / purge) */}
                <SimulationLifecycle />

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

            {/* ── IMPORT AGENTS TAB (P2-3b CSV UPLOAD UI) ── */}
            {activeTab === "import-agents" && (
              <ImportAgentsTab onImported={fetchStats} />
            )}

            {/* ── AUDIT TRAIL TAB ── */}
            {activeTab === "audit" && (
              <AuditTrailTab />
            )}

            {/* Observability */}
            {activeTab === "observability" && (
              <div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {(() => {
                    const types = ["SUBMISSION_CREATED", "CANONICAL_UPSERTED", "VERIFICATION_STARTED", "DETERMINISTIC_CHECKS", "AI_VISION_CALLED", "AI_ANOMALY_CALLED", "AI_CONSISTENCY_CALLED", "AI_EVIDENCE_CALLED", "DECISION_MATCH", "DECISION_DISCREPANCY", "CANONICAL_PUBLISHED", "ADMIN_RESOLVED"];
                    const counts: Record<string, number> = {};
                    (obsData?.dashboard_hourly || []).forEach((row: any) => {
                      counts[row.event_type] = (counts[row.event_type] || 0) + (Number(row.count) || 0);
                    });
                    return types.map((et, i) => (
                      <div key={i} className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)] p-3">
                        <div className="font-mono text-[9px] text-[var(--color-text-dim)] uppercase min-h-[28px] leading-tight">{et.replace(/_/g, " ")}</div>
                        <div className="font-display font-bold text-2xl mt-1 text-[var(--color-text)]">{counts[et] || 0}</div>
                      </div>
                    ));
                  })()}
                </div>
                <div className="border border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
                  <div className="flex items-center justify-between p-3 border-b border-[var(--color-gray-100)]">
                    <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">Timeline Events (Last 50)</h3>
                    <button
                      onClick={fetchObsData}
                      className="px-3 py-1.5 border border-[var(--color-gray-200)] font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-green)] hover:text-[var(--color-green-bright)]"
                    >
                      ↻ REFRESH
                    </button>
                  </div>
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--color-ink-light)]">
                        <tr className="border-b border-[var(--color-gray-100)]">
                          {["TIME", "EVENT TYPE", "ACTOR", "VERIFICATION", "METADATA"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-mono text-[10px] text-[var(--color-text-dim)] uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const flat: any[] = [];
                          Object.values(obsData?.events || {}).forEach((arr: any) => flat.push(...(arr || [])));
                          flat.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
                          return flat.slice(0, 50).map((ev: any, i) => (
                            <tr key={i} className="border-b border-[var(--color-gray-100)] hover:bg-[var(--color-ink)]">
                              <td className="px-3 py-1.5 font-mono text-[10px] text-[var(--color-text-dim)] whitespace-nowrap">{new Date(ev.created_at).toLocaleString()}</td>
                              <td className="px-3 py-1.5 font-mono text-[10px] text-[var(--color-green-bright)] uppercase whitespace-nowrap">{ev.event_type}</td>
                              <td className="px-3 py-1.5 font-mono text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">{ev.actor_id || "—"}</td>
                              <td className="px-3 py-1.5 font-mono text-[10px] text-[var(--color-text-dim)]">{ev.verification_id || ev.canonical_id || "—"}</td>
                              <td className="px-3 py-1.5 font-mono text-[9px] text-[var(--color-text-muted)] max-w-[300px] truncate">{JSON.stringify(ev.metadata || {})}</td>
                            </tr>
                          ));
                        })()}
                        {!obsData && (
                          <tr><td colSpan={5} className="px-3 py-8 text-center font-mono text-[11px] text-[var(--color-text-dim)]">Loading observability data…</td></tr>
                        )}
                        {obsData && (!obsData.events || Object.keys(obsData.events).length === 0) && (
                          <tr><td colSpan={5} className="px-3 py-8 text-center font-mono text-[11px] text-[var(--color-text-dim)]">No events in the last 24 hours</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
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

// ── Import Agents (CSV Upload) Sub-Component (P2-3b) ──

function ImportAgentsTab({ onImported }: { onImported?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [electionId, setElectionId] = useState<string>("");
  const [elections, setElections] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitKind, setSubmitKind] = useState<"dry_run" | "import" | null>(null);
  const [result, setResult] = useState<{
    dry_run: boolean;
    created_volunteers: number;
    skipped_volunteers: number;
    created_assignments: number;
    errors: Array<{ row: number; email?: string; error: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [headers, setHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [invalidRowIdxs, setInvalidRowIdxs] = useState<Set<number>>(new Set());
  const [missingCols, setMissingCols] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("elections")
      .select("id, name, is_active, status")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setElections(data);
          const firstActive = data.find(
            (e) => e.is_active === true || e.status === "ACTIVE"
          );
          if (firstActive) setElectionId(firstActive.id);
        }
      });
  }, []);

  function parseCSV4180(text: string): string[][] {
    const rows: string[][] = [];
    let curRow: string[] = [];
    let cur = "";
    let inQuotes = false;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const ch = text.charCodeAt(i);
      if (inQuotes) {
        if (ch === 34) {
          if (text.charCodeAt(i + 1) === 34) {
            cur += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        cur += text[i];
        i++;
        continue;
      }
      if (ch === 34) {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === 44) {
        curRow.push(cur);
        cur = "";
        i++;
        continue;
      }
      if (ch === 13) {
        if (text.charCodeAt(i + 1) === 10) i++;
        curRow.push(cur);
        cur = "";
        rows.push(curRow);
        curRow = [];
        i++;
        continue;
      }
      if (ch === 10) {
        curRow.push(cur);
        cur = "";
        rows.push(curRow);
        curRow = [];
        i++;
        continue;
      }
      cur += text[i];
      i++;
    }
    if (cur.length > 0 || curRow.length > 0) {
      curRow.push(cur);
      rows.push(curRow);
    }
    return rows.filter(
      (r) => r.length > 0 && !(r.length === 1 && r[0].trim() === "")
    );
  }

  const HEADER_ALIASES: Record<string, keyof BulkRowExpected> = {
    email: "email",
    "e-mail": "email",
    email_address: "email",
    name: "name",
    full_name: "name",
    fullname: "name",
    volunteer: "name",
    agent: "name",
    observer: "name",
    phone: "phone",
    mobile: "phone",
    telephone: "phone",
    whatsapp: "phone",
    contact: "phone",
    state_id: "state_id",
    stateid: "state_id",
    lga_id: "lga_id",
    lgaid: "lga_id",
    ward: "ward",
    ward_name: "ward",
    polling_unit_code: "polling_unit_code",
    pu_code: "polling_unit_code",
    pucode: "polling_unit_code",
    official_code: "polling_unit_code",
    pollingunitcode: "polling_unit_code",
    volunteer_id: "volunteer_id",
    volunteerid: "volunteer_id",
  };

  type BulkRowExpected = {
    email?: string;
    name?: string;
    phone?: string;
    state_id?: string;
    lga_id?: string;
    ward?: string;
    polling_unit_code?: string;
    volunteer_id?: string;
  };

  const REQUIRED_COLS: (keyof BulkRowExpected)[] = [
    "email",
    "name",
    "phone",
    "state_id",
    "lga_id",
    "ward",
    "polling_unit_code",
  ];

  useEffect(() => {
    if (!file) {
      setHeaders([]);
      setParsedRows([]);
      setInvalidRowIdxs(new Set());
      setMissingCols([]);
      setResult(null);
      setError(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const raw = parseCSV4180(text);
      if (raw.length === 0) {
        setHeaders([]);
        setParsedRows([]);
        setMissingCols([...REQUIRED_COLS]);
        return;
      }
      const rawHeaders = raw[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
      const mappedHeaders = rawHeaders.map(
        (h) => HEADER_ALIASES[h] ?? (h as keyof BulkRowExpected)
      );
      setHeaders(raw[0]);

      const missing: string[] = [];
      REQUIRED_COLS.forEach((rc) => {
        if (!mappedHeaders.includes(rc)) missing.push(rc);
      });
      setMissingCols(missing);

      const records: Record<string, string>[] = [];
      const invalidIdxs = new Set<number>();
      for (let r = 1; r < raw.length; r++) {
        const row = raw[r];
        const obj: Record<string, string> = {};
        for (let c = 0; c < mappedHeaders.length; c++) {
          const v = (row[c] ?? "").trim();
          const k = String(mappedHeaders[c]);
          if (v && !(k in obj)) obj[k] = v;
        }
        records.push(obj);
        let bad = false;
        for (const rc of REQUIRED_COLS) {
          if (!obj[rc] || String(obj[rc]).trim().length === 0) {
            bad = true;
            break;
          }
        }
        if (missing.length > 0) bad = true;
        if (bad) invalidIdxs.add(r - 1);
      }
      setParsedRows(records);
      setInvalidRowIdxs(invalidIdxs);
      setResult(null);
      setError(null);
    };
    reader.readAsText(file);
  }, [file]);

  const runBulk = async (kind: "dry_run" | "import") => {
    if (parsedRows.length === 0) {
      setError("No rows parsed. Load a valid CSV first.");
      return;
    }
    setSubmitting(true);
    setSubmitKind(kind);
    setError(null);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const body: any = {
        rows: parsedRows.map((r) => ({
          email: r.email,
          name: r.name,
          phone: r.phone,
          state_id: r.state_id,
          lga_id: r.lga_id,
          ward: r.ward,
          polling_unit_code: r.polling_unit_code,
          volunteer_id: r.volunteer_id || undefined,
        })),
        dry_run: kind === "dry_run",
      };
      if (electionId) body.election_id = electionId;
      const res = await fetch("/api/admin/import-agents/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json);
      if (kind === "import" && !json.errors?.length && onImported) onImported();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
      setSubmitKind(null);
    }
  };

  const previewRows = parsedRows.slice(0, 10);
  const displayCols: { key: string; label: string }[] = [
    { key: "email", label: "Email" },
    { key: "name", label: "Name" },
    { key: "phone", label: "Phone" },
    { key: "state_id", label: "State ID" },
    { key: "lga_id", label: "LGA ID" },
    { key: "ward", label: "Ward" },
    { key: "polling_unit_code", label: "PU Code" },
    { key: "volunteer_id", label: "Vol ID" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">
            Import Agents (Bulk JSON via CSV)
          </h3>
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-dim)] max-w-2xl">
            CSV required columns:{" "}
            <code className="text-[var(--color-green-bright)]">
              email, name, phone, state_id, lga_id, ward, polling_unit_code
            </code>
            . Optional: <code>volunteer_id</code>. Dedup by email. Max 2
            observers per PU. RFC4180 CSV parsing in-browser.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wide">
            Election
          </label>
          <select
            value={electionId}
            onChange={(e) => setElectionId(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] font-mono text-[11px] text-[var(--color-text-muted)]"
          >
            <option value="">(use first ACTIVE election)</option>
            {elections.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} {e.is_active ? "★" : ""}
              </option>
            ))}
          </select>
          <p className="font-mono text-[9px] text-[var(--color-text-dim)]">
            Falls back to the first ACTIVE election when empty.
          </p>
        </div>

        <div className="md:col-span-2 space-y-2">
          <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wide">
            CSV File
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full px-3 py-1.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] font-mono text-[10px] text-[var(--color-text-muted)] file:mr-3 file:px-3 file:py-1.5 file:-mx-3 file:-my-1.5 file:border-0 file:bg-[var(--color-gray-100)] file:font-mono file:text-[10px] file:text-[var(--color-text-muted)]"
          />
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 font-mono text-[11px] text-red-700">
              ERROR: {error}
            </div>
          )}
        </div>
      </div>

      {/* STATS */}
      {parsedRows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-[var(--color-ink-light)] border border-[var(--color-gray-100)]">
            <div className="font-mono text-[9px] uppercase text-[var(--color-text-dim)]">
              Total rows
            </div>
            <div className="mt-1 font-display text-xl text-[var(--color-text)]">
              {parsedRows.length}
            </div>
          </div>
          <div className="p-3 bg-emerald-50 border border-emerald-200">
            <div className="font-mono text-[9px] uppercase text-emerald-700">
              Valid rows
            </div>
            <div className="mt-1 font-display text-xl text-emerald-800">
              {parsedRows.length - invalidRowIdxs.size}
            </div>
          </div>
          <div className="p-3 bg-rose-50 border border-rose-200">
            <div className="font-mono text-[9px] uppercase text-rose-600">
              Invalid rows
            </div>
            <div className="mt-1 font-display text-xl text-rose-700">
              {invalidRowIdxs.size}
              {missingCols.length > 0 && (
                <span className="ml-2 text-[10px] font-mono text-rose-600">
                  missing: {missingCols.join(",")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PREVIEW GRID */}
      {previewRows.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wide">
              Preview (first {previewRows.length} of {parsedRows.length} rows) —{" "}
              {file?.name} · {(file?.size ?? 0).toLocaleString()} bytes
            </span>
          </div>
          <div className="overflow-x-auto border border-[var(--color-gray-100)]">
            <table className="w-full text-[10px]">
              <thead className="bg-[var(--color-ink-light)] sticky top-0">
                <tr className="border-b border-[var(--color-gray-100)]">
                  <th className="px-2 py-1.5 text-left font-mono uppercase text-[var(--color-text-dim)] w-10">
                    #
                  </th>
                  {displayCols.map((c) => (
                    <th
                      key={c.key}
                      className={`px-2 py-1.5 text-left font-mono uppercase text-[var(--color-text-dim)] whitespace-nowrap ${
                        REQUIRED_COLS.includes(c.key as any) &&
                        missingCols.includes(c.key)
                          ? "bg-rose-100 text-rose-700"
                          : ""
                      }`}
                    >
                      {c.label}
                      {REQUIRED_COLS.includes(c.key as any) && (
                        <span className="ml-1 text-[9px] text-[var(--color-amber)]">
                          *
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r, i) => {
                  const isBad = invalidRowIdxs.has(i);
                  return (
                    <tr
                      key={i}
                      className={`border-b border-[var(--color-gray-100)] ${
                        isBad ? "bg-rose-50" : "hover:bg-[var(--color-ink-light)]"
                      }`}
                    >
                      <td className="px-2 py-1 font-mono text-[var(--color-text-dim)]">
                        {i + 1}
                      </td>
                      {displayCols.map((c) => (
                        <td
                          key={c.key}
                          className={`px-2 py-1 font-mono whitespace-nowrap ${
                            REQUIRED_COLS.includes(c.key as any) &&
                            !r[c.key] &&
                            !missingCols.includes(c.key)
                              ? "text-rose-700 bg-rose-50"
                              : "text-[var(--color-text-muted)]"
                          }`}
                        >
                          {r[c.key] || "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ACTION BUTTONS */}
      {parsedRows.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => runBulk("dry_run")}
            disabled={submitting}
            className="px-5 py-2 bg-[var(--color-amber)] text-white font-mono text-[11px] font-bold uppercase disabled:opacity-40 hover:brightness-105 transition"
          >
            {submitting && submitKind === "dry_run"
              ? "Running dry-run…"
              : "Dry Run"}
          </button>
          <button
            onClick={() => runBulk("import")}
            disabled={submitting || invalidRowIdxs.size > 0}
            className="px-5 py-2 bg-[var(--color-green)] text-white font-mono text-[11px] font-bold uppercase disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-105 transition"
            title={
              invalidRowIdxs.size > 0
                ? "Fix invalid rows before importing"
                : ""
            }
          >
            {submitting && submitKind === "import"
              ? "Importing…"
              : "Import"}
          </button>
          {invalidRowIdxs.size > 0 && (
            <span className="font-mono text-[10px] text-rose-600">
              {invalidRowIdxs.size} invalid row
              {invalidRowIdxs.size !== 1 ? "s" : ""} — fix CSV or run Dry Run for errors
            </span>
          )}
        </div>
      )}

      {/* RESULT SUMMARY */}
      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-emerald-50 border border-emerald-200">
              <div className="font-mono text-[9px] uppercase text-emerald-700">
                Created volunteers
              </div>
              <div className="mt-1 font-display text-xl text-emerald-800">
                {result.created_volunteers}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200">
              <div className="font-mono text-[9px] uppercase text-slate-600">
                Skipped volunteers
              </div>
              <div className="mt-1 font-display text-xl text-slate-700">
                {result.skipped_volunteers}
              </div>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-200">
              <div className="font-mono text-[9px] uppercase text-blue-700">
                Created assignments
              </div>
              <div className="mt-1 font-display text-xl text-blue-800">
                {result.created_assignments}
              </div>
            </div>
            <div className="p-3 bg-rose-50 border border-rose-200">
              <div className="font-mono text-[9px] uppercase text-rose-600">
                Errors
              </div>
              <div className="mt-1 font-display text-xl text-rose-700">
                {result.errors.length}
              </div>
            </div>
          </div>
          {result.dry_run ? (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 font-mono text-[11px] text-amber-800">
              ⚠ DRY RUN — no rows written. Numbers above show what WOULD happen.
              Click [Import] to commit.
            </div>
          ) : (
            <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 font-mono text-[11px] text-emerald-800">
              ✅ IMPORT COMPLETE — rows written to database.
            </div>
          )}
          {result.errors.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wide">
                Row errors ({result.errors.length})
              </div>
              <div className="max-h-56 overflow-auto border border-[var(--color-gray-100)]">
                <table className="w-full">
                  <thead className="sticky top-0 bg-[var(--color-ink-light)]">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-mono text-[9px] uppercase text-[var(--color-text-dim)]">
                        Row
                      </th>
                      <th className="px-3 py-1.5 text-left font-mono text-[9px] uppercase text-[var(--color-text-dim)]">
                        Email
                      </th>
                      <th className="px-3 py-1.5 text-left font-mono text-[9px] uppercase text-[var(--color-text-dim)]">
                        Error
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.slice(0, 100).map((e, i) => (
                      <tr
                        key={i}
                        className="border-t border-[var(--color-gray-100)]"
                      >
                        <td className="px-3 py-1.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                          {e.row}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                          {e.email ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-rose-700">
                          {e.error}
                        </td>
                      </tr>
                    ))}
                    {result.errors.length > 100 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-1.5 font-mono text-[10px] text-[var(--color-text-dim)]"
                        >
                          …and {result.errors.length - 100} more (truncated)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
