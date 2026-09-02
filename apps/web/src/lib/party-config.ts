/**
 * Party Configuration — Single Source of Truth
 *
 * All simulation engines, UI components, and sync routes import from here.
 * Change party definitions in ONE place only.
 */

export interface Party {
  id: string;
  name: string;
  abbr: string;
  color: string;
}

export const PARTIES: Party[] = [
  { id: "ndc", name: "Nigeria Democratic Congress", abbr: "NDC", color: "#1B5E20" },
  { id: "apc", name: "All Progressives Congress", abbr: "APC", color: "#00A859" },
  { id: "pdp", name: "Peoples Democratic Party", abbr: "PDP", color: "#000080" },
  { id: "lp", name: "Labour Party", abbr: "LP", color: "#FF0000" },
  { id: "nnpp", name: "New Nigeria Peoples Party", abbr: "NNPP", color: "#E53935" },
  { id: "apga", name: "All Progressives Grand Alliance", abbr: "APGA", color: "#FFD600" },
  { id: "sdp", name: "Social Democratic Party", abbr: "SDP", color: "#1565C0" },
  { id: "ypp", name: "Young Progressives Party", abbr: "YPP", color: "#6A1B9A" },
  { id: "adc", name: "African Democratic Congress", abbr: "ADC", color: "#00838F" },
];

/** National party vote shares by scenario (sums to ~1.0) */
export const PARTY_SHARES: Record<string, number[]> = {
  landslide: [0.42, 0.22, 0.10, 0.08, 0.06, 0.04, 0.03, 0.03, 0.02],
  sweep: [0.37, 0.25, 0.10, 0.08, 0.06, 0.04, 0.03, 0.04, 0.03],
  close: [0.30, 0.28, 0.12, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03],
};

/** Regional vote multipliers [NDC, APC, PDP, LP, NNPP, APGA, SDP, YPP, ADC] */
export const REGION_MULT: Record<string, number[]> = {
  NW: [0.6, 1.4, 0.8, 0.5, 1.3, 0.7, 0.6, 0.5, 0.6],
  NE: [0.7, 1.3, 0.9, 0.6, 1.2, 0.8, 0.7, 0.6, 0.7],
  NC: [1.0, 1.1, 1.0, 0.8, 0.9, 0.9, 1.0, 0.8, 0.9],
  SW: [0.5, 1.5, 1.1, 0.7, 0.8, 1.2, 0.9, 0.7, 0.8],
  SE: [1.9, 0.3, 0.8, 1.8, 0.5, 1.5, 0.7, 0.9, 0.6],
  SS: [1.6, 0.4, 1.2, 1.4, 0.6, 0.7, 0.8, 0.7, 0.6],
  FC: [1.2, 1.0, 0.9, 1.1, 0.8, 0.8, 1.0, 0.9, 0.8],
};

/** State → Region mapping */
export const STATE_REGION: Record<string, string> = {
  Lagos: "SW", Ogun: "SW", Oyo: "SW", Ondo: "SW", Osun: "SW", Ekiti: "SW",
  Kano: "NW", Katsina: "NW", Sokoto: "NW", Zamfara: "NW", Kebbi: "NW", Jigawa: "NW", Kaduna: "NW",
  Borno: "NE", Yobe: "NE", Adamawa: "NE", Gombe: "NE", Taraba: "NE", Bauchi: "NE",
  Niger: "NC", Kwara: "NC", Kogi: "NC", Benue: "NC", Plateau: "NC", Nasarawa: "NC",
  Abia: "SE", Anambra: "SE", Ebonyi: "SE", Enugu: "SE", Imo: "SE",
  Rivers: "SS", Delta: "SS", Bayelsa: "SS", "Akwa Ibom": "SS", "Cross River": "SS", Edo: "SS",
  FCT: "FC",
};

/** Approximate state populations (millions) for voter distribution */
export const STATE_POP: Record<string, number> = {
  Lagos: 15.4, Kano: 13.1, Rivers: 7.3, Kaduna: 8.0, Oyo: 7.8,
  Delta: 5.6, Katsina: 7.4, Borno: 5.9, Jigawa: 5.7, Benue: 5.5,
  Anambra: 5.3, Plateau: 4.2, Sokoto: 5.3, "Cross River": 4.4, Adamawa: 4.8,
  Ogun: 5.2, Bauchi: 6.5, Niger: 5.3, Imo: 5.0, Abia: 3.9,
  Osun: 4.7, Zamfara: 4.3, Ondo: 4.5, Edo: 4.1, "Akwa Ibom": 5.2,
  Kebbi: 5.2, Kogi: 4.9, Enugu: 4.1, Nasarawa: 3.4, Taraba: 3.6,
  Ebonyi: 3.3, Gombe: 3.3, Ekiti: 3.6, Yobe: 3.5, Kwara: 3.6,
  Bayelsa: 2.3, FCT: 2.8,
};

// ── Constants ──

/** INEC 2026 official polling unit count */
export const INEC_TOTAL_PUS = 176_846;

/** National population for voter ratio calculation */
export const NATIONAL_POPULATION = 220_000_000;

/** Registered voter ratio (93M / 220M ≈ 42%) */
export const REGISTERED_VOTER_RATIO = 93_000_000 / 220_000_000;
