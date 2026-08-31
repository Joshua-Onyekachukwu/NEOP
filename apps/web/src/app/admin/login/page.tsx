"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";

const AdminLogin: React.FC = () => {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Check admin role — try client-side first, then server-side fallback
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError("Session error"); setLoading(false); return; }

    // Try client-side RLS query first
    let { data: admin } = await supabase
      .from("admin_users").select("id").eq("user_id", session.user.id).eq("is_active", true).single();      // Fallback to server-side check (bypasses RLS)
    if (!admin) {
      try {
        const checkRes = await fetch("/api/admin/check-auth", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const checkData = await checkRes.json();
        if (checkData.isAdmin) admin = { id: "server-verified" };
      } catch { /* server check failed */ }
    }

    if (!admin) {
      await supabase.auth.signOut();
      setError("Not authorized as admin");
      setLoading(false);
      return;
    }

    router.push("/admin/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-display font-bold text-2xl text-[var(--color-text)] mb-1">
            NG<span className="text-[var(--color-green)]">EO</span>
          </div>
          <div className="font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">
            Admin Console
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[var(--color-red-dim)] border border-[var(--color-red)] text-[var(--color-red-bright)] text-xs font-mono" role="alert" aria-live="assertive">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">Email</label>
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              spellCheck={false}
              required
              className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)]"
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">Password</label>
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full px-3 py-2.5 bg-[var(--color-ink-light)] border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm focus:outline-none focus:border-[var(--color-green)]"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link href="/" className="font-mono text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
