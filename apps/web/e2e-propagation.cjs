// One-off controlled propagation test through the real ingestion function.
// Values are visible test data (PDP 120 / APC 80 / LP 40), cleaned up after.
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const s = createClient(url, key);

(async () => {
  const { data: el } = await s.from("elections").select("id,name").ilike("name", "[SIM]%").order("created_at", { ascending: false }).limit(1);
  const e = el[0];
  console.log("election:", e.name);

  const { data: assigned } = await s.from("agent_assignments").select("polling_unit_id").eq("election_id", e.id).limit(500);
  const puIds = assigned.map(a => a.polling_unit_id);
  const { data: canon } = await s.from("canonical_pu_results").select("polling_unit_id").eq("election_id", e.id).in("polling_unit_id", puIds).eq("status", "PUBLISHED");
  const have = new Set((canon || []).map(c => c.polling_unit_id));
  const free = puIds.filter(id => !have.has(id));
  if (!free.length) { console.log("no free PU in first 500 assignments"); process.exit(1); }

  const { data: target } = await s.from("polling_units").select("id,official_code,states(name),lgas(name)").eq("id", free[0]).single();
  console.log("target PU:", target.official_code, "|", target.lgas?.name, "/", target.states?.name);

  // parties
  const { data: parties } = await s.from("parties").select("id,abbreviation").in("abbreviation", ["PDP", "APC", "LP"]);
  const pid = Object.fromEntries(parties.map(p => [p.abbreviation, p.id]));

  const { data: agents } = await s.from("agent_assignments").select("agent_id").eq("election_id", e.id).eq("polling_unit_id", target.id).limit(1);
  const agentId = agents?.[0]?.agent_id || null;

  // baseline
  const { data: before, error: bErr } = await s.rpc("get_election_summary");
  if (bErr) { console.log("summary error:", bErr.message); process.exit(1); }
  const sum = typeof before === "string" ? JSON.parse(before) : before;
  const pick = (x) => x.election_id === e.id ? x : null;
  console.log("summary is election-scoped?", Array.isArray(before) ? "array" : typeof before, Object.keys(sum).slice(0,6).join(','));

  const votes = [
    { party_id: pid.PDP, votes: 120 },
    { party_id: pid.APC, votes: 80 },
    { party_id: pid.LP, votes: 40 },
  ];
  const { data: pub, error: pubErr } = await s.rpc("publish_canonical_result", {
    p_election_id: e.id,
    p_polling_unit_id: target.id,
    p_status: "PUBLISHED",
    p_valid_votes: 240,
    p_rejected_votes: 10,
    p_total_votes: 250,
    p_source_1: agentId,
    p_source_2: null,
    p_party_votes: votes,
    p_created_by: null,
  });
  if (pubErr) { console.log("publish error:", pubErr.message); process.exit(1); }
  const canonicalId = Array.isArray(pub) ? pub[0]?.canonical_result_id : pub?.canonical_result_id;
  console.log("published canonical:", canonicalId);

  await new Promise(r => setTimeout(r, 1500));
  const { data: afterRaw } = await s.rpc("get_election_summary");
  const after = typeof afterRaw === "string" ? JSON.parse(afterRaw) : afterRaw;
  const coveredKey = Object.keys(after.national).find(k => k.includes("covered")) || "covered_pus";
  console.log("after national:", after.national.total_valid_votes, "| covered:", after.national[coveredKey]);
  console.log("DELTA valid:", after.national.total_valid_votes - sum.national.total_valid_votes, "(240 on first publish, 0 on supersede-rerun)");
  const partyDelta = {};
  for (const p of after.parties || []) {
    const b = (sum.parties || []).find(x => x.party_id === p.party_id);
    const valKey = p.valid_votes !== undefined ? "valid_votes" : "total_votes";
    const bVal = b ? (b.valid_votes !== undefined ? b.valid_votes : b.total_votes) : 0;
    partyDelta[p.abbreviation] = p[valKey] - bVal;
  }
  console.log("party deltas:", JSON.stringify(partyDelta), "(120/80/40 first run; 0/0/0 on supersede-rerun)");
  const canonicalId2 = Array.isArray(pub) ? pub[0]?.out_canonical_id : pub?.out_canonical_id;
  console.log("superseded count:", Array.isArray(pub) ? pub[0]?.out_was_superseded_count : pub?.out_was_superseded_count, "(1 = replaced, not added)");
  console.log("CLEANUP_CANONICAL=" + (canonicalId2 || canonicalId));
  console.log("CLEANUP_PU=" + target.id);
})();
