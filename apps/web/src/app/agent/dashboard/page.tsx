"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";
import { waitForSession, onAuthChanged } from "@/lib/auth-helpers";

interface AgentStatus {
  account: {
    email: string;
    full_name: string;
    avatar_url: string | null;
  };
  volunteer: {
    id: string;
    status: string;
    phone: string | null;
    state_name: string | null;
    lga_name: string | null;
    created_at: string;
  } | null;
  onboarding: {
    status: string;
    training_status: string;
  };
  verification: {
    status: string;
  };
  assignment: {
    id: string;
    status: string;
    observer_number: number;
    polling_unit_name: string | null;
    polling_unit_code: string | null;
    registered_voters: number | null;
    state_name: string | null;
    lga_name: string | null;
    ward_name: string | null;
    election_name: string | null;
    election_type: string | null;
    assigned_at: string;
    checked_in_at: string | null;
  } | null;
  submissions: Array<{
    id: string;
    valid_votes: number;
    rejected_votes: number;
    total_votes: number;
    status: string;
    submitted_at: string;
    verified_at: string | null;
    polling_unit_code: string | null;
    polling_unit_name: string | null;
  }>;
  stats: {
    total_submissions: number;
    verified_submissions: number;
    total_incidents: number;
  };
  actions: string[];
}

