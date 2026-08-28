"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

const AgentSafety: React.FC = () => {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);

  const handleEmergencyStop = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: volunteer } = await supabase
      .from("volunteers").select("id").eq("user_id", session.user.id).single();
    if (!volunteer) return;

    // Deactivate assignment
    await supabase
      .from("agent_assignments")
      .update({ status: "RELEASED", released_at: new Date().toISOString() })
      .eq("volunteer_id", volunteer.id)
      .in("status", ["ASSIGNED", "ACTIVATED", "CHECKED_IN"]);

    // Create incident
    await supabase.from("incidents").insert({
      election_id: "00000000-0000-0000-0000-000000000000",
      polling_unit_id: "00000000-0000-0000-0000-000000000000",
      volunteer_id: volunteer.id,
      category: "SECURITY_INCIDENT",
      severity: "CRITICAL",
      what_observed: "EMERGENCY STOP — Agent reported feeling unsafe",
      when_observed: new Date().toISOString(),
      status: "REPORTED",
      agent_safe: true,
    });

    setSubmitted(true);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-gray-100)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push("/agent/dashboard")} className="font-mono text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]">← Back</button>
          <span className="font-display font-semibold text-sm text-[var(--color-red)]">Safety</span>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-8">
        {submitted ? (
          <div className="text-center py-16">
            <div className="font-display font-bold text-lg text-[var(--color-green-bright)] mb-2">Done</div>
            <div className="text-sm text-[var(--color-text-muted)] mb-6">Your field activity has been stopped. Your coordinator has been notified.</div>
            <button onClick={() => router.push("/agent/dashboard")} className="px-4 py-2 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-xs">
              Return to Dashboard
            </button>
          </div>
        ) : (
          <>
            <h1 className="font-display font-bold text-xl text-[var(--color-red)] mb-2">I Feel Unsafe</h1>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">
              Pressing this button will immediately stop your field activity and alert your coordinator. You should leave the area if you feel at risk.
            </p>

            <div className="space-y-3 mb-8">
              {[
                "Your assignment will be released",
                "Your coordinator will be alerted",
                "You should leave the area safely",
                "Your safety is more important than any report",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 text-sm text-[var(--color-text-muted)]">
                  <span className="text-[var(--color-red)] mt-0.5">•</span>
                  {item}
                </div>
              ))}
            </div>

            <button
              onClick={handleEmergencyStop}
              className="w-full py-4 bg-[var(--color-red)] text-white font-mono text-sm font-bold hover:bg-[var(--color-red)]/90 transition-colors"
            >
              EMERGENCY STOP
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default AgentSafety;
