const fs = require("fs"); const path = require("path");
const envFile = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
for (const ln of envFile.split(/\r?\n/)) {
  if (!ln || ln.startsWith("#")) continue;
  const i = ln.indexOf("="); if (i < 0) continue;
  const k = ln.slice(0,i).trim(), v = ln.slice(i+1).trim().replace(/^"|"$/g,"");
  if (!(k in process.env)) process.env[k] = v;
}
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const { createClient } = require("@supabase/supabase-js");
if (!SB_URL || !SB_KEY) { console.error("MISSING ENV", {SB_URL, SB_KEY_LEN: (SB_KEY||"").length}); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY);

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function fnv1a(str){ let h=0x811c9dc5; for (let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,0x01000193);} return h>>>0; }

function allocLargestRemainder(total, weights){
  if (!weights.length) return [];
  const sumW = weights.reduce((a,b)=>a+b,0) || 1;
  const exact = weights.map(w => total*w/sumW);
  const floors = exact.map(e => Math.floor(e));
  let remain = total - floors.reduce((a,b)=>a+b,0);
  const frac = exact.map((e,i)=>({i, f: e - floors[i]}));
  frac.sort((a,b)=>b.f-a.f);
  const res = [...floors];
  for (let k=0;k<remain;k++) res[frac[k % frac.length].i]++;
  return res;
}

function seededRandoms(puIdStr, idx, delta){
  const seed = (fnv1a(puIdStr + "_" + idx + "_" + (delta||0))) >>> 0;
  return mulberry32(seed);
}

