/**
 * GET /api/admin/assignments
 * Admin endpoint for listing all assignments
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
      .from('agent_assignments')
      .select(`
        id,
        status,
        observer_number,
        assigned_at,
        checked_in_at,
        volunteers (
          id,
          user_accounts (email, full_name)
        ),
        polling_units (
          official_code,
          name
        ),
        elections (
          name
        )
      `)
      .order('assigned_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: assignments, error } = await query;

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch assignments' }, { status: 500 });
    }

    return NextResponse.json({ assignments });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
