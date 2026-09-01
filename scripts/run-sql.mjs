#!/usr/bin/env node

/**
 * run-sql.mjs — Execute SQL directly on Supabase
 *
 * Usage:
 *   node scripts/run-sql.mjs "SELECT count(*) FROM parties"
 *   node scripts/run-sql.mjs --file supabase/migrations/100_redistribute_votes_v3.sql
 *   node scripts/run-sql.mjs --file supabase/migrations/101_simulation_history.sql
 *
 * Uses the Supabase Management API with the service role key.
 * Falls back to direct Postgres connection if Management API isn't available.
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envPath = new URL('../apps/web/.env.local', import.meta.url);
const envLines = readFileSync(envPath, 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// Parse arguments
const args = process.argv.slice(2);
let sql = '';

if (args[0] === '--file' && args[1]) {
  const filePath = new URL('../' + args[1], import.meta.url);
  sql = readFileSync(filePath, 'utf8');
  console.log(`📄 Loaded SQL from ${args[1]} (${sql.length} chars)`);
} else if (args.length > 0) {
  sql = args.join(' ');
} else {
  console.error('Usage: node scripts/run-sql.mjs "SELECT * FROM parties LIMIT 5"');
  console.error('       node scripts/run-sql.mjs --file supabase/migrations/100_redistribute_votes_v3.sql');
  process.exit(1);
}

async function executeSQL(sqlText) {
  console.log('\n🔧 Executing SQL...');
  console.log('─'.repeat(60));
  
  // Method 1: Use Supabase RPC if exec_sql exists
  const supabase = createClient(supabaseUrl, serviceKey);
  
  try {
    const { data, error } = await supabase.rpc('exec_sql', { query: sqlText });
    if (!error) {
      console.log('✅ exec_sql RPC succeeded');
      if (data) console.log(JSON.stringify(data, null, 2));
      return true;
    }
    console.log('⚠️  exec_sql not available:', error.message);
  } catch (e) {
    console.log('⚠️  exec_sql not available:', e.message);
  }

  // Method 2: Use Supabase Management API
  // Extract project ref from URL
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  try {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query: sqlText }),
      }
    );
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Management API succeeded');
      console.log(JSON.stringify(result, null, 2));
      return true;
    } else {
      console.log('⚠️  Management API failed:', response.status, result.message || JSON.stringify(result));
    }
  } catch (e) {
    console.log('⚠️  Management API not available:', e.message);
  }

  // Method 3: Direct Postgres connection via Supabase pooler
  // This requires the direct database URL from Supabase dashboard
  console.log('\n❌ Cannot execute SQL directly.');
  console.log('   The database may be down or the exec_sql function doesn\'t exist.');
  console.log('   Please run this SQL in the Supabase SQL Editor:');
  console.log('─'.repeat(60));
  console.log(sqlText.substring(0, 500));
  if (sqlText.length > 500) console.log('... (' + (sqlText.length - 500) + ' more chars)');
  
  return false;
}

async function main() {
  // Split SQL by semicolons for multi-statement execution
  // But only for simple statements — keep DO blocks intact
  const success = await executeSQL(sql);
  
  if (!success) {
    process.exit(1);
  }
}

main().catch(console.error);
