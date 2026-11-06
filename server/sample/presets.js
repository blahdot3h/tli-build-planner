// Starting points for a sample build: a copy of a logged character (exact rolls, trees, memories,
// slates, Destinies) and Bing #2 (Creative Genius) plans for SS14's Splitting Lightning Bolt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kinds = (item, list) => (item.affixes ?? []).filter((a) => list.includes(a.kind) && a.text).map((a) => a.text);

export const BING2 = 'Escapist Bing: Creative Genius (#2)';
// CoffeeBingTest's picks (the planner's validated Bing #2 build)
export const BING2_TRAITS = {
  level1: 'Creative Genius',
  level45: 'Inspiration Overflow',
  level45b: 'Super Sonic Protocol',
  level60: 'Mind Domain',
  level60b: 'Auto-Ingenuity Program',
  level75: 'Flash of Brilliance',
  level75b: 'Hyper-Resonance Hypothesis',
};
const traitLevels = (levels) => Object.fromEntries(Object.entries(BING2_TRAITS).map(([slot, name]) => [name, slot === 'level1' ? 1 : (levels[slot] ?? levels.all ?? 1)]));

// The recommended Bing #2 trees: CoffeeBingTest's (Spell Burst, Lightning, critical strikes), 106
// points at level 91. "Fit talents to level" trims them to a lower level's points.
export const BING2_TALENTS = [
  { tree: 'Goddess of Knowledge', cores: ['Insight', 'Burning Touch'], points: { 30010300: 3, 30020200: 3, 30030100: 3, 30030200: 3, 30040100: 3, 30040200: 3, 30050200: 1, 30060100: 3, 30060200: 3, 30070100: 2, 30070200: 1 } },
  { tree: 'Magister', cores: ['Play Safe'], points: { 31010100: 3, 31020100: 3, 31020200: 3, 31030200: 3, 31050100: 3, 31050300: 3, 31060100: 3, 31060200: 3, 31060300: 1, 31070100: 1, 31070200: 1 } },
  { tree: 'Assassin', cores: ['Queer Angle'], points: { 24010100: 3, 24020200: 3, 24030100: 3, 24030200: 3, 24040100: 3, 24060200: 3, 24060500: 3, 24070100: 1, 24070200: 1, 24070300: 1, 24070500: 1 } },
  { tree: 'Ranger', cores: ['Fluke'], points: { 43010100: 3, 43020100: 3, 43020200: 3, 43030200: 3, 43040200: 1, 43050100: 3, 43050300: 3, 43060100: 1, 43060200: 3, 43060300: 1, 43070100: 1, 43070200: 1 } },
];

// The recommended trees fitted to a level-80 character's 96 points (server/sample/talentFit.js on the
// league-start build: the 10 points worth the least to Splitting Lightning Bolt taken off)
export const BING2_TALENTS_80 = [
  { tree: 'Goddess of Knowledge', cores: ['Insight', 'Burning Touch'], points: { 30010300: 3, 30020200: 3, 30030100: 3, 30030200: 3, 30040100: 3, 30060100: 3, 30060200: 3, 30070100: 2, 30070200: 1 } },
  { tree: 'Magister', cores: ['Play Safe'], points: { 31010100: 3, 31020100: 3, 31020200: 3, 31030200: 3, 31050100: 3, 31050300: 3, 31060100: 3, 31060200: 1, 31060300: 1, 31070100: 1 } },
  { tree: 'Assassin', cores: ['Queer Angle'], points: { 24010100: 3, 24020200: 3, 24030100: 3, 24030200: 3, 24040100: 3, 24060200: 3, 24060500: 3, 24070200: 1, 24070300: 1, 24070500: 1 } },
  { tree: 'Ranger', cores: ['Fluke'], points: { 43010100: 3, 43020100: 3, 43020200: 3, 43030200: 3, 43050100: 3, 43050300: 3, 43060200: 3, 43060300: 1, 43070100: 1, 43070200: 1 } },
];

const leg = (name, roll = 0.5, more = {}) => ({ legendary: name, roll, ...more });
const rare = (type, lines, name) => ({ rare: { type, name, lines } });
const gem = (name, level = 20) => ({ name, level });
const special = (name, { rank = 1, tier = 2, roll = 0.5 } = {}) => ({ name, rank, tier, roll });

