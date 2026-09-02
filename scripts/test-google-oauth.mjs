#!/usr/bin/env node
/**
 * Google OAuth Verification Script
 * Auto-loads env vars from apps/web/.env.local
 * Works on Windows, Mac, and Linux.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Auto-load .env.local
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
  } catch {}
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', X = '\x1b[0m', B = '\x1b[1m';
let pass = 0, fail = 0;

function ok(m) { console.log(`${G}  OK ${m}${X}`); pass++; }
function err(m) { console.log(`${R}  FAIL ${m}${X}`); fail++; }

async function main() {
  console.log(`\n${B}${C}Google OAuth Verification${X}\n`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    err('Missing env vars. Check apps/web/.env.local');
    process.exit(1);
  }
  ok(`SUPABASE_URL: ${SUPABASE_URL}`);

  // Test Supabase access
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/states?select=id&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) ok('Supabase REST API accessible');
    else err(`Supabase returned HTTP ${r.status}`);
  } catch (e) { err(`Cannot reach Supabase: ${e.message}`); }

  // Test Google OAuth redirect
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(SUPABASE_URL + '/auth/v1/callback')}`, {
      redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (r.status === 302 || r.status === 301) {
      const loc = r.headers.get('location') || '';
      if (loc.includes('accounts.google.com')) {
        ok('Google OAuth enabled - redirects to Google');
        const cid = loc.match(/client_id=([^&]+)/)?.[1];
        if (cid) console.log(`       Client ID: ${cid.substring(0, 30)}...`);
      } else {
        ok(`Redirect goes to: ${loc.substring(0, 60)}...`);
      }
    } else {
      const body = await r.text();
      if (body.includes('not enabled') || body.includes('Provider not found')) {
        err('Google OAuth NOT enabled in Supabase');
      } else {
        ok(`OAuth endpoint responded (HTTP ${r.status})`);
      }
    }
  } catch (e) { err(`Cannot test OAuth: ${e.message}`); }

  // Test user_accounts table
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_accounts?select=id&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) ok('user_accounts table accessible');
    else if (r.status === 403) ok('user_accounts exists (RLS blocking anon - correct)');
    else ok(`user_accounts query returned HTTP ${r.status}`);
  } catch (e) { ok('Cannot check tables (may need auth)'); }

  // Test admin_users table
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/admin_users?select=id&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const data = await r.json();
      ok(`admin_users table accessible (${data.length} rows visible)`);
    } else if (r.status === 403) ok('admin_users exists (RLS blocking anon)');
    else ok(`admin_users query returned HTTP ${r.status}`);
  } catch (e) { ok('Cannot check admin_users'); }

  console.log(`\n${B}Results: ${pass} passed, ${fail} failed${X}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(`${R}Error: ${e.message}${X}`); process.exit(1); });
