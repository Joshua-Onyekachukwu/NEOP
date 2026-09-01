/**
 * POST /api/admin/verify
 * Admin endpoint for verifying or disputing results
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminWithDetails, isAdminDetailsSuccess } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, adminUser } = auth;

    const body = await request.json();
    const { result_id, decision, notes } = body;

    if (!result_id || !decision) {
      return NextResponse.json({ error: 'result_id and decision are required' }, { status: 400 });
    }

    // Validate decision
    const validDecisions = ['VERIFIED', 'DISPUTED', 'REJECTED'];
    if (!validDecisions.includes(decision)) {
      return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
    }

    // Update result status
    const { error: updateError } = await supabase
      .from('result_submissions')
      .update({
        status: decision,
        verified_at: new Date().toISOString(),
      })
      .eq('id', result_id);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update result' }, { status: 500 });
    }

    // Log audit event
    await supabase.from('audit_log').insert({
      actor_id: adminUser.id,
      actor_type: 'ADMIN',
      action: `RESULT_${decision}`,
      resource_type: 'result_submissions',
      resource_id: result_id,
      metadata: JSON.stringify({
        decision,
        notes: notes || null,
        admin_role: adminUser.role,
      }),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error verifying result:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
