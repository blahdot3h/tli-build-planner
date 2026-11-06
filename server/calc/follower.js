// Followers (SS14): what a follower's skills and their supports put on the enemy, and what they do
// for you. The log never lists the follower (only that its page opened), so it comes from
// screenshots of the follower page: choices.follower = { name, level, skills: [{ name, supports }] }.
// The follower versions of skills and supports aren't the player's: these are from the Tartarus
// skills' tlidb pages (e.g. tlidb.com/en/Tartarus_Tidewell_III), where each lists the supports it can
// roll and what they do on a follower.

// Enemy states (scenario toggles), ailment types and stat lines for you, by follower skill
const SKILLS = {
  // "Allies' Spell Skills have a +20% chance to deal Double Damage" in its Water Area
  'Tartarus: Tidewell': { lines: ['+20% chance for Spells to deal Double Damage'], text: "Creates a Water Area: allies' Spell Skills within it have a +20% chance to deal Double Damage. Erupts 1 Torrent every 0.7 s (50-50 Spell Cold Damage). Lasts 6 s" },
  // "Inflicts Numbed when this skill deals Hit Lightning Damage"
  'Tartarus: Lightning Storm': { toggles: { enemyNumbed: true }, ailments: ['Numbed'], text: 'A Lightning Storm that tracks enemies, striking every 0.25 s for 50-50 Spell Lightning Damage. Inflicts Numbed on Hit Lightning Damage' },
  // "+40% Projectile Speed for you and allies for 4s when casting this skill"
  'Tartarus: Swift Shadow Raid': { lines: ['+40% Projectile Speed'], text: 'Dashes forward dealing 50-50 Hit Physical Damage. +40% Projectile Speed for you and allies for 4 s when cast' },
};

// ... and by support on a follower skill
const SUPPORTS = {
  'Additional Ignite': { toggles: { targetEnemyIsIgnited: true }, ailments: ['Ignite'], text: 'Adds 1-1 Base Ignite Damage to this skill. +100% Ignite Chance for this skill' },
  'Improved Corrosion': { ailments: ['Wilt'], text: 'Adds 1-1 Base Wilt Damage to this skill. +100% Wilt Chance for this skill' },
  'Deep Wounds': { toggles: { enemyHasTrauma: true }, ailments: ['Trauma'], text: 'Adds 1-1 Base Trauma Damage to this skill. +100% Trauma chance for this skill' },
  'Glacial Freeze': { toggles: { targetEnemyHasColdInfiltration: true }, text: 'Inflicts Cold Infiltration when this skill deals damage to enemies with 1 or more Frostbite Rating' },
  Coercion: { toggles: { enemyParalyzed: true }, cc: ['Paralysis'], text: 'Inflicts Paralysis on enemies within 10m of this unit when casting the supported skill' },
  Blind: { cc: ['Blind'], text: 'Inflicts Blind on enemies within 10m when casting this skill' },
  'Chance Slow': { cc: ['Slow'], text: '100% chance to inflict Slow on enemies within 10m of this unit when casting the supported skill' },
  'Absolute Power': { toggles: { targetEnemyHasFrail: true }, text: 'Inflicts Frail on the enemy when this skill deals damage' },
  'Potent Numbed': { lines: ['+20% Numbed Effect'], text: '+20% Numbed Effect for you when this skill deals damage. Lasts 4 s' },
  'Tactical Synergy': { lines: ['+30% damage'], text: '+30% Damage for this unit and nearby allies for 3 s when this skill is used' },
};

// "Tartarus: Tidewell III" -> "Tartarus: Tidewell"
const baseName = (name) => String(name ?? '').replace(/\s+(?:I{1,3}|IV|V)$/, '');

