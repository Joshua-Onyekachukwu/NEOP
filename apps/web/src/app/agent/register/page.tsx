"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

interface StateOption { id: string; name: string; code: string; }
interface LgaOption { id: string; name: string; }
interface WardOption { id: string; name: string; code: string; }
interface PuOption { id: string; official_code: string; name: string; }

const AgentRegister: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [states, setStates] = useState<StateOption[]>([]);
  const [lgas, setLgas] = useState<LgaOption[]>([]);
  const [wards, setWards] = useState<WardOption[]>([]);
  const [pus, setPus] = useState<PuOption[]>([]);

  const [selectedState, setSelectedState] = useState("");
  const [selectedLga, setSelectedLga] = useState("");
  const [selectedWard, setSelectedWard] = useState("");
  const [selectedPu, setSelectedPu] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    supabase.from("states").select("id, name, code").order("name").then(({ data }) => {
      if (data) setStates(data);
    });
  }, []);

  useEffect(() => {
    if (!selectedState) { setLgas([]); return; }
    supabase.from("lgas").select("id, name").eq("state_id", selectedState).order("name").then(({ data }) => {
      if (data) setLgas(data);
    });
  }, [selectedState]);

  useEffect(() => {
    if (!selectedLga) { setWards([]); return; }
    supabase.from("wards").select("id, name, code").eq("lga_id", selectedLga).order("name").then(({ data }) => {
      if (data) setWards(data);
    });
  }, [selectedLga]);

  useEffect(() => {
    if (!selectedWard) { setPus([]); return; }
    supabase.from("polling_units").select("id, official_code, name").eq("ward_id", selectedWard).order("official_code").then(({ data }) => {
      if (data) setPus(data);
    });
  }, [selectedWard]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPu) { setError("Select a polling unit"); return; }

    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/agent/login"); return; }

      // Create user account if not exists
      await supabase.from("user_accounts").upsert({
        id: session.user.id,
        email: session.user.email,
        full_name: session.user.user_metadata?.full_name || session.user.email,
        avatar_url: session.user.user_metadata?.avatar_url,
        auth_provider: "google",
      });

      // Create volunteer profile
      const { error: volError } = await supabase.from("volunteers").upsert({
        user_id: session.user.id,
        status: "REGISTERED",
        phone: phone || null,
        state_id: selectedState || null,
        lga_id: selectedLga || null,
        selected_polling_unit_id: selectedPu,
        verification_status: "NOT_REQUESTED",
        training_status: "NOT_STARTED",
      });

      if (volError) {
        setError("Failed to create profile. You may already be registered.");
        setLoading(false);
        return;
      }

      router.push("/agent/onboarding");
    } catch {
      setError("An error occurred");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="font-display font-bold text-2xl text-[var(--color-text)] mb-1">
            NG<span className="text-[var(--color-green)]">EO</span>
          </div>
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">
            Volunteer Registration
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[var(--color-red-dim)] border border-[var(--color-red)] text-[var(--color-red-bright)] text-xs font-mono">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
              State
            </label>
            <select
              value={selectedState}
              onChange={(e) => { setSelectedState(e.target.value); setSelectedLga(""); setSelectedWard(""); setSelectedPu(""); }}
              className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)]"
            >
              <option value="">Select state</option>
              {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
              LGA
            </label>
            <select
              value={selectedLga}
              onChange={(e) => { setSelectedLga(e.target.value); setSelectedWard(""); setSelectedPu(""); }}
              disabled={!selectedState}
              className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)] disabled:opacity-40"
            >
              <option value="">Select LGA</option>
              {lgas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
              Ward
            </label>
            <select
              value={selectedWard}
              onChange={(e) => { setSelectedWard(e.target.value); setSelectedPu(""); }}
              disabled={!selectedLga}
              className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)] disabled:opacity-40"
            >
              <option value="">Select ward</option>
              {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
              Polling Unit
            </label>
            <select
              value={selectedPu}
              onChange={(e) => setSelectedPu(e.target.value)}
              disabled={!selectedWard}
              className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)] disabled:opacity-40"
            >
              <option value="">Select polling unit</option>
              {pus.map((p) => <option key={p.id} value={p.id}>{p.official_code} — {p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
              Phone (optional)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+234..."
              className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)]"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !selectedPu}
            className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
          >
            {loading ? "Registering…" : "Register"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <a href="/agent/login" className="font-mono text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors">
            Already registered? Sign in
          </a>
        </div>
      </div>
    </div>
  );
};

export default AgentRegister;
