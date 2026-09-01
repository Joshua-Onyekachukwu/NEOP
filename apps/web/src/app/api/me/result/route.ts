/**
 * POST /api/me/result
 * Submit election results for a polling unit
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

    const body = await request.json();
    const { assignment_id, valid_votes, rejected_votes, party_results, idempotency_key } = body;

    // Validate required fields
    if (!assignment_id || valid_votes === undefined || rejected_votes === undefined || !party_results || !idempotency_key) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Math validation
    const totalPartyVotes = Object.values(party_results).reduce((sum: number, votes: any) => sum + (votes as number), 0);
    if (totalPartyVotes !== valid_votes) {
      return NextResponse.json({ 
        error: 'Sum of party votes does not match valid votes',
        party_sum: totalPartyVotes,
        valid_votes,
      }, { status: 400 });
    }

    if (valid_votes < 0 || rejected_votes < 0) {
      return NextResponse.json({ error: 'Vote counts cannot be negative' }, { status: 400 });
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
      .select('id, polling_unit_id, election_id, status')
      .eq('id', assignment_id)
      .eq('volunteer_id', volunteer.id)
      .single();

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    if (assignment.status !== 'CHECKED_IN') {
      return NextResponse.json({ error: 'Must be checked in to submit results' }, { status: 400 });
    }

    // Check idempotency key
    const { data: existing } = await supabase
      .from('result_submissions')
      .select('id')
      .eq('idempotency_key', idempotency_key)
      .single();

    if (existing) {
      return NextResponse.json({ 
        success: true, 
        id: existing.id, 
        message: 'Result already submitted' 
      });
    }

    // Create result submission
    const totalVotes = valid_votes + rejected_votes;
    const { data: result, error: resultError } = await supabase
      .from('result_submissions')
      .insert({
        election_id: assignment.election_id,
        polling_unit_id: assignment.polling_unit_id,
        volunteer_id: volunteer.id,
        assignment_id: assignment.id,
        valid_votes,
        rejected_votes,
        total_votes: totalVotes,
        status: 'UNVERIFIED',
        idempotency_key,
      })
      .select('id')
      .single();

    if (resultError) {
      console.error('Error creating result:', resultError);
      return NextResponse.json({ error: 'Failed to create result' }, { status: 500 });
    }

    // Get parties for the election
    const { data: parties } = await supabase
      .from('parties')
      .select('id, abbreviation');

    const partyMap: Record<string, string> = {};
    parties?.forEach(p => { partyMap[p.abbreviation] = p.id; });

    // Insert party results
    const partyResultsInsert = Object.entries(party_results).map(([party, votes]) => ({
      result_submission_id: result.id,
      party_id: partyMap[party],
      votes: votes as number,
    })).filter(pr => pr.party_id);

    if (partyResultsInsert.length > 0) {
      const { error: partyError } = await supabase
        .from('party_results')
        .insert(partyResultsInsert);

      if (partyError) {
        console.error('Error creating party results:', partyError);
      }
    }

    // Log audit event
    await supabase.from('audit_log').insert({
      actor_id: volunteer.id,
      actor_type: 'VOLUNTEER',
      action: 'RESULT_SUBMITTED',
      resource_type: 'result_submissions',
      resource_id: result.id,
      metadata: JSON.stringify({
        valid_votes,
        rejected_votes,
        total_votes: totalVotes,
      }),
    });

    // Trigger verification pipeline (non-blocking)
    // This compares with Observer B if they've already submitted,
    // runs OCR on any uploaded photos, and computes confidence score
    try {
      const verifyUrl = `${request.nextUrl.origin}/api/verify/result`;
      fetch(verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ result_id: result.id }),
      }).catch(err => console.error('Verification trigger failed:', err));
    } catch {
      // Non-critical — verification can be retried later
    }

    return NextResponse.json({ 
      success: true, 
      id: result.id,
      status: 'UNVERIFIED',
    });
  } catch (error) {
    console.error('Error submitting result:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
