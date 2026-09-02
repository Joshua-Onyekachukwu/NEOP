/**
 * GET /api/public/pu-availability
 * Check if a polling unit already has agents assigned for an election
 * Returns: { available: boolean, assigned_count: number, max_observers: number, agents: [...] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  try {
    const { searchParams } = new URL(request.url);
    const pollingUnitId = searchParams.get('polling_unit_id');
    const electionId = searchParams.get('election_id');

    if (!pollingUnitId) {
      return NextResponse.json({ error: 'polling_unit_id required' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the active election if not specified
    let eId = electionId;
    if (!eId) {
      const { data: election } = await supabase
        .from('elections')
        .select('id')
        .eq('is_active', true)
        .single();
      eId = election?.id;
    }

    if (!eId) {
      return NextResponse.json({
        available: true,
        assigned_count: 0,
        max_observers: 2,
        agents: [],
        message: 'No active election found',
      });
    }

    // Count existing assignments for this PU in this election
    const { data: assignments, error } = await supabase
      .from('agent_assignments')
      .select(`
        id,
        status,
        observer_number,
        checked_in_at,
        volunteers (
          user_accounts (full_name, email)
        )
      `)
      .eq('polling_unit_id', pollingUnitId)
      .eq('election_id', eId)
      .in('status', ['ASSIGNED', 'ACTIVATED', 'CHECKED_IN']);

    if (error) {
      console.error('PU availability check error:', error);
      return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 });
    }

    const assignedCount = assignments?.length || 0;
    const MAX_OBSERVERS = 2; // Two-observer verification model

    return NextResponse.json({
      available: assignedCount < MAX_OBSERVERS,
      assigned_count: assignedCount,
      max_observers: MAX_OBSERVERS,
      spots_remaining: MAX_OBSERVERS - assignedCount,
      agents: (assignments || []).map((a: any) => ({
        observer_number: a.observer_number,
        status: a.status,
        name: a.volunteers?.user_accounts?.full_name || 'Unknown',
        checked_in: !!a.checked_in_at,
      })),
      message: assignedCount >= MAX_OBSERVERS
        ? `This polling unit already has ${assignedCount} agent(s) assigned. Maximum capacity is ${MAX_OBSERVERS}.`
        : `${MAX_OBSERVERS - assignedCount} spot(s) remaining at this polling unit.`,
    });
  } catch (error) {
    console.error('PU availability error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
