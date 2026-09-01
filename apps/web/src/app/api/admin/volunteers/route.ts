/**
 * GET /api/admin/volunteers
 * Admin endpoint for listing all volunteers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, isAdminSuccess } from '@/lib/admin-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!isAdminSuccess(auth)) return auth.error;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const status = searchParams.get('status');

    let query = supabase
      .from('volunteers')
      .select(`
        id,
        status,
        phone,
        verification_status,
        training_status,
        created_at,
        user_accounts (email, full_name),
        states (name, code)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: volunteers, error } = await query;

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch volunteers' }, { status: 500 });
    }

    return NextResponse.json({ volunteers });
  } catch (error) {
    console.error('Error fetching volunteers:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