// { lines: [{ source, text }], toggles: { scenario key: true }, ailments: [types], unknown: [names] }
export function followerEffects(follower) {
  const out = { lines: [], toggles: {}, ailments: [], cc: [], unknown: [], skills: [] };
  if (!follower?.skills?.length) return out;
  // For the UI: each skill and support with what it does (tlidb's words) and whether it's modelled
  out.skills = follower.skills.map((s) => ({
    name: s.name,
    text: SKILLS[baseName(s.name)]?.text ?? null,
    supports: (s.supports ?? []).map((name) => ({ name, text: SUPPORTS[name]?.text ?? null })),
  }));
  const add = (effect, source) => {
    for (const text of effect.lines ?? []) out.lines.push({ source, text });
    Object.assign(out.toggles, effect.toggles ?? {});
    for (const a of effect.ailments ?? []) if (!out.ailments.includes(a)) out.ailments.push(a);
    for (const c of effect.cc ?? []) if (!out.cc.includes(c)) out.cc.push(c);
  };
  for (const skill of follower.skills) {
    const source = `Follower: ${follower.name ?? '?'} (${skill.name})`;
    const effect = SKILLS[baseName(skill.name)];
    if (effect) add(effect, source);
    else out.unknown.push(skill.name);
    for (const support of skill.supports ?? []) {
      if (SUPPORTS[support]) add(SUPPORTS[support], `${source}: ${support}`);
      else out.unknown.push(`${support} on ${skill.name}`);
    }
  }
  return out;
}

// The Ailment types on the enemy, from the scenario toggles and what else puts one on (a follower's
// Wilt): Ignite, Frostbite, Numbed, Trauma, Wilt. Frozen is not one: it's a crowd control state of
// Frostbite (it counts for Wings of Light, not here). Ailment Termination's "+8.7% per type,
// multiplies" measured x1.52-1.54 on CoffeeBingBong's dummy with all five up = 1.087^5 (2026-11-03).
export function ailmentTypes(values, extra = []) {
  const types = [];
  if (values.targetEnemyIsIgnited) types.push('Ignite');
  if (values.enemyFrostbittenEnabled) types.push('Frostbite');
  if (values.enemyNumbed) types.push('Numbed');
  if (values.enemyHasTrauma) types.push('Trauma');
  for (const a of extra) if (!types.includes(a)) types.push(a);
  return types;
}

// Crowd control types on the enemy (Wings of Light counts them while the enemy is Intimidated), from
// the scenario toggles, the build's own words (gear, talents, slates, Pact board, support skills) and
// the follower: Intimidated, Paralysis, Blind, Slow, Weaken, Frozen
const CC_WORDS = [
  ['Intimidated', /inflict intimidated|intimidated on hit/i],
  ['Blind', /chance to blind|inflicts? blind|blind on hit/i],
  ['Slow', /chance to inflict slow|inflicts? slow/i],
  ['Weaken', /chance to inflict weaken|inflicts? weaken/i],
  ['Paralysis', /chance to inflict paralysis|inflicts? paralysis/i],
];
// The game's crowd control effects (tlidb, "Crowd Control Effects"): Frostbite, Freeze, Paralysis,
// Knockback, Weaken, Slow, Taunt and Blinding. Intimidated is not one: it only gates Wings of Light's
// per-type bonus (enemyIntimidated), so it isn't in the list this returns.
export function crowdControlTypes(values, text = '', extra = []) {
  const types = [];
  const add = (t) => !types.includes(t) && types.push(t);
  for (const [type, re] of CC_WORDS) if (type !== 'Intimidated' && re.test(text)) add(type);
  if (values.enemyFrostbittenEnabled) add('Frostbite');
  if (values.enemyParalyzed) add('Paralysis');
  if (values.targetEnemyIsFrozen) add('Frozen');
  for (const t of extra) if (t !== 'Intimidated') add(t);
  return types;
}

// Whether the build puts Intimidated on the enemy (a Kismet's "+100% chance to inflict Intimidated on hit")
export const enemyIntimidated = (text = '') => CC_WORDS.find(([type]) => type === 'Intimidated')[1].test(text);
