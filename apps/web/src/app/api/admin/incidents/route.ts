/**
 * GET /api/admin/incidents
 * Admin endpoint for listing all incidents
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
      .from('incidents')
      .select(`
        id,
        category,
        severity,
        what_observed,
        when_observed,
        status,
        agent_safe,
        submitted_at,
        reviewed_at,
        polling_units (
          official_code,
          name
        )
      `)
      .order('submitted_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: incidents, error } = await query;

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch incidents' }, { status: 500 });
    }

    return NextResponse.json({ incidents });
  } catch (error) {
    console.error('Error fetching incidents:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