const SLB = 'Splitting Lightning Bolt';
const SWIFT = 'Splitting Lightning Bolt: Swift Bolt (Magnificent)';
const DISINTEGRATION = 'Splitting Lightning Bolt: Disintegration (Noble)';

// Thunder Spike keeps the enemy at 10 Numbed stacks (CoffeeBingTest: Activation Medium: Rhythm, every
// 0.4 s; it works without a dagger when triggered). Timid and Aim go off with every Spell Burst.
const helpers = (level) => [
  { name: 'Thunder Spike', level, supports: [gem('Activation Medium: Rhythm', level), gem('Cooldown Reduction', level)] },
  { name: 'Timid', level, supports: [gem('Activation Medium: Spell Burst', level), gem('Terrain of Malice', level), gem('Cooldown Reduction', level)] },
  { name: 'Aim', level, supports: [gem('Activation Medium: Spell Burst', level), gem('Cooldown Reduction', level), gem('Extended Duration', level)] },
];
// The player's dummy rules: buffs always up, casting by hand on top of Spell Burst, standing at the
// dummy (no dash or movement buffs)
const SCENARIO = {
  dummyLevel: 85,
  enemyElementalRes: 30,
  enemyErosionRes: 30,
  enemyArmor: 27273,
  buffsAlwaysUp: true,
  handCasting: true,
  enemyNumbed: true,
  hasUsedMobilitySkillRecently: false,
  hasMovedRecently: false,
};

// Crafted at T2 (item level 82-85 bases, Flame Sand: the cheap way), the lines the planner's crafter
// picked by simulated DPS, rolled mid-range (data/gamedata/craftTiers.json)
const T2_WAND = rare('Wand', ['+1 Lightning Skill Level', '+55 Intelligence', '+66% Spell Damage', '+66% Elemental Damage', '+55% Spell Critical Strike Damage', '+31% Spell Burst Charge Speed'], 'Crafted wand (T2)');
const T2_WAND_CRIT = rare('Wand', ['+1 Lightning Skill Level', '+55 Intelligence', '+66% Spell Damage', '+66% Elemental Damage', '+55% Spell Critical Strike Damage', '+76 Spell Critical Strike Rating'], 'Crafted wand (T2)');
const T2_RING = rare('Ring', ['+37 Intelligence', '+44% damage', 'Adds 3 - 57 Lightning Damage to Attacks and Spells', '+38% Critical Strike Damage', '+74% Critical Strike Rating'], 'Crafted ring (T2)');
const T2_BELT = rare('Belt', ['+37 Intelligence', '+44% damage'], 'Crafted belt (T2)');

// CoffeeBingTest's nine Divinity slates (SS13: +70% Effect from Nether King's Divinity on most lines;
// SS14 cuts Judgment's line bonus to +40%), for the 100B plan
const SLATES_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/samples/bing2-slates.json');
const bing2Slates = () => {
  try {
    return JSON.parse(fs.readFileSync(SLATES_FILE, 'utf8'));
  } catch {
    return [];
  }
};

// The early builds' rules (the player's): every item 50 FE or less; no Activation Media (too
// expensive this early) and so no Thunder Spike or auto-cast Timid/Aim (endgame); the enemy isn't
// kept Numbed (early hits put few stacks on the dummy: set "Numbed stacks" to what you see)
const EARLY_SCENARIO = { ...SCENARIO, enemyNumbed: false };

