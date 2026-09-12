/**
 * POST /api/admin/incident
 * Admin endpoint for reviewing incidents
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminWithDetails, isAdminDetailsSuccess } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, admin_user: adminUser, state_id, global } = auth;

    const body = await request.json();
    const { incident_id, decision, review_notes } = body;

    if (!incident_id || !decision) {
      return NextResponse.json({ error: 'incident_id and decision are required' }, { status: 400 });
    }

    // Validate decision
    const validDecisions = ['CORROBORATED', 'UNCONFIRMED', 'REVIEWING'];
    if (!validDecisions.includes(decision)) {
      return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
    }

    // State guard: verify incident belongs to admin's state (if state-scoped)
    if (!global && state_id != null) {
      const { data: incState, error: incErr } = await supabase
        .from('incidents')
        .select('polling_unit_id, polling_units!inner ( state_id )')
        .eq('id', incident_id)
        .maybeSingle();
      if (incErr || !incState) {
        return NextResponse.json({ error: 'incident not found' }, { status: 404 });
      }
      const incSt = (incState as any)?.polling_units?.state_id;
      if (!incSt || incSt !== state_id) {
        return NextResponse.json(
          { error: 'Forbidden: state-scoped admin cannot review incidents outside their state' },
          { status: 403 }
        );
      }
    }

    // Update incident status
    const { error: updateError } = await supabase
      .from('incidents')
      .update({
        status: decision,
        reviewed_by: adminUser.id,
        review_notes: review_notes || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', incident_id);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update incident' }, { status: 500 });
    }

    // Log audit event
    await supabase.from('audit_log').insert({
      actor_id: adminUser.id,
      actor_type: 'ADMIN',
      action: `INCIDENT_${decision}`,
      resource_type: 'incidents',
      resource_id: incident_id,
      metadata: JSON.stringify({
        decision,
        review_notes: review_notes || null,
        admin_role: adminUser.role,
      }),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error reviewing incident:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
