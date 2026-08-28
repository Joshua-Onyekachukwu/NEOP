/**
 * POST /api/me/check-in
 * Agent checks in at their assigned polling unit
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lgdubqovtyvzckvpbtrs.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { assignment_id } = body;

    if (!assignment_id) {
      return NextResponse.json({ error: 'assignment_id is required' }, { status: 400 });
    }

    // Get volunteer
    const { data: volunteer } = await supabase
      .from('volunteers')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!volunteer) {
      return NextResponse.json({ error: 'Volunteer not found' }, { status: 404 });
    }

    // Verify assignment belongs to this volunteer
    const { data: assignment } = await supabase
      .from('agent_assignments')
      .select('id, status')
      .eq('id', assignment_id)
      .eq('volunteer_id', volunteer.id)
      .single();

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    if (assignment.status === 'CHECKED_IN') {
      return NextResponse.json({ error: 'Already checked in' }, { status: 400 });
    }

    // Update assignment status
    const { error: updateError } = await supabase
      .from('agent_assignments')
      .update({
        status: 'CHECKED_IN',
        checked_in_at: new Date().toISOString(),
      })
      .eq('id', assignment_id);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to check in' }, { status: 500 });
    }

    // Log audit event
    await supabase.from('audit_log').insert({
      actor_id: volunteer.id,
      actor_type: 'VOLUNTEER',
      action: 'CHECKED_IN',
      resource_type: 'agent_assignments',
      resource_id: assignment_id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error checking in:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
