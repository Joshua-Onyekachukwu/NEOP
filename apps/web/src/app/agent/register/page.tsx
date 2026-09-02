"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";

interface StateOption { id: string; name: string; code: string; }
interface LgaOption { id: string; name: string; }
interface WardOption { id: string; name: string; code: string; }
interface PuOption { id: string; official_code: string; name: string; registered_voters?: number; }
interface PuAvailability {
  available: boolean;
  assigned_count: number;
  max_observers: number;
  spots_remaining: number;
  agents: { observer_number: number; status: string; name: string; checked_in: boolean }[];
  alternatives?: { id: string; official_code: string; name: string; spots: number }[];
  message: string;
}

const STEPS = ["LOCATION", "PHONE", "VERIFY", "REVIEW"] as const;
type Step = typeof STEPS[number];

const AgentRegister: React.FC = () => {
  const router = useRouter();
  const [step, setStep] = useState<Step>("LOCATION");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Location state
  const [states, setStates] = useState<StateOption[]>([]);
  const [lgas, setLgas] = useState<LgaOption[]>([]);
  const [wards, setWards] = useState<WardOption[]>([]);
  const [pus, setPus] = useState<PuOption[]>([]);
  const [selectedState, setSelectedState] = useState("");
  const [selectedLga, setSelectedLga] = useState("");
  const [selectedWard, setSelectedWard] = useState("");
  const [selectedPu, setSelectedPu] = useState("");
  const [puAvailability, setPuAvailability] = useState<PuAvailability | null>(null);

  // Phone state
  const [phone, setPhone] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);

  // Assignment state
  const [assigning, setAssigning] = useState(false);
  const [assignmentResult, setAssignmentResult] = useState<any>(null);

  // Load states on mount
  useEffect(() => {
    supabase.from("states").select("id, name, code").order("name").then(({ data }) => {
      if (data) setStates(data);
    });
  }, []);

  // Load LGAs when state changes
  useEffect(() => {
    if (!selectedState) { setLgas([]); return; }
    supabase.from("lgas").select("id, name").eq("state_id", selectedState).order("name").then(({ data }) => {
      if (data) setLgas(data);
    });
  }, [selectedState]);

  // Load wards when LGA changes
  useEffect(() => {
    if (!selectedLga) { setWards([]); return; }
    supabase.from("wards").select("id, name, code").eq("lga_id", selectedLga).order("name").then(({ data }) => {
      if (data) setWards(data);
    });
  }, [selectedLga]);

  // Load PUs when ward changes
  useEffect(() => {
    if (!selectedWard) { setPus([]); return; }
    supabase.from("polling_units").select("id, official_code, name, registered_voters").eq("ward_id", selectedWard).order("official_code").then(({ data, error }) => {
      if (error) console.error("PU fetch error:", error.message);
      if (data) setPus(data);
    });
  }, [selectedWard]);

  // Check PU availability when PU changes
  useEffect(() => {
    if (!selectedPu) { setPuAvailability(null); return; }
    fetch(`/api/public/pu-availability?polling_unit_id=${selectedPu}`)
      .then(r => r.json())
      .then(data => setPuAvailability(data))
      .catch(() => setPuAvailability(null));
  }, [selectedPu]);

  // Send OTP
  const handleSendOtp = async () => {
    if (!phone) { setError("Enter your phone number"); return; }
    setOtpLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to send OTP");
        setOtpLoading(false);
        return;
      }

      setOtpSent(true);
      setStep("VERIFY");
      // For testing: show the OTP
      if (data._testOtp) {
        setSuccess(`Test OTP: ${data._testOtp}`);
      }
    } catch {
      setError("Network error sending OTP");
    } finally {
      setOtpLoading(false);
    }
  };

  // Verify OTP
  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    setOtpLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, token: otpCode }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Invalid OTP code");
        setOtpLoading(false);
        return;
      }

      setPhoneVerified(true);
      setStep("REVIEW");
    } catch {
      setError("Network error verifying OTP");
    } finally {
      setOtpLoading(false);
    }
  };

  // Final registration + auto-assign
  const handleRegister = async () => {
    if (!selectedPu) { setError("Select a polling unit"); return; }
    if (!phoneVerified) { setError("Verify your phone number"); return; }

    setLoading(true);
    setError(null);
    setAssigning(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/agent/login"); return; }

      // 1. Create user account
      await supabase.from("user_accounts").upsert({
        id: session.user.id,
        email: session.user.email,
        full_name: session.user.user_metadata?.full_name || session.user.email,
        avatar_url: session.user.user_metadata?.avatar_url,
        auth_provider: "google",
      });

      // 2. Create volunteer profile with phone and selected PU
      const { error: volError } = await supabase.from("volunteers").upsert({
        user_id: session.user.id,
        status: "REGISTERED",
        phone: phone,
        state_id: selectedState || null,
        lga_id: selectedLga || null,
        selected_polling_unit_id: selectedPu,
        verification_status: "PHONE_VERIFIED",
        training_status: "NOT_STARTED",
      });

      if (volError) {
        setError("Failed to create profile. You may already be registered.");
        setLoading(false);
        setAssigning(false);
        return;
      }

      // 3. Skip straight to onboarding — assignment happens after training
      setAssignmentResult({ message: "Registration successful! Complete training to get your assignment." });
      router.push("/agent/onboarding");
    } catch {
      setError("An error occurred during registration");
      setLoading(false);
      setAssigning(false);
    }
  };

  const selectedPuInfo = pus.find(p => p.id === selectedPu);
  const selectedStateInfo = states.find(s => s.id === selectedState);
  const selectedLgaInfo = lgas.find(l => l.id === selectedLga);
  const selectedWardInfo = wards.find(w => w.id === selectedWard);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="font-display font-bold text-2xl text-[var(--color-text)] mb-1">
            NG<span className="text-[var(--color-green)]">EO</span>
          </div>
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">
            Volunteer Registration
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-6">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1 ${
                STEPS.indexOf(step) >= i
                  ? "bg-[var(--color-green)]"
                  : "bg-[var(--color-gray-200)]"
              }`} />
              <div className={`font-mono text-[8px] mt-1 text-center ${
                step === s ? "text-[var(--color-green)]" : "text-[var(--color-text-dim)]"
              }`}>
                {s}
              </div>
            </div>
          ))}
        </div>

        {/* Errors / Success */}
        {error && (
          <div className="mb-4 p-3 bg-[var(--color-red-dim)] border border-[var(--color-red)] text-[var(--color-red-bright)] text-xs font-mono" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-[var(--color-green-dim)] border border-[var(--color-green)] text-[var(--color-green-bright)] text-xs font-mono">
            {success}
          </div>
        )}

        {/* STEP: LOCATION */}
        {step === "LOCATION" && (
          <div className="space-y-3">
            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">State</label>
              <select
                value={selectedState}
                onChange={(e) => { setSelectedState(e.target.value); setSelectedLga(""); setSelectedWard(""); setSelectedPu(""); }}
                className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)]"
              >
                <option value="">Select state</option>
                {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">LGA</label>
              <select
                value={selectedLga}
                onChange={(e) => { setSelectedLga(e.target.value); setSelectedWard(""); setSelectedPu(""); }}
                disabled={!selectedState}
                className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)] disabled:opacity-40"
              >
                <option value="">Select LGA</option>
                {lgas.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">Ward</label>
              <select
                value={selectedWard}
                onChange={(e) => { setSelectedWard(e.target.value); setSelectedPu(""); }}
                disabled={!selectedLga}
                className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)] disabled:opacity-40"
              >
                <option value="">Select ward</option>
                {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">Polling Unit</label>
              <select
                value={selectedPu}
                onChange={(e) => setSelectedPu(e.target.value)}
                disabled={!selectedWard}
                className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)] disabled:opacity-40"
              >
                <option value="">Select polling unit</option>
                {pus.map(p => (
                  <option key={p.id} value={p.id}>{p.official_code} — {p.name}</option>
                ))}
              </select>
            </div>

            {/* PU Details Card */}
            {selectedPu && selectedPuInfo && (
              <div className="p-3 border border-[var(--color-gray-200)] bg-[var(--color-ink-light)]">
                <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Polling Unit Details</div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-dim)]">Code</span>
                    <span className="font-mono text-[var(--color-text)]">{selectedPuInfo.official_code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-dim)]">Name</span>
                    <span className="font-mono text-[var(--color-text-muted)] text-right max-w-[60%]">{selectedPuInfo.name}</span>
                  </div>
                  {selectedPuInfo.registered_voters && (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Registered Voters</span>
                      <span className="font-mono text-[var(--color-text)]">
                        {selectedPuInfo.registered_voters.toLocaleString()}
                        <span className="text-[9px] text-[var(--color-text-dim)] ml-1">(est.)</span>
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-dim)]">Max Observers</span>
                    <span className="font-mono text-[var(--color-text)]">2</span>
                  </div>
                </div>
              </div>
            )}

            {/* PU Availability Warning */}
            {puAvailability && selectedPu && (
              <div className={`p-3 border text-xs font-mono ${
                puAvailability.available
                  ? "bg-[var(--color-green-dim)] border-[var(--color-green)]/30 text-[var(--color-green-bright)]"
                  : "bg-[var(--color-amber-dim)] border-[var(--color-amber)]/30 text-[var(--color-amber)]"
              }`}>
                <div className="font-bold mb-1">
                  {puAvailability.available ? "✓ SPOT AVAILABLE" : "⚠ PU FULL"}
                </div>
                <div>{puAvailability.message}</div>
                {puAvailability.agents.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {puAvailability.agents.map((a, i) => (
                      <div key={i} className="flex justify-between">
                        <span>Observer #{a.observer_number}: {a.name}</span>
                        <span className={a.checked_in ? "text-[var(--color-green-bright)]" : ""}>
                          {a.checked_in ? "CHECKED IN" : a.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {puAvailability.alternatives && puAvailability.alternatives.length > 0 && (
                  <div className="mt-2">
                    <div className="font-bold mb-1">Alternative PUs in your ward:</div>
                    {puAvailability.alternatives.map((alt: any) => (
                      <div key={alt.id} className="flex justify-between py-1 border-t border-[var(--color-amber)]/20">
                        <span>{alt.official_code} — {alt.name}</span>
                        <span>{alt.spots} spot(s)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => { if (selectedPu) setStep("PHONE"); }}
              disabled={!selectedPu}
              className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
            >
              Continue →
            </button>
          </div>
        )}

        {/* STEP: PHONE */}
        {step === "PHONE" && (
          <div className="space-y-4">
            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+234 801 234 5678"
                className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)]"
              />
              <div className="mt-1 font-mono text-[9px] text-[var(--color-text-dim)]">
                We&apos;ll send a verification code to confirm this is your number
              </div>
            </div>

            <div className="p-3 border border-[var(--color-gray-200)] bg-[var(--color-ink-light)]">
              <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Selected Location</div>
              <div className="text-sm text-[var(--color-text)]">
                {selectedPuInfo?.official_code} — {selectedPuInfo?.name}
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-1">
                {selectedWardInfo?.name}, {selectedLgaInfo?.name}, {selectedStateInfo?.name}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep("LOCATION")}
                className="px-4 py-3 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-sm hover:bg-[var(--color-ink-light)] transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleSendOtp}
                disabled={!phone || otpLoading}
                className="flex-1 py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
              >
                {otpLoading ? "Sending…" : "Send Verification Code"}
              </button>
            </div>
          </div>
        )}

        {/* STEP: VERIFY */}
        {step === "VERIFY" && (
          <div className="space-y-4">
            <div>
              <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                Enter 6-Digit Code
              </label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-3 py-3 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-2xl text-center tracking-[0.5em] focus:outline-none focus:border-[var(--color-green)]"
                autoFocus
              />
              <div className="mt-1 font-mono text-[9px] text-[var(--color-text-dim)] text-center">
                Code sent to {phone}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setStep("PHONE"); setOtpSent(false); }}
                className="px-4 py-3 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-sm hover:bg-[var(--color-ink-light)] transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleVerifyOtp}
                disabled={otpCode.length !== 6 || otpLoading}
                className="flex-1 py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
              >
                {otpLoading ? "Verifying…" : "Verify Code"}
              </button>
            </div>

            <button
              onClick={handleSendOtp}
              disabled={otpLoading}
              className="w-full py-2 text-[var(--color-green)] font-mono text-xs hover:underline"
            >
              Resend code
            </button>
          </div>
        )}

        {/* STEP: REVIEW */}
        {step === "REVIEW" && (
          <div className="space-y-4">
            <div className="p-4 border border-[var(--color-gray-200)] bg-[var(--color-ink-light)] space-y-3">
              <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">
                Registration Summary
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-dim)]">Phone</span>
                  <span className="font-mono text-[var(--color-green-bright)]">✓ {phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-dim)]">State</span>
                  <span className="font-mono text-[var(--color-text-muted)]">{selectedStateInfo?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-dim)]">LGA</span>
                  <span className="font-mono text-[var(--color-text-muted)]">{selectedLgaInfo?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-dim)]">Ward</span>
                  <span className="font-mono text-[var(--color-text-muted)]">{selectedWardInfo?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-dim)]">Polling Unit</span>
                  <span className="font-mono text-[var(--color-text)]">{selectedPuInfo?.official_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-dim)]">PU Name</span>
                  <span className="font-mono text-[var(--color-text-muted)] text-right max-w-[60%]">{selectedPuInfo?.name}</span>
                </div>
              </div>

              {puAvailability && (
                <div className={`pt-2 border-t text-xs font-mono ${
                  puAvailability.available
                    ? "border-[var(--color-green)]/20 text-[var(--color-green-bright)]"
                    : "border-[var(--color-amber)]/20 text-[var(--color-amber)]"
                }`}>
                  {puAvailability.available
                    ? `✓ ${puAvailability.spots_remaining} spot(s) available`
                    : `⚠ PU full — ${puAvailability.assigned_count}/${puAvailability.max_observers} agents`
                  }
                </div>
              )}
            </div>

            <div className="p-3 border border-[var(--color-green)]/20 bg-[var(--color-green-dim)] text-xs font-mono text-[var(--color-green-bright)]">
              After registration, complete training modules to receive your official assignment.
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep("PHONE")}
                className="px-4 py-3 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-sm hover:bg-[var(--color-ink-light)] transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleRegister}
                disabled={loading || assigning}
                className="flex-1 py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
              >
                {assigning ? "Creating Account…" : "Register"}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center">
          <Link href="/agent/login" className="font-mono text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors">
            Already registered? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AgentRegister;
