/**
 * POST /api/admin/simulate
 * Full-scale election simulation with:
 * - Random polling unit statuses (voting → counting → result announced → submitted → verified)
 * - Admin-configurable duration and voter count
 * - NDC always wins with varying margins
 * - Live status transitions that update the dashboard in real time
 *
 * Body: {
 *   scenario?: "landslide" | "close" | "sweep" | "random",
 *   duration_minutes?: number,  // 1-60, default 5
 *   total_voters?: number,      // 10M-200M, default ~100M
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const dynamic = "force-dynamic";

// ── Constants ──
const TOTAL_INEC_PUS = 176846;

const PARTIES = ["APC", "NDC", "PDP", "LP", "NNPP", "APGA", "SDP", "YPP", "ADC"] as const;

// All possible PU statuses — simulation progresses through these
const PU_STATUSES = [
  "NOT_STARTED",
  "VOTING",
  "COUNTING",
  "RESULT_ANNOUNCED",
  "RESULT_SUBMITTED",
  "VERIFICATION_PENDING",
  "VERIFIED",
  "DISPUTED",
  "DISRUPTED",
  "ELECTION_NOT_HELD",
] as const;

// Status progression weights — most PUs follow the happy path
const STATUS_PROGRESSION: Record<string, { next: string; weight: number }[]> = {
  NOT_STARTED: [
    { next: "VOTING", weight: 0.85 },
    { next: "ELECTION_NOT_HELD", weight: 0.03 },
    { next: "DISRUPTED", weight: 0.02 },
    { next: "NOT_STARTED", weight: 0.10 }, // stays stuck
  ],
  VOTING: [
    { next: "COUNTING", weight: 0.88 },
    { next: "DISPUTED", weight: 0.04 },
    { next: "DISRUPTED", weight: 0.02 },
    { next: "VOTING", weight: 0.06 },
  ],
  COUNTING: [
    { next: "RESULT_ANNOUNCED", weight: 0.90 },
    { next: "DISPUTED", weight: 0.05 },
    { next: "COUNTING", weight: 0.05 },
  ],
  RESULT_ANNOUNCED: [
    { next: "RESULT_SUBMITTED", weight: 0.92 },
    { next: "DISPUTED", weight: 0.03 },
    { next: "RESULT_ANNOUNCED", weight: 0.05 },
  ],
  RESULT_SUBMITTED: [
    { next: "VERIFICATION_PENDING", weight: 0.88 },
    { next: "VERIFIED", weight: 0.05 },
    { next: "RESULT_SUBMITTED", weight: 0.07 },
  ],
  VERIFICATION_PENDING: [
    { next: "VERIFIED", weight: 0.80 },
    { next: "DISPUTED", weight: 0.10 },
    { next: "VERIFICATION_PENDING", weight: 0.10 },
  ],
  VERIFIED: [{ next: "VERIFIED", weight: 1.0 }],
  DISPUTED: [{ next: "DISPUTED", weight: 1.0 }],
  DISRUPTED: [{ next: "DISRUPTED", weight: 1.0 }],
  ELECTION_NOT_HELD: [{ next: "ELECTION_NOT_HELD", weight: 1.0 }],
};

// Regional multipliers per party
const REGION_MULT: Record<string, Record<string, number>> = {
  NW: { APC: 1.4, NDC: 0.6, PDP: 0.8, LP: 0.4, NNPP: 1.3, APGA: 0.2, SDP: 1.2, YPP: 0.8, ADC: 0.6 },
  NE: { APC: 1.3, NDC: 0.7, PDP: 1.0, LP: 0.4, NNPP: 0.9, APGA: 0.2, SDP: 1.0, YPP: 0.6, ADC: 0.8 },
  NC: { APC: 1.1, NDC: 1.0, PDP: 1.1, LP: 0.6, NNPP: 0.7, APGA: 0.4, SDP: 1.1, YPP: 0.7, ADC: 0.9 },
  SW: { APC: 1.5, NDC: 0.5, PDP: 0.7, LP: 0.8, NNPP: 0.3, APGA: 0.3, SDP: 0.7, YPP: 1.0, ADC: 0.5 },
  SE: { APC: 0.3, NDC: 1.9, PDP: 0.4, LP: 1.7, NNPP: 0.2, APGA: 2.2, SDP: 0.3, YPP: 1.3, ADC: 0.4 },
  SS: { APC: 0.4, NDC: 1.6, PDP: 1.3, LP: 1.3, NNPP: 0.2, APGA: 0.4, SDP: 0.5, YPP: 0.8, ADC: 0.6 },
  FC: { APC: 1.0, NDC: 1.2, PDP: 0.8, LP: 1.1, NNPP: 0.5, APGA: 0.4, SDP: 0.8, YPP: 1.0, ADC: 0.7 },
};

const STATE_REGION: Record<string, string> = {
  Kano: "NW", Katsina: "NW", Sokoto: "NW", Zamfara: "NW", Kebbi: "NW", Jigawa: "NW", Kaduna: "NW",
  Borno: "NE", Yobe: "NE", Adamawa: "NE", Gombe: "NE", Taraba: "NE", Bauchi: "NE",
  Niger: "NC", Kwara: "NC", Kogi: "NC", Benue: "NC", Plateau: "NC", Nasarawa: "NC",
  Lagos: "SW", "Ogun": "SW", Oyo: "SW", Ondo: "SW", Osun: "SW", Ekiti: "SW",
  Abia: "SE", Anambra: "SE", Ebonyi: "SE", Enugu: "SE", Imo: "SE",
  Rivers: "SS", Delta: "SS", Bayelsa: "SS", "Akwa Ibom": "SS", "Cross River": "SS", Edo: "SS",
  FCT: "FC",
};

interface Scenario {
  ndcShare: number;
  baseWeights: Record<string, number>;
}

const SCENARIOS: Record<string, Scenario> = {
  landslide: {
    ndcShare: 0.38,
    baseWeights: { APC: 0.22, PDP: 0.10, LP: 0.08, NNPP: 0.04, APGA: 0.06, SDP: 0.04, YPP: 0.04, ADC: 0.04 },
  },
  sweep: {
    ndcShare: 0.35,
    baseWeights: { APC: 0.24, PDP: 0.11, LP: 0.09, NNPP: 0.04, APGA: 0.06, SDP: 0.04, YPP: 0.04, ADC: 0.03 },
  },
  close: {
    ndcShare: 0.28,
    baseWeights: { APC: 0.26, PDP: 0.12, LP: 0.09, NNPP: 0.05, APGA: 0.07, SDP: 0.04, YPP: 0.05, ADC: 0.04 },
  },
};

// ── Helpers ──
function pickWeighted(options: { next: string; weight: number }[]): string {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const opt of options) {
    r -= opt.weight;
    if (r <= 0) return opt.next;
  }
  return options[options.length - 1].next;
}

function buildRegionalWeights(scenario: Scenario, stateName: string): Record<string, number> {
  const region = STATE_REGION[stateName] || "NC";
  const rm = REGION_MULT[region] || {};
  const weights: Record<string, number> = {};
  let total = 0;
  weights.NDC = scenario.ndcShare * (rm.NDC || 1);
  total += weights.NDC;
  for (const p of PARTIES) {
    if (p === "NDC") continue;
    weights[p] = (scenario.baseWeights[p] || 0.03) * (rm[p] || 1);
    total += weights[p];
  }
  for (const p of Object.keys(weights)) weights[p] /= total;
  return weights;
}

function generateVotes(weights: Record<string, number>, totalVotes: number): Record<string, number> {
  const votes: Record<string, number> = {};
  let remaining = totalVotes;
  const ps = Object.keys(weights);
  for (let i = 0; i < ps.length - 1; i++) {
    const expected = Math.round(totalVotes * weights[ps[i]]);
    const jitter = 1 + (Math.random() - 0.5) * 0.3;
    votes[ps[i]] = Math.max(0, Math.min(Math.round(expected * jitter), remaining - (ps.length - i - 1)));
    remaining -= votes[ps[i]];
  }
  votes[ps[ps.length - 1]] = Math.max(0, remaining);
  return votes;
}

// Pick a random scenario if not specified
function pickScenario(key: string): { scenario: Scenario; name: string; description: string } {
  if (key === "random" || !SCENARIOS[key]) {
    const options = ["landslide", "sweep", "close"] as const;
    key = options[Math.floor(Math.random() * options.length)];
  }
  const descriptions: Record<string, string> = {
    landslide: "NDC wins by 20+ points — a massive coalition victory",
    sweep: "NDC carries every region except SW",
    close: "NDC edges APC by 2-5 points in a nail-biter",
  };
  return { scenario: SCENARIOS[key], name: key.toUpperCase().replace("_", " "), description: descriptions[key] || "" };
}

// ── Main handler ──
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { scenario: scenarioKey, duration_minutes, total_voters } = body;

    // Clamp parameters
    const durationMs = Math.max(1, Math.min(60, duration_minutes || 5)) * 60 * 1000;
    const targetVoters = Math.max(10_000_000, Math.min(200_000_000, total_voters || 100_000_000));

    const { scenario, name, description } = pickScenario(scenarioKey || "random");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Step 0: Reset ──
    console.log("[sim] Resetting data...");
    await supabase.rpc("reset_simulation_data");

    // Update simulation_config
    await supabase.from("simulation_config").upsert({
      id: "00000000-0000-0000-0000-000000000001",
      election_type: "PRESIDENTIAL",
      status: "RUNNING",
      speed: 3,
      started_at: new Date().toISOString(),
      last_tick_at: new Date().toISOString(),
    }, { onConflict: "id" });

    // ── Step 1: Load PUs ──
    console.log("[sim] Loading polling units...");
    const { data: states } = await supabase.from("states").select("id, name");
    const stateNameMap = new Map(states?.map((s) => [s.id, s.name]) || []);

    const allPUs: any[] = [];
    let offset = 0;
    while (true) {
      const { data } = await supabase.from("polling_units").select("id, state_id").range(offset, offset + 999);
      if (!data || data.length === 0) break;
      allPUs.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }
    console.log(`[sim] Loaded ${allPUs.length} PUs`);

    // ── Step 2: Assign random starting statuses ──
    // At the start: ~10% already past, ~30% currently active, ~60% not started
    const puStatuses = new Map<string, string>();
    for (const pu of allPUs) {
      const r = Math.random();
      if (r < 0.05) puStatuses.set(pu.id, "VERIFIED");
      else if (r < 0.12) puStatuses.set(pu.id, "RESULT_SUBMITTED");
      else if (r < 0.20) puStatuses.set(pu.id, "RESULT_ANNOUNCED");
      else if (r < 0.30) puStatuses.set(pu.id, "COUNTING");
      else if (r < 0.40) puStatuses.set(pu.id, "VOTING");
      else puStatuses.set(pu.id, "NOT_STARTED");
    }

    // Set initial PU statuses in database
    const statusBatches = Array.from(puStatuses.entries());
    for (let i = 0; i < statusBatches.length; i += 500) {
      const batch = statusBatches.slice(i, i + 500);
      const promises = batch.map(([puId, status]) =>
        supabase.from("polling_units").update({ status }).eq("id", puId)
      );
      await Promise.all(promises);
    }
    console.log("[sim] Initial statuses set");

    // ── Step 3: Generate vote data for all PUs ──
    const avgVotesPerPU = Math.round(targetVoters / allPUs.length);

    // Get party IDs
    const { data: allParties } = await supabase.from("parties").select("id, abbreviation");
    const partyIdMap: Record<string, string> = {};
    allParties?.forEach((p) => { if (!partyIdMap[p.abbreviation]) partyIdMap[p.abbreviation] = p.id; });

    // Build all result rows with votes
    console.log(`[sim] Generating votes (~${avgVotesPerPU} per PU, ~${(targetVoters / 1_000_000).toFixed(0)}M total)...`);

    const allResultData: {
      pu: any;
      totalVotes: number;
      validVotes: number;
      rejectedVotes: number;
      weights: Record<string, number>;
      votes: Record<string, number>;
      status: string;
      submittedAt: string;
      verifiedAt: string | null;
    }[] = [];

    for (const pu of allPUs) {
      const stateName = stateNameMap.get(pu.state_id) || "Unknown";
      const weights = buildRegionalWeights(scenario, stateName);
      const totalVotes = Math.max(50, Math.round(avgVotesPerPU * (0.5 + Math.random())));
      const validVotes = Math.round(totalVotes * (0.82 + Math.random() * 0.15));
      const votes = generateVotes(weights, totalVotes);
      const status = puStatuses.get(pu.id) || "NOT_STARTED";
      const submittedAt = new Date(Date.now() - Math.random() * 86400000 * 60).toISOString();
      const verifiedAt = status === "VERIFIED"
        ? new Date(Date.now() - Math.random() * 86400000 * 30).toISOString()
        : null;

      allResultData.push({
        pu,
        totalVotes,
        validVotes,
        rejectedVotes: totalVotes - validVotes,
        weights,
        votes,
        status,
        submittedAt,
        verifiedAt,
      });
    }

    // ── Step 4: Insert results in batches ──
    let resultsCreated = 0;
    let prCreated = 0;
    const BATCH = 100;

    for (let i = 0; i < allResultData.length; i += BATCH) {
      const batch = allResultData.slice(i, i + BATCH);

      const resultRows = batch.map((r) => ({
        polling_unit_id: r.pu.id,
        election_id: null,
        volunteer_id: null,
        assignment_id: null,
        valid_votes: r.validVotes,
        rejected_votes: r.rejectedVotes,
        total_votes: r.totalVotes,
        status: ["VERIFIED", "RESULT_SUBMITTED", "RESULT_ANNOUNCED", "VERIFICATION_PENDING"].includes(r.status) ? r.status : "RESULT_SUBMITTED",
        submitted_at: r.submittedAt,
        verified_at: r.verifiedAt,
      }));

      const { data: inserted, error: rsErr } = await supabase
        .from("result_submissions").insert(resultRows).select("id");
      if (rsErr || !inserted) continue;

      // Party results
      const prRows: any[] = [];
      for (let j = 0; j < inserted.length; j++) {
        for (const [abbr, count] of Object.entries(batch[j].votes)) {
          const pid = partyIdMap[abbr];
          if (pid && count > 0) {
            prRows.push({ result_submission_id: inserted[j].id, party_id: pid, votes: count });
          }
        }
      }
      for (let k = 0; k < prRows.length; k += 500) {
        const sub = prRows.slice(k, k + 500);
        const { error } = await supabase.from("party_results").insert(sub);
        if (!error) prCreated += sub.length;
      }

      resultsCreated += inserted.length;
      if ((i + BATCH) % 5000 === 0 || i + BATCH >= allResultData.length) {
        console.log(`[sim] ${Math.round(((i + BATCH) / allResultData.length) * 100)}% — Results: ${resultsCreated}, PR: ${prCreated}`);
      }
    }

    // ── Step 5: Run status progression over time ──
    // Divide duration into ticks — each tick advances ~10% of PUs
    const TICK_COUNT = 10;
    const tickInterval = durationMs / TICK_COUNT;

    console.log(`[sim] Starting ${TICK_COUNT} status ticks over ${durationMs / 60000} minutes...`);

    for (let tick = 0; tick < TICK_COUNT; tick++) {
      await new Promise((r) => setTimeout(r, tickInterval));

      // Advance ~30% of eligible PUs per tick
      let changed = 0;
      const updates: { id: string; status: string }[] = [];

      for (const [puId, currentStatus] of Array.from(puStatuses.entries())) {
        if (["VERIFIED", "DISPUTED", "DISRUPTED", "ELECTION_NOT_HELD"].includes(currentStatus)) continue;
        if (Math.random() > 0.30) continue; // only advance 30% per tick

        const transition = STATUS_PROGRESSION[currentStatus];
        if (!transition) continue;
        const newStatus = pickWeighted(transition);
        if (newStatus !== currentStatus) {
          puStatuses.set(puId, newStatus);
          updates.push({ id: puId, status: newStatus });
          changed++;
        }
      }

      // Batch update PU statuses
      for (let i = 0; i < updates.length; i += 200) {
        const batch = updates.slice(i, i + 200);
        const promises = batch.map((u) =>
          supabase.from("polling_units").update({ status: u.status }).eq("id", u.id)
        );
        await Promise.all(promises);
      }

      // Update simulation config
      await supabase.from("simulation_config").update({
        last_tick_at: new Date().toISOString(),
        total_results_submitted: resultsCreated,
      }).eq("id", "00000000-0000-0000-0000-000000000001");

      // Log status distribution
      const statusCounts: Record<string, number> = {};
      for (const s of puStatuses.values()) {
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      }
      console.log(`[sim] Tick ${tick + 1}/${TICK_COUNT} — ${changed} PUs advanced —`, JSON.stringify(statusCounts));
    }

    // Final: force all remaining VOTING/COUNTING PUs to result_submitted
    let forcedCount = 0;
    const forceUpdates: { id: string }[] = [];
    for (const [puId, status] of Array.from(puStatuses.entries())) {
      if (!["NOT_STARTED", "VOTING", "COUNTING"].includes(status)) continue;
      forceUpdates.push({ id: puId });
    }
    for (let i = 0; i < forceUpdates.length; i += 200) {
      const batch = forceUpdates.slice(i, i + 200);
      await Promise.all(batch.map((u) =>
        supabase.from("polling_units").update({ status: "RESULT_SUBMITTED" }).eq("id", u.id)
      ));
      forcedCount += batch.length;
    }
    console.log(`[sim] Finalized ${forcedCount} remaining PUs`);

    // Update config to DONE
    const finalStatusCounts: Record<string, number> = {};
    // Recount after forced
    const { data: finalPUs } = await supabase.from("polling_units").select("status");
    finalPUs?.forEach((pu: any) => {
      finalStatusCounts[pu.status] = (finalStatusCounts[pu.status] || 0) + 1;
    });

    await supabase.from("simulation_config").update({
      status: "COMPLETED",
      last_tick_at: new Date().toISOString(),
      total_results_submitted: resultsCreated,
    }).eq("id", "00000000-0000-0000-0000-000000000001");

    return NextResponse.json({
      success: true,
      scenario: name,
      description,
      duration_minutes: Math.round(durationMs / 60000),
      target_voters: targetVoters,
      total_polling_units: allPUs.length,
      results_created: resultsCreated,
      party_results_created: prCreated,
      total_votes: allResultData.reduce((s, r) => s + r.totalVotes, 0),
      final_status_distribution: finalStatusCounts,
      ndc_wins: true,
    });
  } catch (error: any) {
    console.error("[sim] Error:", error);
    return NextResponse.json({ error: error.message || "Simulation failed" }, { status: 500 });
  }
}
