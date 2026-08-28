/**
 * Election Simulation Engine
 * 
 * Generates realistic election data for different Nigerian election types.
 * Used by the admin dashboard to run controlled simulations.
 */

// Nigerian political parties with approximate strength profiles
const PARTIES = [
  { abbreviation: "APC", name: "All Progressives Congress", color: "#00A859", baseStrength: 0.25 },
  { abbreviation: "PDP", name: "Peoples Democratic Party", color: "#003DA5", baseStrength: 0.22 },
  { abbreviation: "LP", name: "Labour Party", color: "#00FF00", baseStrength: 0.18 },
  { abbreviation: "NNPP", name: "New Nigeria Peoples Party", color: "#FF0000", baseStrength: 0.10 },
  { abbreviation: "APGA", name: "All Progressives Grand Alliance", color: "#FFD700", baseStrength: 0.08 },
  { abbreviation: "SDP", name: "Social Democratic Party", color: "#800080", baseStrength: 0.07 },
  { abbreviation: "YPP", name: "Young Progressives Party", color: "#FF4500", baseStrength: 0.05 },
  { abbreviation: "ADC", name: "African Democratic Congress", color: "#006400", baseStrength: 0.05 },
];

export type ElectionType = "PRESIDENTIAL" | "HOUSE_OF_REPS" | "GOVERNORSHIP";

export interface SimulationConfig {
  election_type: ElectionType;
  speed: number; // results per tick
  target_states: string[]; // state codes, empty = all
}

export interface SimulatedResult {
  polling_unit_id: string;
  polling_unit_code: string;
  state_id: string;
  valid_votes: number;
  rejected_votes: number;
  total_votes: number;
  party_results: { party_id: string; votes: number }[];
  status: "UNVERIFIED";
}

export interface SimulatedIncident {
  polling_unit_id: string;
  category: string;
  severity: string;
  what_observed: string;
  latitude: number;
  longitude: number;
}

/**
 * Generate a simulated result for a polling unit.
 * Vote counts are realistic for Nigerian elections:
 * - 200-2000 registered voters per PU
 * - 30-80% turnout
 * - 1-5% rejected ballots
 * - Party vote distribution varies by region
 */
export function generateResult(
  pu: { id: string; official_code: string; state_id: string; registered_voters?: number },
  electionType: ElectionType
): SimulatedResult {
  const registeredVoters = pu.registered_voters || 500 + Math.floor(Math.random() * 1500);
  
  // Turnout: 30-80%
  const turnoutRate = 0.30 + Math.random() * 0.50;
  const totalVoters = Math.floor(registeredVoters * turnoutRate);
  
  // Rejected ballots: 1-5%
  const rejectRate = 0.01 + Math.random() * 0.04;
  const rejectedVotes = Math.floor(totalVoters * rejectRate);
  const validVotes = totalVoters - rejectedVotes;
  
  // Distribute votes among parties with some randomness
  const partyVotes = distributeVotes(validVotes, electionType);
  
  const totalVotes = validVotes + rejectedVotes;
  
  return {
    polling_unit_id: pu.id,
    polling_unit_code: pu.official_code,
    state_id: pu.state_id,
    valid_votes: validVotes,
    rejected_votes: rejectedVotes,
    total_votes: totalVotes,
    party_results: partyVotes,
    status: "UNVERIFIED",
  };
}

/**
 * Generate a simulated incident (random, ~5% chance per result submitted)
 */
export function generateIncident(
  pu: { id: string; latitude: number; longitude: number }
): SimulatedIncident | null {
  if (Math.random() > 0.05) return null;
  
  const categories = [
    { category: "VIOLENCE", severity: "HIGH", templates: [
      "Altercation between party agents near polling unit",
      "Thugs disrupted voting process",
    ]},
    { category: "INTIMIDATION", severity: "MEDIUM", templates: [
      "Voters turned away by unknown persons",
      "Party agents intimidating voters at queue",
    ]},
    { category: "DISRUPTION", severity: "MEDIUM", templates: [
      "Power outage delayed electronic voting",
      "Ballot box tampered with before counting",
    ]},
    { category: "MATERIAL_SHORTAGE", severity: "LOW", templates: [
      "Insufficient ballot papers for registered voters",
      "INK pads not available at polling unit",
    ]},
    { category: "OTHER", severity: "LOW", templates: [
      "Late arrival of INEC officials",
      "Voter register not found at polling unit",
    ]},
  ];
  
  const cat = categories[Math.floor(Math.random() * categories.length)];
  const template = cat.templates[Math.floor(Math.random() * cat.templates.length)];
  
  return {
    polling_unit_id: pu.id,
    category: cat.category,
    severity: cat.severity,
    what_observed: template,
    latitude: pu.latitude + (Math.random() - 0.5) * 0.001,
    longitude: pu.longitude + (Math.random() - 0.5) * 0.001,
  };
}

/**
 * Distribute valid votes among parties.
 * Uses Dirichlet-like distribution with base strengths + noise.
 */
function distributeVotes(
  totalVotes: number,
  electionType: ElectionType
): { party_id: string; votes: number }[] {
  // Adjust party strengths based on election type
  const strengths = PARTIES.map((p) => {
    let base = p.baseStrength;
    if (electionType === "GOVERNORSHIP") {
      // Governorship: more localized, wider variance
      base += (Math.random() - 0.5) * 0.15;
    } else if (electionType === "HOUSE_OF_REPS") {
      // House of Reps: slightly more varied
      base += (Math.random() - 0.5) * 0.08;
    }
    return Math.max(0.01, base);
  });
  
  // Normalize
  const totalStrength = strengths.reduce((s, v) => s + v, 0);
  const normalized = strengths.map((s) => s / totalStrength);
  
  // Allocate votes
  let remaining = totalVotes;
  const results: { party_id: string; votes: number }[] = [];
  
  for (let i = 0; i < PARTIES.length; i++) {
    const isLast = i === PARTIES.length - 1;
    const votes = isLast ? remaining : Math.round(totalVotes * normalized[i]);
    remaining -= votes;
    results.push({ party_id: PARTIES[i].abbreviation, votes: Math.max(0, votes) });
  }
  
  return results;
}

/**
 * Get party info by abbreviation
 */
export function getPartyInfo(abbreviation: string) {
  return PARTIES.find((p) => p.abbreviation === abbreviation);
}

export { PARTIES };
