/**
 * FULL-SCALE SEED v2 — Handles existing data + UNIQUE constraints
 * Skips PUs that already have assignments, creates new ones for the rest.
 * Run: node scripts/seed-final-v2.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const s = createClient(
  "https://lgdubqovtyvzckvpbtrs.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PARTIES = ["APC","PDP","LP","NNPP","APGA","SDP","YPP","ADC"];
const ZS = {
  NW:[.40,.15,.05,.25,.02,.03,.05,.05], NE:[.35,.20,.05,.20,.02,.03,.08,.07],
  NC:[.30,.25,.15,.08,.02,.08,.07,.05], SW:[.35,.20,.20,.05,.02,.05,.05,.08],
  SE:[.10,.15,.45,.03,.10,.02,.05,.10], SS:[.15,.40,.15,.05,.02,.08,.05,.10],
};
const SZ = {
  AB:"SE",AD:"NE",AK:"SS",AN:"SE",BA:"NE",BY:"SS",BE:"NC",BO:"NE",CR:"SS",
  DE:"SS",EB:"SE",ED:"SS",EK:"SW",EN:"SE",FC:"NC",GO:"NE",IM:"SE",JI:"NW",
  KD:"NW",KN:"NW",KT:"NW",KB:"NW",KG:"NC",KW:"NC",LA:"SW",NA:"NC",NI:"NC",
  OG:"SW",ON:"SW",OS:"SW",OY:"SW",PL:"NC",RV:"SS",SO:"NW",TA:"NE",YO:"NE",ZF:"NW",
};
const pick = a => a[Math.floor(Math.random()*a.length)];

function genVotes(rv, zone) {
  const zs = ZS[zone];
  const n = zs.map(v => Math.max(.01, v+(Math.random()-.5)*.08));
  const t = n.reduce((a,b)=>a+b,0);
  const nm = n.map(v=>v/t);
  const to = .35+Math.random()*.40;
  const total = Math.floor((rv||500)*to);
  const rj = Math.floor(total*(.01+Math.random()*.04));
  const vd = total-rj;
  const pv = nm.map(x=>Math.round(vd*x));
  pv[7] += vd-pv.reduce((a,b)=>a+b,0);
  return { valid:vd, rejected:rj, total, partyVotes:pv };
}

async function main() {
  const t0 = Date.now();
  console.log("=== FULL-SCALE SEED v2 ===\n");

  // Load refs
  const {data:st}=await s.from('states').select('id,code');
  const idCode={}; for(const x of st||[]) idCode[x.id]=x.code;
  const {data:pr}=await s.from('parties').select('id,abbreviation').limit(50);
  const pMap={}; for(const x of pr||[]) pMap[x.abbreviation]=x.id;
  const {data:el}=await s.from('elections').select('id').limit(1);
  const elId=el?.[0]?.id;
  const {data:v}=await s.from('volunteers').select('id').limit(10000);
  const vols=v||[];
  console.log(`Refs: el=${elId?.substring(0,8)} vols=${vols.length}`);

  // Load ALL PUs
  let allPUs=[];
  for(let o=0;o<250000;o+=1000){
    const{data:d}=await s.from('polling_units').select('id,state_id,registered_voters,latitude,longitude').range(o,o+999);
    if(!d||!d.length)break;
    allPUs=allPUs.concat(d);
  }
  console.log(`PUs loaded: ${allPUs.length}`);

  // Load EXISTING assignments to build PU->assignment map
  let existingAssigns=[];
  for(let o=0;o<200000;o+=1000){
    const{data:d}=await s.from('agent_assignments').select('id,polling_unit_id').range(o,o+999);
    if(!d||!d.length)break;
    existingAssigns=existingAssigns.concat(d);
  }
  const existingMap={};
  for(const a of existingAssigns) existingMap[a.polling_unit_id]=a.id;
  console.log(`Existing assignments: ${existingAssigns.length}`);

  // Filter to PUs WITHOUT assignments
  const newPUs = allPUs.filter(pu => !existingMap[pu.id]);
  console.log(`PUs needing assignments: ${newPUs.length}`);
  console.log(`PUs with existing assignments: ${allPUs.length - newPUs.length}\n`);

  // Phase 1: Create assignments for uncovered PUs (batches of 100)
  console.log("Phase 1: Creating assignments...");
  let assignCreated = 0;
  for(let i=0; i<newPUs.length; i+=100){
    const batch = newPUs.slice(i, i+100);
    const rows = batch.map(pu => ({
      volunteer_id: pick(vols).id,
      polling_unit_id: pu.id,
      election_id: elId,
      observer_number: 1,
      status: "CHECKED_IN",
      checked_in_at: new Date().toISOString(),
    }));
    const {data:created, error}=await s.from('agent_assignments').insert(rows).select('id,polling_unit_id');
    if(error){
      console.log(`  Batch ${i} error: ${error.message.substring(0,80)}`);
      continue;
    }
    for(const a of created||[]) existingMap[a.polling_unit_id]=a.id;
    assignCreated += created?.length||0;
    if(assignCreated%5000===0) process.stdout.write(`  ${assignCreated}/${newPUs.length}\r`);
  }
  console.log(`\n  Assignments created: ${assignCreated}`);
  console.log(`  Total assignments: ${Object.keys(existingMap).length}\n`);

  // Phase 2: Create results + party results for ALL PUs
  console.log("Phase 2: Generating results...");
  let tv=0, rd=0, id2=0;
  const BATCH=200;

  for(let i=0; i<allPUs.length; i+=BATCH){
    const chunk=allPUs.slice(i,i+BATCH);
    const rB=[], pB=[], iB=[];

    for(const pu of chunk){
      const aId=existingMap[pu.id];
      if(!aId) continue;
      
      const zone=SZ[idCode[pu.state_id]]||'NC';
      const votes=genVotes(pu.registered_voters, zone);
      tv+=votes.total;
      const rid=randomUUID();
      const vol=pick(vols);

      rB.push({
        id:rid, election_id:elId, polling_unit_id:pu.id,
        volunteer_id:vol.id, assignment_id:aId,
        valid_votes:votes.valid, rejected_votes:votes.rejected,
        total_votes:votes.total,
        status: Math.random()>.3?'VERIFIED':'UNVERIFIED',
        submitted_at: new Date(Date.now()-Math.floor(Math.random()*7200000)).toISOString(),
      });

      for(let j=0;j<8;j++){
        if(pMap[PARTIES[j]]) pB.push({result_submission_id:rid, party_id:pMap[PARTIES[j]], votes:votes.partyVotes[j]});
      }

      if(Math.random()<.03){
        const cats=[{c:'VIOLENCE',s:'HIGH',t:['Thugs at PU']},{c:'INTIMIDATION',s:'MEDIUM',t:['Voters turned away']},{c:'DISRUPTION',s:'MEDIUM',t:['Ballot snatched']},{c:'MATERIAL_SHORTAGE',s:'LOW',t:['Insufficient ballots']},{c:'OTHER',s:'LOW',t:['Late start']}];
        const tm=pick(cats);
        iB.push({volunteer_id:vol.id,polling_unit_id:pu.id,category:tm.c,severity:tm.s,what_observed:pick(tm.t),latitude:pu.latitude,longitude:pu.longitude,status:'REPORTED',submitted_at:new Date(Date.now()-Math.floor(Math.random()*7200000)).toISOString()});
      }
    }

    // Insert results
    if(rB.length){
      const{error}=await s.from('result_submissions').insert(rB);
      if(error){console.log(`  Results err at ${i}: ${error.message.substring(0,60)}`); continue;}
    }

    // Insert party results (sub-batches of 500)
    for(let j=0;j<pB.length;j+=500){
      const{error}=await s.from('party_results').insert(pB.slice(j,j+500));
      if(error){console.log(`  PR err: ${error.message.substring(0,60)}`);}
    }

    // Insert incidents
    if(iB.length){
      const{error}=await s.from('incidents').insert(iB);
      if(!error) id2+=iB.length;
    }

    rd+=rB.length;
    if(rd%5000===0||i+BATCH>=allPUs.length){
      const el2=((Date.now()-t0)/1000).toFixed(0);
      console.log(`  ${rd}/${allPUs.length} | ${(tv/1e6).toFixed(1)}M votes | ${id2} incidents | ${el2}s`);
    }
  }

  const elapsed=((Date.now()-t0)/1000).toFixed(0);
  console.log(`\n=== COMPLETE ===`);
  console.log(`Results: ${rd.toLocaleString()}`);
  console.log(`Total votes: ${(tv/1e6).toFixed(1)}M`);
  console.log(`Incidents: ${id2.toLocaleString()}`);
  console.log(`Time: ${elapsed}s`);
}

main().catch(console.error);
