"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";

interface PartyVote {
  party_id: string;
  party_name: string;
  abbreviation: string;
  votes: string;
  color: string;
}

interface AssignmentInfo {
  polling_unit_name: string;
  polling_unit_code: string;
  registered_voters: number | null;
  state_name: string;
  lga_name: string;
  ward_name: string;
  election_name: string;
  observer_number: number;
}

const SubmitResult: React.FC = () => {
  const router = useRouter();
  const [step, setStep] = useState<"photo" | "numbers" | "review">("photo");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [partyVotes, setPartyVotes] = useState<PartyVote[]>([]);
  const [rejectedVotes, setRejectedVotes] = useState("");
  const [registeredVoters, setRegisteredVoters] = useState("");
  const [accreditedVoters, setAccreditedVoters] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentInfo | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);

  // Fetch assignment context and parties
  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Get volunteer
      const { data: volunteer } = await supabase
        .from("volunteers").select("id").eq("user_id", session.user.id).single();
      if (!volunteer) return;

      // Get active assignment
      const { data: a } = await supabase
        .from("agent_assignments")
        .select(`
          id, observer_number,
          polling_units ( name, official_code, registered_voters, states ( name ), lgas ( name ), wards ( name ) ),
          elections ( name )
        `)
        .eq("volunteer_id", volunteer.id)
        .eq("status", "CHECKED_IN")
        .single();

      if (a) {
        const pu = a.polling_units as any;
        setAssignmentId(a.id);
        setAssignment({
          polling_unit_name: pu?.name || "—",
          polling_unit_code: pu?.official_code || "—",
          registered_voters: pu?.registered_voters || null,
          state_name: pu?.states?.name || "—",
          lga_name: pu?.lgas?.name || "—",
          ward_name: pu?.wards?.name || "—",
          election_name: (a.elections as any)?.name || "—",
          observer_number: a.observer_number,
        });
        if (pu?.registered_voters) {
          setRegisteredVoters(String(pu.registered_voters));
        }
      }

      // Fetch parties from database
      const { data } = await supabase
        .from("parties")
        .select("id, official_name, abbreviation, color")
        .eq("status", "ACTIVE")
        .order("abbreviation");

      if (data && data.length > 0) {
        setPartyVotes(data.map((p) => ({
          party_id: p.id,
          party_name: p.official_name,
          abbreviation: p.abbreviation || "?",
          votes: "",
          color: p.color || "#6B7280",
        })));
      } else {
        // Fallback
        setPartyVotes([
          { party_id: "1", party_name: "All Progressives Congress", abbreviation: "APC", votes: "", color: "#00A859" },
          { party_id: "2", party_name: "Peoples Democratic Party", abbreviation: "PDP", votes: "", color: "#0000FF" },
          { party_id: "3", party_name: "Labour Party", abbreviation: "LP", votes: "", color: "#FF0000" },
          { party_id: "4", party_name: "New Nigeria Peoples Party", abbreviation: "NNPP", votes: "", color: "#E53935" },
          { party_id: "5", party_name: "Nigeria Democratic Congress", abbreviation: "NDC", votes: "", color: "#1B5E20" },
          { party_id: "6", party_name: "All Progressives Grand Alliance", abbreviation: "APGA", votes: "", color: "#FFD600" },
          { party_id: "7", party_name: "Social Democratic Party", abbreviation: "SDP", votes: "", color: "#1565C0" },
          { party_id: "8", party_name: "Young Progressives Party", abbreviation: "YPP", votes: "", color: "#6A1B9A" },
          { party_id: "9", party_name: "African Democratic Congress", abbreviation: "ADC", votes: "", color: "#00838F" },
        ]);
      }
    };
    fetchData();
  }, []);

  // ── Computed values ──
  const validVotes = partyVotes.reduce((sum, pv) => sum + (parseInt(pv.votes) || 0), 0);
  const rejected = parseInt(rejectedVotes) || 0;
  const totalVotes = validVotes + rejected;
  const regVoters = parseInt(registeredVoters) || 0;
  const accVoters = parseInt(accreditedVoters) || 0;

  // Validation
  const validationErrors: string[] = [];
  if (totalVotes > 0 && regVoters > 0 && totalVotes > regVoters) {
    validationErrors.push("Total votes cannot exceed registered voters");
  }
  if (accVoters > 0 && totalVotes > accVoters) {
    validationErrors.push("Total votes cannot exceed accredited voters");
  }
  if (accVoters > 0 && regVoters > 0 && accVoters > regVoters) {
    validationErrors.push("Accredited voters cannot exceed registered voters");
  }
  const allPartiesFilled = partyVotes.every((pv) => pv.votes !== "");
  const isValid = validVotes > 0 && allPartiesFilled && validationErrors.length === 0;

  const handlePhotoCapture = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.capture = "environment";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setPhotoFile(file);
        const reader = new FileReader();
        reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const handleVoteChange = (index: number, value: string) => {
    if (value !== "" && !/^\d+$/.test(value)) return;
    setPartyVotes((prev) => prev.map((pv, i) => i === index ? { ...pv, votes: value } : pv));
  };

  const handleSubmit = async () => {
    if (!isValid || !assignmentId) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/agent/login"); return; }

      const { data: volunteer } = await supabase
        .from("volunteers").select("id").eq("user_id", session.user.id).single();
      if (!volunteer) { setError("Profile not found"); setIsSubmitting(false); return; }

      const { data: assignmentData } = await supabase
        .from("agent_assignments")
        .select("id, polling_unit_id, election_id")
        .eq("id", assignmentId)
        .single();
      if (!assignmentData) { setError("No active assignment"); setIsSubmitting(false); return; }

      // Upload photo
      let evidenceId = null;
      if (photoFile) {
        const filePath = `evidence/${assignmentData.election_id}/${assignmentData.polling_unit_id}/${Date.now()}`;
        const { data: uploadData } = await supabase.storage.from("evidence").upload(filePath, photoFile);
        if (uploadData) {
          const { data: ev } = await supabase.from("evidence_records").insert({
            parent_type: "RESULT_SUBMISSION",
            parent_id: "pending",
            election_id: assignmentData.election_id,
            polling_unit_id: assignmentData.polling_unit_id,
            volunteer_id: volunteer.id,
            file_id: uploadData.path,
            sha256_hash: "pending",
            mime_type: photoFile.type,
            file_size_bytes: photoFile.size,
            captured_at: new Date().toISOString(),
            is_public: false,
            access_level: "ADMIN_ONLY",
          }).select().single();
          if (ev) evidenceId = ev.id;
        }
      }

      // Submit result via API
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      const res = await fetch("/api/me/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${freshSession?.access_token}`,
        },
        body: JSON.stringify({
          assignment_id: assignmentId,
          valid_votes: validVotes,
          rejected_votes: rejected,
          party_results: Object.fromEntries(partyVotes.map(pv => [pv.abbreviation, parseInt(pv.votes) || 0])),
          idempotency_key: crypto.randomUUID(),
          registered_voters: regVoters || undefined,
          accredited_voters: accVoters || undefined,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Failed to submit");
        setIsSubmitting(false);
        return;
      }

      // Link evidence
      if (evidenceId && result.id) {
        await supabase.from("evidence_records").update({ parent_id: result.id }).eq("id", evidenceId);
      }

      router.push("/agent/dashboard");
    } catch {
      setError("Unexpected error");
      setIsSubmitting(false);
    }
  };

  if (!assignment) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="font-mono text-sm text-[var(--color-text-dim)] mb-2">No active assignment</div>
          <Link href="/agent/dashboard" className="font-mono text-xs text-[var(--color-green)]">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--color-gray-100)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/agent/dashboard" className="font-mono text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]">
            ← Back
          </Link>
          <span className="font-display font-semibold text-sm text-[var(--color-text)]">Submit Result</span>
        </div>
      </header>

      {/* Assignment Context Bar */}
      <div className="border-b border-[var(--color-gray-100)] bg-[var(--color-ink-light)] px-4 py-2">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <div className="font-mono text-xs font-bold text-[var(--color-text)]">
              {assignment.polling_unit_code} — {assignment.polling_unit_name}
            </div>
            <div className="font-mono text-[10px] text-[var(--color-text-dim)]">
              {assignment.ward_name}, {assignment.lga_name}, {assignment.state_name}
            </div>
          </div>
          {assignment.registered_voters && (
            <div className="text-right">
              <div className="font-mono text-[10px] text-[var(--color-text-dim)]">REGISTERED</div>
              <div className="font-mono text-xs font-bold text-[var(--color-text)]">{assignment.registered_voters.toLocaleString()}</div>
            </div>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="border-b border-[var(--color-gray-100)] px-4 py-2">
        <div className="max-w-lg mx-auto flex items-center justify-center gap-2 font-mono text-[10px]">
          {["photo", "numbers", "review"].map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <span className="text-[var(--color-text-dim)]">→</span>}
              <span className={`px-2 py-0.5 ${
                step === s ? "bg-[var(--color-green)] text-white" :
                (["numbers", "review"].indexOf(step) >= i) ? "text-[var(--color-green-bright)]" :
                "text-[var(--color-text-dim)]"
              }`}>
                {i + 1} {s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 bg-[var(--color-red-dim)] border border-[var(--color-red)] text-[var(--color-red-bright)] text-xs font-mono max-w-lg mx-auto">
          {error}
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Step 1: Photo */}
        {step === "photo" && (
          <div>
            <h2 className="font-display font-bold text-lg text-[var(--color-text)] mb-2">Photograph Result Sheet</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">Clear photo of the Form EC8A helps verify your numbers.</p>

            {photoPreview ? (
              <div className="relative mb-4">
                <img src={photoPreview} alt="Result sheet" width={800} height={600} className="w-full border border-[var(--color-gray-200)]" />
                <button onClick={() => { setPhotoPreview(null); setPhotoFile(null); }} className="absolute top-2 right-2 px-2 py-0.5 bg-[var(--color-red)] text-white text-[10px] font-mono">
                  Remove
                </button>
              </div>
            ) : (
              <button onClick={handlePhotoCapture} className="w-full flex flex-col items-center justify-center py-12 border border-dashed border-[var(--color-gray-200)] hover:border-[var(--color-green)] transition-colors mb-4">
                <span className="text-2xl mb-2">📷</span>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">Tap to photograph</span>
              </button>
            )}

            <button onClick={() => setStep("numbers")} className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors">
              {photoPreview ? "Continue" : "Skip Photo"}
            </button>
          </div>
        )}

        {/* Step 2: Numbers */}
        {step === "numbers" && (
          <div>
            <h2 className="font-display font-bold text-lg text-[var(--color-text)] mb-2">Enter Vote Counts</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">As shown on the result sheet. All party fields are required.</p>

            {/* Voter Totals Section */}
            <div className="mb-4 p-3 border border-[var(--color-gray-100)] bg-[var(--color-ink-light)]">
              <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Voter Figures</div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-mono text-[10px] text-[var(--color-text-dim)]">Registered</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*"
                    value={registeredVoters}
                    onChange={(e) => { if (e.target.value === "" || /^\d+$/.test(e.target.value)) setRegisteredVoters(e.target.value); }}
                    placeholder="0"
                    className="w-full px-2 py-1.5 bg-transparent border-b border-[var(--color-gray-200)] font-mono text-xs text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-green)]"
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] text-[var(--color-text-dim)]">Accredited</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*"
                    value={accreditedVoters}
                    onChange={(e) => { if (e.target.value === "" || /^\d+$/.test(e.target.value)) setAccreditedVoters(e.target.value); }}
                    placeholder="0"
                    className="w-full px-2 py-1.5 bg-transparent border-b border-[var(--color-gray-200)] font-mono text-xs text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-green)]"
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] text-[var(--color-text-dim)]">Rejected</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*"
                    value={rejectedVotes}
                    onChange={(e) => { if (e.target.value === "" || /^\d+$/.test(e.target.value)) setRejectedVotes(e.target.value); }}
                    placeholder="0"
                    className="w-full px-2 py-1.5 bg-transparent border-b border-[var(--color-gray-200)] font-mono text-xs text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-green)]"
                  />
                </div>
              </div>
            </div>

            {/* Party Votes */}
            <div className="space-y-2 mb-4">
              {partyVotes.map((pv, i) => (
                <div key={pv.party_id} className="flex items-center gap-2 p-2 border border-[var(--color-gray-100)]">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: pv.color }} />
                  <span className="font-mono text-xs text-[var(--color-text-muted)] w-12">{pv.abbreviation}</span>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*"
                    value={pv.votes}
                    onChange={(e) => handleVoteChange(i, e.target.value)}
                    placeholder="0"
                    aria-label={`${pv.party_name} votes`}
                    className="flex-1 px-2 py-1.5 bg-transparent border-b border-[var(--color-gray-200)] text-right font-mono text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-green)] focus-visible:ring-1 focus-visible:ring-[var(--color-green)]"
                  />
                </div>
              ))}
            </div>

            {/* Computed Totals */}
            <div className="p-3 bg-[var(--color-ink-light)] border border-[var(--color-gray-100)] mb-3 font-mono text-xs space-y-1">
              <div className="flex justify-between"><span className="text-[var(--color-text-dim)]">Party Total</span><span className="text-[var(--color-text-muted)]">{validVotes.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-text-dim)]">Rejected</span><span className="text-[var(--color-text-muted)]">{rejected.toLocaleString()}</span></div>
              <div className="flex justify-between border-t border-[var(--color-gray-100)] pt-1">
                <span className="text-[var(--color-text)] font-bold">Total Votes Cast</span>
                <span className="text-[var(--color-text)] font-bold">{totalVotes.toLocaleString()}</span>
              </div>
              {regVoters > 0 && (
                <>
                  <div className="flex justify-between"><span className="text-[var(--color-text-dim)]">Registered Voters</span><span className="text-[var(--color-text-muted)]">{regVoters.toLocaleString()}</span></div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-dim)]">Turnout</span>
                    <span className="text-[var(--color-text-muted)]">{regVoters > 0 ? ((totalVotes / regVoters) * 100).toFixed(1) : "0"}%</span>
                  </div>
                </>
              )}
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div className="p-3 bg-[var(--color-red)]/10 border border-[var(--color-red)]/30 mb-3">
                {validationErrors.map((err, i) => (
                  <div key={i} className="font-mono text-[10px] text-[var(--color-red)]">⚠ {err}</div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep("photo")} className="flex-1 py-2.5 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-xs hover:bg-[var(--color-ink-light)]">Back</button>
              <button onClick={() => setStep("review")} disabled={!isValid} className="flex-1 py-2.5 bg-[var(--color-green)] text-white font-mono text-xs font-bold disabled:opacity-40">Review</button>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === "review" && (
          <div>
            <h2 className="font-display font-bold text-lg text-[var(--color-text)] mb-2">Review & Submit</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">Cannot undo after submission.</p>

            {photoPreview && (
              <div className="mb-4">
                <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-1">Photo</div>
                <img src={photoPreview} alt="Result sheet" width={800} height={600} className="w-full border border-[var(--color-gray-200)]" />
              </div>
            )}

            {/* Assignment Summary */}
            <div className="border border-[var(--color-gray-100)] p-3 mb-3">
              <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-2">Polling Unit</div>
              <div className="font-mono text-xs text-[var(--color-text)] font-bold">{assignment.polling_unit_code} — {assignment.polling_unit_name}</div>
              <div className="font-mono text-[10px] text-[var(--color-text-dim)]">{assignment.ward_name}, {assignment.lga_name}</div>
            </div>

            {/* Party Results */}
            <div className="border border-[var(--color-gray-100)] p-3 mb-3">
              <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-2">Party Results</div>
              <div className="space-y-1">
                {partyVotes.map((pv) => (
                  <div key={pv.party_id} className="flex justify-between font-mono text-xs">
                    <span className="text-[var(--color-text-muted)]">{pv.abbreviation}</span>
                    <span className="text-[var(--color-text)] font-bold">{parseInt(pv.votes || "0").toLocaleString()}</span>
                  </div>
                ))}
                <div className="border-t border-[var(--color-gray-100)] pt-1 mt-1">
                  <div className="flex justify-between font-mono text-xs"><span className="text-[var(--color-text-dim)]">Rejected</span><span className="text-[var(--color-text-muted)]">{rejected.toLocaleString()}</span></div>
                  <div className="flex justify-between font-mono text-xs font-bold"><span className="text-[var(--color-text)]">Total</span><span className="text-[var(--color-text)]">{totalVotes.toLocaleString()}</span></div>
                </div>
              </div>
            </div>

            {/* Voter Figures Summary */}
            {(regVoters > 0 || accVoters > 0) && (
              <div className="border border-[var(--color-gray-100)] p-3 mb-4">
                <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-2">Voter Figures</div>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  {regVoters > 0 && <div><span className="text-[var(--color-text-dim)]">Registered</span><div className="font-bold text-[var(--color-text)]">{regVoters.toLocaleString()}</div></div>}
                  {accVoters > 0 && <div><span className="text-[var(--color-text-dim)]">Accredited</span><div className="font-bold text-[var(--color-text)]">{accVoters.toLocaleString()}</div></div>}
                  <div><span className="text-[var(--color-text-dim)]">Turnout</span><div className="font-bold text-[var(--color-text)]">{regVoters > 0 ? ((totalVotes / regVoters) * 100).toFixed(1) : "—"}%</div></div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep("numbers")} className="flex-1 py-2.5 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-xs">Back</button>
              <button onClick={handleSubmit} disabled={isSubmitting || !isValid} className="flex-1 py-2.5 bg-[var(--color-green)] text-white font-mono text-xs font-bold disabled:opacity-40">
                {isSubmitting ? "Submitting…" : "SUBMIT REPORT"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubmitResult;
