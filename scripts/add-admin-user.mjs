#!/usr/bin/env node
/**
 * Add Admin User by Email
 * Works on Windows (PowerShell), Mac, and Linux.
 * 
 * Usage:
 *   node scripts/add-admin-user.mjs onyekachukwujoshua39@gmail.com
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local from apps/web
function loadEnv() {
  try {
    const envPath = join(__dirname, '..', 'apps', 'web', '.env.local');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (e) {
    console.error('Could not load .env.local:', e.message);
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function addAdmin(email) {
  console.log(`\nAdding admin: ${email}\n`);
  
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    console.error('Make sure apps/web/.env.local exists with these values.');
    process.exit(1);
  }
  
  // Find user in user_accounts
  console.log('1. Looking up user in user_accounts...');
  const searchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_accounts?email=eq.${encodeURIComponent(email)}&select=id,email,full_name`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  
  let userData = null;
  if (searchRes.ok) {
    const users = await searchRes.json();
    if (users.length > 0) {
      userData = users[0];
      console.log(`   Found user: ${userData.email} (id: ${userData.id})`);
    }
  }
  
  if (!userData) {
    // Try to find in auth.users
    console.log('   User not in user_accounts. Checking auth.users...');
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    
    if (authRes.ok) {
      const authData = await authRes.json();
      const authUser = authData.users?.find(u => u.email === email);
      if (authUser) {
        console.log(`   Found in auth.users (id: ${authUser.id})`);
        console.log('   Creating user_accounts record...');
        
        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_accounts`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            id: authUser.id,
            email: authUser.email,
            full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
            avatar_url: authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || '',
            auth_provider: authUser.app_metadata?.provider || 'google',
          }),
        });
        
        if (insertRes.ok) {
          const created = await insertRes.json();
          userData = created[0];
          console.log('   Created user_accounts record');
        } else {
          const err = await insertRes.text();
          console.error(`   Failed to create: ${err}`);
          process.exit(1);
        }
      } else {
        console.error(`   User not found in auth.users either.`);
        console.error('   They need to sign in with Google first at /agent/login');
        process.exit(1);
      }
    }
  }
  
  if (!userData) {
    console.error('Could not find or create user record.');
    process.exit(1);
  }
  
  // Check if already admin
  console.log('\n2. Checking if already admin...');
  const adminCheckRes = await fetch(
    `${SUPABASE_URL}/rest/v1/admin_users?user_id=eq.${userData.id}&select=id,role,is_active`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  
  if (adminCheckRes.ok) {
    const admins = await adminCheckRes.json();
    if (admins.length > 0 && admins[0].is_active) {
      console.log(`   Already an admin (role: ${admins[0].role})`);
      console.log(`\nDone! ${email} already has admin access.\n`);
      return;
    }
  }
  
  // Add as admin
  console.log('3. Adding as SUPER_ADMIN...');
  const insertAdminRes = await fetch(`${SUPABASE_URL}/rest/v1/admin_users`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ user_id: userData.id, role: 'SUPER_ADMIN', is_active: true }),
  });
  
  if (insertAdminRes.ok) {
    console.log('   Added as SUPER_ADMIN');
    console.log(`\nSUCCESS! ${email} is now a SUPER_ADMIN`);
    console.log('They can sign in at /admin/login with Google OAuth.\n');
  } else {
    const err = await insertAdminRes.text();
    console.error(`   Failed: ${err}`);
    process.exit(1);
  }
}

const email = process.argv[2];
if (!email) {
  console.log('Usage: node scripts/add-admin-user.mjs <email>');
  console.log('Example: node scripts/add-admin-user.mjs onyekachukwujoshua39@gmail.com');
  process.exit(1);
}

addAdmin(email).catch(e => { console.error('Error:', e.message); process.exit(1); });