export const PRESETS = {
  // League start: Treasure Trove legendaries (drop level 54 or less, so the campaign's Troves can
  // give them), T2 crafts, regular support gems, no pactspirits
  trove: {
    name: 'League start: Treasure Trove gear, every item 50 FE or less',
    description:
      'Level 80, legendaries a Treasure Trove can drop (drop level 54 or less), T2 crafted rings and belt (Flame Sand), Splitting Lightning Bolt with five regular supports and two cheap auras, no Activation Media, Thunder Spike, Nobles or pactspirits, the dummy not Numbed.',
    target: 1e9,
    build: (id) => ({
      id,
      name: 'Bing 2: Splitting Lightning Bolt (league start)',
      level: 80,
      hero: { name: BING2, traits: { ...BING2_TRAITS }, levels: traitLevels({ all: 1 }) },
      pactspirits: [],
      gear: {
        1: leg('Brainwave Emitter'),
        2: leg('On the Sublime'),
        3: leg('Spring Resurrection'),
        4: leg('Genius Battlegear'),
        5: leg('Photophobia'),
        6: T2_RING,
        7: T2_RING,
        8: T2_BELT,
        9: leg('Feline Gloves'),
        10: leg("Pathfinder's Path"),
      },
      skills: {
        active: [{ name: SLB, level: 20, supports: [gem('Psychic Burst', 18), gem('Target Projection', 18), gem('Turmoil Burst', 18), gem('Control Spell', 18), gem('Slow Projectile', 18)] }],
        passive: [gem('Spell Amplification', 18), gem('Electric Conversion', 18)].map((g) => ({ ...g, supports: [] })),
      },
      talents: BING2_TALENTS_80,
      extraLines: [],
      scenario: { ...EARLY_SCENARIO },
    }),
  },
  // The best the planner found with every item at 50 FE or less (2026-10-15): the league-start build
  // after its cheapest path under a 50 FE cap (T2 wands, helmet and boots; Elemental Fusion; nine
  // Intelligence Destinies at 9-38 FE), plus what costs nothing or little: Timid cast by hand, 3
  // Numbed stacks, three non-legendary pactspirits at level 1 (no price data; taken as cheap)
  budget50: {
    name: 'Every item 50 FE or less: best found (about 120M)',
    description:
      'T2 crafted wands, helmet, boots, rings and belt; Genius Battlegear, Photophobia and Feline Gloves from Treasure Troves; nine Intelligence Destinies (9-38 FE); Timid cast by hand; 3 Numbed stacks; Hell Cavalry - Muffled Thunder, Cloudgatherer - Violet and Happy Chonky - Electrify at level 1. Pets at level 6: about 170M.',
    target: 1e9,
    build: (id) => {
      const spec = PRESETS.trove.build(id);
      const destiny = (name, text, n) => Array.from({ length: n }, () => ({ source: `Destiny: ${name}`, text }));
      return {
        ...spec,
        name: 'Bing 2: Splitting Lightning Bolt (every item 50 FE or less)',
        pactspirits: [{ name: 'Hell Cavalry - Muffled Thunder', level: 1 }, { name: 'Cloudgatherer - Violet', level: 1 }, { name: 'Happy Chonky - Electrify', level: 1 }],
        gear: {
          ...spec.gear,
          1: rare('INT Helmet', ['+37 Intelligence', '+38% Critical Strike Damage', '+44% damage', '+74% Critical Strike Rating'], 'Crafted helmet (T2)'),
          2: T2_WAND_CRIT,
          3: T2_WAND_CRIT,
          10: rare('INT Boots', ['+38% Critical Strike Damage', '+44% damage', '+74% Critical Strike Rating'], 'Crafted boots (T2)'),
        },
        skills: {
          active: [
            { name: SLB, level: 20, supports: [gem('Elemental Fusion'), gem('Target Projection', 18), gem('Turmoil Burst', 18), gem('Control Spell', 18), gem('Slow Projectile', 18)] },
            { name: 'Timid', level: 20, supports: [] },
          ],
          passive: spec.skills.passive,
        },
        extraLines: [...destiny('Medium Fate: Intelligence', '+28 Intelligence', 3), ...destiny('Micro Fate: Intelligence', '+13 Intelligence', 6)],
        scenario: { ...EARLY_SCENARIO, enemyNumbed: true, enemyNumbedStacks: 3 },
      };
    },
  },
  // What 1B takes past the 50 FE cap: the cheapest path from the budget build (2026-10-15, Solid
  // River at the player's 4000 FE): 121.9M -> 1.30B in 11 steps
  oneB: {
    name: 'About 1B: the 50 FE build + the cheapest pieces over the cap',
    description:
      "The 50 FE build plus what the planner's cheapest path to 1B adds: Ralph's Laws, Solid River (~4000 FE day 1), Frozen Ripples, I Am Truth, Shattered Moonlight, Dawn Break, Disintegration (Noble), Willpower (149 FE), Psychic Burst and Dreamweaver at level 1. No Activation Media or Thunder Spike; 3 Numbed stacks.",
    target: 1e9,
    build: (id) => {
      const spec = PRESETS.budget50.build(id);
      return {
        ...spec,
        name: 'Bing 2: Splitting Lightning Bolt (about 1B)',
        pactspirits: [{ name: 'Hell Cavalry - Muffled Thunder', level: 1 }, { name: 'Cloudgatherer - Violet', level: 1 }, { name: 'Dreamweaver', level: 1 }],
        gear: {
          ...spec.gear,
          1: leg('Solid River'),
          4: leg('Shattered Moonlight'),
          5: leg('I Am Truth', 0.5, { random: { '<Random stat affix>': '+(88–99) Intelligence', '<Cooldown Recovery Speed or Duration Bonus>': '+(30–40)% Cooldown Recovery Speed' } }),
          8: leg('Dawn Break', 0.5, { random: { '<Random stat affix>': '+(50–100) Intelligence' } }),
          9: leg("Ralph's Laws"),
          10: leg('Frozen Ripples'),
        },
        skills: {
          ...spec.skills,
          active: [
            { name: SLB, level: 20, supports: [gem('Elemental Fusion'), gem('Target Projection', 18), gem('Willpower'), gem('Psychic Burst'), special(DISINTEGRATION)] },
            ...spec.skills.active.slice(1),
          ],
        },
      };
    },
  },
  // Mid-game: Bing's own endgame legendaries and Ultimate-affix rares, Splitting Lightning Bolt's
  // Noble and Magnificent supports, two pactspirits
  mid: {
    name: 'Mid-game: Spell Burst core (about 100B)',
    description: "Level 90, Solid River, Law of Greed, Ralph's Laws, Dawn Break, rares with Ultimate affixes, Splitting Lightning Bolt's Noble and Magnificent supports (rank 1), level 20 gems, two pactspirits at level 3.",
    target: 1e11,
    build: (id) => ({
      id,
      name: 'Bing 2: Splitting Lightning Bolt (mid-game)',
      level: 90,
      hero: { name: BING2, traits: { ...BING2_TRAITS }, levels: traitLevels({ all: 2 }) },
      pactspirits: [{ name: 'Dreamweaver', level: 3 }, { name: 'Squiddle', level: 3 }],
      gear: {
        1: leg('Solid River'),
        2: rare('Wand', ['+3 Spell Skill Level', '+2 Lightning Skill Level', '+77 Intelligence', '+58% additional Hit Damage for skills cast by Spell Burst', '+31% Cast Speed', '+92% Elemental Damage'], 'Crafted wand'),
        3: rare('Wand', ['+3 Spell Skill Level', '+2 Lightning Skill Level', '+92% Spell Damage', '+58% additional Hit Damage for skills cast by Spell Burst', '+31% Cast Speed', '+92% Elemental Damage'], 'Crafted wand'),
        4: leg('Shattered Moonlight'),
        5: leg('Law of Greed'),
        6: rare('Ring', ['+17% Elemental and Erosion Resistance Penetration', '+52 Intelligence', 'Adds 5 - 95 Lightning Damage to Attacks and Spells', '+1 Max Spell Burst\n+7% additional Hit Damage for skills cast by Spell Burst', '+23% Lightning Resistance', '+23% Cold Resistance'], 'Crafted ring'),
        7: rare('Ring', ['+17% Elemental and Erosion Resistance Penetration', '+52 Intelligence', 'Adds 5 - 95 Lightning Damage to Attacks and Spells', '+1 Max Spell Burst\n+7% additional Hit Damage for skills cast by Spell Burst', '+23% Fire Resistance', '+23% Erosion Resistance'], 'Crafted ring'),
        8: leg('Dawn Break', 0.5, { random: { '<Random stat affix>': '+(50–100) Intelligence' } }),
        9: leg("Ralph's Laws"),
        10: rare('INT Boots', ['+1 Lightning Skill Level', '+25% Spell Burst Charge Speed\n+10% chance to immediately gain 1 stack(s) of Spell Burst Charge when using a skill. Interval: 0.03s', '+190 Max Life', '+23% Lightning Resistance'], 'Crafted boots'),
      },
      skills: {
        active: [
          { name: SLB, level: 20, supports: [gem('Psychic Burst'), gem('Target Projection'), special(SWIFT), gem('Turmoil Burst'), special(DISINTEGRATION)] },
          ...helpers(20),
        ],
        passive: [gem('Spell Amplification'), gem('Electric Conversion'), gem('Domain Expansion')].map((g) => ({ ...g, supports: [] })),
      },
      talents: BING2_TALENTS,
      extraLines: [],
      scenario: { ...SCENARIO },
    }),
  },
  // 100B: the mid-game gear with Divinity slates like CoffeeBingTest's (x4.8 on their own: +2
  // Lightning and +1 Spell Skill Level, Intelligence, Lightning Infiltration, Frail) and three
  // pactspirits at level 6 (x2.1). Memories, Destinies, a prism and higher-rank Nobles go past it.
  hundredB: {
    name: 'About 100B: mid-game gear + slates + pets at level 6',
    description:
      "The mid-game gear plus nine Divinity slates like CoffeeBingTest's (SS13 numbers, +70% Nether King's Effect) and Dreamweaver, Squiddle and Cloudgatherer - Violet at level 6.",
    target: 1e11,
    build: (id) => {
      const spec = PRESETS.mid.build(id);
      return {
        ...spec,
        name: 'Bing 2: Splitting Lightning Bolt (about 100B)',
        pactspirits: [{ name: 'Dreamweaver', level: 6 }, { name: 'Squiddle', level: 6 }, { name: 'Cloudgatherer - Violet', level: 6 }],
        slates: bing2Slates(),
      };
    },
  },
};

