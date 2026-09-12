/**
 * GET /api/admin/results
 * Admin endpoint for listing all results
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
      .from('result_submissions')
      .select(`
        id,
        valid_votes,
        rejected_votes,
        total_votes,
        status,
        submitted_at,
        verified_at,
        polling_units (
          official_code,
          name
        ),
        volunteers (
          user_accounts (email, full_name)
        )
      `)
      .order('submitted_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: results, error } = await query;

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Error fetching results:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
