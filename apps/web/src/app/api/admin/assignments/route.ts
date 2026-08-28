/**
 * GET /api/admin/assignments
 * Admin endpoint for listing all assignments
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lgdubqovtyvzckvpbtrs.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (!adminUser) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

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
