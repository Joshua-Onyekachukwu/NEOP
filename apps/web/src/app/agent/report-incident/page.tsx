"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

const CATEGORIES = [
  { value: "VIOLENCE", label: "Violence" },
  { value: "INTIMIDATION", label: "Intimidation" },
  { value: "DISRUPTION", label: "Disruption" },
  { value: "ELECTION_NOT_HELD", label: "Election Not Held" },
  { value: "MATERIAL_SHORTAGE", label: "Material Shortage" },
  { value: "POLLING_UNIT_RELOCATION", label: "PU Relocation" },
  { value: "ACCESS_PROBLEM", label: "Access Problem" },
  { value: "SECURITY_INCIDENT", label: "Security Incident" },
  { value: "OTHER", label: "Other" },
];

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const AgentReportIncident: React.FC = () => {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !description.trim()) return;

    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/agent/login"); return; }

    const { data: volunteer } = await supabase
      .from("volunteers").select("id").eq("user_id", session.user.id).single();
    if (!volunteer) { setLoading(false); return; }

    const { data: assignment } = await supabase
      .from("agent_assignments").select("id, polling_unit_id, election_id")
      .eq("volunteer_id", volunteer.id).in("status", ["CHECKED_IN", "ACTIVATED"]).single();

    await supabase.from("incidents").insert({
      election_id: assignment?.election_id || "00000000-0000-0000-0000-000000000000",
      polling_unit_id: assignment?.polling_unit_id || "00000000-0000-0000-0000-000000000000",
      volunteer_id: volunteer.id,
      assignment_id: assignment?.id,
      category,
      severity,
      what_observed: description.trim(),
      when_observed: new Date().toISOString(),
      status: "REPORTED",
      agent_safe: true,
    });

    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-gray-100)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push("/agent/dashboard")} className="font-mono text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]">← Back</button>
          <span className="font-display font-semibold text-sm text-[var(--color-text)]">Report Incident</span>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">
        {submitted ? (
          <div className="text-center py-16">
            <div className="font-display font-bold text-lg text-[var(--color-green-bright)] mb-2">Reported</div>
            <div className="text-sm text-[var(--color-text-muted)] mb-6">Your incident has been recorded.</div>
            <button onClick={() => router.push("/agent/dashboard")} className="px-4 py-2 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-xs">
              Return to Dashboard
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} required className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)]">
                <option value="">Select category</option>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">Severity</label>
              <div className="flex gap-1">
                {SEVERITIES.map((s) => (
                  <button key={s} type="button" onClick={() => setSeverity(s)} className={`flex-1 py-1.5 font-mono text-[10px] border transition-colors ${
                    severity === s
                      ? s === "CRITICAL" ? "bg-[var(--color-red)] text-white border-[var(--color-red)]"
                        : s === "HIGH" ? "bg-[var(--color-amber)] text-black border-[var(--color-amber)]"
                        : "bg-[var(--color-green)] text-white border-[var(--color-green)]"
                      : "border-[var(--color-gray-200)] text-[var(--color-text-dim)] hover:border-[var(--color-gray-300)]"
                  }`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">What did you observe?</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={4}
                placeholder="Describe what you personally saw…"
                className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)] resize-none"
              />
            </div>

            <button type="submit" disabled={loading || !category || !description.trim()} className="w-full py-3 bg-[var(--color-amber)] text-black font-mono text-sm font-bold hover:bg-[var(--color-amber)]/90 transition-colors disabled:opacity-50">
              {loading ? "Submitting…" : "SUBMIT REPORT"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default AgentReportIncident;
