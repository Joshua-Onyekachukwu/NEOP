/**
 * GET /api/me/assignment
 * Returns the authenticated volunteer's current assignment
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    // Get auth token from header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    
    // Verify user
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get volunteer profile
    const { data: volunteer } = await supabase
      .from('volunteers')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!volunteer) {
      return NextResponse.json({ error: 'Volunteer not found' }, { status: 404 });
    }

    // Get active assignment
    const { data: assignment } = await supabase
      .from('agent_assignments')
      .select(`
        id,
        status,
        observer_number,
        assigned_at,
        checked_in_at,
        polling_units (
          id,
          official_code,
          name,
          states (name),
          lgas (name),
          wards (name)
        ),
        elections (
          name,
          type,
          scheduled_start
        )
      `)
      .eq('volunteer_id', volunteer.id)
      .in('status', ['ASSIGNED', 'ACTIVATED', 'CHECKED_IN'])
      .single();

    if (!assignment) {
      return NextResponse.json({ assignment: null });
    }

    return NextResponse.json({ assignment });
  } catch (error) {
    console.error('Error fetching assignment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
