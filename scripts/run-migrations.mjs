/**
 * Run SQL migrations directly via Supabase REST API.
 * Usage: node scripts/run-migrations.mjs <migration_number>
 * Example: node scripts/run-migrations.mjs 036
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Read .env.local
const envPath = join(ROOT, "apps/web/.env.local");
const envFile = readFileSync(envPath, "utf8");
const env = {};
envFile.split("\n").filter(l => l && !l.startsWith("#")).forEach(l => {
  const [k, ...v] = l.split("=");
  if (k) env[k.trim()] = v.join("=").trim();
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const migrationNum = process.argv[2];
if (!migrationNum) {
  console.log("Usage: node scripts/run-migrations.mjs <number>");
  console.log("Example: node scripts/run-migrations.mjs 036");
  process.exit(1);
}

const sqlPath = join(ROOT, `supabase/migrations/${migrationNum}_*.sql`);
const { readdirSync } = await import("fs");
const migrationsDir = join(ROOT, "supabase/migrations");
const files = readdirSync(migrationsDir).filter(f => f.startsWith(migrationNum));
if (files.length === 0) {
  console.error(`No migration found starting with ${migrationNum}`);
  process.exit(1);
}

const sqlFile = join(migrationsDir, files[0]);
console.log(`Running: ${files[0]}`);
const sql = readFileSync(sqlFile, "utf8");

console.log(`SQL length: ${sql.length} chars`);
console.log("Executing via Supabase RPC...");

// Split SQL into individual statements and run them
// Supabase's rpc function can handle multi-statement SQL via psql_exec
const { data, error } = await supabase.rpc("exec_sql", { sql_query: sql });

if (error) {
  console.error("RPC exec_sql failed:", error.message);
  console.log("\nTrying alternative: run statements individually...");
  
  // Split by semicolons and run each
  const statements = sql
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length > 10 && !s.startsWith("--"));

  let success = 0;
  let failed = 0;
  for (const stmt of statements) {
    try {
      const { error: stmtError } = await supabase.rpc("exec_sql", { sql_query: stmt });
      if (stmtError) {
        console.error(`  FAILED: ${stmt.substring(0, 80)}...`);
        console.error(`    Error: ${stmtError.message}`);
        failed++;
      } else {
        success++;
      }
    } catch (e) {
      console.error(`  ERROR: ${stmt.substring(0, 50)}... → ${e.message}`);
      failed++;
    }
  }
  console.log(`\nResults: ${success} succeeded, ${failed} failed`);
} else {
  console.log("Success!", data);
}
