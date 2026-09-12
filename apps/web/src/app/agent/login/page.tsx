"use client";

import React, { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";

const AgentLogin: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-display font-bold text-2xl text-[var(--color-text)] mb-1">
            NG<span className="text-[var(--color-green)]">EO</span>
          </div>
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">
            Agent Portal
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[var(--color-red-dim)] border border-[var(--color-red)] text-[var(--color-red-bright)] text-xs font-mono" role="alert" aria-live="assertive">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in with Google"}
        </button>

        <div className="mt-6 text-center">
          <Link href="/" className="font-mono text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AgentLogin;
