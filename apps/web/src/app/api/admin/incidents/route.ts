/**
 * GET /api/admin/incidents
 * Admin endpoint for listing all incidents (state-scoped)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminWithDetails, isAdminDetailsSuccess } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, state_id, global } = auth;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const status = searchParams.get('status');

    let query = supabase
      .from('incidents')
      .select(
        global && state_id == null
          ? `
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
      `
          : `
        id,
        category,
        severity,
        what_observed,
        when_observed,
        status,
        agent_safe,
        submitted_at,
        reviewed_at,
        polling_units!inner (
          official_code,
          name,
          state_id
        )
      `
      )
      .order('submitted_at', { ascending: false })
      .limit(limit);

    if (!global && state_id != null) {
      query = query.eq('polling_units.state_id', state_id);
    }
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
