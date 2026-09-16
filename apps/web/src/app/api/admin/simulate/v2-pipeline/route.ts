import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";
import { randomUUID } from "crypto";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Mode = "CONTROLLED" | "REHEARSAL" | "STRESS" | "FAILURE" | "FULL_SYSTEM";
type Speed = "SLOW" | "NORMAL" | "FAST" | "STRESS";

const SPEED_DELAYS: Record<Speed, number> = {
  SLOW: 2500,
  NORMAL: 1000,
  FAST: 300,
  STRESS: 0,
};

const SYSTEM_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let t = seed;
  return function () {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function generateVoteDistribution(
  pu: { id: string; registered_voters?: number },
  parties: any[]
) {
  const rng = mulberry32(fnv1a(String(pu.id)));
  const registered = Math.max(50, Math.min(1000, pu.registered_voters || 500));
  const turnout = 0.3 + rng() * 0.5;
  const totalVoters = Math.floor(registered * turnout);
  const validVotes = Math.max(0, totalVoters - Math.floor(totalVoters * (0.01 + rng() * 0.04)));
  const rejectedVotes = Math.max(0, totalVoters - validVotes);

  const weights = parties.map(() => 0.1 + rng() * 1.5);
  const wsum = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map((w) => (w / wsum) * validVotes);

  let allocated = 0;
  const ints = raw.map((r) => {
    const f = Math.floor(r);
    allocated += f;
    return f;
  });
  const remainder = validVotes - allocated;
  const fracs = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; k < remainder; k++) {
    ints[fracs[k % fracs.length].i] += 1;
  }

  const party_votes = parties.map((p, i) => ({
    party_id: p.id,
    votes: Math.max(0, ints[i]),
  }));
  const total_votes = validVotes + rejectedVotes;

  return { validVotes, rejectedVotes, total_votes, party_votes };
}

