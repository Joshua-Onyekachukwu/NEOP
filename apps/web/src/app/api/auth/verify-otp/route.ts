/**
 * POST /api/auth/verify-otp
 * Verifies the OTP code sent to the phone number
 * Returns a verification token that the registration flow uses
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const { phone, token } = await request.json();

    if (!phone || !token) {
      return NextResponse.json({ error: 'Phone and OTP token required' }, { status: 400 });
    }

    // Normalize phone
    let normalizedPhone = phone.replace(/\s/g, '').replace(/-/g, '');
    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = '+234' + normalizedPhone.substring(1);
    } else if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+234' + normalizedPhone;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify OTP via Supabase
    const { data, error } = await supabase.auth.verifyOtp({
      phone: normalizedPhone,
      token: token,
      type: 'sms',
    });

    if (error) {
      console.error('OTP verification error:', error.message);
      return NextResponse.json({ error: 'Invalid or expired OTP code' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      phone: normalizedPhone,
      verified: true,
      message: 'Phone verified successfully',
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
