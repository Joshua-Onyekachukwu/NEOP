/**
 * POST /api/me/evidence
 * Upload evidence (result sheet photos, etc.)
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

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const assignmentId = formData.get('assignment_id') as string;
    const parentType = formData.get('parent_type') as string;
    const parentId = formData.get('parent_id') as string;

    if (!file || !assignmentId) {
      return NextResponse.json({ error: 'File and assignment_id are required' }, { status: 400 });
    }

    // Validate file size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP' }, { status: 400 });
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
      .eq('id', assignmentId)
      .eq('volunteer_id', volunteer.id)
      .single();

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Compute SHA-256 hash
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Generate file path
    const timestamp = Date.now();
    const fileExt = file.type.split('/')[1];
    const filePath = `evidence/${assignment.election_id}/${assignment.polling_unit_id}/${timestamp}.${fileExt}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('evidence')
      .upload(filePath, file, {
        contentType: file.type,
      });

    if (uploadError) {
      console.error('Error uploading file:', uploadError);
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
    }

    // Create evidence record
    const { data: evidence, error: evidenceError } = await supabase
      .from('evidence_records')
      .insert({
        parent_type: parentType || 'RESULT_SUBMISSION',
        parent_id: parentId || 'pending',
        election_id: assignment.election_id,
        polling_unit_id: assignment.polling_unit_id,
        volunteer_id: volunteer.id,
        file_id: filePath,
        sha256_hash: hashHex,
        mime_type: file.type,
        file_size_bytes: file.size,
        captured_at: new Date().toISOString(),
        is_public: false,
        access_level: 'ADMIN_ONLY',
      })
      .select('id')
      .single();

    if (evidenceError) {
      console.error('Error creating evidence record:', evidenceError);
      return NextResponse.json({ error: 'Failed to create evidence record' }, { status: 500 });
    }

    // Log audit event
    await supabase.from('audit_log').insert({
      actor_id: volunteer.id,
      actor_type: 'VOLUNTEER',
      action: 'EVIDENCE_UPLOADED',
      resource_type: 'evidence_records',
      resource_id: evidence.id,
      metadata: JSON.stringify({
        file_path: filePath,
        sha256_hash: hashHex,
        file_size: file.size,
      }),
    });

    return NextResponse.json({ 
      success: true, 
      id: evidence.id,
      file_path: filePath,
      sha256_hash: hashHex,
    });
  } catch (error) {
    console.error('Error uploading evidence:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
