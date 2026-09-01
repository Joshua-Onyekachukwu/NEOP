#!/usr/bin/env node

/**
 * run-convex-simulation.mjs
 *
 * Runs the full election simulation (188,042 PUs) in Convex via HTTP.
 * Processes in batches of 5000 PUs (~38 batches).
 * Each batch takes ~5-10 seconds.
 * Total time: ~3-5 minutes.
 */

const CONVEX_URL = "https://flexible-guineapig-4.convex.site/trigger-simulation";
const BATCH_SIZE = 500;
const TOTAL_PUS = 188042;
const SCENARIO = process.argv[2] || "landslide";

async function runBatch(offset, batchSize, scenario) {
  const res = await fetch(CONVEX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "seed",
      scenario,
      offset,
      batchSize,
    }),
  });

  if (!res.ok) {
    throw new Error(`Batch ${offset} failed: ${res.status} ${await res.text()}`);
  }

  return await res.json();
}

async function finalize(scenario) {
  const res = await fetch(CONVEX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finalize", scenario }),
  });

  if (!res.ok) {
    throw new Error(`Finalize failed: ${res.status} ${await res.text()}`);
  }

  return await res.json();
}

async function main() {
  console.log(`\n🗳️  Starting Convex Simulation: ${SCENARIO}`);
  console.log(`   Total PUs: ${TOTAL_PUS.toLocaleString()}`);
  console.log(`   Batch size: ${BATCH_SIZE.toLocaleString()}`);
  console.log(`   Batches: ${Math.ceil(TOTAL_PUS / BATCH_SIZE)}\n`);

  const startTime = Date.now();
  let lastProgress = 0;

  for (let offset = 0; offset < TOTAL_PUS; offset += BATCH_SIZE) {
    const batchStart = Date.now();
    const result = await runBatch(offset, BATCH_SIZE, SCENARIO);
    const batchMs = Date.now() - batchStart;

    if (result.progress > lastProgress) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const rate = Math.round((result.progress / elapsed) * 100) / 100;
      const eta = Math.round((100 - result.progress) / rate);
      console.log(
        `   ✅ ${result.progress}% | ${result.processed.toLocaleString()} PUs | ${batchMs}ms | ETA: ${eta}s`
      );
      lastProgress = result.progress;
    }

    if (result.isComplete) break;
  }

  console.log(`\n📊 Finalizing...`);
  const finalResult = await finalize(SCENARIO);
  const totalTime = Math.round((Date.now() - startTime) / 1000);

  console.log(`\n✅ Simulation Complete!`);
  console.log(`   Scenario: ${SCENARIO}`);
  console.log(`   Total votes: ${(finalResult.totalVotes || 0).toLocaleString()}`);
  console.log(`   Duration: ${totalTime}s`);
  console.log(`\n   Party Totals:`);
  if (finalResult.partyTotals) {
    const sorted = Object.entries(finalResult.partyTotals).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, v]) => s + v, 0);
    for (const [party, votes] of sorted) {
      const pct = total > 0 ? ((votes / total) * 100).toFixed(1) : "0.0";
      console.log(`   ${party.padEnd(6)} ${votes.toLocaleString().padStart(12)} votes (${pct}%)`);
    }
  }
}

main().catch((e) => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
