// Berserker Rehan - Seething Silhouette (#2): Rage, Berserk and the Seething Spirit, which the
// engine lists but doesn't model. Trait values are per trait level 1-5, from tlidb (current
// season); keyword rules from the engine's hyperlink data:
//   Rage: "default upper limit of 100. Upon reaching max Rage, Berserker enters Berserk"
//   Berserk: "Gains bonuses twice the Max Rage while Berserk is active. Berserk expires when you
//            run out of Rage"
//   Seething Spirit: "casts your Non-Mobility and Non-Channeled Main Melee Attack Skills when it appears"
const at = (values, level) => values[Math.max(1, Math.min(5, level ?? 3)) - 1];

export const REHAN_SIM_TRAITS = new Set([
  'Seething Silhouette',
  "Fury's Onslaught",
  'Ritual of Offering',
  'Growing Anger',
  'Hysteria',
  'Rage Infusion',
  'Split Form',
]);

// Trait levels: the ones picked in the UI (hero.levels, shown in game on the Hero Trait screen),
// else the engine's guess from the hero memories (levels: [{ name, level }]); maxLife for Split Form
export function rehanModel(hero, levels, { maxLife = 0 } = {}) {
  if (!/^Berserker Rehan: Seething Silhouette/.test(hero?.name ?? '')) return null;
  const picked = new Set(Object.values(hero.traits ?? {}).filter(Boolean));
  const level = (name) => hero.levels?.[name] ?? levels.find((l) => l.name === name)?.level ?? 3;
  const has = (name) => picked.has(name);
  const fury = has("Fury's Onslaught");
  const ritual = !fury && has('Ritual of Offering');
  const splitForm = has('Split Form') ? at([1, 1, 2, 2, 2], level('Split Form')) * Math.floor(maxLife / 40) : 0;

  return {
    traits: [...picked].map((name) => ({ name, level: level(name) })),
    maxRage: 100,
    rageOnCast: 10, // outside Berserk, each Melee Attack Skill cast
    aspdPerRagePct: 1 / 5, // +1% Attack Speed for every 5 Rage
    berserkAddnPct: at([20, 26, 32, 38, 44], level('Seething Silhouette')),
    // While Berserk: 10 Rage per second, and casts cost 10 instead of generating Rage
    drainPerSec: fury ? 0 : 10,
    castCost: fury ? 5 : 10,
    // Fury's Onslaught: the spirit appears for a while each time you use the main skill in Berserk.
    // Ritual of Offering: it's always out in Berserk, but you're disarmed.
    spirit: fury
      ? { mode: 'onCast', duration: at([1, 1.5, 2, 2, 2], level("Fury's Onslaught")), aspdMult: 0.7, addnPct: 0 }
      : ritual
        ? { mode: 'always', aspdMult: 1, addnPct: at([20, 25, 30, 35, 40], level('Ritual of Offering')), disarms: true }
        : null,
    playerAddnPct: fury ? at([50, 57, 64, 71, 78], level("Fury's Onslaught")) : 0,
    rageOnSpiritCast: has('Growing Anger') ? at([9, 10, 11, 12, 13], level('Growing Anger')) : 0,
    rageGainedPct: (has('Rage Infusion') ? 40 : 0) + splitForm,
    // +5% additional damage per 25 Rage gained recently; no longer Disarmed after 5 s of Berserk
    infusion: has('Rage Infusion') ? { perRage: 25, pctPerStack: 5, maxStacks: at([4, 5, 6, 7, 8], level('Rage Infusion')), armedAfter: 5 } : null,
  };
}
