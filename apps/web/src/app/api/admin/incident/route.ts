/**
 * POST /api/admin/incident
 * Admin endpoint for reviewing incidents
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
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

    // Check if user is admin
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id, role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (!adminUser) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

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
