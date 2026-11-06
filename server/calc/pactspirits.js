// Finds the best trio of legendary pactspirits for the current build. Every pet is scored alone
// with the engine's formula DPS; every trio of the strongest candidates is compared the same way
// (bonuses multiply, so pairs matter); then the best trios are re-ranked by the in-game
// simulation, which accounts for timing (Terra Charges, Gash, ramp-up, reaping).
import { runEngine, LEGENDARY_PACTSPIRITS } from '../engine/bridge.js';
import { simulate } from '../sim/index.js';
import { rankCombos } from './combos.js';

const MIN_GAIN = 1.0005; // a pet must add more than 0.05% DPS alone to be a candidate
const SIM_RERANK = 15; // trios re-checked with the simulation

// hero: the hero/traits picked in the UI; current: the trio picked as equipped, [{ name, level }]
export async function optimizePactspirits(character, scenario, { level = 6, maxCandidates = 20, hero, current, onProgress } = {}) {
  const started = Date.now();
  const withPets = (names) => names.map((name) => ({ name, level }));
  const formula = (pets) => {
    const r = runEngine(character, scenario, { pactspirits: pets, hero });
    return r.ok ? (r.results.skills[r.mainSkill]?.totalDps ?? null) : null;
  };
  const sim = (pets) => {
    const s = simulate(character, scenario, { pactspirits: pets, hero });
    return s.supported ? { avgDps: s.avgDps, steadyDps: s.steadyDps, peak1s: s.peak1s, policy: s.policy } : null;
  };

  const base = formula([]);
  if (base == null) return { error: "The main skill has no damage model in the engine, so pactspirits can't be compared." };

  const singles = LEGENDARY_PACTSPIRITS.map((p) => ({ ...p, dps: formula(withPets([p.name])) ?? base })).sort((a, b) => b.dps - a.dps);
  const candidates = singles
    .filter((s) => s.dps > base * MIN_GAIN)
    .slice(0, maxCandidates)
    .map((s) => s.name);
  const size = Math.min(3, candidates.length);
  const { top, evaluated } = size
    ? await rankCombos(candidates, size, (names) => formula(withPets(names)), { keep: SIM_RERANK, onProgress })
    : { top: [], evaluated: 0 };

  const baseSim = sim([]);
  const combos = [];
  for (const { items, value } of top) {
    combos.push({ pets: items, dps: value, sim: sim(withPets(items)) });
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (baseSim) combos.sort((a, b) => (b.sim?.avgDps ?? 0) - (a.sim?.avgDps ?? 0));

  const yours = current?.length ? { pets: current.map((p) => p.name), dps: formula(current), sim: sim(current) } : null;

  return {
    base,
    baseSim,
    yours,
    level,
    scenario,
    singles,
    combos: combos.slice(0, 10),
    candidates: candidates.length,
    evaluated: evaluated + singles.length + 1,
    simulated: combos.length + (baseSim ? 1 : 0),
    ms: Date.now() - started,
  };
}
