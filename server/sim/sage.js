// Scent Weaver Sage: Licorice Note (#1). Her traits are in the engine (vendor .../hero/hero-trait-mods.ts,
// values from tlidb's Licorice_Note page, SS14); this module holds what the engine can't see: the
// Scent Bottle ingredients. The game log never lists them (checked against CoffeeSage#9020's login
// dump), so they're picked in the UI (hero.ingredients) and handed to the engine as stat lines.
//   Basic Scent Bottle  = the 2nd active skill slot (Licorice Note): 2 ingredients, scaled by the
//                         Licorice Note trait level, + 1 Functional ingredient with Pungent Stimulant
//                         Salt (charge restoration only)
//   Special Scent Bottle = the 3rd active skill slot (Licorice Tincture Blend): 1 Special ingredient,
//                         scaled by that trait's level
// Elixir skills themselves are buff skills the engine scales with Elixir Skill Effect
// (server/engine/elixirs.js); they're taken as always up, the player's rule for buffs.
export const SAGE_HERO = 'Scent Weaver Sage: Licorice Note (#1)';
export const SAGE_LOG_HERO_ID = 1800;
export const isSage = (hero) => hero?.name === SAGE_HERO;

const at = (values, level) => values[Math.max(1, Math.min(5, level ?? 1)) - 1];
const pct = (values, level) => at(values, level);

// The log's trait ids (tlidb's data-id on the hero page) by name, for data/gamedata/heroTraits.local.json
export const SAGE_TRAIT_IDS = {
  1800001: { name: 'Licorice Note', level: 1 },
  1800011: { name: 'Pungent Stimulant Salt', level: 45 },
  1800021: { name: 'Elixir of Immortality', level: 60 },
  1800022: { name: 'Scent of Ambition', level: 60 },
  1800031: { name: 'Everlasting Nectar', level: 75 },
  1800032: { name: 'Licorice Tincture Blend', level: 75 },
};

// text(level): what the ingredient says at that trait level (shown in the UI). line(level): the stat
// line the engine gets, null when it has no DPS effect the engine can count. Defence-only ingredients
// are kept for the picker and listed as not counted.
export const SAGE_INGREDIENTS = {
  basic: [
    {
      name: 'Razor Leaf',
      kind: 'Damage',
      text: (l) => `+${pct([8, 9, 10, 11, 12], l)}% additional damage when you or your Minions land a Critical Strike`,
      line: (l) => `+${pct([8, 9, 10, 11, 12], l)}% additional damage when you or your Minions land a Critical Strike`,
    },
    {
      name: 'Twinspine Flower',
      kind: 'Damage',
      text: (l) => `When Reaping, +${pct([10, 11, 12, 13, 14], l)}% chance to Reap 2 times`,
      line: () => null,
      note: 'its extra Reap chance is not modelled yet',
    },
    {
      name: 'Scattered Spore',
      kind: 'Damage',
      text: (l) => `+${pct([5, 6, 7, 8, 9], l)}% additional damage taken by enemies within 15m when casting this skill. Stacks up to 2 times. Lasts for 8s`,
      // Both stacks up (the bottle recasts well within 8 s)
      line: (l) => `+${2 * pct([5, 6, 7, 8, 9], l)}% additional damage taken by enemies`,
    },
    {
      name: 'Resilient Moss',
      kind: 'Defense',
      text: (l) => `-${pct([6, 7, 8, 9, 10], l)}% additional damage taken when any Minion exists (up to -60% additional damage)`,
      line: () => null,
      note: 'defence only, not counted',
    },
    {
      name: 'Spectral Stamen',
      kind: 'Defense',
      text: (l) => `${pct([6, 7, 8, 9, 10], l)}% of damage is taken from Mana before life`,
      line: (l) => `${pct([6, 7, 8, 9, 10], l)}% of damage is taken from Mana before life`,
    },
    {
      name: 'Prismatic Vine',
      kind: 'Defense',
      text: (l) => `Converts ${pct([6, 7, 8, 9, 10], l)}% of Physical Damage taken to random Elemental Damage`,
      line: () => null,
      note: 'defence only, not counted',
    },
  ],
  // Pungent Stimulant Salt's extra ingredient: Charging Progress, which only sets the elixir's uptime
  functional: [
    { name: 'Husk', kind: 'Functional', text: (l) => `This skill gains ${at([3, 4, 5, 5, 6], l)} Charging Progress on Critical Strike. Interval: 0.5 s`, line: () => null, note: 'charge restoration only (elixirs are taken as always up)' },
    { name: 'Sword Lily Leaf', kind: 'Functional', text: (l) => `When Reaping, this skill gains ${at([3, 4, 5, 5, 6], l)} Charging Progress. Interval: 0.5 s`, line: () => null, note: 'charge restoration only (elixirs are taken as always up)' },
    { name: 'Tumbleweed Seed', kind: 'Functional', text: (l) => `For every 6 m moved, this skill gains ${at([2, 3, 4, 4, 5], l)} Charging Progress. Interval: 0.5 s`, line: () => null, note: 'charge restoration only (elixirs are taken as always up)' },
  ],
  // Licorice Tincture Blend's Special Scent Bottle
  special: [
    {
      name: 'Pixie Tear',
      kind: 'Special',
      text: (l) => `${at([80, 90, 100, 110, 120], l)}% of excess Life restoration is also applied to Energy Shield restoration. For every 400 Max Energy Shield, +${at([1, 1.2, 1.4, 1.6, 1.8], l)}% additional damage for you and your Minions, up to +${at([40, 48, 56, 62, 70], l)}%`,
      line: (l) => `+${at([1, 1.2, 1.4, 1.6, 1.8], l)}% additional damage for you and your Minions for every 400 Max Energy Shield, up to +${at([40, 48, 56, 62, 70], l)}%`,
    },
    {
      name: 'Thunder Dragon Scale',
      kind: 'Special',
      text: (l) => `Defeated enemies have a 30% chance to explode for True Damage equal to 250% of their Max Life within 6 m${l >= 2 ? `. +${at([0, 5, 10, 15, 20], l)}% additional damage for you and your Minions` : ''}`,
      line: (l) => (l >= 2 ? `+${at([0, 5, 10, 15, 20], l)}% additional damage for you and your Minions` : null),
      note: 'its explosions on kills are not counted (nothing dies on a dummy)',
    },
    {
      name: 'Gargoyle Horn',
      kind: 'Special',
      text: (l) => `Increases Block Chance by an additional ${at([70, 90, 110, 130, 150], l)}%, but you take True Damage equal to ${at([6, 4.5, 3, 1.5, 0], l)}% of the mitigated damage every second after each successful block. Lasts for 4s`,
      line: () => null,
      note: 'defence only, not counted',
    },
  ],
};