// A logged character as a sample spec: every item line by line with its exact rolls
export function specFromCharacter(character, { id = 'copy', name } = {}) {
  const calc = character.calc ?? {};
  const gear = {};
  for (const { slot, item } of character.equipment) {
    if (!item?.detailsKnown || !item.type) continue;
    gear[slot] = {
      rare: {
        type: item.type,
        name: item.name,
        legendaryName: item.uniqueName ?? undefined,
        base: kinds(item, ['base']),
        implicit: kinds(item, ['implicit']),
        lines: kinds(item, ['prefix', 'suffix']),
        other: (item.affixes ?? []).filter((a) => !['base', 'implicit', 'prefix', 'suffix'].includes(a.kind) && a.text).map((a) => a.text),
      },
    };
  }
  const group = (g) =>
    g.skill
      ? {
          name: g.skill.name,
          level: g.skill.level ?? 20,
          supports: g.supports.map((s) =>
            /\((Noble|Magnificent)\)$/.test(s.name ?? '')
              ? { name: s.name, rank: s.level ?? 1, line: s.affixes?.find((a) => a.text)?.text ?? '' }
              : { name: s.name, level: s.level ?? 20, ...(s.affixes?.length ? { affixes: s.affixes } : {}) },
          ),
        }
      : null;
  return {
    id,
    name: name ?? `${character.player.name} (copy)`,
    level: character.player.level ?? 90,
    hero: calc.choices?.hero ?? calc.choices?.heroInferred ?? null,
    pactspirits: calc.choices?.pactspirits?.length ? calc.choices.pactspirits : (calc.choices?.petsInferred ?? []),
    gear,
    skills: { active: character.skills.active.map(group), passive: character.skills.passive.map(group) },
    talents: character.talentTrees.map((t) => ({
      tree: t.name,
      points: Object.fromEntries(t.nodes.filter((n) => n.points).map((n) => [n.id, n.points])),
      cores: t.cores.map((c) => c.name).filter(Boolean),
      ...(t.prism ? { prism: t.prism } : {}),
    })),
    memories: character.memories,
    slates: character.slates,
    // As the live view uses them: the log's plus what screenshots added (Pact board Fates past the
    // log's cut, the follower's buffs), so the copy computes the same
    destinies: calc.used?.destinies ?? character.destinies,
    extraLines: (calc.used?.extraLines ?? []).filter((l) => l?.text),
    scenario: calc.scenario?.values ? { ...calc.scenario.values } : {},
    copiedFrom: { playerId: String(character.player.playerId), name: character.player.name, at: Date.now() },
  };
}
