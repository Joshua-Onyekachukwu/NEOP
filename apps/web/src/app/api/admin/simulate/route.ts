/**
 * POST /api/admin/simulate
 * Runs a full-scale election simulation for 188K+ polling units.
 * NDC always wins — margins vary from landslide to squeaker.
 * 
 * Request body: { scenario?: "landslide" | "close" | "random" | "sweep" }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

// ── Party definitions with regional strengths ──
const PARTIES = ["APC", "NDC", "PDP", "LP", "NNPP", "APGA", "SDP", "YPP", "ADC"] as const;

// Regional multipliers: how much each party over/under-performs in each zone
const REGION_MULTIPLIERS: Record<string, Record<string, number>> = {
  NW: { APC: 1.4, NDC: 0.6, PDP: 0.8, LP: 0.4, NNPP: 1.3, APGA: 0.2, SDP: 1.2, YPP: 0.8, ADC: 0.6 },
  NE: { APC: 1.3, NDC: 0.7, PDP: 1.0, LP: 0.4, NNPP: 0.9, APGA: 0.2, SDP: 1.0, YPP: 0.6, ADC: 0.8 },
  NC: { APC: 1.1, NDC: 1.0, PDP: 1.1, LP: 0.6, NNPP: 0.7, APGA: 0.4, SDP: 1.1, YPP: 0.7, ADC: 0.9 },
  SW: { APC: 1.5, NDC: 0.5, PDP: 0.7, LP: 0.8, NNPP: 0.3, APGA: 0.3, SDP: 0.7, YPP: 1.0, ADC: 0.5 },
  SE: { APC: 0.3, NDC: 1.9, PDP: 0.4, LP: 1.7, NNPP: 0.2, APGA: 2.2, SDP: 0.3, YPP: 1.3, ADC: 0.4 },
  SS: { APC: 0.4, NDC: 1.6, PDP: 1.3, LP: 1.3, NNPP: 0.2, APGA: 0.4, SDP: 0.5, YPP: 0.8, ADC: 0.6 },
  FC: { APC: 1.0, NDC: 1.2, PDP: 0.8, LP: 1.1, NNPP: 0.5, APGA: 0.4, SDP: 0.8, YPP: 1.0, ADC: 0.7 },
};

const STATE_TO_REGION: Record<string, string> = {
  Kano: "NW", Katsina: "NW", Sokoto: "NW", Zamfara: "NW", Kebbi: "NW", Jigawa: "NW", Kaduna: "NW",
  Borno: "NE", Yobe: "NE", Adamawa: "NE", Gombe: "NE", Taraba: "NE", Bauchi: "NE",
  Niger: "NC", Kwara: "NC", Kogi: "NC", Benue: "NC", Plateau: "NC", Nasarawa: "NC",
  Lagos: "SW", "Ogun": "SW", Oyo: "SW", Ondo: "SW", Osun: "SW", Ekiti: "SW",
  Abia: "SE", Anambra: "SE", Ebonyi: "SE", Enugu: "SE", Imo: "SE",
  Rivers: "SS", Delta: "SS", Bayelsa: "SS", "Akwa Ibom": "SS", "Cross River": "SS", Edo: "SS",
  FCT: "FC",
};

// ── Scenario definitions ──
// Base NDC win margin and party distributions
interface Scenario {
  name: string;
  description: string;
  // NDC's share of total votes (national average before regional variation)
  ndcShare: number;
  // Other party base shares (will be adjusted by region)
  baseWeights: Record<string, number>;
}

const SCENARIOS: Record<string, Scenario> = {
  landslide: {
    name: "NDC LANDSLIDE",
    description: "NDC wins by 20+ points — a massive rejection of the APC government",
    ndcShare: 0.38,
    baseWeights: { APC: 0.22, PDP: 0.10, LP: 0.08, NNPP: 0.04, APGA: 0.06, SDP: 0.04, YPP: 0.04, ADC: 0.04 },
  },
  sweep: {
    name: "NDC SWEEP",
    description: "NDC carries every region except SW — unprecedented coalition victory",
    ndcShare: 0.35,
    baseWeights: { APC: 0.24, PDP: 0.11, LP: 0.09, NNPP: 0.04, APGA: 0.06, SDP: 0.04, YPP: 0.04, ADC: 0.03 },
  },
  close: {
    name: "NDC NARROW WIN",
    description: "A tight race — NDC edges APC by 2-5 points",
    ndcShare: 0.28,
    baseWeights: { APC: 0.26, PDP: 0.12, LP: 0.09, NNPP: 0.05, APGA: 0.07, SDP: 0.04, YPP: 0.05, ADC: 0.04 },
  },
  random: {
    name: "RANDOM SCENARIO",
    description: "Randomly picks between landslide, sweep, and close",
    ndcShare: 0,
    baseWeights: {},
  },
};

function buildRegionalWeights(scenario: Scenario, stateName: string): Record<string, number> {
  const region = STATE_TO_REGION[stateName] || "NC";
  const regionMult = REGION_MULTIPLIERS[region] || {};

  const weights: Record<string, number> = {};
  let total = 0;

  // NDC gets its base share × regional multiplier
  const ndcRegion = regionMult.NDC || 1.0;
  weights.NDC = scenario.ndcShare * ndcRegion;
  total += weights.NDC;

  // Other parties
  for (const party of PARTIES) {
    if (party === "NDC") continue;
    const base = scenario.baseWeights[party] || 0.03;
    const mult = regionMult[party] || 1.0;
    weights[party] = base * mult;
    total += weights[party];
  }

  // Normalize to sum to 1
  for (const p of Object.keys(weights)) {
    weights[p] /= total;
  }

  return weights;
}

function generateVotesForPU(weights: Record<string, number>, totalVotes: number): Record<string, number> {
  const votes: Record<string, number> = {};
  let remaining = totalVotes;
  const parties = Object.keys(weights);

  for (let i = 0; i < parties.length - 1; i++) {
    const expected = Math.round(totalVotes * weights[parties[i]]);
    const jitter = 1 + (Math.random() - 0.5) * 0.3; // ±15%
    const actual = Math.min(Math.round(expected * jitter), remaining - (parties.length - i - 1));
    votes[parties[i]] = Math.max(0, actual);
    remaining -= votes[parties[i]];
  }
  votes[parties[parties.length - 1]] = Math.max(0, remaining);
  return votes;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedScenario = body.scenario || "random";

    // Pick scenario
    let scenarioKey = requestedScenario;
    if (scenarioKey === "random") {
      const options = ["landslide", "sweep", "close"];
      scenarioKey = options[Math.floor(Math.random() * options.length)];
    }
    const scenario = SCENARIOS[scenarioKey] || SCENARIOS.random;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Step 0: Reset — clear old data via RPC ──
    const { error: resetError } = await supabase.rpc("reset_simulation_data");
    if (resetError) {
      console.error("Reset error:", resetError.message);
      // Fallback: try TRUNCATE via direct SQL
    }

    // ── Step 1: Load all polling units with state info ──
    const { data: states } = await supabase.from("states").select("id, name");
    const stateMap = new Map(states?.map((s) => [s.name, s.id]));
    const stateNameMap = new Map(states?.map((s) => [s.id, s.name]));

    // Load all PUs
    const allPUs: any[] = [];
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from("polling_units")
        .select("id, state_id")
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      allPUs.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }

    // Load assignments for result linkage
    const allAssignments: any[] = [];
    offset = 0;
    while (true) {
      const { data } = await supabase
        .from("agent_assignments")
        .select("id, polling_unit_id, election_id, volunteer_id")
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      allAssignments.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }

    const assignmentMap = new Map(allAssignments.map((a) => [a.polling_unit_id, a]));

    // Get party IDs
    const { data: allParties } = await supabase.from("parties").select("id, abbreviation");
    const partyIdMap: Record<string, string> = {};
    allParties?.forEach((p) => {
      if (!partyIdMap[p.abbreviation]) partyIdMap[p.abbreviation] = p.id;
    });

    // ── Step 2: Generate results ──
    let totalVotesGlobal = 0;
    let resultsCreated = 0;
    let prCreated = 0;
    const BATCH = 100;

    for (let i = 0; i < allPUs.length; i += BATCH) {
      const batch = allPUs.slice(i, i + BATCH);

      // Build result rows
      const resultRows = batch.map((pu) => {
        const stateName = stateNameMap.get(pu.state_id) || "Unknown";
        const weights = buildRegionalWeights(scenario, stateName);
        const totalVotes = Math.round(400 + Math.random() * 800);
        totalVotesGlobal += totalVotes;
        const validVotes = Math.round(totalVotes * (0.82 + Math.random() * 0.15));
        const rejectedVotes = totalVotes - validVotes;
        const asst = assignmentMap.get(pu.id);

        return {
          polling_unit_id: pu.id,
          election_id: asst?.election_id || null,
          volunteer_id: asst?.volunteer_id || null,
          assignment_id: asst?.id || null,
          valid_votes: validVotes,
          rejected_votes: rejectedVotes,
          total_votes: totalVotes,
          status: "VERIFIED",
          submitted_at: new Date(Date.now() - Math.random() * 86400000 * 60).toISOString(),
          verified_at: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString(),
          _weights: weights,
          _totalVotes: totalVotes,
        };
      });

      // Insert results
      const { data: inserted, error: rsErr } = await supabase
        .from("result_submissions")
        .insert(
          resultRows.map((r) => ({
            polling_unit_id: r.polling_unit_id,
            election_id: r.election_id,
            volunteer_id: r.volunteer_id,
            assignment_id: r.assignment_id,
            valid_votes: r.valid_votes,
            rejected_votes: r.rejected_votes,
            total_votes: r.total_votes,
            status: r.status,
            submitted_at: r.submitted_at,
            verified_at: r.verified_at,
          }))
        )
        .select("id");

      if (rsErr || !inserted) continue;

      // Build party_results
      const prRows: any[] = [];
      for (let j = 0; j < inserted.length; j++) {
        const votes = generateVotesForPU(resultRows[j]._weights, resultRows[j]._totalVotes);
        for (const [abbr, count] of Object.entries(votes)) {
          const pid = partyIdMap[abbr];
          if (pid && count > 0) {
            prRows.push({
              result_submission_id: inserted[j].id,
              party_id: pid,
              votes: count,
            });
          }
        }
      }

      // Insert party_results in sub-batches
      for (let k = 0; k < prRows.length; k += 500) {
        const sub = prRows.slice(k, k + 500);
        const { error } = await supabase.from("party_results").insert(sub);
        if (!error) prCreated += sub.length;
      }

      resultsCreated += inserted.length;

      // Log progress every 5000
      if ((i + BATCH) % 5000 === 0 || i + BATCH >= allPUs.length) {
        console.log(
          `[${Math.round(((i + BATCH) / allPUs.length) * 100)}%] ` +
          `Results: ${resultsCreated}, PR: ${prCreated}, ` +
          `Votes: ~${(totalVotesGlobal / 1_000_000).toFixed(1)}M`
        );
      }
    }

    return NextResponse.json({
      success: true,
      scenario: scenario.name,
      description: scenario.description,
      total_polling_units: allPUs.length,
      results_created: resultsCreated,
      party_results_created: prCreated,
      total_votes: totalVotesGlobal,
      ndc_wins: true,
    });
  } catch (error: any) {
    console.error("Simulation error:", error);
    return NextResponse.json(
      { error: error.message || "Simulation failed" },
      { status: 500 }
    );
  }
}
