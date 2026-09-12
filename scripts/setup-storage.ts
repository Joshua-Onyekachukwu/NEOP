/**
 * Setup Supabase Storage Buckets
 * Creates evidence and avatar storage buckets
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lgdubqovtyvzckvpbtrs.supabase.co';
const supabaseServiceRoleKey = '';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function setupStorage() {
  console.log('Setting up Supabase storage buckets...\n');

  // Create evidence bucket (private)
  const { error: evidenceError } = await supabase.storage.createBucket('evidence', {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024, // 20MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  });

  if (evidenceError) {
    if (evidenceError.message.includes('already exists')) {
      console.log('✓ Evidence bucket already exists');
    } else {
      console.error('Error creating evidence bucket:', evidenceError.message);
    }
  } else {
    console.log('✓ Evidence bucket created');
  }

  // Create avatars bucket (public)
  const { error: avatarError } = await supabase.storage.createBucket('avatars', {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });

  if (avatarError) {
    if (avatarError.message.includes('already exists')) {
      console.log('✓ Avatars bucket already exists');
    } else {
      console.error('Error creating avatars bucket:', avatarError.message);
    }
  } else {
    console.log('✓ Avatars bucket created');
  }

  // Set up storage policies for evidence bucket
  const evidencePolicies = [
    // Allow authenticated users to upload
    {
      name: 'Authenticated users can upload evidence',
      definition: {
        bucket_id: 'evidence',
        operation: 'INSERT',
        policy: 'auth.role() = \'authenticated\'',
      },
    },
    // Allow owners to read their own evidence
    {
      name: 'Owners can read their evidence',
      definition: {
        bucket_id: 'evidence',
        operation: 'SELECT',
        policy: 'auth.uid() = (storage.foldername(name))[1]::uuid',
      },
    },
    // Allow admins to read all evidence
    {
      name: 'Admins can read all evidence',
      definition: {
        bucket_id: 'evidence',
        operation: 'SELECT',
        policy: 'EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)',
      },
    },
  ];

  console.log('\nStorage policies should be set up in Supabase Dashboard.');
  console.log('Go to Storage > Policies and add the necessary policies.');

  console.log('\n=== STORAGE SETUP COMPLETE ===');
}

setupStorage().catch(console.error);