async function main() {
  const partiesRes = await sb.from("parties").select("id,abbreviation,official_name as name,color").order("id",{ascending:true});
  let parties = partiesRes.data || [];
  if (parties.length === 0) {
    const seed = [
      ['APC','All Progressives Congress','#3a6ea5'],
      ['PDP','Peoples Democratic Party','#b45f06'],
      ['LP','Labour Party','#38761d'],
      ['NNPP','New Nigeria Peoples Party','#990000'],
      ['APGA','All Progressives Grand Alliance','#e69138'],
      ['SDP','Social Democratic Party','#674ea7'],
      ['YPP','Young Progressives Party','#f1c232'],
      ['ADC','African Democratic Congress','#1155cc'],
      ['NDC','National Democratic Congress','#cc4125']
    ];
    const newIds = [];
    for (const [abbr,off,col] of seed) {
      const ins = await sb.from("parties").insert({ official_name: off, abbreviation: abbr, color: col }).select("id,abbreviation,official_name as name,color").maybeSingle();
      if (ins.data) { parties.push(ins.data); newIds.push(abbr); }
    }
    console.log("seeded parties on-the-fly (not in DB before)=", newIds.length);
  }
  console.log("parties total=", parties.length, "party_ids_sample=", parties.slice(0,3).map(p=>({abbr:p.abbreviation,id:p.id?.slice(0,6)})));

  const stateRes = await sb.from("states").select("id,code,name").limit(3);
  const stateIds = stateRes.data.map(s=>s.id);
  console.log("stateIds=", stateIds);

  const pus = [];
  for (const sid of stateIds) {
    const r = await sb.from("polling_units").select("id,state_id,lga_id,ward_id,official_code,name,registered_voters,latitude,longitude").eq("state_id", sid).limit(9).order("created_at",{ascending:true});
    for (const p of (r.data||[])) pus.push(p);
  }
  while (pus.length < 25) {
    const r = await sb.from("polling_units").select("id,state_id,lga_id,ward_id,official_code,name,registered_voters,latitude,longitude").limit(10).order("created_at",{ascending:true});
    for (const p of (r.data||[])) if (!pus.find(x=>x.id===p.id)) pus.push(p);
    if (pus.length >= 25) break;
  }
  const selected = pus.slice(0, 25);
  console.log("selected PUs=", selected.length);

  // create sim election
  const ts = new Date().toISOString().replace(/[-:]/g,"").slice(0,15);
  const e = await sb.from("elections").insert({ name: "[SIM-E2E] 25PU discrepancy=0.15 sep13_"+ts, status:"ACTIVE", type:"PRESIDENTIAL", is_active:true, scheduled_start: new Date().toISOString()}).select("id").single();
  if (e.error) { console.error("ELECTION CREATE", e.error); process.exit(2); }
  const electionId = e.data.id;
  console.log("electionId=", electionId);

  // ensure 50 volunteers + assignments (two per PU). look for existing agents assigned this election else assign 2 per PU
  const { data: existing } = await sb.from("agent_assignments").select("volunteer_id,polling_unit_id").eq("election_id", electionId);
  const existingMap = new Map();
  for (const a of (existing||[])) {
    if (!existingMap.has(a.polling_unit_id)) existingMap.set(a.polling_unit_id, []);
    existingMap.get(a.polling_unit_id).push(a.volunteer_id);
  }
  // preload 50 distinct volunteers that already exist with status REGISTERED/TRAINED
  const vr = await sb.from("volunteers").select("id,user_id,status").order("created_at",{ascending:true}).limit(60);
  const availVols = (vr.data||[]).filter(v=>v.status==="REGISTERED"||v.status==="TRAINED");
  let volIdx = 0;
  const volAssignedSet = new Set();
  const puToAssigns = new Map();
  const ensureAssignCheckIn = async (puId, electionId, vols, maxPerPu=2) => {
    // find existing assignments for this pu+election
    const { data: have } = await sb.from("agent_assignments").select("id,volunteer_id,observer_number,status").eq("election_id", electionId).eq("polling_unit_id", puId);
    let list = (have || []).slice(0, maxPerPu).sort((a,b)=>a.observer_number-b.observer_number);
    // if assignments found but status<CHECKED_IN: upgrade them
    let fixed = 0;
    for (const a of list) {
      if (a.status !== "CHECKED_IN" && a.status !== "SUBMITTED") {
        const up = await sb.from("agent_assignments").update({ status: "CHECKED_IN", location_verified: true, checked_in_at: new Date().toISOString() }).eq("id", a.id);
        if (!up.error) fixed++;
      }
    }
    if (list.length >= maxPerPu) return list;
    // else top up from vols
    let need = maxPerPu - list.length;
    let tries = 0;
    while (need > 0 && tries++ < vols.length * 2) {
      const v = vols.shift(); if (!v) break;
      if (volAssignedSet.has(v.id)) { vols.push(v); continue; }
      const num = (maxPerPu - need + 1);
      const r = await sb.from("agent_assignments").insert({ volunteer_id: v.id, polling_unit_id: puId, election_id: electionId, status: "CHECKED_IN", observer_number: num, location_verified: true, checked_in_at: new Date().toISOString() }).select("id,volunteer_id,observer_number,status").maybeSingle();
      if (!r.error && r.data) { list.push(r.data); volAssignedSet.add(v.id); need--; } else { vols.push(v); }
    }
    return list;
  };
  for (const pu of selected) {
    const puId = pu.id;
    // reload assignment after check-in ensures up-to-date
    const list = await ensureAssignCheckIn(puId, electionId, availVols, 2);
    if (!puToAssigns.has(puId)) puToAssigns.set(puId, []);
    for (const a of list) puToAssigns.get(puId).push(a);
  }
  console.log("assignments ensured CHECKED_IN=", [...puToAssigns.values()].flat().length);

  // for each of 25 PU do 2 submissions (2 agents) discrepancy_rate 0.15: difference between agent reports
  let totalSubmissions = 0;
  for (let pi=0; pi<selected.length; pi++) {
    const pu = selected[pi];
    const puId = pu.id;
    const randBase = mulberry32(fnv1a(puId+"_sep13"));
    // base votes: weights proportional to rand floats across parties, sum scaled to registered ~ 0.6 turnout
    const weights = parties.map((p,i)=> 0.5 + mulberry32(fnv1a(puId+"_party_"+i))() * 1.5);
    const registered = Math.max(50, Number(pu.registered_voters || 200));
    const turnout = Math.floor(registered * (0.55 + randBase()*0.25));
    const base = allocLargestRemainder(Math.max(10,turnout), weights);
    // valid = sum base, rejected ~ 0.02-0.05 turnout
    const rejected = Math.max(1, Math.floor(turnout * (0.02 + randBase()*0.03)));
    const total = Math.max(10, turnout);
    const valid = Math.max(0, total - rejected);

    // discrepancy_rate 0.15: for observer 2 perturb ~15% by +- small shifts
    for (let observer of [1,2]) {
      let partiesArr = base.map(v=>v);
      if (observer === 2) {
        // perturb discrepancy_rate 0.15 across votes proportionally
        const perturbRate = 0.15;
        const changes = partiesArr.map(v => Math.max(0, Math.round(v * (1 + (mulberry32(fnv1a(puId+"_obs2_"+base.indexOf(v))))()*2-1)*perturbRate) - v));
        for (let k=0;k<partiesArr.length;k++) partiesArr[k] = Math.max(0, partiesArr[k] + Math.round(partiesArr[k]*(mulberry32(fnv1a(puId+"_p_"+k+"_obs2"))()*2-1)*perturbRate));
        // rebalance sum to valid again
        const curSum = partiesArr.reduce((a,b)=>a+b,0);
        if (curSum > 0) {
          const scale = valid / curSum;
          partiesArr = allocLargestRemainder(valid, partiesArr.map(v => Math.max(0.01, v*scale)));
        }
      }
      const obsRejected = observer===2 ? Math.max(0, rejected + Math.round(rejected * (mulberry32(fnv1a(puId+"_rej_obs2"))()*2-1)*0.15)) : rejected;
      const obsValid = observer===2 ? Math.max(0, Math.min(valid*1.2, valid + Math.round(valid*(mulberry32(fnv1a(puId+"_val_obs2"))()*2-1)*0.15))) : valid;
      const obsTotal = obsValid + obsRejected;

      const assignList = (puToAssigns.get(puId) || []).sort((a,b)=>a.observer_number-b.observer_number);
      const obs = assignList[Math.min(observer-1, assignList.length-1)];
      const volId = obs ? obs.volunteer_id : (availVols[(pi*2+observer-1) % availVols.length]?.id);
      const assignId = obs ? obs.id : null;
      if (volId && assignId) {
        const idem = (puId + "_o" + observer + "_" + (new Date().getTime().toString(36)));
        const sIns = await sb.from("result_submissions").insert({
          idempotency_key: idem,
          assignment_id: assignId,
          volunteer_id: volId,
          election_id: electionId,
          polling_unit_id: puId,
          valid_votes: obsValid,
          rejected_votes: obsRejected,
          total_votes: obsTotal,
          status: "UNVERIFIED"
        }).select("id").maybeSingle();
        if (!sIns.error && sIns.data) {
          const sid = sIns.data.id;
          const prRows = parties.map((p,i)=>({ result_submission_id: sid, party_id: p.id, votes: Math.max(0, partiesArr[i]||0) }));
          const prIns = await sb.from("party_results").insert(prRows);
          if (!prIns.error) totalSubmissions++;
          else console.error("PARTY_ROW_ERR PU=" + puId.slice(0,6) + " obs=" + observer, prIns.error);
        } else if (sIns.error) { console.error("SUBMIT_ERR PU=" + puId.slice(0,6) + " obs=" + observer, sIns.error); }
      } else {
        console.error("MISSING_VOL_OR_ASSIGN PU=" + puId.slice(0,6) + " obs=" + observer + " vol=" + (!!volId) + " assign=" + (!!assignId));
      }
    }
  }
  console.log("SUBMISSIONS OK=", totalSubmissions);

  // Now run inline pairing + publish exactly like v2-pipeline route does (no need for RPC)
  const subR = await sb.from("result_submissions").select("id,polling_unit_id,election_id,valid_votes,rejected_votes,total_votes,volunteer_id,assignment_id").eq("election_id", electionId).order("polling_unit_id").order("created_at",{ascending:true});
  const byPu = new Map();
  for (const s of (subR.data||[])) { if (!byPu.has(s.polling_unit_id)) byPu.set(s.polling_unit_id,[]); byPu.get(s.polling_unit_id).push(s); }
  console.log("submissions per PUs grouped=", byPu.size);

  // pick admin_id to pass p_created_by (any admin row id)
  let adminId = null;
  const ar = await sb.from("admin_users").select("id").limit(1);
  if (ar.data && ar.data[0]) adminId = ar.data[0].id;

  let pairsOk = 0; let pubCntAfter = 0; let sumMismatchAfter = 0;
  const puList = [...byPu.keys()];
  for (const puId of puList) {
    const arr = byPu.get(puId);
    if (arr.length < 2) continue;
    const s1 = arr[0], s2 = arr[1];
    const pr1 = (await sb.from("party_results").select("party_id,votes").eq("result_submission_id", s1.id)).data || [];
    const pr2 = (await sb.from("party_results").select("party_id,votes").eq("result_submission_id", s2.id)).data || [];
    const m1 = new Map(pr1.map(p=>[p.party_id, Number(p.votes||0)]));
    const m2 = new Map(pr2.map(p=>[p.party_id, Number(p.votes||0)]));
    let iden = s1.valid_votes === s2.valid_votes && s1.rejected_votes === s2.rejected_votes && s1.total_votes === s2.total_votes;
    let md = 0;
    const all = new Set([...m1.keys(), ...m2.keys()]);
    for (const k of all) { const d = Math.abs((m1.get(k)||0) - (m2.get(k)||0)); if (d>0) iden=false; if (d>md) md=d; }
    if (m1.size !== m2.size) iden=false;
    const shouldMatch = iden && md <= 2;

    const pubParties = JSON.stringify(pr1.map(p=>({ party_id: p.party_id, votes: Number(p.votes||0)})));
    const v1 = await sb.from("verifications").insert({
      election_id: electionId, polling_unit_id: puId, submission_id_1: s1.id, submission_id_2: s2.id,
      status: shouldMatch ? "MATCH" : "DISCREPANCY", submissions_identical: iden, math_consistent: md <= 2,
      final_decision: shouldMatch ? "MATCH" : "DISCREPANCY"
    }).select("id").maybeSingle();
    const vid = v1.data?.id || null;

    if (shouldMatch) {
      try {
        const prr = await sb.rpc("publish_canonical_result", {
          p_election_id: electionId, p_polling_unit_id: puId, p_status: "PUBLISHED",
          p_valid_votes: Number(s1.valid_votes||0), p_rejected_votes: Number(s1.rejected_votes||0), p_total_votes: Number(s1.total_votes||0),
          p_source_1: s1.id, p_source_2: s2.id, p_party_votes: pubParties, p_created_by: adminId
        });
        const cid = (Array.isArray(prr.data) && prr.data[0]?.out_canonical_id) || (prr.data && prr.data.out_canonical_id) || null;
        if (vid && cid) { await sb.from("verifications").update({ canonical_result_id: cid }).eq("id", vid); }
        if (cid) pubCntAfter++;
      } catch (e) { /* skip */ }
    } else {
      await sb.from("canonical_pu_results").insert({
        election_id: electionId, polling_unit_id: puId, status: "HUMAN_REVIEW",
        source_submission_1: s1.id, source_submission_2: s2.id,
        valid_votes: Number(s1.valid_votes||0), rejected_votes: Number(s1.rejected_votes||0), total_votes: Number(s1.total_votes||0)
      });
    }
    pairsOk++;
  }
  console.log("pairs processed=", pairsOk, "canonical PUBLISHED via publish_canonical_result=", pubCntAfter);

  await new Promise(r=>setTimeout(r, 8_000));

  // final counts
  const tables = ["result_submissions","verifications","canonical_pu_results","canonical_party_results","verification_timeline_events"];
  const filters = { result_submissions: {election_id: electionId}, verifications: {election_id: electionId} };
  for (const t of tables) {
    const b = sb.from(t).select("id", {count:"exact", head:true});
    if (filters[t]) { for (const k in filters[t]) b.eq(k, filters[t][k]); }
    const r = await b;
    console.log("COUNT " + t + " =", r.count ?? 0);
  }

  // published canonical sum check
  const { data: pub } = await sb.from("canonical_pu_results").select("id,valid_votes,rejected_votes,total_votes,status,polling_unit_id").eq("election_id", electionId);
  const pubCnt = (pub||[]).filter(p=>p.status==="PUBLISHED").length;
  console.log("canonical PUBLISHED=", pubCnt);
  let mismatchSum = 0;
  for (const r of (pub||[]).filter(x=>x.status==="PUBLISHED")) {
    const { data: cp } = await sb.from("canonical_party_results").select("votes").eq("canonical_result_id", r.id);
    const s = (cp||[]).reduce((a,b)=>a+Number(b.votes||0),0);
    if (s !== Number(r.valid_votes||0)) { console.log("PARTY SUM MISMATCH canonical=" + r.id.slice(0,8) + " valid=" + r.valid_votes + " sumParties=" + s); mismatchSum++; }
  }
  console.log("party-sum mismatches=", mismatchSum);

  process.exit(0);
}
main().catch(err=>{ console.error("TOP_ERR", err); process.exit(99); });
