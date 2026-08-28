/**
 * POST /api/admin/simulate/tick
 * 
 * Executes one simulation tick: picks random polling units,
 * generates results and incidents, writes them to the database.
 * Called by the admin dashboard every 5 seconds while simulation is running.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generateResult,
  generateIncident,
  type ElectionType,
} from "@/lib/domain/simulation";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function POST(_request: NextRequest) {
  try {
    const supabase = getSupabase();

    // 1. Get current simulation config
    const { data: config } = await supabase
      .from("simulation_config")
      .select("*")
      .eq("status", "RUNNING")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!config) {
      return NextResponse.json({ ticked: false, reason: "No active simulation" });
    }

    const speed = config.speed || 3;
    const electionType = (config.election_type || "PRESIDENTIAL") as ElectionType;
    const targetStates = config.target_states || [];

    // 2. Fetch polling units (batch of random ones)
    let puQuery = supabase
      .from("polling_units")
      .select("id, official_code, state_id, registered_voters, latitude, longitude")
      .not("latitude", "is", null)
      .not("longitude", "is", null);

    if (targetStates.length > 0) {
      // Filter by state codes — need to join with states table
      const { data: stateIds } = await supabase
        .from("states")
        .select("id")
        .in("code", targetStates);

      if (stateIds && stateIds.length > 0) {
        puQuery = puQuery.in(
          "state_id",
          stateIds.map((s) => s.id)
        );
      }
    }

    const { data: allPUs } = await puQuery.limit(10000);

    if (!allPUs || allPUs.length === 0) {
      return NextResponse.json({ ticked: false, reason: "No polling units found" });
    }

    // 3. Get existing results to avoid duplicating too much
    const { data: existingResults } = await supabase
      .from("result_submissions")
      .select("polling_unit_id")
      .limit(10000);

    const existingPUIds = new Set(existingResults?.map((r) => r.polling_unit_id) || []);

    // Filter to PUs without results yet (prefer new coverage)
    const uncoveredPUs = allPUs.filter((pu) => !existingPUIds.has(pu.id));
    const coveredPUs = allPUs.filter((pu) => existingPUIds.has(pu.id));

    // 4. Pick PUs: mostly uncovered, some covered (for re-submission / verification)
    const candidates = [
      ...uncoveredPUs,
      ...coveredPUs.slice(0, Math.ceil(speed * 0.3)),
    ];

    // Shuffle and pick `speed` PUs
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    const selectedPUs = shuffled.slice(0, speed);

    // 5. Get existing volunteers to assign
    const { data: volunteers } = await supabase
      .from("volunteers")
      .select("id, status")
      .in("status", ["ACTIVE", "VERIFIED"]);

    if (!volunteers || volunteers.length === 0) {
      return NextResponse.json({ ticked: false, reason: "No active volunteers" });
    }

    // 6. Get elections — create one if needed
    let { data: election } = await supabase
      .from("elections")
      .select("id")
      .eq("election_type", electionType)
      .limit(1)
      .single();

    if (!election) {
      const electionName =
        electionType === "PRESIDENTIAL"
          ? "Presidential Election 2027"
          : electionType === "HOUSE_OF_REPS"
            ? "House of Representatives 2027"
            : "Governorship Election 2027";

      const { data: newElection } = await supabase
        .from("elections")
        .insert({
          name: electionName,
          election_type: electionType,
          election_date: "2027-01-16",
        })
        .select("id")
        .single();

      election = newElection;
    }

    if (!election) {
      return NextResponse.json({ ticked: false, reason: "Could not create election" });
    }

    // 7. For each selected PU: ensure assignment exists, then submit result
    let resultsSubmitted = 0;
    let incidentsSubmitted = 0;
    let assignmentsCreated = 0;

    for (const pu of selectedPUs) {
      try {
        // Check if PU already has 2 observers assigned
        const { data: existingAssignments } = await supabase
          .from("agent_assignments")
          .select("id, volunteer_id, observer_number")
          .eq("polling_unit_id", pu.id)
          .eq("election_id", election.id);

        let volunteerId: string;
        let observerNumber: number;

        if (existingAssignments && existingAssignments.length >= 2) {
          // Already has 2 observers — pick one for re-submission
          const randomAssignment =
            existingAssignments[Math.floor(Math.random() * existingAssignments.length)];
          volunteerId = randomAssignment.volunteer_id;
          observerNumber = randomAssignment.observer_number;
        } else if (existingAssignments && existingAssignments.length === 1) {
          // Has 1 observer — add the second
          volunteerId = pickRandom(volunteers).id;
          observerNumber = existingAssignments[0].observer_number === 1 ? 2 : 1;

          // Check if this volunteer already has an assignment for this PU
          const alreadyAssigned = existingAssignments.some(
            (a) => a.volunteer_id === volunteerId
          );
          if (alreadyAssigned) {
            volunteerId = volunteers.find(
              (v) => !existingAssignments.some((a) => a.volunteer_id === v.id)
            )?.id || pickRandom(volunteers).id;
          }

          await supabase.from("agent_assignments").insert({
            volunteer_id: volunteerId,
            polling_unit_id: pu.id,
            election_id: election.id,
            observer_number: observerNumber,
            status: "CHECKED_IN",
            checked_in_at: new Date().toISOString(),
          });
          assignmentsCreated++;
        } else {
          // No observers — create first
          volunteerId = pickRandom(volunteers).id;
          observerNumber = 1;

          await supabase.from("agent_assignments").insert({
            volunteer_id: volunteerId,
            polling_unit_id: pu.id,
            election_id: election.id,
            observer_number: observerNumber,
            status: "CHECKED_IN",
            checked_in_at: new Date().toISOString(),
          });
          assignmentsCreated++;
        }

        // Generate and submit result
        const result = generateResult(
          {
            id: pu.id,
            official_code: pu.official_code,
            state_id: pu.state_id,
            registered_voters: pu.registered_voters,
          },
          electionType
        );

        // Get party IDs from database
        const { data: partyRows } = await supabase.from("parties").select("id, abbreviation");
        const partyMap = new Map(partyRows?.map((p) => [p.abbreviation, p.id]) || []);

        // Insert result
        const { data: resultRow } = await supabase
          .from("result_submissions")
          .insert({
            volunteer_id: volunteerId,
            polling_unit_id: pu.id,
            election_id: election.id,
            valid_votes: result.valid_votes,
            rejected_votes: result.rejected_votes,
            total_votes: result.total_votes,
            status: "UNVERIFIED",
            submitted_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        // Insert party results
        if (resultRow) {
          const partyResultRows = result.party_results
            .filter((pr) => partyMap.has(pr.party_id))
            .map((pr) => ({
              result_id: resultRow.id,
              party_id: partyMap.get(pr.party_id)!,
              votes: pr.votes,
            }));

          if (partyResultRows.length > 0) {
            await supabase.from("party_results").insert(partyResultRows);
          }
        }

        resultsSubmitted++;

        // Maybe generate an incident
        if (pu.latitude && pu.longitude) {
          const incident = generateIncident({
            id: pu.id,
            latitude: pu.latitude,
            longitude: pu.longitude,
          });

          if (incident) {
            await supabase.from("incidents").insert({
              volunteer_id: volunteerId,
              polling_unit_id: pu.id,
              category: incident.category,
              severity: incident.severity,
              what_observed: incident.what_observed,
              latitude: incident.latitude,
              longitude: incident.longitude,
              status: "REPORTED",
              submitted_at: new Date().toISOString(),
            });
            incidentsSubmitted++;
          }
        }
      } catch (e) {
        // Skip this PU on error, continue with others
        console.error(`Error simulating PU ${pu.official_code}:`, e);
      }
    }

    // 8. Update simulation config stats
    await supabase
      .from("simulation_config")
      .update({
        total_results_submitted: (config.total_results_submitted || 0) + resultsSubmitted,
        total_incidents_submitted: (config.total_incidents_submitted || 0) + incidentsSubmitted,
        total_assignments_created: (config.total_assignments_created || 0) + assignmentsCreated,
        last_tick_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    return NextResponse.json({
      ticked: true,
      election_type: electionType,
      results_submitted: resultsSubmitted,
      incidents_submitted: incidentsSubmitted,
      assignments_created: assignmentsCreated,
      total_results: (config.total_results_submitted || 0) + resultsSubmitted,
      total_incidents: (config.total_incidents_submitted || 0) + incidentsSubmitted,
    });
  } catch (error) {
    console.error("Error in simulation tick:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
