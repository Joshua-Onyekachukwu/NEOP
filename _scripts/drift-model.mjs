// Models neop_sim_wave's party allocation cumulatively across waves.
// Weights: w_party = v_party * neop_state_mult(state, party); minors scale by
// 1.05 * (1 - v_ndc - v_apc). Shares are normalised per PU, then averaged
// across PUs (weighted by each state's polling-unit count).
//
// Purpose: choose WAVES / v_ndc / v_apc / drift so that the CUMULATIVE
// leaderboard shows APC leading early and NDC overtaking later, with NDC
// finishing ahead.

const STATE_PUS = {
  Abia: 4062, Adamawa: 4104, "Akwa Ibom": 4353, Anambra: 5720, Bauchi: 5423,
  Bayelsa: 2244, Benue: 5102, Borno: 5071, "Cross River": 3281, Delta: 5863,
  Ebonyi: 2946, Edo: 4519, Ekiti: 2445, Enugu: 4145, Fct: 2822, Gombe: 2988,
  Imo: 4758, Jigawa: 4522, Kaduna: 8012, Kano: 11222, Katsina: 6652,
  Kebbi: 3743, Kogi: 3508, Kwara: 2887, Lagos: 13325, Nasarawa: 3256,
  Niger: 4950, Ogun: 5042, Ondo: 3933, Osun: 3763, Oyo: 6390,
  Plateau: 4989, Rivers: 6866, Sokoto: 3991, Taraba: 3597, Yobe: 2823,
  Zamfara: 3529,
};

function ndcMult(s) {
  switch (s) {
    case "Abia": case "Anambra": case "Ebonyi": case "Enugu": case "Imo": return 1.9;
    case "Rivers": case "Delta": case "Bayelsa": case "Akwa Ibom":
    case "Cross River": case "Edo": return 1.6;
    case "FCT": return 1.2;
    case "Borno": case "Yobe": case "Adamawa": case "Gombe":
    case "Taraba": case "Bauchi": return 0.7;
    case "Kano": case "Katsina": case "Sokoto": case "Zamfara":
    case "Kebbi": case "Jigawa": case "Kaduna": return 0.6;
    case "Lagos": case "Ogun": case "Oyo": case "Ondo":
    case "Osun": case "Ekiti": return 0.5;
    default: return 1.0;
  }
}

function apcMult(s) {
  switch (s) {
    case "Lagos": case "Ogun": case "Oyo": case "Ondo":
    case "Osun": case "Ekiti": return 1.5;
    case "Kano": case "Katsina": case "Sokoto": case "Zamfara":
    case "Kebbi": case "Jigawa": case "Kaduna": return 1.4;
    case "Borno": case "Yobe": case "Adamawa": case "Gombe":
    case "Taraba": case "Bauchi": return 1.3;
    case "Niger": case "Kwara": case "Kogi": case "Benue":
    case "Plateau": case "Nasarawa": return 1.1;
    case "Rivers": case "Delta": case "Bayelsa": case "Akwa Ibom":
    case "Cross River": case "Edo": return 0.4;
    case "Abia": case "Anambra": case "Ebonyi": case "Enugu": case "Imo": return 0.3;
    default: return 1.0;
  }
}

// Minor-party coefficient sum from the wave engine's CASE
const MINOR_SUM = 0.30 + 0.20 + 0.12 + 0.10 + 0.08 + 0.10 + 0.10 + 0.05; // 1.05

function run({ waves, ndcBase, apcBase, ndcLo, ndcHi, apcLo, apcHi }) {
  const states = Object.keys(STATE_PUS);
  const totalPus = states.reduce((s, k) => s + STATE_PUS[k], 0);

  // per-wave share of each party, averaged over the PU distribution
  const waveShare = [];
  for (let w = 0; w < waves; w++) {
    const p = waves > 1 ? w / (waves - 1) : 0;
    const vNdc = ndcBase * (ndcLo + (ndcHi - ndcLo) * p);
    const vApc = apcBase * (apcLo + (apcHi - apcLo) * p);
    const minors = MINOR_SUM * Math.max(0, 1 - vNdc - vApc);

    let sn = 0, sa = 0;
    for (const s of states) {
      const wn = vNdc * ndcMult(s);
      const wa = vApc * apcMult(s);
      const denom = wn + wa + minors;
      sn += (wn / denom) * STATE_PUS[s];
      sa += (wa / denom) * STATE_PUS[s];
    }
    waveShare.push({ w, ndc: sn / totalPus, apc: sa / totalPus });
  }

  // cumulative (each wave contributes equally many PUs)
  let cn = 0, ca = 0;
  const rows = [];
  let crossover = null;
  for (let k = 0; k < waves; k++) {
    cn += waveShare[k].ndc;
    ca += waveShare[k].apc;
    const leader = cn >= ca ? "NDC" : "APC";
    if (crossover === null && leader === "NDC") crossover = k;
    rows.push(
      `  wave ${String(k).padStart(2)}  cum NDC ${(cn / (k + 1) * 100).toFixed(1)}%   cum APC ${(ca / (k + 1) * 100).toFixed(1)}%   leader ${leader}`
    );
  }
  return { rows, crossover, finalNdc: cn / waves, finalApc: ca / waves };
}

const scenarios = [
  { label: "CURRENT close (0.30/0.28, drift .35)", waves: 12, ndcBase: 0.30, apcBase: 0.28, ndcLo: 0.65, ndcHi: 1.35, apcLo: 1.35, apcHi: 0.65 },
  { label: "A close (0.34/0.26, drift .35 sym)",   waves: 12, ndcBase: 0.34, apcBase: 0.26, ndcLo: 0.65, ndcHi: 1.35, apcLo: 1.35, apcHi: 0.65 },
  { label: "B close (0.34/0.26, NDC .85->1.45)",   waves: 12, ndcBase: 0.34, apcBase: 0.26, ndcLo: 0.85, ndcHi: 1.45, apcLo: 1.15, apcHi: 0.75 },
  { label: "C close (0.34/0.26, NDC .80->1.60)",   waves: 12, ndcBase: 0.34, apcBase: 0.26, ndcLo: 0.80, ndcHi: 1.60, apcLo: 1.20, apcHi: 0.70 },
  { label: "D close (0.34/0.26, NDC .85->1.55)",   waves: 12, ndcBase: 0.34, apcBase: 0.26, ndcLo: 0.85, ndcHi: 1.55, apcLo: 1.25, apcHi: 0.70 },
];

for (const s of scenarios) {
  console.log("\n== " + s.label);
  const r = run(s);
  console.log(r.rows.join("\n"));
  console.log(`  -> cumulative crossover at wave ${r.crossover}; final NDC ${(r.finalNdc * 100).toFixed(1)}% vs APC ${(r.finalApc * 100).toFixed(1)}%`);
}
