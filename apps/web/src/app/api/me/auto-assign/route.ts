/**
 * POST /api/me/auto-assign
 * Automatically assigns a volunteer to their selected polling unit
 * after they complete training. Checks PU availability first.
 * 
 * Flow:
 * 1. Volunteer registers → picks PU
 * 2. Volunteer completes training
 * 3. This API is called → checks PU availability
 * 4. If available → creates assignment
 * 5. If full → returns alternatives
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MAX_OBSERVERS = 2;

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get volunteer profile
    const { data: volunteer, error: volError } = await supabase
      .from('volunteers')
      .select('id, selected_polling_unit_id, training_status, status, phone')
      .eq('user_id', user.id)
      .single();

    if (volError || !volunteer) {
      return NextResponse.json({ error: 'Volunteer not found' }, { status: 404 });
    }

    // Check training is complete
    if (volunteer.training_status !== 'COMPLETED') {
      return NextResponse.json({
        error: 'Training not completed',
        message: 'Complete all training modules before assignment',
      }, { status: 400 });
    }

    // Check phone is verified
    if (!volunteer.phone) {
      return NextResponse.json({
        error: 'Phone not verified',
        message: 'Verify your phone number before assignment',
      }, { status: 400 });
    }

    // Check if already assigned
    const { data: existingAssignment } = await supabase
      .from('agent_assignments')
      .select('id, status')
      .eq('volunteer_id', volunteer.id)
      .in('status', ['ASSIGNED', 'ACTIVATED', 'CHECKED_IN'])
      .single();

    if (existingAssignment) {
      return NextResponse.json({
        success: true,
        already_assigned: true,
        assignment_id: existingAssignment.id,
        status: existingAssignment.status,
        message: 'You are already assigned to a polling unit',
      });
    }

    if (!volunteer.selected_polling_unit_id) {
      return NextResponse.json({
        error: 'No polling unit selected',
        message: 'Select a polling unit during registration before assignment',
      }, { status: 400 });
    }

    // Get active election
    const { data: election } = await supabase
      .from('elections')
      .select('id, name')
      .eq('is_active', true)
      .single();

    if (!election) {
      return NextResponse.json({
        error: 'No active election',
        message: 'No active election to assign for',
      }, { status: 400 });
    }

    // Check PU availability
    const { data: existingAgents } = await supabase
      .from('agent_assignments')
      .select('id, observer_number')
      .eq('polling_unit_id', volunteer.selected_polling_unit_id)
      .eq('election_id', election.id)
      .in('status', ['ASSIGNED', 'ACTIVATED', 'CHECKED_IN']);

    const assignedCount = existingAgents?.length || 0;

    if (assignedCount >= MAX_OBSERVERS) {
      // PU is full — find nearby alternatives
      const { data: pu } = await supabase
        .from('polling_units')
        .select('ward_id, ward:wards(id, name, lga_id)')
        .eq('id', volunteer.selected_polling_unit_id)
        .single();

      const wardId = (pu as any)?.ward_id || (pu as any)?.ward?.id;

      // Find other PUs in same ward with capacity
      const { data: alternatives } = await supabase
        .from('polling_units')
        .select(`
          id, official_code, name,
          agent_assignments!inner(id)
        `)
        .eq('ward_id', wardId)
        .neq('id', volunteer.selected_polling_unit_id);

      // Filter to PUs with capacity
      const availablePU: any[] = [];
      if (alternatives) {
        // Group by PU and count assignments
        const puCounts = new Map<string, number>();
        for (const alt of alternatives) {
          const count = puCounts.get(alt.id) || 0;
          puCounts.set(alt.id, count + 1);
        }
        // Actually we need to count differently — let's do a simpler approach
      }

      // Simpler: find PUs in same ward with fewer than MAX_OBSERVERS assignments
      const { data: wardPUs } = await supabase
        .from('polling_units')
        .select('id, official_code, name')
        .eq('ward_id', wardId);

      const available: any[] = [];
      if (wardPUs) {
        for (const pu of wardPUs) {
          const { count } = await supabase
            .from('agent_assignments')
            .select('id', { count: 'exact', head: true })
            .eq('polling_unit_id', pu.id)
            .eq('election_id', election.id)
            .in('status', ['ASSIGNED', 'ACTIVATED', 'CHECKED_IN']);

          if ((count || 0) < MAX_OBSERVERS) {
            available.push({
              id: pu.id,
              official_code: pu.official_code,
              name: pu.name,
              spots: MAX_OBSERVERS - (count || 0),
            });
          }
        }
      }

      return NextResponse.json({
        success: false,
        pu_full: true,
        assigned_count: assignedCount,
        max_observers: MAX_OBSERVERS,
        current_agents: existingAgents?.map((a: any) => ({
          observer_number: a.observer_number,
        })),
        alternatives: available.slice(0, 5),
        message: `This polling unit already has ${assignedCount} agent(s). ${available.length} alternative(s) available in your ward.`,
      });
    }

    // Determine observer number (1 or 2)
    const observerNumber = assignedCount + 1;

    // Create assignment
    const { data: assignment, error: assignError } = await supabase
      .from('agent_assignments')
      .insert({
        volunteer_id: volunteer.id,
        polling_unit_id: volunteer.selected_polling_unit_id,
        election_id: election.id,
        status: 'ASSIGNED',
        observer_number: observerNumber,
        assigned_at: new Date().toISOString(),
      })
      .select('id, status, observer_number')
      .single();

    if (assignError) {
      console.error('Assignment error:', assignError);
      return NextResponse.json({
        error: 'Assignment failed',
        message: assignError.message.includes('unique')
          ? 'You already have an assignment for this election'
          : 'Failed to create assignment',
      }, { status: 500 });
    }

    // Update volunteer status
    await supabase
      .from('volunteers')
      .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
      .eq('id', volunteer.id);

    // Get PU details for response
    const { data: puDetails } = await supabase
      .from('polling_units')
      .select('official_code, name, states(name), lgas(name), wards(name)')
      .eq('id', volunteer.selected_polling_unit_id)
      .single();

    return NextResponse.json({
      success: true,
      assignment_id: assignment.id,
      observer_number: assignment.observer_number,
      status: assignment.status,
      polling_unit: {
        id: volunteer.selected_polling_unit_id,
        code: (puDetails as any)?.official_code,
        name: (puDetails as any)?.name,
        state: (puDetails as any)?.states?.name,
        lga: (puDetails as any)?.lgas?.name,
        ward: (puDetails as any)?.wards?.name,
      },
      election: election.name,
      message: `Successfully assigned as Observer #${assignment.observer_number} at your selected polling unit`,
    });
  } catch (error) {
    console.error('Auto-assign error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
