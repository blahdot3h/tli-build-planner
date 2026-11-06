// Tide Whisper Selena: Dance of the Deep (#2). The engine's data predates this hero, so her traits
// are listed here and the Terra simulation (server/sim/index.js) applies them. Values per trait
// level 1-5, from tlidb's Dance_of_the_Deep page (current season); the log names her trait tree
// nodes by id (data/gamedata/heroTraits.local.json).
const at = (values, level) => values[Math.max(1, Math.min(5, level ?? 3)) - 1];

export const SELENA_HERO = 'Tide Whisper Selena: Dance of the Deep (#2)';

// The trait tree by the hero level each node needs. Nodes are picked like the older heroes'
// choices, but the tree allows two picks from the same level.
export const SELENA_TREE = {
  1: ['Dance of the Deep'],
  45: ["Dreambreaker's Gyre", 'Silencing Severance', 'The Paradise I Curse', 'Crimson Endless Dance'],
  60: ['Layered Hem', 'Drenched Hem', 'The Cycle I Resist'],
  75: ['Lonely Ensemble'],
};

// Traits whose effect on damage the simulation models. The rest are accepted but add nothing:
// Crimson Endless Dance (Dance Step buffs), Drenched Hem (needs Activation Medium: Terra sealing
// Life) and Lonely Ensemble (Crimson Shades casting Terra).
export const SELENA_SIM_TRAITS = new Set([
  'Dance of the Deep',
  "Dreambreaker's Gyre",
  'The Paradise I Curse',
  'The Cycle I Resist',
  'Silencing Severance',
  'Layered Hem',
]);

// Trait levels: picked in the UI or worked out from the memories (hero.levels), else 1 for the
// base trait and 2 for the others (a memory of level 30+, the usual case)
export function selenaModel(hero) {
  if (hero?.name !== SELENA_HERO) return null;
  const picked = new Set(Object.values(hero.traits ?? {}).filter(Boolean));
  picked.add('Dance of the Deep');
  const level = (name) => hero.levels?.[name] ?? (name === 'Dance of the Deep' ? 1 : 2);
  const has = (name) => picked.has(name);
  const base = level('Dance of the Deep');

  return {
    traits: [...picked].map((name) => ({ name, level: level(name), modelled: SELENA_SIM_TRAITS.has(name) })),
    // Dance of the Deep: the Main Terra is centred on you and follows you, so a target you stand
    // next to is always inside it. "+X% additional Terra Skill Damage"; at level 5, Artificial
    // Moon raises the damage per Terra Charge consumed to 32%.
    terraAddnPct: at([0, 5, 10, 15, 20], base),
    chargeBonusPct: base >= 5 ? 32 : null,
    // Dreambreaker's Gyre: a Crimson Tide while the Main Terra lasts; "+X% additional damage taken
    // by enemies affected by Crimson Tide"
    crimsonTidePct: has("Dreambreaker's Gyre") ? at([35, 45, 55, 65, 75], level("Dreambreaker's Gyre")) : 0,
    // The Paradise I Curse: enemies in the Main Terra get Lv. 1 Ominous (so they can gain Ill
    // Omen); "+X% additional damage against Cursed enemies"
    ominous: has('The Paradise I Curse'),
    cursedAddnPct: has('The Paradise I Curse') ? at([10, 15, 20, 25, 30], level('The Paradise I Curse')) : 0,
    // The Cycle I Resist: 25% of the Critical Strike Rating bonus also applies to Terra Skill
    // Duration; casting a Terra while the previous Main Terra hasn't ended Reaps DoT equal to X% of
    // that Terra's remaining duration
    cycle: has('The Cycle I Resist') ? { critToDurationPct: 25, reapPctOfRemaining: at([6, 7, 8, 9, 10], level('The Cycle I Resist')) } : null,
    // Silencing Severance: Max Terra Charge Stacks +1 (its Activation Medium: Terra auto-cast isn't
    // modelled; casts follow the simulation's recast policy)
    maxChargesBonus: has('Silencing Severance') ? 1 : 0,
    // Layered Hem: +X% Terra Charge Recovery Speed (its Max Spell Burst -> Max Terra Charge part
    // isn't modelled)
    chargeRecoveryPct: has('Layered Hem') ? at([50, 75, 100, 125, 150], level('Layered Hem')) : 0,
  };
}
