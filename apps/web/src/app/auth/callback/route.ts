/**
 * GET /auth/callback
 * Handles the OAuth callback from Google → Supabase.
 * Exchanges the auth code for a session and redirects to the appropriate page.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const redirectTo = searchParams.get("redirect_to")?.toString();

  if (code) {
    // Exchange the auth code for a session
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Auth callback error:", error.message);
      return NextResponse.redirect(`${origin}/auth/auth-code-error?error=${encodeURIComponent(error.message)}`);
    }

    // Get the user to determine where to redirect
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      // Check if user is an admin
      const { data: adminUser } = await supabase
        .from("admin_users")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .single();

      if (adminUser) {
        // Admin goes to admin dashboard
        return NextResponse.redirect(`${origin}/admin/dashboard`);
      }

      // Check if user is a registered volunteer
      const { data: volunteer } = await supabase
        .from("volunteers")
        .select("id, training_status")
        .eq("user_id", user.id)
        .single();

      if (volunteer) {
        // If training not complete, go to onboarding
        if (volunteer.training_status !== "COMPLETED") {
          return NextResponse.redirect(`${origin}/agent/onboarding`);
        }
        // Otherwise, go to agent dashboard
        return NextResponse.redirect(`${origin}/agent/dashboard`);
      }

      // New user — go to registration
      return NextResponse.redirect(`${origin}/agent/register`);
    }

    // Fallback redirect
    if (redirectTo) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  // No code — error
  return NextResponse.redirect(`${origin}/auth/auth-code-error?error=no_code`);
}
