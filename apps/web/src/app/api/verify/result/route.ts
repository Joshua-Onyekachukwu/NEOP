/**
 * POST /api/verify/result
 * Triggers the verification pipeline for a result submission.
 * 
 * Can be called:
 * 1. Automatically after a result is submitted (webhook-style)
 * 2. Manually by an admin
 * 3. By a cron job to verify pending results
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyResult } from '@/lib/domain/verification';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lgdubqovtyvzckvpbtrs.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { result_id } = body;

    if (!result_id) {
      return NextResponse.json({ error: 'result_id is required' }, { status: 400 });
    }

    // Optional: verify caller is admin or system
    const authHeader = request.headers.get('Authorization');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Allow system calls (no auth) or admin calls
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user } } = await supabase.auth.getUser(token);

      if (user) {
        const { data: adminUser } = await supabase
          .from('admin_users')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .single();

        if (!adminUser) {
          return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
        }
      }
    }

    // Run verification pipeline
    const result = await verifyResult(result_id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      score: result.score,
      comparison: result.comparison,
      ocrProcessed: result.ocrResult?.success ?? false,
    });
  } catch (error) {
    console.error('Verification error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/verify/result?result_id=xxx
 * Get verification status for a result
 */
export async function GET(request: NextRequest) {
  try {
    const resultId = request.nextUrl.searchParams.get('result_id');
    if (!resultId) {
      return NextResponse.json({ error: 'result_id is required' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: result } = await supabase
      .from('result_submissions')
      .select(`
        id, status, verified_at,
        polling_units ( official_code, name ),
        party_results ( votes, parties ( abbreviation, color ) )
      `)
      .eq('id', resultId)
      .single();

    if (!result) {
      return NextResponse.json({ error: 'Result not found' }, { status: 404 });
    }

    // Get audit log for verification events
    const { data: auditEvents } = await supabase
      .from('audit_log')
      .select('action, metadata, created_at')
      .eq('resource_type', 'result_submissions')
      .eq('resource_id', resultId)
      .eq('action', 'RESULT_VERIFIED')
      .order('created_at', { ascending: false })
      .limit(1);

    return NextResponse.json({
      result,
      verification: auditEvents?.[0] || null,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
