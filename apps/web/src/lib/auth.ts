/**
 * Auth utilities for the election observation platform
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lgdubqovtyvzckvpbtrs.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Create a server-side Supabase client with service role key
 */
export function createServerClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Get the current user from a session token
 */
export async function getCurrentUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const supabase = createServerClient();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }

  return user;
}

/**
 * Check if a user is an admin
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const supabase = createServerClient();
  
  const { data } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  return !!data;
}

/**
 * Check if a user is a volunteer
 */
export async function isVolunteer(userId: string): Promise<{ isVolunteer: boolean; volunteerId: string | null }> {
  const supabase = createServerClient();
  
  const { data } = await supabase
    .from('volunteers')
    .select('id')
    .eq('user_id', userId)
    .single();

  return {
    isVolunteer: !!data,
    volunteerId: data?.id || null,
  };
}

/**
 * Get volunteer's active assignment
 */
export async function getActiveAssignment(volunteerId: string, electionId?: string) {
  const supabase = createServerClient();
  
  let query = supabase
    .from('agent_assignments')
    .select(`
      id,
      polling_unit_id,
      election_id,
      status,
      observer_number,
      polling_units (
        id,
        official_code,
        name,
        state_id,
        lga_id,
        ward_id,
        states (name),
        lgas (name),
        wards (name)
      ),
      elections (
        id,
        name,
        type
      )
    `)
    .eq('volunteer_id', volunteerId)
    .in('status', ['ASSIGNED', 'ACTIVATED', 'CHECKED_IN']);

  if (electionId) {
    query = query.eq('election_id', electionId);
  }

  const { data } = await query.single();

  return data;
}

/**
 * Verify that a volunteer can submit results for a polling unit
 */
export async function canSubmitResult(
  volunteerId: string,
  assignmentId: string,
  pollingUnitId: string,
  electionId: string
): Promise<boolean> {
  const supabase = createServerClient();
  
  const { data } = await supabase
    .from('agent_assignments')
    .select('id')
    .eq('id', assignmentId)
    .eq('volunteer_id', volunteerId)
    .eq('polling_unit_id', pollingUnitId)
    .eq('election_id', electionId)
    .in('status', ['ACTIVATED', 'CHECKED_IN'])
    .single();

  return !!data;
}

/**
 * Log an audit event
 */
export async function logAuditEvent(
  actorId: string | null,
  actorType: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata?: Record<string, any>
) {
  const supabase = createServerClient();
  
  await supabase.from('audit_log').insert({
    actor_id: actorId,
    actor_type: actorType,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}
