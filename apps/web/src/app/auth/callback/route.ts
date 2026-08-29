/**
 * GET /auth/callback
 *
 * Handles the OAuth callback from Google → Supabase.
 * Two flows:
 *  1. PKCE flow: `?code=xxx` in query params → exchange server-side
 *  2. Implicit flow: `#access_token=xxx` in hash fragment → return HTML that
 *     extracts tokens client-side (hash fragments are never sent to the server)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const redirectTo = searchParams.get("redirect_to")?.toString();

  // ── PKCE flow: server-side code exchange ──
  if (code) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Auth callback error:", error.message);
      return NextResponse.redirect(
        `${origin}/auth/auth-code-error?error=${encodeURIComponent(error.message)}`
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const redirectPath = await resolveRedirect(supabase, user.id);
      return NextResponse.redirect(`${origin}${redirectPath}`);
    }

    if (redirectTo) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  // ── Implicit flow: tokens in hash fragment ──
  // Hash fragments are never sent to the server, so we return a tiny
  // HTML page that extracts them client-side and stores the session.
  return new NextResponse(
    `<!DOCTYPE html>
<html>
<head><title>Signing in…</title></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui;background:#0a0e19;color:#fff;">
  <div style="text-align:center;">
    <div style="font-size:24px;margin-bottom:12px;">⏳</div>
    <div style="font-size:14px;opacity:0.7;">Completing sign-in…</div>
    <div id="status" style="font-size:12px;opacity:0.5;margin-top:8px;"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script>
    (async function() {
      var status = document.getElementById('status');
      try {
        var hash = window.location.hash.substring(1);
        if (!hash) {
          status.textContent = 'No tokens found';
          return;
        }
        var params = new URLSearchParams(hash);
        var access_token = params.get('access_token');
        var refresh_token = params.get('refresh_token');
        var expires_in = params.get('expires_in');

        if (!access_token) {
          var errorParam = params.get('error') || params.get('error_description');
          if (errorParam) {
            status.textContent = 'Auth error: ' + decodeURIComponent(errorParam);
            setTimeout(function() { window.location.href = '${origin}/auth/auth-code-error?error=' + encodeURIComponent(errorParam); }, 2000);
            return;
          }
          status.textContent = 'No access token found';
          return;
        }

        status.textContent = 'Setting session…';

        var supabase = window.supabase.createClient(
          '${supabaseUrl}',
          '${supabaseAnonKey}'
        );

        var result = await supabase.auth.setSession({
          access_token: access_token,
          refresh_token: refresh_token,
          expires_in: expires_in ? parseInt(expires_in) : 3600
        });

        if (result.error) {
          status.textContent = 'Session error: ' + result.error.message;
          setTimeout(function() { window.location.href = '${origin}/auth/auth-code-error?error=' + encodeURIComponent(result.error.message); }, 2000);
          return;
        }

        status.textContent = 'Session set! Redirecting…';
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);

        var user = result.data.user;
        if (user) {
          var adminResult = await supabase
            .from('admin_users')
            .select('id')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .single();

          if (adminResult.data) {
            window.location.href = '${origin}/admin/dashboard';
            return;
          }

          var volResult = await supabase
            .from('volunteers')
            .select('id, training_status')
            .eq('user_id', user.id)
            .single();

          if (volResult.data) {
            if (volResult.data.training_status !== 'COMPLETED') {
              window.location.href = '${origin}/agent/onboarding';
            } else {
              window.location.href = '${origin}/agent/dashboard';
            }
            return;
          }

          window.location.href = '${origin}/agent/register';
        } else {
          window.location.href = '${origin}/agent/register';
        }
      } catch(e) {
        status.textContent = 'Error: ' + e.message;
        setTimeout(function() { window.location.href = '${origin}/auth/auth-code-error?error=' + encodeURIComponent(e.message); }, 2000);
      }
    })();
  </script>
</body>
</html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}

async function resolveRedirect(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string
): Promise<string> {
  const { data: adminUser } = await supabase
    .from("admin_users")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();

  if (adminUser) return "/admin/dashboard";

  const { data: volunteer } = await supabase
    .from("volunteers")
    .select("id, training_status")
    .eq("user_id", userId)
    .single();

  if (volunteer) {
    return volunteer.training_status !== "COMPLETED"
      ? "/agent/onboarding"
      : "/agent/dashboard";
  }

  return "/agent/register";
}
