const fs = require("fs"), path = require("path");
const envFile = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
for (const ln of envFile.split(/\r?\n/)) {
  if (!ln || ln.startsWith("#")) continue;
  const i = ln.indexOf("="); if (i < 0) continue;
  const k = ln.slice(0, i).trim(), v = ln.slice(i + 1).trim().replace(/^"|"$/g, "");
  if (!(k in process.env)) process.env[k] = v;
}
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(SB_URL, SB_KEY);
const SUB = "c9c2cabe-5c7c-41e0-9990-c012ca3b91b3"; // probe submission from manual RPC test

(async () => {
  const { data: pt } = await sb.from("parties").select("id").limit(1);
  const ins = await sb.from("party_results").insert({
    result_submission_id: SUB,
    party_id: pt[0].id,
    votes: 7,
  }).select();
  console.log("insert:", JSON.stringify(ins).slice(0, 200));
  const imm = await sb.from("party_results").select("votes").eq("result_submission_id", SUB);
  console.log("immediately after:", JSON.stringify(imm.data));
  await new Promise((r) => setTimeout(r, 5000));
  const later = await sb.from("party_results").select("votes").eq("result_submission_id", SUB);
  console.log("after 5s:", JSON.stringify(later.data));
  const { count } = await sb.from("party_results").select("id", { count: "exact", head: true });
  console.log("total party_results rows:", count);
})();
