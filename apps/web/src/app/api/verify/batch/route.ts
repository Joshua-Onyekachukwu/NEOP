/**
 * POST /api/verify/batch
 * Batch-verify multiple pending results.
 * Admin-only endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyResult } from '@/lib/domain/verification';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, isAdminSuccess } from '@/lib/admin-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    // Verify caller is admin
    const auth = await requireAdmin(request);
    if (!isAdminSuccess(auth)) return auth.error;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get pending results
    const body = await request.json();
    const { limit = 50, election_id, polling_unit_id } = body;

    let query = supabase
      .from('result_submissions')
      .select('id')
      .eq('status', 'UNVERIFIED')
      .order('submitted_at', { ascending: true })
      .limit(limit);

    if (election_id) {
      query = query.eq('election_id', election_id);
    }
    if (polling_unit_id) {
      query = query.eq('polling_unit_id', polling_unit_id);
    }

    const { data: pendingResults, error: queryError } = await query;

    if (queryError || !pendingResults?.length) {
      return NextResponse.json({
        success: true,
        processed: 0,
        message: 'No pending results to verify',
      });
    }

    // Verify each result
    const results = [];
    let verified = 0;
    let disputed = 0;
    let failed = 0;

    for (const { id } of pendingResults) {
      const result = await verifyResult(id);
      results.push({ id, ...result });

      if (result.success) {
        if (result.score?.overall === 'HIGH') verified++;
        else if (result.score?.overall === 'DISPUTED') disputed++;
      } else {
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      processed: pendingResults.length,
      verified,
      disputed,
      failed,
      results,
    });
  } catch (error) {
    console.error('Batch verification error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/verify/batch
 * Get count of pending verifications
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { count } = await supabase
      .from('result_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'UNVERIFIED');

    const { count: verifiedCount } = await supabase
      .from('result_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'VERIFIED');

    const { count: disputedCount } = await supabase
      .from('result_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'DISPUTED');

    return NextResponse.json({
      pending: count || 0,
      verified: verifiedCount || 0,
      disputed: disputedCount || 0,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
