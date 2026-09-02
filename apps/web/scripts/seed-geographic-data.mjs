/**
 * Seed Nigerian Electoral Geography via Supabase Management API SQL endpoint.
 * Uses PostgreSQL CTEs for correct hierarchy (states → LGAs → wards → PUs).
 *
 * Usage: SUPABASE_API_TOKEN=xxx node scripts/seed-geographic-data.mjs
 */

const SUPABASE_API_TOKEN = process.env.SUPABASE_API_TOKEN;
const PROJECT_REF = "lvtfrfrnqxqwjuematum";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

if (!SUPABASE_API_TOKEN) {
  console.error("Set SUPABASE_API_TOKEN environment variable");
  process.exit(1);
}

async function runSQL(label, sql) {
  process.stdout.write(`${label}... `);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) { console.log("✅"); return true; }
    else { const err = await res.text(); console.log(`❌ ${err.slice(0, 200)}`); return false; }
  } catch (e) { console.log(`❌ ${e.message}`); return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. States ──
const STATES_SQL = `
INSERT INTO states (name, code) VALUES
  ('Abia','AB'),('Adamawa','AD'),('Akwa Ibom','AK'),('Anambra','AN'),
  ('Bauchi','BA'),('Bayelsa','BY'),('Benue','BE'),('Borno','BO'),
  ('Cross River','CR'),('Delta','DE'),('Ebonyi','EB'),('Edo','ED'),
  ('Ekiti','EK'),('Enugu','EN'),('FCT','FC'),('Gombe','GO'),
  ('Imo','IM'),('Jigawa','JI'),('Kaduna','KD'),('Kano','KN'),
  ('Katsina','KT'),('Kebbi','KB'),('Kogi','KG'),('Kwara','KW'),
  ('Lagos','LA'),('Nasarawa','NA'),('Niger','NI'),('Ogun','OG'),
  ('Ondo','ON'),('Osun','OS'),('Oyo','OY'),('Plateau','PL'),
  ('Rivers','RV'),('Sokoto','SO'),('Taraba','TA'),('Yobe','YO'),
  ('Zamfara','ZF')
ON CONFLICT (code) DO NOTHING;
`;

// ── 2. LGAs per state (representative counts matching INEC) ──
const LGA_COUNTS = {
  AB:17,AD:21,AK:31,AN:21,BA:20,BY:8,BE:23,BO:27,CR:18,DE:25,EB:13,ED:18,
  EK:16,EN:17,FC:6,GO:11,IM:27,JI:27,KD:23,KN:44,KT:34,KB:23,KG:21,KW:16,
  LA:20,NA:13,NI:25,OG:20,ON:18,OS:30,OY:33,PL:17,RV:23,SO:23,TA:16,YO:17,ZF:14
};

const WARD_COUNT = 12; // per LGA
const PU_COUNT = 5; // per ward (real data has ~20)

function generateLGAsSQL() {
  const lines = [];
  for (const [code, count] of Object.entries(LGA_COUNTS)) {
    for (let i = 1; i <= count; i++) {
      lines.push(`('${code}', '${String(i).padStart(2, "0")}')`);
    }
  }
  return `
INSERT INTO lgas (state_id, name, code)
SELECT s.id, s.code || ' LGA ' || v.num, s.code || v.num
FROM states s
CROSS JOIN (VALUES ${lines.join(",")}) AS v(state_code, num)
WHERE s.code = v.state_code
ON CONFLICT (state_id, code) DO NOTHING;
`;
}

function generateWardsSQL() {
  const lines = [];
  for (const [stateCode, lgaCount] of Object.entries(LGA_COUNTS)) {
    for (let lga = 1; lga <= lgaCount; lga++) {
      for (let w = 1; w <= WARD_COUNT; w++) {
        lines.push(`('${stateCode}${String(lga).padStart(2, "0")}', '${String(w).padStart(2, "0")}')`);
      }
    }
  }
  // Split into chunks to avoid query size limits
  const CHUNK = 3000;
  const chunks = [];
  for (let i = 0; i < lines.length; i += CHUNK) {
    chunks.push(lines.slice(i, i + CHUNK));
  }
  return chunks.map((chunk, idx) => `
INSERT INTO wards (lga_id, name, code)
SELECT l.id, 'Ward ' || v.ward_num, l.code || v.ward_num
FROM lgas l
CROSS JOIN (VALUES ${chunk.join(",")}) AS v(lga_code, ward_num)
WHERE l.code = v.lga_code
ON CONFLICT (lga_id, code) DO NOTHING;
`);
}function generatePUsSQL() {
  const lines = [];
  for (const [stateCode, lgaCount] of Object.entries(LGA_COUNTS)) {
    for (let lga = 1; lga <= lgaCount; lga++) {
      for (let w = 1; w <= WARD_COUNT; w++) {
        for (let p = 1; p <= PU_COUNT; p++) {
          const lgaCode = `${stateCode}${String(lga).padStart(2, "0")}`;
          const wardCode = `${lgaCode}${String(w).padStart(2, "0")}`;
          const puCode = `${wardCode}${String(p).padStart(2, "0")}`;
          const lat = (4 + Math.random() * 10).toFixed(6);
          const lng = (3 + Math.random() * 11).toFixed(6);
          const voters = 500 + Math.floor(Math.random() * 2000);
          lines.push(`('${stateCode}', '${lgaCode}', '${wardCode}', '${puCode}', 'PU ${p}', ${lat}, ${lng}, ${voters})`);
        }
      }
    }
  }
  const CHUNK = 1500;
  const chunks = [];
  for (let i = 0; i < lines.length; i += CHUNK) {
    chunks.push(lines.slice(i, i + CHUNK));
  }
  return chunks.map((chunk) => `
INSERT INTO polling_units (state_id, lga_id, ward_id, official_code, name, latitude, longitude, registered_voters)
SELECT s.id, l.id, w.id, v.pu_code, v.name, v.lat, v.lng, v.voters
FROM (VALUES ${chunk.join(", ")}) AS v(state_code, lga_code, ward_code, pu_code, name, lat, lng, voters)
JOIN states s ON s.code = v.state_code
JOIN lgas l ON l.state_id = s.id AND l.code = v.lga_code
JOIN wards w ON w.lga_id = l.id AND w.code = v.ward_code
ON CONFLICT (official_code) DO NOTHING;
`);
}

async function main() {
  console.log("=== Seeding Nigerian Electoral Geography ===\n");

  // States
  await runSQL("States (37)", STATES_SQL);
  await sleep(300);

  // LGAs
  await runSQL("LGAs", generateLGAsSQL());
  await sleep(500);

  // Wards (in chunks)
  const wardSQLs = generateWardsSQL();
  for (let i = 0; i < wardSQLs.length; i++) {
    await runSQL(`Wards chunk ${i + 1}/${wardSQLs.length}`, wardSQLs[i]);
    await sleep(500);
  }

  // Polling units (in chunks)
  const puSQLs = generatePUsSQL();
  for (let i = 0; i < puSQLs.length; i++) {
    await runSQL(`Polling Units chunk ${i + 1}/${puSQLs.length}`, puSQLs[i]);
    await sleep(500);
  }

  // Verify
  console.log("\n--- Verification ---");
  await runSQL("Counts", `
    SELECT 'states' as tbl, count(*) as cnt FROM states
    UNION ALL SELECT 'lgas', count(*) FROM lgas
    UNION ALL SELECT 'wards', count(*) FROM wards
    UNION ALL SELECT 'polling_units', count(*) FROM polling_units
    UNION ALL SELECT 'parties', count(*) FROM parties;
  `);

  console.log("\n=== Done ===");
}

main().catch(console.error);
