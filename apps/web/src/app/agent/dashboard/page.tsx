"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";
import { waitForSession, onAuthChanged } from "@/lib/auth-helpers";

interface Assignment {
  id: string;
  polling_unit_name: string;
  polling_unit_code: string;
  state_name: string;
  lga_name: string;
  ward_name: string;
  election_name: string;
  observer_number: number;
  status: string;
  checked_in_at: string | null;
}

const AgentDashboard: React.FC = () => {
  const router = useRouter();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Wait for session with retries for localStorage hydration
    const init = async () => {
      const session = await waitForSession();
      if (!session) {
        router.push("/agent/login");
        return;
      }
      fetchAssignment();
    };
    init();

    // Subscribe to auth changes — only redirect on explicit sign-out
    const subscription = onAuthChanged(
      () => fetchAssignment(),
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
  }, []);

  const fetchAssignment = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // Single query with full nested joins — no fallback needed
    const { data: a } = await supabase
      .from("agent_assignments")
      .select(`
        id, status, observer_number, assigned_at, checked_in_at,
        polling_units (
          name, official_code,
          states ( name ),
          lgas ( name ),
          wards ( name )
        ),
        elections ( name )
      `)
      .in("status", ["ASSIGNED", "ACTIVATED", "CHECKED_IN"])
      .order("assigned_at", { ascending: false })
      .limit(1)
      .single();

    if (a) {
      const pu = a.polling_units as any;
      setAssignment({
        id: a.id,
        polling_unit_name: pu?.name || "—",
        polling_unit_code: pu?.official_code || "—",
        state_name: pu?.states?.name || "—",
        lga_name: pu?.lgas?.name || "—",
        ward_name: pu?.wards?.name || "—",
        election_name: (a.elections as any)?.name || "—",
        observer_number: a.observer_number,
        status: a.status,
        checked_in_at: a.checked_in_at,
      });
    }
    setLoading(false);
  };

  const [gpsStatus, setGpsStatus] = useState<string>("");
  const [gpsError, setGpsError] = useState<string>("");

  const handleCheckIn = async () => {
    if (!assignment) return;
    setGpsStatus("Acquiring GPS location...");
    setGpsError("");

    if (!navigator.geolocation) {
      setGpsError("GPS not available on this device");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setGpsStatus(`GPS acquired (±${Math.round(accuracy)}m). Verifying location...`);

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
              assignment_id: assignment.id,
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

          setAssignment({ ...assignment, status: "CHECKED_IN" });
          setGpsStatus(data.message);
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
    if (!assignment) return;
    const { error } = await supabase
      .from("agent_assignments")
      .update({ status: "CHECKED_OUT", checked_out_at: new Date().toISOString() })
      .eq("id", assignment.id);
    if (!error) setAssignment({ ...assignment, status: "CHECKED_OUT" });
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
          <div className="border border-[var(--color-gray-100)] p-4 animate-pulse">
            <div className="h-5 w-24 bg-[var(--color-gray-200)] rounded mb-3" />
            <div className="h-3 w-40 bg-[var(--color-gray-100)] rounded mb-2" />
            <div className="space-y-2 mt-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex justify-between">
                  <div className="h-2 w-16 bg-[var(--color-gray-100)] rounded" />
                  <div className="h-2 w-24 bg-[var(--color-gray-200)] rounded" />
                </div>
              ))}
            </div>
          </div>
          <div className="h-12 bg-[var(--color-gray-100)] rounded animate-pulse" />
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] text-center">Loading assignment…</div>
        </div>
      </div>
    );
  }

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

      <div className="max-w-lg mx-auto px-4 py-6">
        {assignment ? (
          <>
            {/* Assignment card */}
            <div className="border border-[var(--color-gray-100)] p-4 mb-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono text-lg font-bold text-[var(--color-text)]">
                    {assignment.polling_unit_code}
                  </div>
                  <div className="text-sm text-[var(--color-text-muted)]">
                    {assignment.polling_unit_name}
                  </div>
                </div>
                <span className={`font-mono text-[10px] px-2 py-0.5 ${
                  assignment.status === "CHECKED_IN"
                    ? "bg-[var(--color-green-dim)] text-[var(--color-green-bright)]"
                    : "bg-[var(--color-gray-100)] text-[var(--color-text-dim)]"
                }`}>
                  {assignment.status === "CHECKED_IN" ? "ACTIVE" : assignment.status}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                {([
                  ["Election", assignment.election_name],
                  ["Observer", `#${assignment.observer_number}`],
                  ["Ward", assignment.ward_name],
                  ["LGA", assignment.lga_name],
                  ["State", assignment.state_name],
                  assignment.checked_in_at ? ["Checked in", new Date(assignment.checked_in_at).toLocaleTimeString()] : null,
                ] as [string, string][]).filter((item): item is [string, string] => item !== null && item[1] !== "—").map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-[var(--color-text-dim)]">{label}</span>
                    <span className="font-mono text-[var(--color-text-muted)]">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              {assignment.status !== "CHECKED_IN" ? (
                <>
                  <button onClick={handleCheckIn} disabled={!!gpsStatus} className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50">
                    {gpsStatus || "📍 CHECK IN WITH GPS"}
                  </button>
                  {gpsStatus && (
                    <div className="p-2 bg-[var(--color-green-dim)] border border-[var(--color-green)]/30">
                      <span className="font-mono text-[10px] text-[var(--color-green-bright)] animate-pulse">{gpsStatus}</span>
                    </div>
                  )}
                  {gpsError && (
                    <div className="p-2 bg-[var(--color-red)]/10 border border-[var(--color-red)]/30">
                      <span className="font-mono text-[10px] text-[var(--color-red-bright)]">{gpsError}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Link href="/agent/submit-result" className="block w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors text-center">
                    SUBMIT RESULT
                  </Link>
                  <Link href="/agent/report-incident" className="block w-full py-3 border border-[var(--color-amber)] text-[var(--color-amber)] font-mono text-sm font-bold hover:bg-[var(--color-amber-dim)] transition-colors text-center">
                    REPORT INCIDENT
                  </Link>

                  {/* Quick disruption report buttons */}
                  <div className="p-3 border border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
                    <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                      Quick Report — Election Problem
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
                          onClick={async () => {
                            if (!window.confirm(`Report: ${item.label}?`)) return;
                            const { data: { session } } = await supabase.auth.getSession();
                            if (!session) return;
                            const { data: vol } = await supabase.from("volunteers").select("id").eq("user_id", session.user.id).single();
                            if (!vol) return;
                            await fetch("/api/me/incident", {
                              method: "POST",
                              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                              body: JSON.stringify({
                                assignment_id: assignment.id,
                                category: item.cat,
                                severity: item.sev,
                                what_observed: `Quick report: ${item.label} at ${assignment.polling_unit_code}`,
                                agent_safe: true,
                              }),
                            });
                            alert("Report submitted.");
                          }}
                          className="py-2 px-2 border border-[var(--color-gray-200)] text-[var(--color-text-dim)] font-mono text-[10px] hover:border-[var(--color-amber)] hover:text-[var(--color-amber)] hover:bg-[var(--color-amber-dim)] transition-colors text-left"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button onClick={handleCheckOut} className="w-full py-2.5 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-xs hover:bg-[var(--color-ink-light)] transition-colors">
                    CHECK OUT
                  </button>
                </>
              )}
            </div>

            {/* Safety */}
            <div className="mt-6 pt-4 border-t border-[var(--color-gray-100)]">
              <Link href="/agent/safety" className="block w-full py-3 bg-[var(--color-red)] text-white font-mono text-sm font-bold hover:bg-[var(--color-red)]/90 transition-colors text-center">
                I FEEL UNSAFE
              </Link>
              <p className="mt-2 text-center text-[10px] text-[var(--color-text-dim)]">
                Stops field activity & alerts coordinator
              </p>
            </div>
          </>
        ) : (
          <div className="text-center py-16">
            <div className="font-mono text-sm text-[var(--color-text-dim)] mb-2">No Assignment</div>
            <div className="text-xs text-[var(--color-text-dim)]">
              Check back closer to election day
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentDashboard;
