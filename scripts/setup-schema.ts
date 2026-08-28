/**
 * Run Supabase SQL schema setup
 * This script creates all tables, indexes, RLS policies, and triggers
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = process.env.SUPABASE_URL || 'https://lgdubqovtyvzckvpbtrs.supabase.co';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function runSchema() {
  console.log('Running schema setup...');
  
  const schemaPath = path.join(__dirname, '../supabase/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  
  // Split by semicolons and execute each statement
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  let success = 0;
  let errors = 0;
  
  for (const statement of statements) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' });
      if (error) {
        console.error(`Error executing statement: ${error.message}`);
        errors++;
      } else {
        success++;
      }
    } catch (err) {
      console.error(`Error: ${err}`);
      errors++;
    }
  }
  
  console.log(`Schema setup complete: ${success} success, ${errors} errors`);
}

runSchema().catch(console.error);
