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

  // ── Email/Password Login ──
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

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError("Session error"); setLoading(false); return; }

    let { data: admin } = await supabase
      .from("admin_users").select("id").eq("user_id", session.user.id).eq("is_active", true).single();
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

  // ── Google OAuth Login ──
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
            Admin Console
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[var(--color-red-dim)] border border-[var(--color-red)] text-[var(--color-red-bright)] text-xs font-mono" role="alert" aria-live="assertive">
            {error}
          </div>
        )}

        {/* Google OAuth Button */}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full py-3 bg-white border border-[var(--color-gray-200)] text-[var(--color-text)] font-mono text-sm font-bold hover:bg-[var(--color-ink-light)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {loading ? "Signing in…" : "Sign in with Google"}
        </button>

        {/* Divider */}
        <div className="my-4 flex items-center gap-3">
          <div className="flex-1 h-px bg-[var(--color-gray-200)]" />
          <span className="font-mono text-[10px] text-[var(--color-text-dim)]">OR</span>
          <div className="flex-1 h-px bg-[var(--color-gray-200)]" />
        </div>

        {/* Email/Password Form */}
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
            {loading ? "Signing in…" : "Sign In with Email"}
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
