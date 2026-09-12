/**
 * POST /api/admin/verify
 * Admin endpoint for verifying or disputing results
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminWithDetails, isAdminDetailsSuccess } from '@/lib/admin-auth';
import { revalidateTag, revalidatePath } from 'next/cache';

/**
 * POST /api/admin/verify
 * Admin endpoint for verifying or disputing results.
 *
 * P1-2 fix: after any status write, invalidate Next.js server caches
 *  (unstable_cache tags for stats / party-results) and also revalidate
 *  all public routes so the homepage / results page don't serve stale
 *  aggregated data until the 30s ttl expires.
 */
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

    // P1-3 Admin rejection / correction handling:
    //
    // If decision === REJECTED we MUST write the old row with status=SUPERSEDED
    // (not REJECTED).  The partial unique constraint
    // uq_single_active_result_per_assignment blocks any NEW submission for the
    // same assignment WHEN status NOT IN ('SUPERSEDED'); leaving it as REJECTED
    // would lock the agent out FOREVER (correction resubmission impossible).
    //
    // For VERIFIED / DISPUTED we keep status unchanged from decision.
    const rejected = decision === 'REJECTED';
    const newStatus = rejected ? 'SUPERSEDED' : decision;

    // Update result status
    const { data: updated, error: updateError } = await supabase
      .from('result_submissions')
      .update({
        status: newStatus,
        verified_at: new Date().toISOString(),
      })
      .eq('id', result_id)
      .select('assignment_id, volunteer_id, status, polling_unit_id, election_id')
      .single();

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update result' }, { status: 500 });
    }

    // Log audit event
    await supabase.from('audit_log').insert({
      actor_id: adminUser.id,
      actor_type: 'ADMIN',
      action: rejected ? 'RESULT_REJECTED' : `RESULT_${decision}`,
      resource_type: 'result_submissions',
      resource_id: result_id,
      metadata: JSON.stringify({
        decision,
        written_status: newStatus,
        notes: notes || null,
        admin_role: adminUser.role,
        assignment_id: updated?.assignment_id ?? null,
      }),
    });

    // P1-3: For rejection / correction, flip agent assignment back from
    // CHECKED_IN → ASSIGNED so the agent can re-submit a corrected result.
    // (verified/disputed remain as-is)
    if (rejected && updated?.assignment_id) {
      try {
        await supabase
          .from('agent_assignments')
          .update({ status: 'ASSIGNED' })
          .eq('id', updated.assignment_id);

        await supabase.from('audit_log').insert({
          actor_id: adminUser.id,
          actor_type: 'ADMIN',
          action: 'ASSIGNMENT_REJECTED_REOPENED',
          resource_type: 'agent_assignments',
          resource_id: updated.assignment_id,
          metadata: JSON.stringify({
            reason: 'Result rejected — correction cycle started',
            old_status: 'CHECKED_IN',
            new_status: 'ASSIGNED',
            rejected_result_id: result_id,
          }),
        });
      } catch (reopenErr) {
        console.error('[admin/verify] rejection reopen failed:', reopenErr);
      }
    }

    // P1-2: Force cache refresh for public stats & party breakdown.
    revalidateTag('stats');
    revalidateTag('party-results');
    revalidateTag('config');
    revalidatePath('/');
    revalidatePath('/results');
    revalidatePath('/live');

    return NextResponse.json({
      success: true,
      decision_applied: decision,
      written_status: newStatus,
      assignment_reopened: rejected && !!updated?.assignment_id,
      cache_revalidated: ['stats', 'party-results', 'config', '/', '/results', '/live'],
    });
  } catch (error) {
    console.error('Error verifying result:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