const AgentDashboard: React.FC = () => {
  const router = useRouter();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [gpsStatus, setGpsStatus] = useState("");
  const [gpsError, setGpsError] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("/api/me/status", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (e) {
      console.error("Failed to fetch status:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const session = await waitForSession();
      if (!session) {
        router.push("/agent/login");
        return;
      }
      fetchStatus();
    };
    init();

    const subscription = onAuthChanged(
      () => fetchStatus(),
      () => router.push("/agent/login")
    );

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [fetchStatus]);

  const handleCheckIn = async () => {
    if (!status?.assignment) return;
    setGpsStatus("Acquiring GPS location...");
    setGpsError("");

    if (!navigator.geolocation) {
      setGpsError("GPS not available on this device");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setGpsStatus(`GPS acquired (±${Math.round(accuracy)}m). Verifying...`);

        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;

          const res = await fetch("/api/me/check-in", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              assignment_id: status.assignment!.id,
              latitude,
              longitude,
              accuracy,
            }),
          });

          const data = await res.json();
          if (!res.ok) {
            setGpsError(data.error || "Check-in failed");
            setGpsStatus("");
            return;
          }

          setGpsStatus(data.message);
          fetchStatus();
        } catch (e: any) {
          setGpsError(e.message || "Network error");
          setGpsStatus("");
        }
      },
      (err) => {
        setGpsError(`GPS error: ${err.message}. Please enable location access.`);
        setGpsStatus("");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleCheckOut = async () => {
    if (!status?.assignment) return;
    const { error } = await supabase
      .from("agent_assignments")
      .update({ status: "CHECKED_OUT", checked_out_at: new Date().toISOString() })
      .eq("id", status.assignment.id);
    if (!error) fetchStatus();
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <header className="border-b border-[var(--color-gray-100)] px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-sm">NG<span className="text-[var(--color-green)]">EO</span></span>
              <span className="font-mono text-[10px] text-[var(--color-text-dim)]">AGENT</span>
            </div>
          </div>
        </header>
        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border border-[var(--color-gray-100)] p-4 animate-pulse">
              <div className="h-4 w-32 bg-[var(--color-gray-200)] rounded mb-3" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="flex justify-between">
                    <div className="h-2 w-16 bg-[var(--color-gray-100)] rounded" />
                    <div className="h-2 w-24 bg-[var(--color-gray-200)] rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] text-center">Loading dashboard…</div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="font-mono text-sm text-[var(--color-text-dim)]">Failed to load status</div>
      </div>
    );
  }

  const a = status.assignment;
  const isCheckedIn = a?.status === "CHECKED_IN";
  const hasAssignment = !!a;
  const latestSubmission = status.submissions[0];
  const hasSubmitted = !!latestSubmission;
  const isVerified = latestSubmission?.status === "VERIFIED";
  const isRejected = latestSubmission?.status === "REJECTED";
  const isPending = latestSubmission?.status === "UNVERIFIED";

  return (
    <div className="min-h-screen">
      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-[var(--color-red)] text-white text-center py-2 text-xs font-mono">
          ⚠ Offline — submissions will queue
        </div>
      )}

      {/* Header */}
      <header className="border-b border-[var(--color-gray-100)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-sm text-[var(--color-text)]">
              NG<span className="text-[var(--color-green)]">EO</span>
            </span>
            <span className="font-mono text-[10px] text-[var(--color-text-dim)]">AGENT</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/" target="_self" className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-green-bright)] hover:text-[var(--color-green)] transition-colors">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green-bright)] animate-pulse" />
              LIVE
            </a>
            <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-[var(--color-green-bright)]" : "bg-[var(--color-red)]"}`} />
            <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
              {isOnline ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* ── WELCOME / PROFILE ── */}
        <div className="border border-[var(--color-gray-100)] p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display font-bold text-base text-[var(--color-text)]">
              Welcome, {status.account.full_name?.split(" ")[0] || "Agent"}
            </h2>
            <StatusBadge status={status.volunteer?.status || "UNKNOWN"} type="volunteer" />
          </div>
          <div className="font-mono text-[10px] text-[var(--color-text-dim)]">
            {status.account.email}
          </div>
          {status.volunteer?.state_name && (
            <div className="font-mono text-[10px] text-[var(--color-text-dim)] mt-1">
              {status.volunteer.state_name}{status.volunteer.lga_name ? ` • ${status.volunteer.lga_name}` : ""}
            </div>
          )}
        </div>

        {/* ── ONBOARDING STATUS ── */}
        <StatusCard
          title="Onboarding"
          status={status.onboarding.status}
          type="onboarding"
          detail={
            status.onboarding.status === "COMPLETED"
              ? "You're fully onboarded and ready for election day."
              : status.onboarding.status === "IN_PROGRESS"
              ? "Complete your onboarding to become eligible for assignment."
              : "Start onboarding to get assigned to a polling unit."
          }
          action={
            status.onboarding.status !== "COMPLETED"
              ? { label: status.onboarding.status === "NOT_STARTED" ? "START ONBOARDING" : "CONTINUE ONBOARDING", href: "/agent/onboarding" }
              : null
          }
        />

        {/* ── VERIFICATION STATUS ── */}
        <StatusCard
          title="Verification"
          status={status.verification.status}
          type="verification"
          detail={
            status.verification.status === "VERIFIED"
              ? "Your identity has been verified. You're ready for deployment."
              : status.verification.status === "PENDING"
              ? "Your verification is being reviewed. This usually takes 1-2 business days."
              : status.verification.status === "REJECTED"
              ? "Your verification was rejected. Please resubmit with valid ID."
              : "Submit your verification documents to become eligible for assignment."
          }
          action={
            status.verification.status === "NOT_REQUESTED" || status.verification.status === "REJECTED"
              ? { label: "REQUEST VERIFICATION", href: "/agent/onboarding" }
              : null
          }
        />

        {/* ── ASSIGNMENT ── */}
        {hasAssignment ? (
          <div className="border border-[var(--color-gray-100)] p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-mono text-lg font-bold text-[var(--color-text)]">
                  {a!.polling_unit_code}
                </div>
                <div className="text-sm text-[var(--color-text-muted)]">
                  {a!.polling_unit_name}
                </div>
              </div>
              <StatusBadge status={a!.status} type="assignment" />
            </div>

            <div className="space-y-1.5 text-xs">
              {([
                ["Election", a!.election_name],
                ["Observer", `#${a!.observer_number}`],
                ["Ward", a!.ward_name],
                ["LGA", a!.lga_name],
                ["State", a!.state_name],
                ["Registered Voters", a!.registered_voters?.toLocaleString()],
                a!.checked_in_at ? ["Checked in", new Date(a!.checked_in_at).toLocaleTimeString()] : null,
              ] as [string, string | undefined][]).filter((item): item is [string, string] => !!item && !!item[1]).map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-[var(--color-text-dim)]">{label}</span>
                  <span className="font-mono text-[var(--color-text-muted)]">{value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="border border-[var(--color-gray-100)] p-6 text-center">
            <div className="font-mono text-sm text-[var(--color-text-dim)] mb-1">No Assignment</div>
            <div className="text-xs text-[var(--color-text-dim)]">
              Complete onboarding and verification to receive an assignment
            </div>
          </div>
        )}

        {/* ── ACTION CENTER ── */}
        {hasAssignment && (
          <div className="border border-[var(--color-gray-100)] p-4">
            <h3 className="font-display font-semibold text-sm text-[var(--color-text)] mb-3">
              Your Actions
            </h3>

            {!isCheckedIn ? (
              /* ── CHECK IN ── */
              <>
                <button onClick={handleCheckIn} disabled={!!gpsStatus} className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50">
                  {gpsStatus || "📍 CHECK IN WITH GPS"}
                </button>
                {gpsStatus && (
                  <div className="mt-2 p-2 bg-[var(--color-green-dim)] border border-[var(--color-green)]/30">
                    <span className="font-mono text-[10px] text-[var(--color-green-bright)] animate-pulse">{gpsStatus}</span>
                  </div>
                )}
                {gpsError && (
                  <div className="mt-2 p-2 bg-[var(--color-red)]/10 border border-[var(--color-red)]/30">
                    <span className="font-mono text-[10px] text-[var(--color-red-bright)]">{gpsError}</span>
                  </div>
                )}
              </>
            ) : (
              /* ── CHECKED IN ACTIONS ── */
              <>
                {/* Report Status Banner */}
                {hasSubmitted && (
                  <div className={`mb-3 p-3 border ${
                    isVerified ? "border-[var(--color-green)]/30 bg-[var(--color-green)]/5" :
                    isRejected ? "border-[var(--color-red)]/30 bg-[var(--color-red)]/5" :
                    "border-[var(--color-amber)]/30 bg-[var(--color-amber)]/5"
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold">
                        {isVerified ? "✅" : isRejected ? "❌" : "⏳"}
                      </span>
                      <span className="font-mono text-xs font-bold text-[var(--color-text)]">
                        {isVerified ? "Report Verified" :
                         isRejected ? "Report Rejected" :
                         "Report Under Review"}
                      </span>
                    </div>
                    {isRejected && (
                      <div className="mt-1 font-mono text-[10px] text-[var(--color-red)]">
                        Please review and resubmit your report
                      </div>
                    )}
                  </div>
                )}

                {/* Submit / Resubmit Result */}
                {(isRejected || !hasSubmitted) && (
                  <Link
                    href={isRejected ? "/agent/submit-result?resubmit=true" : "/agent/submit-result"}
                    className="block w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors text-center mb-2"
                  >
                    {isRejected ? "🔄 RESUBMIT RESULT" : "📝 SUBMIT RESULT"}
                  </Link>
                )}

                {/* View Report */}
                {hasSubmitted && (
                  <div className="mb-2 p-3 border border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
                    <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-2">Latest Report</div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                      <div>
                        <div className="text-[var(--color-text-dim)]">Valid</div>
                        <div className="text-[var(--color-text)] font-bold">{latestSubmission.valid_votes.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-[var(--color-text-dim)]">Rejected</div>
                        <div className="text-[var(--color-text-muted)]">{latestSubmission.rejected_votes.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-[var(--color-text-dim)]">Total</div>
                        <div className="text-[var(--color-text)] font-bold">{latestSubmission.total_votes.toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="mt-2 font-mono text-[10px] text-[var(--color-text-dim)]">
                      Submitted: {new Date(latestSubmission.submitted_at).toLocaleString()}
                    </div>
                  </div>
                )}

                {/* Report Incident */}
                <Link href="/agent/report-incident" className="block w-full py-3 border border-[var(--color-amber)] text-[var(--color-amber)] font-mono text-sm font-bold hover:bg-[var(--color-amber-dim)] transition-colors text-center mb-2">
                  🚨 REPORT INCIDENT
                </Link>

                {/* Quick Incident Buttons */}
                <QuickIncidentButtons assignmentId={a!.id} pollingUnitCode={a!.polling_unit_code || ""} onComplete={fetchStatus} />

                {/* Check Out */}
                <button onClick={handleCheckOut} className="w-full py-2.5 mt-2 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-xs hover:bg-[var(--color-ink-light)] transition-colors">
                  CHECK OUT
                </button>
              </>
            )}
          </div>
        )}

        {/* ── SUBMISSION HISTORY ── */}
        {status.submissions.length > 0 && (
          <div className="border border-[var(--color-gray-100)] p-4">
            <h3 className="font-display font-semibold text-sm text-[var(--color-text)] mb-3">
              Submission History
            </h3>
            <div className="space-y-2">
              {status.submissions.map((sub) => (
                <div key={sub.id} className="flex items-center justify-between p-2 border border-[var(--color-gray-100)]">
                  <div>
                    <div className="font-mono text-xs text-[var(--color-text-muted)]">
                      {sub.polling_unit_code} — {sub.total_votes.toLocaleString()} votes
                    </div>
                    <div className="font-mono text-[10px] text-[var(--color-text-dim)]">
                      {new Date(sub.submitted_at).toLocaleDateString()}
                    </div>
                  </div>
                  <StatusBadge status={sub.status} type="submission" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STATS ── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-[var(--color-gray-100)] p-3 text-center">
            <div className="font-mono text-lg font-bold text-[var(--color-text)]">{status.stats.total_submissions}</div>
            <div className="font-mono text-[10px] text-[var(--color-text-dim)]">Reports</div>
          </div>
          <div className="border border-[var(--color-gray-100)] p-3 text-center">
            <div className="font-mono text-lg font-bold text-[var(--color-green-bright)]">{status.stats.verified_submissions}</div>
            <div className="font-mono text-[10px] text-[var(--color-text-dim)]">Verified</div>
          </div>
          <div className="border border-[var(--color-gray-100)] p-3 text-center">
            <div className="font-mono text-lg font-bold text-[var(--color-amber)]">{status.stats.total_incidents}</div>
            <div className="font-mono text-[10px] text-[var(--color-text-dim)]">Incidents</div>
          </div>
        </div>

        {/* ── SAFETY ── */}
        <div className="pt-4 border-t border-[var(--color-gray-100)]">
          <Link href="/agent/safety" className="block w-full py-3 bg-[var(--color-red)] text-white font-mono text-sm font-bold hover:bg-[var(--color-red)]/90 transition-colors text-center">
            I FEEL UNSAFE
          </Link>
          <p className="mt-2 text-center text-[10px] text-[var(--color-text-dim)]">
            Stops field activity & alerts coordinator
          </p>
        </div>
      </div>
    </div>
  );
};

// ── Status Badge Component ──

function StatusBadge({ status, type }: { status: string; type: string }) {
  const colorMap: Record<string, string> = {
    // Volunteer statuses
    ACTIVE: "bg-[var(--color-green-dim)] text-[var(--color-green-bright)]",
    REGISTERED: "bg-[var(--color-gray-100)] text-[var(--color-text-dim)]",
    SUSPENDED: "bg-[var(--color-red)]/10 text-[var(--color-red)]",

    // Verification statuses
    VERIFIED: "bg-[var(--color-green-dim)] text-[var(--color-green-bright)]",
    PENDING: "bg-[var(--color-amber)]/10 text-[var(--color-amber)]",
    REJECTED: "bg-[var(--color-red)]/10 text-[var(--color-red)]",
    NOT_REQUESTED: "bg-[var(--color-gray-100)] text-[var(--color-text-dim)]",

    // Assignment statuses
    CHECKED_IN: "bg-[var(--color-green-dim)] text-[var(--color-green-bright)]",
    ASSIGNED: "bg-[var(--color-gray-100)] text-[var(--color-text-muted)]",
    ACTIVATED: "bg-[var(--color-blue)]/10 text-[var(--color-blue)]",
    CHECKED_OUT: "bg-[var(--color-gray-100)] text-[var(--color-text-dim)]",

    // Submission statuses
    UNVERIFIED: "bg-[var(--color-amber)]/10 text-[var(--color-amber)]",
    DISPUTED: "bg-[var(--color-red)]/10 text-[var(--color-red)]",

    // Onboarding
    COMPLETED: "bg-[var(--color-green-dim)] text-[var(--color-green-bright)]",
    IN_PROGRESS: "bg-[var(--color-blue)]/10 text-[var(--color-blue)]",
    NOT_STARTED: "bg-[var(--color-gray-100)] text-[var(--color-text-dim)]",
  };

  const label = status.replace(/_/g, " ");

  return (
    <span className={`font-mono text-[10px] px-2 py-0.5 ${colorMap[status] || "bg-[var(--color-gray-100)] text-[var(--color-text-dim)]"}`}>
      {label}
    </span>
  );
}

// ── Status Card Component ──

function StatusCard({ title, status, type, detail, action }: {
  title: string;
  status: string;
  type: string;
  detail: string;
  action?: { label: string; href: string } | null;
}) {
  const statusColors: Record<string, string> = {
    COMPLETED: "border-[var(--color-green)]/30",
    VERIFIED: "border-[var(--color-green)]/30",
    IN_PROGRESS: "border-[var(--color-blue)]/30",
    PENDING: "border-[var(--color-amber)]/30",
    NOT_STARTED: "border-[var(--color-gray-200)]",
    NOT_REQUESTED: "border-[var(--color-gray-200)]",
    REJECTED: "border-[var(--color-red)]/30",
  };

  return (
    <div className={`border ${statusColors[status] || "border-[var(--color-gray-100)]"} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display font-semibold text-sm text-[var(--color-text)]">{title}</h3>
        <StatusBadge status={status} type={type} />
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mb-3">{detail}</p>
      {action && (
        <Link href={action.href} className="block w-full py-2 bg-[var(--color-green)] text-white font-mono text-xs font-bold text-center hover:bg-[var(--color-green)]/90 transition-colors">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

// ── Quick Incident Buttons ──

function QuickIncidentButtons({ assignmentId, pollingUnitCode, onComplete }: {
  assignmentId: string;
  pollingUnitCode: string;
  onComplete: () => void;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);

  const reportIncident = async (category: string, label: string, severity: string) => {
    if (!window.confirm(`Report: ${label}?`)) return;
    setSubmitting(category);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: vol } = await supabase.from("volunteers").select("id").eq("user_id", session.user.id).single();
      if (!vol) return;

      await fetch("/api/me/incident", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          assignment_id: assignmentId,
          category,
          severity,
          what_observed: `Quick report: ${label} at ${pollingUnitCode}`,
          agent_safe: true,
        }),
      });

      alert("Report submitted.");
      onComplete();
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="p-3 border border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
      <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
        Quick Report — Election Problem
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { cat: "ELECTION_NOT_HELD", label: "⛔ Election Not Held", sev: "CRITICAL" },
          { cat: "VIOLENCE", label: "🔴 Violence / Threats", sev: "CRITICAL" },
          { cat: "MATERIAL_SHORTAGE", label: "📦 Materials Missing", sev: "HIGH" },
          { cat: "DISRUPTION", label: "🟡 Process Disrupted", sev: "MEDIUM" },
          { cat: "ACCESS_PROBLEM", label: "🚫 Can't Access PU", sev: "MEDIUM" },
          { cat: "SECURITY_INCIDENT", label: "🚨 Security Issue", sev: "HIGH" },
        ].map((item) => (
          <button
            key={item.cat}
            onClick={() => reportIncident(item.cat, item.label, item.sev)}
            disabled={submitting === item.cat}
            className="py-2 px-2 border border-[var(--color-gray-200)] text-[var(--color-text-dim)] font-mono text-[10px] hover:border-[var(--color-amber)] hover:text-[var(--color-amber)] hover:bg-[var(--color-amber-dim)] transition-colors text-left disabled:opacity-50"
          >
            {submitting === item.cat ? "..." : item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default AgentDashboard;
