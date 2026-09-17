import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ── Session cookie bridge ──────────────────────────────────────
//
// The edge middleware (apps/web/middleware.ts) gates /admin/* and the
// protected /agent/* pages on a REAL session, read from the
// `sb-<project-ref>-auth-token` cookie. supabase-js v2 keeps its session in
// localStorage only, and nothing was writing that cookie — so every
// authenticated request to /admin/dashboard was redirected straight back to
// /admin/login. Admins could authenticate successfully and still never reach
// the console (the login button simply sat on "Signing in…" because the
// redirect was swallowed).
//
// Mirrors the same JSON shape the middleware parses
// ({ access_token, expires_at, user }) and keeps it in step with the auth
// state. The token is already stored client-side by supabase-js, so this adds
// no new exposure; authorisation itself is still enforced server-side by
// requireAdmin() (Bearer token + admin_users lookup) — the cookie only proves
// "a session exists" to the middleware.

const AUTH_COOKIE = (() => {
  if (!supabaseUrl) return null;
  try {
    const host = new URL(supabaseUrl).hostname;
    // supabase-js keys storage on the first hostname label for <ref>.supabase.co
    const ref = host.split('.')[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
})();

function writeSessionCookie(session: Session | null) {
  if (typeof document === 'undefined' || !AUTH_COOKIE) return;
  try {
    if (!session?.access_token) {
      document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
      return;
    }
    const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + 3600;
    const maxAge = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
    const payload = encodeURIComponent(
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: expiresAt,
        user: { id: session.user?.id },
      })
    );
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${AUTH_COOKIE}=${payload}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    // Never let cookie mirroring break auth itself.
  }
}

// Build the client eagerly when env vars are present (normal runtime).
// When they are missing (e.g. a prerender/build context without env vars),
// export a proxy that throws only if code actually touches the client —
// importing this module can never crash a build, only real usage can.
const client =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

if (client && typeof window !== 'undefined') {
  // Seed from any session restored before this module loaded...
  void client.auth.getSession().then(({ data }) => writeSessionCookie(data.session ?? null));
  // ...then stay in step with sign-in, sign-out and token refreshes.
  client.auth.onAuthStateChange((_event, session) => writeSessionCookie(session));
}

export const supabase: SupabaseClient = new Proxy(
  (client ?? {}) as SupabaseClient,
  {
    get(_target, prop) {
      if (!client) throw new Error('Missing Supabase environment variables');
      return (client as any)[prop];
    },
  }
);