const pickedTraits = (hero) => new Set(Object.values(hero?.traits ?? {}).filter(Boolean));
const traitLevel = (hero, name) => hero?.levels?.[name] ?? 1;
const find = (list, name) => list.find((i) => i.name === name) ?? null;

// Which bottles this hero has: the Basic one always, the Functional slot with Pungent Stimulant
// Salt, the Special bottle with Licorice Tincture Blend
export function sageBottles(hero) {
  const picked = pickedTraits(hero);
  return { basic: true, functional: picked.has('Pungent Stimulant Salt'), special: picked.has('Licorice Tincture Blend') };
}

// The picked ingredients with the level they're read at: [{ slot, ingredient, level }]
function pickedIngredients(hero) {
  const bottles = sageBottles(hero);
  const ing = hero?.ingredients ?? {};
  const out = [];
  const basicLevel = traitLevel(hero, 'Licorice Note');
  for (const name of (ing.basic ?? []).slice(0, 2)) {
    const i = find(SAGE_INGREDIENTS.basic, name);
    if (i) out.push({ slot: 'basic', ingredient: i, level: basicLevel });
  }
  if (bottles.functional && ing.functional) {
    const i = find(SAGE_INGREDIENTS.functional, ing.functional);
    if (i) out.push({ slot: 'functional', ingredient: i, level: traitLevel(hero, 'Pungent Stimulant Salt') });
  }
  if (bottles.special && ing.special) {
    const i = find(SAGE_INGREDIENTS.special, ing.special);
    if (i) out.push({ slot: 'special', ingredient: i, level: traitLevel(hero, 'Licorice Tincture Blend') });
  }
  return out;
}

// Stat lines for the engine, by source
export function sageIngredientLines(hero) {
  if (!isSage(hero)) return [];
  return pickedIngredients(hero)
    .map(({ ingredient, level }) => ({ source: `Scent Bottle: ${ingredient.name}`, text: ingredient.line(level) }))
    .filter((l) => l.text);
}

// What the numbers leave out, for the calculation's "not counted" list
export function sageNotes(hero) {
  if (!isSage(hero)) return [];
  const notes = [];
  const picked = pickedIngredients(hero);
  const bottles = sageBottles(hero);
  const ing = hero.ingredients ?? {};
  if ((ing.basic ?? []).filter((n) => find(SAGE_INGREDIENTS.basic, n)).length < 2) notes.push('Scent Bottle: pick its 2 ingredients under "Hero & pactspirits" (the log doesn\'t list them)');
  if (bottles.special && !find(SAGE_INGREDIENTS.special, ing.special)) notes.push('Special Scent Bottle (Licorice Tincture Blend): pick its ingredient under "Hero & pactspirits"');
  for (const { ingredient } of picked) if (ingredient.note) notes.push(`Scent Bottle: ${ingredient.name}: ${ingredient.note}`);
  notes.push('Elixir skills: taken as always up and at full stacks (Scent of Ambition, Omni-Elixir Notes); Temporary Life at its cap unless the combat toggle says less');
  return notes;
}

// For the UI's pickers: each ingredient's text at every trait level
export function sageCatalog() {
  const levels = [1, 2, 3, 4, 5];
  const list = (items) => items.map((i) => ({ name: i.name, kind: i.kind, modelled: !!i.line(5), texts: levels.map((l) => i.text(l)) }));
  return { basic: list(SAGE_INGREDIENTS.basic), functional: list(SAGE_INGREDIENTS.functional), special: list(SAGE_INGREDIENTS.special) };
}
