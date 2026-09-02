/**
 * Seed polling units only (states, LGAs, wards already seeded).
 * Uses small batches to avoid query size limits.
 */

const TOKEN = process.env.SUPABASE_API_TOKEN;
const URL = "https://api.supabase.com/v1/projects/lvtfrfrnqxqwjuematum/database/query";

async function runSQL(label, sql) {
  process.stdout.write(label + "... ");
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.ok) { console.log("✅"); return true; }
  const err = await res.text();
  console.log("❌ " + err.slice(0, 150));
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LGA_COUNTS = {
  AB:17,AD:21,AK:31,AN:21,BA:20,BY:8,BE:23,BO:27,CR:18,DE:25,EB:13,ED:18,
  EK:16,EN:17,FC:6,GO:11,IM:27,JI:27,KD:23,KN:44,KT:34,KB:23,KG:21,KW:16,
  LA:20,NA:13,NI:25,OG:20,ON:18,OS:30,OY:33,PL:17,RV:23,SO:23,TA:16,YO:17,ZF:14
};

async function main() {
  console.log("=== Seeding Polling Units ===\n");

  // Generate all PU rows
  const rows = [];
  for (const [sc, lgaN] of Object.entries(LGA_COUNTS)) {
    for (let l = 1; l <= lgaN; l++) {
      for (let w = 1; w <= 12; w++) {
        for (let p = 1; p <= 5; p++) {
          const lc = sc + String(l).padStart(2, "0");
          const wc = lc + String(w).padStart(2, "0");
          const pc = wc + String(p).padStart(2, "0");
          const lat = (4 + Math.random() * 10).toFixed(6);
          const lng = (3 + Math.random() * 11).toFixed(6);
          const voters = 500 + Math.floor(Math.random() * 2000);
          rows.push({ sc, lc, wc, pc, lat, lng, voters });
        }
      }
    }
  }

  console.log(`Total: ${rows.length} polling units\n`);

  // Insert in small batches of 200
  const BATCH = 200;
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vals = batch.map(r =>
      `('${r.sc}','${r.lc}','${r.wc}','${r.pc}','PU ${r.pc.slice(-2)}',${r.lat},${r.lng},${r.voters})`
    ).join(",");

    const sql = `
INSERT INTO polling_units (state_id, lga_id, ward_id, official_code, name, latitude, longitude, registered_voters)
SELECT s.id, l.id, w.id, v.pc, v.name, v.lat, v.lng, v.voters
FROM (VALUES ${vals}) AS v(sc, lc, wc, pc, name, lat, lng, voters)
JOIN states s ON s.code = v.sc
JOIN lgas l ON l.state_id = s.id AND l.code = v.lc
JOIN wards w ON w.lga_id = l.id AND w.code = v.wc
ON CONFLICT (official_code) DO NOTHING;`;

    const num = Math.floor(i / BATCH) + 1;
    const total = Math.ceil(rows.length / BATCH);
    if (await runSQL(`Batch ${num}/${total}`, sql)) ok += batch.length;
    else fail += batch.length;
    await sleep(300);
  }

  console.log(`\nDone: ${ok} inserted, ${fail} failed`);
}

main().catch(console.error);