function applyDiscrepancy(values: any, rate: number, parties: any[]) {
  if (Math.random() >= rate) return values;
  const newParties = values.party_votes.map((pv: any) => {
    const jitter = Math.floor(Math.random() * 11) - 5;
    return {
      party_id: pv.party_id,
      votes: Math.max(0, pv.votes + jitter),
    };
  });
  const newValid = newParties.reduce((s: number, p: any) => s + p.votes, 0);
  const newTotal = newValid + values.rejectedVotes;
  return {
    ...values,
    validVotes: newValid,
    total_votes: newTotal,
    party_votes: newParties,
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, admin_user: adminUser, state_id, global } = auth;

    const body = await request.json();
    const mode: Mode = body.mode || "CONTROLLED";
    const speed: Speed = body.speed || "NORMAL";
    let pu_count: number = Math.min(500, Math.max(1, body.pu_count || 50));
    const discrepancy_rate: number = Math.max(
      0,
      Math.min(1, body.discrepancy_rate ?? 0.05)
    );
    const require_ai: boolean = body.require_ai || false;
    let sim_election_id: string | null = body.sim_election_id || null;

    const delayMs = SPEED_DELAYS[speed] ?? 1000;
    const start_time = new Date().toISOString();

    const partiesRes = await supabase
      .from("parties")
      .select("id, abbreviation, official_name, color")
      .order("id", { ascending: true });
    const parties = partiesRes.data || [];
    if (partiesRes.error) {
      return NextResponse.json(
        { error: `Parties query failed: ${partiesRes.error.message}` },
        { status: 500 }
      );
    }
    if (parties.length === 0) {
      return NextResponse.json(
        { error: "No parties found in DB" },
        { status: 500 }
      );
    }

    if (!sim_election_id) {
      const ts = new Date().toISOString();
      const { data: newElec, error: elecErr } = await supabase
        .from("elections")
        .insert({
          name: `[SIM] ${ts} ${mode} Pipeline x${pu_count}`,
          status: "ACTIVE",
          type: "PRESIDENTIAL",
        })
        .select("id")
        .single();
      if (elecErr || !newElec) {
        return NextResponse.json(
          { error: "Failed to create election" },
          { status: 500 }
        );
      }
      sim_election_id = (newElec as any).id;
    }

    let stateIds: string[];
    if (!global && state_id != null) {
      stateIds = [state_id];
    } else {
      const { data: states } = await supabase
        .from("states")
        .select("id, name")
        .order("id")
        .limit(3);
      stateIds = (states || []).map((s: any) => s.id);
      if (stateIds.length === 0) stateIds.push("dummy-state");
    }

    const perState = Math.ceil(pu_count / Math.max(1, stateIds.length));
    let pus: any[] = [];
    for (const sid of stateIds) {
      const { data: puRows } = await supabase
        .from("polling_units")
        .select("id, official_code, name, state_id, registered_voters")
        .eq("state_id", sid)
        .order("id")
        .limit(perState);
      if (puRows) pus = pus.concat(puRows);
    }
    if (pus.length > pu_count) pus = pus.slice(0, pu_count);
    if (pus.length === 0) {
      return NextResponse.json(
        { error: "No polling units found" },
        { status: 500 }
      );
    }
    pu_count = pus.length;
    const expected_submissions = pu_count * 2;

    try {
      await supabase.from("audit_log").insert({
        action: "SIMULATION_V2_STARTED",
        actor_id: adminUser.id,
        actor_type: "admin",
        resource_type: "elections",
        resource_id: sim_election_id,
        metadata: { mode, speed, pu_count, discrepancy_rate, require_ai },
        created_at: new Date().toISOString(),
      });
    } catch {}

    const response = NextResponse.json(
      {
        started: true,
        sim_election_id,
        total_pus: pu_count,
        expected_submissions,
        start_time,
      },
      { status: 202 }
    );

    const electionId = sim_election_id;
    const adminId = adminUser.id;

    setTimeout(async () => {
      const errors: any[] = [];
      const chunkSize = 50;
      let completedPUs = 0;

      for (let ci = 0; ci < pus.length; ci += chunkSize) {
        const chunk = pus.slice(ci, ci + chunkSize);
        const chunkErrors: any[] = [];

        for (const pu of chunk) {
          const emailN = `sim_observer_N_${pu.official_code || pu.id}@neop.ng`;
          const emailS = `sim_observer_S_${pu.official_code || pu.id}@neop.ng`;

          let volNId: string | null = null;
          let volSId: string | null = null;

          try {
            const { data: uaN } = await supabase
              .from("user_accounts")
              .select("id")
              .eq("email", emailN)
              .maybeSingle();
            let uaidN: string;
            if (uaN) {
              uaidN = (uaN as any).id;
            } else {
              const { data: ins } = await supabase
                .from("user_accounts")
                .insert({
                  email: emailN,
                  full_name: `Sim Observer N ${pu.official_code || pu.id}`,
                })
                .select("id")
                .single();
              uaidN = (ins as any).id;
            }
            const { data: vN } = await supabase
              .from("volunteers")
              .select("id")
              .eq("user_id", uaidN)
              .maybeSingle();
            if (vN) {
              volNId = (vN as any).id;
            } else {
              const { data: vi } = await supabase
                .from("volunteers")
                .insert({
                  user_id: uaidN,
                  status: "ACTIVE",
                  state_id: pu.state_id,
                })
                .select("id")
                .single();
              volNId = (vi as any).id;
            }
          } catch (e: any) {
            chunkErrors.push({ pu_code: pu.official_code, step: "volunteer_N", message: e?.message, agent: "N" });
          }

          try {
            const { data: uaS } = await supabase
              .from("user_accounts")
              .select("id")
              .eq("email", emailS)
              .maybeSingle();
            let uaidS: string;
            if (uaS) {
              uaidS = (uaS as any).id;
            } else {
              const { data: ins } = await supabase
                .from("user_accounts")
                .insert({
                  email: emailS,
                  full_name: `Sim Observer S ${pu.official_code || pu.id}`,
                })
                .select("id")
                .single();
              uaidS = (ins as any).id;
            }
            const { data: vS } = await supabase
              .from("volunteers")
              .select("id")
              .eq("user_id", uaidS)
              .maybeSingle();
            if (vS) {
              volSId = (vS as any).id;
            } else {
              const { data: vi } = await supabase
                .from("volunteers")
                .insert({
                  user_id: uaidS,
                  status: "ACTIVE",
                  state_id: pu.state_id,
                })
                .select("id")
                .single();
              volSId = (vi as any).id;
            }
          } catch (e: any) {
            chunkErrors.push({ pu_code: pu.official_code, step: "volunteer_S", message: e?.message, agent: "S" });
          }

          let assignNId: string | null = null;
          let assignSId: string | null = null;

          if (volNId) {
            try {
              const { data: aN } = await supabase
                .from("agent_assignments")
                .select("id")
                .eq("volunteer_id", volNId)
                .eq("election_id", electionId)
                .eq("polling_unit_id", pu.id)
                .maybeSingle();
              if (aN) {
                assignNId = (aN as any).id;
              } else {
                const { data: ai } = await supabase
                  .from("agent_assignments")
                  .insert({
                    election_id: electionId,
                    polling_unit_id: pu.id,
                    volunteer_id: volNId,
                    observer_number: 1,
                    status: "CHECKED_IN",
                    location_verified: true,
                    checked_in_at: new Date().toISOString(),
                  })
                  .select("id")
                  .single();
                assignNId = (ai as any).id;
              }
            } catch (e: any) {
              chunkErrors.push({ pu_code: pu.official_code, step: "assign_N", message: e?.message, agent: "N" });
            }
          }
          if (volSId) {
            try {
              const { data: aS } = await supabase
                .from("agent_assignments")
                .select("id")
                .eq("volunteer_id", volSId)
                .eq("election_id", electionId)
                .eq("polling_unit_id", pu.id)
                .maybeSingle();
              if (aS) {
                assignSId = (aS as any).id;
              } else {
                const { data: ai } = await supabase
                  .from("agent_assignments")
                  .insert({
                    election_id: electionId,
                    polling_unit_id: pu.id,
                    volunteer_id: volSId,
                    observer_number: 2,
                    status: "CHECKED_IN",
                    location_verified: true,
                    checked_in_at: new Date().toISOString(),
                  })
                  .select("id")
                  .single();
                assignSId = (ai as any).id;
              }
            } catch (e: any) {
              chunkErrors.push({ pu_code: pu.official_code, step: "assign_S", message: e?.message, agent: "S" });
            }
          }

          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }

          const baseDist = generateVoteDistribution(pu, parties);
          const a2Dist = applyDiscrepancy(baseDist, discrepancy_rate, parties);

          let sub1Id: string | null = null;
          let sub2Id: string | null = null;

          if (volNId && assignNId) {
            try {
              const partyArray: any[] = baseDist.party_votes.filter(
                (pv: any) => pv.party_id && Number(pv.votes || 0) >= 0
              );
              const subN = await supabase
                .from("result_submissions")
                .insert({
                  idempotency_key: randomUUID(),
                  assignment_id: assignNId,
                  volunteer_id: volNId,
                  election_id: electionId,
                  polling_unit_id: pu.id,
                  valid_votes: baseDist.validVotes,
                  rejected_votes: baseDist.rejectedVotes,
                  total_votes: baseDist.total_votes,
                  status: "UNVERIFIED",
                })
                .select("id")
                .maybeSingle();
              sub1Id = (subN as any)?.data?.id || null;
              if (sub1Id) {
                const bulk1: any[] = partyArray.map((pr: any) => ({
                  result_submission_id: sub1Id,
                  party_id: pr.party_id,
                  votes: pr.votes,
                }));
                await supabase.from("party_results").insert(bulk1);
              }
            } catch (e: any) {
              chunkErrors.push({
                pu_code: pu.official_code,
                step: "submit_N",
                message: e?.message,
                stack: e?.stack,
                agent: "N",
              });
            }
          }

          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }

          if (volSId && assignSId) {
            try {
              const partyArrayS: any[] = a2Dist.party_votes.filter(
                (pv: any) => pv.party_id && Number(pv.votes || 0) >= 0
              );
              const subS = await supabase
                .from("result_submissions")
                .insert({
                  idempotency_key: randomUUID(),
                  assignment_id: assignSId,
                  volunteer_id: volSId,
                  election_id: electionId,
                  polling_unit_id: pu.id,
                  valid_votes: a2Dist.validVotes,
                  rejected_votes: a2Dist.rejectedVotes,
                  total_votes: a2Dist.total_votes,
                  status: "UNVERIFIED",
                })
                .select("id")
                .maybeSingle();
              sub2Id = (subS as any)?.data?.id || null;
              if (sub2Id) {
                const bulk2: any[] = partyArrayS.map((pr: any) => ({
                  result_submission_id: sub2Id,
                  party_id: pr.party_id,
                  votes: pr.votes,
                }));
                await supabase.from("party_results").insert(bulk2);
              }
            } catch (e: any) {
              chunkErrors.push({
                pu_code: pu.official_code,
                step: "submit_S",
                message: e?.message,
                stack: e?.stack,
                agent: "S",
              });
            }
          }

          if (sub1Id && sub2Id) {
            try {
              const loadSub = async (sid: string) => {
                const { data } = await supabase
                  .from("result_submissions")
                  .select(
                    "*, party_results ( votes, parties ( id, abbreviation ) )"
                  )
                  .eq("id", sid)
                  .single();
                return data as any;
              };
              const s1 = await loadSub(sub1Id);
              const s2 = await loadSub(sub2Id);

              const toP = (s: any) =>
                new Map(
                  (s?.party_results || []).map((pr: any) => [
                    pr?.parties?.abbreviation || "?",
                    Number(pr?.votes || 0),
                  ])
                );
              const pm1 = toP(s1);
              const pm2 = toP(s2);
              const allP = Array.from(
                new Set([...pm1.keys(), ...pm2.keys()])
              );

              let iden =
                Number(s1?.valid_votes ?? 0) === Number(s2?.valid_votes ?? 0) &&
                Number(s1?.rejected_votes ?? 0) === Number(s2?.rejected_votes ?? 0) &&
                Number(s1?.total_votes ?? 0) === Number(s2?.total_votes ?? 0);
              let md = 0;
              for (const abbr of allP) {
                const d = Math.abs(Number(pm1.get(abbr) || 0) - Number(pm2.get(abbr) || 0));
                if (d > 0) iden = false;
                if (d > md) md = d;
              }
              if (pm1.size !== pm2.size) iden = false;

              const shouldMatch = iden && md <= 2 && !require_ai;

              const pubParties = (s1?.party_results || []).map((pr: any) => ({
                party_id: pr?.parties?.id || pr?.party_id,
                votes: Number(pr?.votes || 0),
              }));

              // The trg_rs_timeline trigger already created one verification row per
              // (election, polling_unit) and attached both submissions — update it
              // instead of inserting a duplicate.
              const { data: verRow } = await supabase
                .from("verifications")
                .select("id")
                .eq("election_id", electionId)
                .eq("polling_unit_id", pu.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              const vid = (verRow as any)?.id || null;

              if (vid) {
                await supabase
                  .from("verifications")
                  .update({
                    status: shouldMatch ? "MATCH" : "DISCREPANCY",
                    submissions_identical: iden,
                    math_consistent: md <= 2,
                    discrepancy_score: md,
                    final_decision: shouldMatch ? "MATCH" : "DISCREPANCY",
                    decided_at: new Date().toISOString(),
                    completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", vid);
              }

              if (shouldMatch) {
                try {
                  const { data: pub, error: pubErr } = await supabase.rpc("publish_canonical_result", {
                    p_election_id: electionId,
                    p_polling_unit_id: pu.id,
                    p_status: "PUBLISHED",
                    p_valid_votes: Number(s1?.valid_votes || 0),
                    p_rejected_votes: Number(s1?.rejected_votes || 0),
                    p_total_votes: Number(s1?.total_votes || 0),
                    p_source_1: sub1Id,
                    p_source_2: sub2Id,
                    p_party_votes: pubParties,
                    p_created_by: adminId,
                  });
                  if (pubErr) {
                    chunkErrors.push({
                      pu_code: pu.official_code,
                      step: "publish_rpc",
                      message: pubErr.message || "publish_rpc failed",
                    });
                  } else {
                    const cid =
                      (Array.isArray(pub) && (pub as any)[0]?.out_canonical_id) ||
                      (pub as any)?.out_canonical_id ||
                      null;
                    if (vid && cid) {
                      await supabase
                        .from("verifications")
                        .update({ canonical_result_id: cid })
                        .eq("id", vid);
                    }
                  }
                } catch (pe: any) {
                  chunkErrors.push({
                    pu_code: pu.official_code,
                    step: "publish_rpc",
                    message: pe?.message || "publish_rpc failed",
                  });
                }
              } else {
                await supabase
                  .from("canonical_pu_results")
                  .insert({
                    election_id: electionId,
                    polling_unit_id: pu.id,
                    status: "HUMAN_REVIEW",
                    source_submission_1: sub1Id,
                    source_submission_2: sub2Id,
                    valid_votes: Number(s1?.valid_votes || 0),
                    rejected_votes: Number(s1?.rejected_votes || 0),
                    total_votes: Number(s1?.total_votes || 0),
                  });
              }
            } catch (e: any) {
              chunkErrors.push({
                pu_code: pu.official_code,
                step: "inline_pairing",
                message: e?.message,
                stack: e?.stack,
              });
            }
          }
          completedPUs++;
        }

        errors.push(...chunkErrors);

        try {
          await supabase
            .from("simulation_config")
            .update({
              scenario: JSON.stringify({
                mode,
                speed,
                pu_count,
                discrepancy_rate,
                require_ai,
                sim_election_id: electionId,
                progress: {
                  completed: completedPUs,
                  total: pu_count,
                  errors: errors.length,
                  last_tick: new Date().toISOString(),
                },
              }),
              last_tick_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", SYSTEM_CONFIG_ID);
        } catch {}
      }

      try {
        await supabase.from("audit_log").insert({
          action: "SIMULATION_V2_COMPLETED",
          actor_id: adminId,
          actor_type: "admin",
          resource_type: "elections",
          resource_id: electionId,
          metadata: {
            mode,
            speed,
            pu_count,
            discrepancy_rate,
            require_ai,
            completed_pus: completedPUs,
            errors_count: errors.length,
            errors_sample: errors.slice(0, 20),
          },
          created_at: new Date().toISOString(),
        });
      } catch {}
    }, 0);

    return response;
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error", started: false },
      { status: 500 }
    );
  }
}
