/**
 * Deploy NEOP_COMPLETE_SCHEMA.sql to the new Supabase project.
 * Sends the entire SQL file as a single query (PL/pgSQL needs $$ delimiters intact).
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPABASE_API_TOKEN = process.env.SUPABASE_API_TOKEN;
const PROJECT_REF = "lvtfrfrnqxqwjuematum";

if (!SUPABASE_API_TOKEN) {
  console.error("Set SUPABASE_API_TOKEN environment variable");
  process.exit(1);
}

const schemaPath = resolve(__dirname, "../../../supabase/NEOP_COMPLETE_SCHEMA.sql");
const sql = readFileSync(schemaPath, "utf-8");

console.log(`Deploying schema from ${schemaPath}`);
console.log(`SQL length: ${sql.length} characters`);
console.log(`Project: ${PROJECT_REF}`);
console.log("Sending entire schema as single query...\n");

try {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout for large schema
    }
  );

  if (res.ok) {
    const data = await res.json();
    console.log("✅ Schema deployed successfully!");
    console.log("Response:", JSON.stringify(data).slice(0, 500));
  } else {
    const err = await res.text();
    console.error(`❌ Failed (${res.status}):`);
    console.error(err);
  }
} catch (e) {
  console.error(`❌ Error: ${e.message}`);
}
