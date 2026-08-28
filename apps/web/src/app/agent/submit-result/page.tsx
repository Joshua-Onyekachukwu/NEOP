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

const SubmitResult: React.FC = () => {
  const router = useRouter();
  const [step, setStep] = useState<"photo" | "numbers" | "review">("photo");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [partyVotes, setPartyVotes] = useState<PartyVote[]>([]);
  const [rejectedVotes, setRejectedVotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch parties from database
  useEffect(() => {
    const fetchParties = async () => {
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
        // Fallback if no parties in DB
        setPartyVotes([
          { party_id: "1", party_name: "All Progressives Congress", abbreviation: "APC", votes: "", color: "#00A859" },
          { party_id: "2", party_name: "Peoples Democratic Party", abbreviation: "PDP", votes: "", color: "#0000FF" },
          { party_id: "3", party_name: "Labour Party", abbreviation: "LP", votes: "", color: "#00FF00" },
          { party_id: "4", party_name: "New Nigeria Peoples Party", abbreviation: "NNPP", votes: "", color: "#FF0000" },
        ]);
      }
    };
    fetchParties();
  }, []);

  const validVotes = partyVotes.reduce((sum, pv) => sum + (parseInt(pv.votes) || 0), 0);
  const rejected = parseInt(rejectedVotes) || 0;
  const totalVotes = validVotes + rejected;
  const isValid = validVotes > 0 && partyVotes.every((pv) => pv.votes !== "");

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
    if (!isValid) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/agent/login"); return; }

      const { data: volunteer } = await supabase
        .from("volunteers").select("id").eq("user_id", session.user.id).single();
      if (!volunteer) { setError("Profile not found"); setIsSubmitting(false); return; }

      const { data: assignment } = await supabase
        .from("agent_assignments")
        .select("id, polling_unit_id, election_id")
        .eq("volunteer_id", volunteer.id)
        .eq("status", "CHECKED_IN")
        .single();
      if (!assignment) { setError("No active assignment. Check in first."); setIsSubmitting(false); return; }

      // Upload photo
      let evidenceId = null;
      if (photoFile) {
        const filePath = `evidence/${assignment.election_id}/${assignment.polling_unit_id}/${Date.now()}`;
        const { data: uploadData } = await supabase.storage.from("evidence").upload(filePath, photoFile);
        if (uploadData) {
          const { data: ev } = await supabase.from("evidence_records").insert({
            parent_type: "RESULT_SUBMISSION",
            parent_id: "pending",
            election_id: assignment.election_id,
            polling_unit_id: assignment.polling_unit_id,
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

      // Submit result
      const idempotencyKey = crypto.randomUUID();
      const { data: resultData, error: resultError } = await supabase
        .from("result_submissions")
        .insert({
          election_id: assignment.election_id,
          polling_unit_id: assignment.polling_unit_id,
          volunteer_id: volunteer.id,
          assignment_id: assignment.id,
          valid_votes: validVotes,
          rejected_votes: rejected,
          total_votes: totalVotes,
          status: "UNVERIFIED",
          idempotency_key: idempotencyKey,
        })
        .select()
        .single();

      if (resultError) { setError("Failed to submit. Try again."); setIsSubmitting(false); return; }

      // Insert party results
      const pr = partyVotes.map((pv) => ({
        result_submission_id: resultData.id,
        party_id: pv.party_id,
        votes: parseInt(pv.votes),
      }));
      await supabase.from("party_results").insert(pr);

      // Link evidence
      if (evidenceId) {
        await supabase.from("evidence_records").update({ parent_id: resultData.id }).eq("id", evidenceId);
      }

      // Audit
      await supabase.from("audit_log").insert({
        actor_id: volunteer.id,
        actor_type: "VOLUNTEER",
        action: "RESULT_SUBMITTED",
        resource_type: "result_submissions",
        resource_id: resultData.id,
        metadata: JSON.stringify({ valid_votes: validVotes, rejected_votes: rejected, total_votes: totalVotes }),
      });

      router.push("/agent/dashboard");
    } catch {
      setError("Unexpected error");
      setIsSubmitting(false);
    }
  };

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
                <button onClick={() => { setPhotoPreview(null); setPhotoFile(null); }} className="absolute top-2 right-2 px-2 py-0.5 bg-[var(--color-red)] text-white text-[10px] font-mono" aria-label="Remove photo">
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
            <p className="text-sm text-[var(--color-text-muted)] mb-4">As shown on the result sheet.</p>

            <div className="space-y-2 mb-4">
              {partyVotes.map((pv, i) => (
                <div key={pv.party_id} className="flex items-center gap-2 p-2 border border-[var(--color-gray-100)]">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: pv.color }} />
                  <span className="font-mono text-xs text-[var(--color-text-muted)] w-12">{pv.abbreviation}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pv.votes}
                    onChange={(e) => handleVoteChange(i, e.target.value)}
                    placeholder="0"
                    aria-label={`${pv.party_name} votes`}
                    className="flex-1 px-2 py-1.5 bg-transparent border-b border-[var(--color-gray-200)] text-right font-mono text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-green)] focus-visible:ring-1 focus-visible:ring-[var(--color-green)]"
                  />
                </div>
              ))}

              <div className="flex items-center gap-2 p-2 border border-[var(--color-gray-100)] mt-2">
                <span className="font-mono text-xs text-[var(--color-text-muted)] w-12">REJ</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={rejectedVotes}
                  onChange={(e) => { if (e.target.value === "" || /^\d+$/.test(e.target.value)) setRejectedVotes(e.target.value); }}
                  placeholder="0"
                  aria-label="Rejected votes"
                  className="flex-1 px-2 py-1.5 bg-transparent border-b border-[var(--color-gray-200)] text-right font-mono text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-green)] focus-visible:ring-1 focus-visible:ring-[var(--color-green)]"
                />
              </div>
            </div>

            {/* Totals */}
            <div className="p-2 bg-[var(--color-ink-light)] border border-[var(--color-gray-100)] mb-4 font-mono text-xs space-y-1">
              <div className="flex justify-between"><span className="text-[var(--color-text-dim)]">Valid</span><span className="text-[var(--color-text-muted)]">{validVotes.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-text-dim)]">Rejected</span><span className="text-[var(--color-text-muted)]">{rejected.toLocaleString()}</span></div>
              <div className="flex justify-between border-t border-[var(--color-gray-100)] pt-1"><span className="text-[var(--color-text)] font-bold">Total</span><span className="text-[var(--color-text)] font-bold">{totalVotes.toLocaleString()}</span></div>
            </div>

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

            <div className="border border-[var(--color-gray-100)] p-3 mb-4">
              <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase mb-2">Votes</div>
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

            <div className="flex gap-2">
              <button onClick={() => setStep("numbers")} className="flex-1 py-2.5 border border-[var(--color-gray-200)] text-[var(--color-text-muted)] font-mono text-xs">Back</button>
              <button onClick={handleSubmit} disabled={isSubmitting || !isValid} className="flex-1 py-2.5 bg-[var(--color-green)] text-white font-mono text-xs font-bold disabled:opacity-40">
                {isSubmitting ? "Submitting…" : "SUBMIT"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubmitResult;
