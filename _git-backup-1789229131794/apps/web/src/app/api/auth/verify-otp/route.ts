/**
 * POST /api/auth/verify-otp
 * Verifies OTP via Supabase → returns full session.
 *
 * P0 fixes (audit 2026-09-12):
 *  - S10: Returns Supabase session (access_token, refresh_token, expires_in)
 *    so the frontend can call supabase.auth.setSession() and the
 *    sb-*-auth-token HttpOnly/same-site cookie is written by client JS into
 *    localStorage cookie-store that middleware check-auth already reads.
 *  - Bonus: On first successful OTP login, ensures user_accounts row exists
 *    and if phone number indicates a new user, creates placeholder volunteer
 *    row (PROFILE_INCOMPLETE status). This fixes the earlier disconnect:
 *    Supabase auth.users can exist with no user_accounts.id / volunteer row.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const { phone, token } = await request.json();
    if (!phone || !token) {
      return NextResponse.json(
        { error: "Phone and OTP token required" },
        { status: 400 }
      );
    }

    let normalizedPhone = phone.replace(/\s/g, "").replace(/-/g, "");
    if (normalizedPhone.startsWith("0")) {
      normalizedPhone = "+234" + normalizedPhone.substring(1);
    } else if (!normalizedPhone.startsWith("+")) {
      normalizedPhone = "+234" + normalizedPhone;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase.auth.verifyOtp({
      phone: normalizedPhone,
      token: token,
      type: "sms",
    });

    if (error) {
      console.error("OTP verification error:", error.message);
      return NextResponse.json(
        { error: "Invalid or expired OTP code" },
        { status: 400 }
      );
    }

    const user = data.user;
    const session = data.session;

    if (!user) {
      return NextResponse.json(
        { error: "OTP verified but user not returned by auth provider" },
        { status: 500 }
      );
    }

    // Idempotently ensure user_accounts row exists so volunteers.user_id FK works.
    try {
      const { count } = await supabase
        .from("user_accounts")
        .select("id", { count: "exact", head: true })
        .eq("id", user.id);
      if (!count) {
        await supabase.from("user_accounts").insert({
          id: user.id,
          phone: normalizedPhone,
          email: user.email || null,
          full_name: (user.user_metadata?.full_name as string) || null,
          status: "ACTIVE",
        });
      }
    } catch (err) {
      console.warn("[verify-otp] user_accounts upsert skipped:", err);
    }

    // Create placeholder volunteer row PROFILE_INCOMPLETE if missing — so
    // /agent/onboarding can find volunteer record by user_id immediately.
    let onboardingStatus = "PROFILE_INCOMPLETE";
    try {
      const { data: existingVol } = await supabase
        .from("volunteers")
        .select("id, status")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existingVol) {
        onboardingStatus = existingVol.status || onboardingStatus;
      } else {
        const { data: newVol } = await supabase
          .from("volunteers")
          .insert({
            user_id: user.id,
            phone: normalizedPhone,
            status: "PROFILE_INCOMPLETE",
            verification_status: "PENDING",
            training_completed: false,
          })
          .select("id, status")
          .single();
        if (newVol) onboardingStatus = newVol.status;
      }
    } catch (err) {
      console.warn("[verify-otp] volunteer placeholder skipped:", err);
    }

    // P0 #S10: Return complete session to frontend so client JS can call
    // supabase.auth.setSession({ access_token, refresh_token }) → which
    // writes the sb-<ref>-auth-token cookie that middleware reads.
    return NextResponse.json({
      success: true,
      verified: true,
      phone: normalizedPhone,
      message: "Phone verified successfully",
      user: user
        ? {
            id: user.id,
            email: user.email || null,
            phone: user.phone || normalizedPhone,
            aud: user.aud,
            role: user.role || null,
          }
        : null,
      session: session
        ? {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            expires_at: session.expires_at || null,
            token_type: session.token_type,
          }
        : null,
      onboarding: {
        status: onboardingStatus,
        next_step:
          onboardingStatus === "PROFILE_INCOMPLETE"
            ? "/agent/onboarding"
            : onboardingStatus === "TRAINING_PENDING"
              ? "/agent/training"
              : onboardingStatus === "ACTIVE" || onboardingStatus === "REGISTERED"
                ? "/agent/dashboard"
                : "/agent/onboarding",
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

