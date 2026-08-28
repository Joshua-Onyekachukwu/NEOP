/**
 * POST /api/me/incident
 * Submit an incident report
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
    const { assignment_id, category, severity, what_observed, agent_safe } = body;

    // Validate required fields
    if (!assignment_id || !category || !severity || !what_observed) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate category
    const validCategories = [
      'VIOLENCE', 'INTIMIDATION', 'DISRUPTION', 'ELECTION_NOT_HELD',
      'MATERIAL_SHORTAGE', 'POLLING_UNIT_RELOCATION', 'ACCESS_PROBLEM',
      'SECURITY_INCIDENT', 'OTHER',
    ];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }

    // Validate severity
    const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    if (!validSeverities.includes(severity)) {
      return NextResponse.json({ error: 'Invalid severity' }, { status: 400 });
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

    // Verify assignment
    const { data: assignment } = await supabase
      .from('agent_assignments')
      .select('id, polling_unit_id, election_id')
      .eq('id', assignment_id)
      .eq('volunteer_id', volunteer.id)
      .single();

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Create incident
    const { data: incident, error: incidentError } = await supabase
      .from('incidents')
      .insert({
        election_id: assignment.election_id,
        polling_unit_id: assignment.polling_unit_id,
        volunteer_id: volunteer.id,
        assignment_id: assignment.id,
        category,
        severity,
        what_observed,
        when_observed: new Date().toISOString(),
        agent_safe: agent_safe !== false,
        status: 'REPORTED',
      })
      .select('id')
      .single();

    if (incidentError) {
      console.error('Error creating incident:', incidentError);
      return NextResponse.json({ error: 'Failed to create incident' }, { status: 500 });
    }

    // Log audit event
    await supabase.from('audit_log').insert({
      actor_id: volunteer.id,
      actor_type: 'VOLUNTEER',
      action: 'INCIDENT_REPORTED',
      resource_type: 'incidents',
      resource_id: incident.id,
      metadata: JSON.stringify({
        category,
        severity,
        agent_safe: agent_safe !== false,
      }),
    });

    // If agent is not safe, flag for emergency response
    if (agent_safe === false) {
      // TODO: Send emergency notification to coordinator
      console.log('EMERGENCY: Agent reported feeling unsafe');
    }

    return NextResponse.json({ 
      success: true, 
      id: incident.id,
    });
  } catch (error) {
    console.error('Error submitting incident:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
