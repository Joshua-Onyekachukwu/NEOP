/**
 * POST /api/admin/assign
 * Admin endpoint to manually assign a volunteer to a polling unit
 * Also supports auto-assigning all pending volunteers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MAX_OBSERVERS = 2;

async function verifyAdmin(token: string) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return null;

  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single();

  return adminUser ? supabase : null;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await verifyAdmin(authHeader.substring(7));
    if (!supabase) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await request.json();
    const { volunteer_id, polling_unit_id, election_id, action } = body;

    // Auto-assign all pending volunteers
    if (action === 'auto_assign_all') {
      const results = { assigned: 0, skipped: 0, failed: 0, pu_full: 0 };

      // Get active election
      const { data: election } = await supabase
        .from('elections')
        .select('id')
        .eq('is_active', true)
        .single();

      if (!election) {
        return NextResponse.json({ error: 'No active election' }, { status: 400 });
      }

      // Get all volunteers with completed training but no assignment
      const { data: pendingVolunteers } = await supabase
        .from('volunteers')
        .select('id, selected_polling_unit_id')
        .eq('training_status', 'COMPLETED')
        .eq('status', 'REGISTERED');

      if (!pendingVolunteers) {
        return NextResponse.json({ results });
      }

      for (const vol of pendingVolunteers) {
        if (!vol.selected_polling_unit_id) {
          results.skipped++;
          continue;
        }

        // Check PU availability
        const { count } = await supabase
          .from('agent_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('polling_unit_id', vol.selected_polling_unit_id)
          .eq('election_id', election.id)
          .in('status', ['ASSIGNED', 'ACTIVATED', 'CHECKED_IN']);

        if ((count || 0) >= MAX_OBSERVERS) {
          results.pu_full++;
          continue;
        }

        // Create assignment
        const { error } = await supabase
          .from('agent_assignments')
          .insert({
            volunteer_id: vol.id,
            polling_unit_id: vol.selected_polling_unit_id,
            election_id: election.id,
            status: 'ASSIGNED',
            observer_number: (count || 0) + 1,
          });

        if (error) {
          results.failed++;
        } else {
          await supabase
            .from('volunteers')
            .update({ status: 'ACTIVE' })
            .eq('id', vol.id);
          results.assigned++;
        }
      }

      return NextResponse.json({ success: true, results });
    }

    // Manual single assignment
    if (!volunteer_id || !polling_unit_id || !election_id) {
      return NextResponse.json({
        error: 'volunteer_id, polling_unit_id, and election_id required',
      }, { status: 400 });
    }

    // Check PU capacity
    const { count } = await supabase
      .from('agent_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('polling_unit_id', polling_unit_id)
      .eq('election_id', election_id)
      .in('status', ['ASSIGNED', 'ACTIVATED', 'CHECKED_IN']);

    if ((count || 0) >= MAX_OBSERVERS) {
      return NextResponse.json({
        error: 'PU full',
        message: `This polling unit already has ${count} agent(s). Max is ${MAX_OBSERVERS}.`,
      }, { status: 400 });
    }

    // Check volunteer doesn't already have assignment
    const { data: existing } = await supabase
      .from('agent_assignments')
      .select('id')
      .eq('volunteer_id', volunteer_id)
      .eq('election_id', election_id)
      .single();

    if (existing) {
      return NextResponse.json({
        error: 'Already assigned',
        message: 'This volunteer already has an assignment for this election',
      }, { status: 400 });
    }

    // Create assignment
    const { data: assignment, error } = await supabase
      .from('agent_assignments')
      .insert({
        volunteer_id,
        polling_unit_id,
        election_id,
        status: 'ASSIGNED',
        observer_number: (count || 0) + 1,
      })
      .select('id, status, observer_number')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update volunteer status
    await supabase
      .from('volunteers')
      .update({ status: 'ACTIVE' })
      .eq('id', volunteer_id);

    return NextResponse.json({
      success: true,
      assignment,
      message: `Assigned as Observer #${assignment.observer_number}`,
    });
  } catch (error) {
    console.error('Assign error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
