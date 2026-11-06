// Turns a character read from the game log into a Torchlight of Building save, then runs that
// engine for stats and DPS. Anything that can't be mapped or parsed is reported, not dropped
// silently, so the UI can show how complete the calculation is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tob from './tob.bundle.js';
import { buildSkillShapes } from './skill-shapes.js';
import { registerNewSupports, registerSpecialSupports, specialSupportRolledText, syncSupportLevels } from './ss14-supports.js';
import { REHAN_SIM_TRAITS } from '../sim/rehan.js';
import { SELENA_HERO, SELENA_SIM_TRAITS, SELENA_TREE } from '../sim/selena.js';
import { BING_SETTING_TRAITS, BING_SIM_TRAITS, bingTraitLevel, TROUBLE_MAKER_SIGNAL } from '../sim/bing.js';
import { SAGE_HERO, SAGE_LOG_HERO_ID, isSage, sageCatalog, sageIngredientLines, sageNotes, SAGE_INGREDIENTS } from '../sim/sage.js';
import { copiedTalents } from '../game/slates.js';
import { elixirText, registerElixirSkills } from './elixirs.js';
import { heroNote, heroNotes } from '../sim/heroNotes.js';

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[_\s]+/g, ' ')
    .trim();
const byName = (list) => new Map(list.map((entry) => [norm(entry.name), entry]));

export const LEGENDARY_PACTSPIRITS = tob.Pactspirits.filter((p) => p.rarity === 'Legendary').map((p) => ({ name: p.name, type: p.type }));

// Heroes for the trait picker: each hero's choices at levels 1/45/60/75, and what models a trait:
// 'engine' (every DPS number), 'sim' (the in-game simulation only) or false (accepted, adds nothing)
const SIM_TRAITS = new Set([...REHAN_SIM_TRAITS, ...SELENA_SIM_TRAITS, ...BING_SIM_TRAITS]);
const SETTING_TRAITS = new Set(BING_SETTING_TRAITS);
export const traitModel = (name) => (tob.isHeroTraitImplemented(name) || SETTING_TRAITS.has(name) ? 'engine' : SIM_TRAITS.has(name) ? 'sim' : false);

export const HERO_CATALOG = (() => {
  const heroes = new Map();
  for (const t of tob.HeroTraits) {
    const level = [1, 45, 60, 75].includes(t.level) ? t.level : t.level >= 600 ? 60 : t.level;
    const hero = heroes.get(t.hero) ?? { hero: t.hero, levels: { 1: [], 45: [], 60: [], 75: [] } };
    if (hero.levels[level] && !hero.levels[level].some((x) => x.name === t.name)) {
      hero.levels[level].push({ name: t.name, modelled: traitModel(t.name) });
    }
    heroes.set(t.hero, hero);
  }
  // Heroes newer than the engine's data
  const levels = Object.fromEntries(Object.entries(SELENA_TREE).map(([level, names]) => [level, names.map((name) => ({ name, modelled: traitModel(name) }))]));
  heroes.set(SELENA_HERO, { hero: SELENA_HERO, levels });
  // Scent Weaver Sage: the Scent Bottle ingredients are picked with the traits (sage.js)
  const sage = heroes.get(SAGE_HERO);
  if (sage) sage.ingredients = sageCatalog();
  return [...heroes.values()];
})();

// The log has hero and trait ids only. Hero 310 is Rehan: his portrait and hero-310 voice lines
// load in the same sessions. Hero 1700 is Selena: CoffeeTerra plays her (the game's own UserData
// cache pairs RoleId 1700 with that character) and her trait node ids are on her tlidb page.
// Hero 810 is Bing: CoffeeBingTest (purchase 4002, version #2) starts with Fire Burst, Creative
// Genius's starting skill on tlidb, and its six trait ids fit that trait's two picks per level.
// Hero 1800 is Sage: CoffeeSage#9020 (purchase 18001, version #1) lists trait ids 1800011/1800022/
// 1800031, tlidb's data-ids for Licorice Note's traits.
// The others follow the same scheme (tlidb's trait ids start with the hero's number: 600xxx is
// Carino, 1100xxx Thea...); the player's Carino, Thea, Youga and Iris characters confirm 600, 1100,
// 1300 and 1600. Gemma, Erika, Moto and Rosa are read off their trait ids alone.
const LOG_HEROES = {
  310: 'Berserker Rehan',
  600: 'Divineshot Carino',
  700: 'Cateye Erika',
  810: 'Escapist Bing',
  900: 'Frostfire Gemma',
  1100: 'Oracle Thea',
  1300: 'Spacetime Witness Youga',
  1400: 'Commander Moto',
  1500: 'Lightbringer Rosa',
  1600: 'The Forsaken Iris',
  1700: 'Tide Whisper Selena',
  [SAGE_LOG_HERO_ID]: 'Scent Weaver Sage',
};
// Trait ids end in <tier><choice>. Tiers 1-3 are the picks at levels 45/60/75; tiers 4-6 are the
// second pick a hero like Bing #2 gets at each level ("an additional Trait can be selected at each
// level threshold"), from the second row of choices.
const TRAIT_TIER_LEVELS = { 1: 45, 2: 60, 3: 75, 4: 45, 5: 60, 6: 75 };
// How many of a hero's choices at each level are in its first row. The engine's trait table lists
// the first row's 45/60/75 traits, then the second row's (the level drops back to 45 there).
function firstRowSizes(heroName) {
  const sizes = { 45: 0, 60: 0, 75: 0 };
  let last = 0;
  let secondRow = false;
  const seen = new Set();
  for (const t of tob.HeroTraits) {
    if (t.hero !== heroName || !(t.level in sizes) || seen.has(t.name)) continue;
    seen.add(t.name);
    if (t.level < last) secondRow = true;
    last = t.level;
    if (!secondRow) sizes[t.level]++;
  }
  return sizes;
}
// A trait's level is set by the memory in its slot (TLI Builder, docs/verification/
// hero-memory-phase-b.md, confirmed in game): 1, +1 at memory level 30, +1 more at 50, plus any
// "+N to Hero Trait Level" on the memory, capped at 5. The level-1 trait has no slot and stays at 1.
// CoffeeTerra's memories (30, 30, and 40 with +2) give the LV.2/LV.2/LV.4 the game shows. A log
// without the memory level (older dumps) is taken as 30+.
export function memoryTraitLevel(memory) {
  if (!memory) return null;
  const level = memory.memoryLevel ?? 30;
  const added = (memory.item.affixes ?? []).reduce((sum, a) => sum + Number(/([+-]\d+) to Hero Trait Level/i.exec(a.text ?? '')?.[1] ?? 0), 0);
  return Math.max(1, Math.min(5, 1 + (level >= 30 ? 1 : 0) + (level >= 50 ? 1 : 0) + added));
}
const traitLevelIn = (memories, slot) => memoryTraitLevel(memories.find((m) => m.slot === slot)) ?? 1;
const TRAIT_SLOT_OF_LEVEL = { 45: 1, 60: 2, 75: 3 };

// Inferred, not read: the purchase id's last digits pick the hero's version (1002 -> "#2"). Older
// heroes' trait ids end in <tier><choice> (320022 -> the 2nd choice at level 60). Newer heroes list
// trait tree nodes, named through the hero trait table, each in a memory slot (1-3) whose memory
// can raise its level.
export function inferHero(player, logTraits, memories = []) {
  const base = LOG_HEROES[player.heroId];
  const version = Number(player.heroPurchaseId) % 1000;
  const hero = base && HERO_CATALOG.find((h) => h.hero.startsWith(`${base}:`) && h.hero.endsWith(`(#${version})`));
  if (!hero) return null;
  const traits = { level1: hero.levels[1][0]?.name };
  const levels = { [traits.level1]: 1 };
  // Every hero's trait ids are named now (heroTraits.local.json, from tlidb's pages), so the names
  // decide; the digit scheme below is the fallback for ids the table lacks. A tree hero's node we
  // can't name means the table is behind the game: don't guess the rest
  const tree = logTraits.some((t) => t.slot != null);
  if (tree && !logTraits.every((t) => t.name)) return null;
  if (logTraits.length && logTraits.every((t) => t.name)) {
    for (const { name, slot } of logTraits) {
      const level = [1, 45, 60, 75].find((l) => hero.levels[l]?.some((x) => x.name === name));
      // A trait the engine's hero data doesn't list (a trait added since): left out, not guessed
      if (!level) continue;
      if (level === 1) continue;
      traits[traits[`level${level}`] ? `level${level}b` : `level${level}`] = name;
      // Tree heroes say which memory slot a node sits in; the others share the slot of their level
      levels[name] = traitLevelIn(memories, slot ?? TRAIT_SLOT_OF_LEVEL[level]);
    }
    return { name: hero.hero, traits, levels };
  }
  const firstRow = firstRowSizes(hero.hero);
  for (const { id } of logTraits) {
    const digits = String(id);
    const tier = Number(digits.at(-2));
    const level = TRAIT_TIER_LEVELS[tier];
    if (!level) continue;
    const second = tier > 3;
    const name = hero.levels[level]?.[(second ? firstRow[level] : 0) + Number(digits.at(-1)) - 1]?.name;
    if (!name) continue;
    // Both picks at a level share that level's memory slot
    traits[`level${level}${second ? 'b' : ''}`] = name;
    levels[name] = traitLevelIn(memories, TRAIT_SLOT_OF_LEVEL[level]);
  }
  return { name: hero.hero, traits, levels };
}

// Pactspirit ids from the log (servantId), named by players matching them to the in-game Pact page
const LOG_PACTSPIRITS = {
  1130: 'Red Umbrella',
  2320: 'Cloudgatherer - Violet', // CoffeeBingTest's slot 3 (the player's screenshot, 2026-10-13)
  2330: 'Dreamweaver',
  3130: 'Fire Swordsman',
  5330: 'Preserver of Eternity',
  16330: 'Azure Gunslinger',
  17230: 'Squiddle', // CoffeeBingTest's slot 2 (the player named it, 2026-10-13)
  18230: 'Kitty Express',
};

// The battle pactspirits in the log's main slots (areas 1-3), for those with a known name. The log's
// starLevel runs 0-5 under the game's level badge of 1-6; when the log's list was cut short before
// reaching a pet, level 6 is assumed.
export function inferPactspirits(logPets) {
  return logPets
    .filter((p) => p.area >= 1 && p.area <= 3 && LOG_PACTSPIRITS[p.id])
    .sort((a, b) => a.area - b.area)
    .map((p) => ({ name: LOG_PACTSPIRITS[p.id], level: p.stars != null ? Math.min(6, p.stars + 1) : 6, area: p.area }));
}

// A Destiny's spot on the Pact board: contract point <area><spot> (308 = area 3, spot 8). In a
// battle pet's area, spots 1-6 are its inner ring (Micro Fates go there) and 7-9 its middle ring
// (Medium Fates): an installed Destiny replaces that ring spot's own stat.
const RING_OF_SPOT = { 1: 'innerRing1', 2: 'innerRing2', 3: 'innerRing3', 4: 'innerRing4', 5: 'innerRing5', 6: 'innerRing6', 7: 'midRing1', 8: 'midRing2', 9: 'midRing3' };
const destinySpot = (d) => (d.point ? { area: Math.floor(d.point / 100), ring: RING_OF_SPOT[d.point % 100] ?? null } : { area: null, ring: null });

// What the chosen pactspirits say at their levels (for combat toggles their effects depend on)
export function pactspiritText(pets = []) {
  return pets.map((p) => tob.Pactspirits.find((x) => x.name === p.name)?.[`affix${p.level ?? 6}`] ?? '').join('\n');
}

// What the hero's picked traits say (for combat toggles, e.g. Bing #2's Whimsy Signal)
export function heroText(hero) {
  if (!hero?.name) return '';
  const names = new Set(Object.values(hero.traits ?? {}).filter(Boolean));
  return tob.HeroTraits.filter((t) => t.hero === hero.name && names.has(t.name))
    .map((t) => t.affix ?? '')
    .join('\n');
}

// hero: { name, traits: { level1, level45, level45b, level60, level60b, level75, level75b } }
function toHeroTraits(hero) {
  const traits = {};
  for (const [slot, name] of Object.entries(hero?.traits ?? {})) if (name) traits[slot] = { name };
  return traits;
}

// Skills without a hand-written model in the engine get one from tlidb's current card
// (skill-shapes.js), or a stated reason why not. Skills newer than the engine's data join its skill
// list first, so their names resolve below.
const STAT_KEYS = { Strength: 'str', Dexterity: 'dex', Intelligence: 'int' };
export const SKILL_DATA = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/gamedata/skillData.json'), 'utf8'));
  } catch {
    return {};
  }
})();
export const SKILL_SHAPES = (() => {
  const skillData = SKILL_DATA;
  if (!Object.keys(skillData).length) return {};
  const shapes = buildSkillShapes(skillData);
  const usable = Object.fromEntries(Object.entries(shapes).filter(([, s]) => s.shape));
  for (const s of Object.values(usable)) {
    const existing = tob.ActiveSkills.find((a) => a.name === s.name);
    if (existing) {
      // The engine's older card for a skill it never modelled: tlidb's current tags and a hit
      // skill's kinds, so "Hit Damage" and tag-based bonuses apply (its SS13 Chromatic Shot listed
      // Cold/Fire/Lightning tags and no hit kind)
      if (!tob.isSkillImplemented(existing)) {
        existing.tags = s.tags;
        existing.kinds = [...new Set([...(existing.kinds ?? []), 'deal_damage', 'hit_enemies'])];
      }
      continue;
    }
    tob.ActiveSkills.push({ type: 'Active', name: s.name, tags: s.tags, description: [], mainStats: s.mainStats.map((m) => STAT_KEYS[m]).filter(Boolean), kinds: ['deal_damage', 'hit_enemies'] });
  }
  tob.registerGeneratedActiveSkills(usable);
  return shapes;
})();

// Supports at this season's numbers, SS14's new supports, and Noble/Magnificent supports newer than
// the engine (ss14-supports.js), before the lookups below are built
export const SUPPORT_SYNC = {
  levels: syncSupportLevels(tob, SKILL_DATA),
  added: registerNewSupports(tob, SKILL_DATA),
  special: registerSpecialSupports(tob, SKILL_DATA),
};
// Scent Weaver Sage's Elixir skills as buff skills, from their tlidb cards (elixirs.js)
export const ELIXIR_SYNC = registerElixirSkills(tob, SKILL_DATA);

// Barrier Burst, the skill Necklace of Firebird grants ("Replaces the Main Skill with Lv. 20/25
// Barrier Burst", triggered "upon taking damage" while you have a Barrier). tlidb has no card for
// it, only the glossary's "Deals Spell Fire Damage equal to a certain ratio of Barrier to nearby
// enemies". Barrier is "a Shield equal to 20% of the sum of Max Life and Max Energy Shield", raised
// by Barrier Shield bonuses. The ratio comes from the combat toggles (an SS10 guide's 75% until the
// tooltip is read), as does how often you're hit while shielded. Cast speed is neutralised so the
// casts per second are the triggers per second. Spell Burst applies, as to any spell: the game's
// Damage panel for Barrier Burst lists Max Spell Burst, charge time and the burst bonus.
export const BARRIER_BURST = 'Barrier Burst';
export const BARRIER_BURST_DEFAULTS = { barrierBurstPct: 75, barrierBurstPerSec: 1 };
if (!tob.ActiveSkills.some((s) => s.name === BARRIER_BURST)) {
  tob.ActiveSkills.push({
    type: 'Active',
    name: BARRIER_BURST,
    tags: ['Spell', 'Fire', 'Area', 'Triggered', 'Strength', 'Intelligence'],
    description: ['Deals Spell Fire Damage equal to a certain ratio of Barrier to nearby enemies.'],
    mainStats: ['str', 'int'],
    kinds: ['deal_damage', 'hit_enemies'],
  });
}
const fill40 = (v) => Array.from({ length: 40 }, () => v);
const barrierBurstShape = (hit, castTime) => ({ shape: 'spell', dmgType: 'fire', levels: { spellDmgMin: fill40(hit), spellDmgMax: fill40(hit), addedDmgEffPct: fill40(100), castTime: fill40(castTime) } });
tob.registerGeneratedActiveSkills({ [BARRIER_BURST]: barrierBurstShape(1, 1) });
// From a first engine run: the Barrier amount sets the hit, the cast speed bonus is divided out of
// the cast time so the engine's casts per second equal the triggers per second. Returns what was
// assumed (for the "not counted" list), or null when Barrier Burst isn't the main skill.
export function barrierBurstModel(sheet, settings = {}) {
  if (!sheet?.ok || sheet.mainSkill !== BARRIER_BURST) return null;
  const pct = Number(settings.barrierBurstPct) > 0 ? Number(settings.barrierBurstPct) : BARRIER_BURST_DEFAULTS.barrierBurstPct;
  const perSec = Number(settings.barrierBurstPerSec) > 0 ? Number(settings.barrierBurstPerSec) : BARRIER_BURST_DEFAULTS.barrierBurstPerSec;
  const r = sheet.results;
  const mods = r.skills[BARRIER_BURST]?.resolvedMods ?? [];
  const eff = (type) => {
    const list = mods.filter((m) => m.type === type);
    const inc = list.filter((m) => !m.addn).reduce((s, m) => s + m.value, 0);
    const addn = list.filter((m) => m.addn).reduce((p, m) => p * (1 + m.value / 100), 1);
    return (1 + inc / 100) * addn;
  };
  const life = r.resourcePool?.maxLife ?? 0;
  const es = r.defenses?.energyShield ?? 0;
  const barrier = 0.2 * (life + es) * eff('BarrierShieldPct');
  const hit = (barrier * pct) / 100;
  tob.registerGeneratedActiveSkills({ [BARRIER_BURST]: barrierBurstShape(hit, eff('CspdPct') / perSec) });
  return {
    barrier,
    hit,
    pct,
    perSec,
    note: `Skill Barrier Burst: modelled as ${pct}% of your Barrier (${Math.round(barrier).toLocaleString()} = 20% of Max Life ${Math.round(life).toLocaleString()} + Max Energy Shield ${Math.round(es).toLocaleString()}, with Barrier Shield bonuses) dealt as Spell Fire damage ${perSec} time(s) per second (one per hit taken while shielded). The ratio is an SS10 guide's figure, not the tooltip's: set "Barrier Burst: % of Barrier" from the in-game tooltip`,
  };
}

const ACTIVE = byName(tob.ActiveSkills);
// Skills that buff rather than hit: never the main skill while a hitting one is slotted
const BUFF_TAGS = new Set(['Elixir', 'Empower', 'Curse', 'Defensive', 'Aura', 'Warcry']);
const isBuffSkill = (skill) => (skill?.tags ?? []).some((t) => BUFF_TAGS.has(t));
// The engine's entry for the character's main skill: the first active skill it knows that isn't a
// buff (Sage's Scent Bottle in slot 2 holds an Elixir skill), else the first it knows at all
export function mainActiveSkill(character) {
  const known = (character.skills?.active ?? []).map((g) => ACTIVE.get(norm(g.skill?.name))).filter(Boolean);
  return known.find((s) => !isBuffSkill(s)) ?? known[0] ?? null;
}
// The slotted Elixir skills' and Scent Bottle ingredients' words, for the combat toggles' defaults
export const elixirTextFor = (character) => elixirText(character, SKILL_DATA);
export function sageText(hero) {
  if (!isSage(hero)) return '';
  const all = [...SAGE_INGREDIENTS.basic, ...SAGE_INGREDIENTS.functional, ...SAGE_INGREDIENTS.special];
  const ing = hero.ingredients ?? {};
  return [...(ing.basic ?? []), ing.functional, ing.special]
    .map((name) => all.find((i) => i.name === name)?.text(5) ?? '')
    .join('\n');
}
export const findActiveSkill = (name) => ACTIVE.get(norm(name)) ?? null;
const PASSIVE = byName(tob.PassiveSkills);
const SUPPORT = byName(tob.SupportSkills);
const SPECIAL_SUPPORTS = new Map([
  ...tob.MagnificentSupportSkills.map((s) => [norm(s.name), { name: s.name, skillType: 'magnificent_support' }]),
  ...tob.NobleSupportSkills.map((s) => [norm(s.name), { name: s.name, skillType: 'noble_support' }]),
]);
const TREES = byName(tob.TalentTrees);
const CORE_TALENTS = new Set(tob.CoreTalents.map((c) => c.name));

const GEAR_SLOTS = { 1: 'helmet', 2: 'mainHand', 3: 'offHand', 4: 'chest', 5: 'neck', 6: 'leftRing', 7: 'rightRing', 8: 'belt', 9: 'gloves', 10: 'boots' };
// The engine's HeroMemories is an affix pool keyed by memory type ("Memory of Origin", ...)
const MEMORY_TYPES = new Set(tob.HeroMemories.map((m) => m.item));
const MEMORY_SLOTS = { 1: 'slot45', 2: 'slot60', 3: 'slot75' };
// "(Max Divinity Effect: 1)" (SS13) or "(Max Active Divinity: 1)" (SS14): at most that many copies
// of the line count across slates
const DIVINITY_SUFFIX = /\s*\(Max (?:Active )?Divinity(?: Effect)?: \d+\)\s*$/;
const DIVINITY_CAP = /\(Max (?:Active )?Divinity(?: Effect)?: (\d+)\)/;

// tlidb names armor "INT Helmet"; the engine calls it "Helmet (INT)"
function equipmentType(type) {
  const m = /^(STR|DEX|INT) (Helmet|Chest Armor|Gloves|Boots|Shield)$/.exec(type ?? '');
  const engineType = m ? `${m[2]} (${m[1]})` : type;
  return tob.EQUIPMENT_TYPES.includes(engineType) ? engineType : undefined;
}

// Lines the engine's parser doesn't know, rewritten as equivalent lines it does for this
// character. Per-level stats use the character's level; chance-based shadows use the average.
const fmtNum = (n) => String(Math.round(n * 100) / 100);
const LINE_REWRITES = [
  // Keywords a unique names instead of spelling out (tlidb glossary): Rotted Taboo (Dawn Break),
  // "Takes 100 True Damage when casting a skill. Interval: 0.1s +3 to All Skill Levels"
  [/^Rotted Taboo$/i, () => "+3 to All Skills' Levels"],
  // "+ 20% Spell Elemental Damage" (Grasp of Truth; tlidb and the game put a space after the sign)
  [/^([+-]) +(\d.*)$/, (m) => `${m[1]}${m[2]}`],
  // "+1% Fire Damage for every 1 level(s)" (Born in Fire)
  [/^([+-]?)(\d+(?:\.\d+)?)% (.+?) for every (\d+) level\(s\)$/i, (m, { level }) => `${m[1] || '+'}${fmtNum(m[2] * Math.floor(level / m[4]))}% ${m[3]}`],
  // "+5 Max Life per 1 levels" (Born in Fire)
  [/^([+-]?)(\d+(?:\.\d+)?) (.+?) per (\d+) levels?$/i, (m, { level }) => `${m[1] || '+'}${fmtNum(m[2] * Math.floor(level / m[4]))} ${m[3]}`],
  // "33% chance to gain +3 Shadows when using the Shadow Strike skill" (Despised Shadow)
  [/^(\d+(?:\.\d+)?)% chance to gain \+(\d+) Shadows? when using the Shadow Strike skill$/i, (m) => `+${Math.round((m[1] / 100) * m[2])} Shadow Quantity`],
  // SS14 lines, at steady state (the main skill cast over and over, buffs up: the player's rule).
  // On the Sublime (tlidb still shows it in Chinese): "+2% additional Spell Projectile Damage for each
  // Spell Projectile created recently, up to 10 stacks"
  [/^最近每生成 1 个法术投射物，额外 \+(\d+(?:\.\d+)?)% 法术投射物伤害，上限 (\d+) 层$/, (m, ctx) => rewriteLine(`+${m[1]}% additional Spell Projectile Damage for each Spell Projectile created recently, up to ${m[2]} stacks`, ctx)],
  [/^\+(\d+(?:\.\d+)?)% additional Spell Projectile Damage for each Spell Projectile created recently, up to (\d+) stacks$/i, (m, ctx) => (isSpellProjectile(ctx) ? `+${fmtNum(m[1] * m[2])}% additional Projectile Damage` : '')],
  // SS14 talent nodes tlidb still shows in Chinese (Energy Shield recharge triggers; defensive, so
  // they stay as readable text the engine doesn't count)
  [/^消耗法术迸发时，立即开启护盾充能，间隔 (\d+) 秒$/, (m) => `When Spell Burst is consumed, Energy Shield starts charging immediately. Interval: ${m[1]} s`],
  [/^纠缠释放技能时，立即开启护盾充能，间隔 (\d+) 秒$/, (m) => `When a Tangle casts a skill, Energy Shield starts charging immediately. Interval: ${m[1]} s`],
  // "+1 Spell Projectile Skill Level": the engine has projectile and spell skill levels, not both
  [/^([+-]\d+) Spell Projectile Skill Level$/i, (m, ctx) => (isSpellProjectile(ctx) ? `${m[1]} Projectile Skill Level` : '')],
  // Genius Battlegear: "+40% Spell Critical Strike Rating for every 1 Spell Burst Charge stack consumed.
  // Lasts 10s. Stacks up to 10 times" (Spell Burst goes off every second or so: always at 10)
  [/^When activating Spell Burst, \+(\d+(?:\.\d+)?)% Spell Critical Strike Rating for every 1 Spell Burst Charge stack consumed\. Lasts \d+(?:\.\d+)?s\. Stacks up to (\d+) times$/i, (m) => `+${fmtNum(m[1] * m[2])}% Spell Critical Strike Rating`],
  // Frostbolt: "Damage penetrates 30% Elemental Resistance of Numbed enemies" (while the enemy is)
  [/^Damage penetrates (\d+(?:\.\d+)?)% Elemental Resistance of (Numbed|Frostbitten) enemies$/i, (m, ctx) =>
    (m[2].toLowerCase() === 'numbed' ? ctx.config?.enemyNumbed : ctx.config?.enemyFrostbittenEnabled) ? `Damage Penetrates ${m[1]}% Elemental Resistance` : ''],
  // Splitting Lightning Bolt: Swift Bolt (Magnificent): "+3.6% additional damage for the supported skill
  // for each time it was cast recently, up to 8 time(s)": cast nonstop, always 8
  [/^\+(\d+(?:\.\d+)?)% additional damage for the supported skill for each time it was cast recently, up to (\d+) time\(s\)$/i, (m) => `+${fmtNum(m[1] * m[2])}% additional damage for the supported skill`],
  // Splitting Lightning Bolt: Disintegration (Noble): "+26% additional Hit Damage for the supported skill
  // for each remaining fork". On one target only the spear hits (its forks fly off to other enemies),
  // and the spear has all its forks left: 2
  [/^\+(\d+(?:\.\d+)?)% additional Hit Damage for the supported skill for each remaining fork$/i, (m) => `+${fmtNum(m[1] * SPEAR_FORKS)}% additional Hit Damage for the supported skill`],
  // Illusory Chimera: "Triggers Lv. 20 Aim while standing still. Interval: 1 s" / "+50% Aiming Skill
  // Duration." Standing at the dummy it's always up (9 s out of a 10 s cooldown, and the player's
  // buffs-up rule). Aim's Euphoria at Lv. 20 (tlidb, SS14): Projectile and Beam skills +35%
  // additional damage, -16% Attack and Cast Speed
  [/^Triggers Lv\. 20 Aim while standing still\. Interval: [\d.]+ s$/i, (m, ctx) => (ctx.config?.hasMovedRecently ? '' : '+35% additional Projectile Damage\n-16% Attack Speed\n-16% Cast Speed')],
  [/^\+\d+(?:\.\d+)?% Aiming Skill Duration\.?$/i, () => ''],
  // Genius Idea Generator (Bing #2 memory revival): "+2 to Whimsy Explosion Projectile Quantity, +100%
  // Whimsy Effect, +40% Whimsy Signal Effect" in one line. Whimsy Effect scales the Whimsy stacks'
  // +5% a stack (the engine's WhimsyEffPct; CoffeeBingBong's dummy, 2026-11-03) and Whimsy Signal's
  // Effect its +20%; the Whimsy Explosion's projectiles aren't modelled here.
  [/^\+\d+ to Whimsy Explosion Projectile Quantity, (\+\d+(?:\.\d+)?% Whimsy Effect), (\+\d+(?:\.\d+)?% Whimsy Signal Effect)$/i, (m) => `${m[1]}\n${m[2]}`],
  // Wings of Light: "Intimidated gains an additional base effect: +29% additional Spell and Ailment
  // Damage taken for each type of crowd control effect the target is under. Stacks up to 6 times". A
  // base effect of Intimidated, so the build's Intimidating effect and Crowd Control Effects scale it
  // (the item's own +26% and +18%)
  [/^Intimidated gains an additional base effect: \+(\d+(?:\.\d+)?)% (additional Spell and Ailment Damage taken for each type of crowd control effect the target is under\. Stacks up to \d+ times)$/i, (m, ctx) =>
    `Intimidated gains an additional base effect: +${fmtNum(Number(m[1]) * (1 + (ctx.intimidatingEffectPct ?? 0) / 100))}% ${m[2]}`],
  // Consumed by the line above
  [/^[+-]\d+(?:\.\d+)?% Intimidating effect$/i, () => ''],
];

// "+X% Intimidating effect" and "+X% Crowd Control Effects" on the character's gear, memories, slates,
// Pact board and talents, added up: both scale Wings of Light's "additional base effect" of
// Intimidated (the player, in game)
function intimidatingEffect(character) {
  const texts = [
    ...(character.equipment ?? []).flatMap(({ item }) => (item?.affixes ?? []).map((a) => a.text)),
    ...(character.memories ?? []).flatMap((m) => (m.item?.affixes ?? []).map((a) => a.text)),
    ...(character.slates ?? []).flatMap((s) => (s.talents ?? []).map((t) => t.text)),
    ...(character.destinies ?? []).filter((d) => d.active !== false).flatMap((d) => (d.affixes ?? []).map((a) => a.text)),
    ...(character.talentTrees ?? []).flatMap((t) => (t.nodes ?? []).filter((n) => n.points).map((n) => timesPoints(n.text ?? '', n.points))),
  ];
  let pct = 0;
  for (const text of texts) for (const m of String(text ?? '').matchAll(/([+-]\d+(?:\.\d+)?)% (?:Intimidating effect|Crowd Control Effects?)\b/gi)) pct += Number(m[1]);
  return pct;
}

// When Sparks Set the Prairie Ablaze: "Copies the last Talent on all adjacent slates. Unable to copy
// Core Talents." Adjacent means sharing an edge, by each slate's cells on the board
// (server/game/slates.js: spot, shape and turn). The copy keeps the copied slate's Effect bonus.
function copiedSlateTalents(slates, report) {
  const names = new Map(slates.map((s) => [s.id, s.name ?? `slate ${s.position}`]));
  const out = copiedTalents(slates);
  for (const t of out) report.unmapped.push(`${names.get(t.forSlate)}: copies "${t.text.split('\n')[0]}" from ${t.copiedFrom}`);
  return out;
}

// Whole affixes whose lines only mean something together, rewritten before the line rewrites.
// Illusory Chimera: "Gains the following buffs by turns. Each buff lasts for 8 s:" then +50%
// additional Erosion, Elemental and Physical Damage. One turn at a time, never all three, so over a
// long fight the damage takes the average of the turns: a turn counts when the main skill deals
// that kind of damage (its tags; physical converted to an element keeps its Physical bonuses and
// takes the Elemental ones too). CoffeeBingBong's Psionic Missile (physical, converted to cold):
// (1 + 1.5 + 1.5) / 3 = x1.33, and his 3-5 minute dummy runs measured the boots at x1.75-1.77,
// which is that times the Aim line; the best turn counted all the time gave x1.96 (2026-11-03).
// The turns of a "Gains the following buffs by turns. Each buff lasts for D s" affix, for the
// engine's average and for the simulation's timeline: each turn's bonus (0 for a turn the main
// skill's damage doesn't take), the period (a new turn every D s), each buff's length (D x (1 +
// Skill Effect Duration), so the turns overlap for a moment) and the long-run average factor.
export const TURNS_AFFIX = /^Gains the following buffs by turns\. Each buff lasts for ([\d.]+) s:\n([\s\S]+)$/i;
export function rotatingTurns(text, ctx) {
  const m = TURNS_AFFIX.exec(String(text ?? '').trim());
  if (!m) return null;
  const turns = [...m[2].matchAll(/\+(\d+(?:\.\d+)?)% additional (\w+) Damage/gi)];
  if (!turns.length) return null;
  const tags = ctx?.mainTags ?? [];
  const elemental = tags.some((t) => ['Cold', 'Fire', 'Lightning'].includes(t)) || (tags.includes('Physical') && !!ctx?.convertsPhysical);
  const takes = { Erosion: tags.includes('Erosion'), Elemental: elemental, Physical: tags.includes('Physical') };
  const period = Number(m[1]);
  const duration = period * (1 + (ctx?.skillEffectDurationPct ?? 0) / 100);
  const bonuses = turns.map((x) => (takes[x[2]] ?? true ? Number(x[1]) / 100 : 0));
  const uptime = duration / (period * turns.length);
  return { bonuses, period, duration, average: 1 + bonuses.reduce((s, b) => s + b * uptime, 0) };
}
// Whole affixes whose lines only mean something together, rewritten before the line rewrites.
// Illusory Chimera's turns go in as their long-run average (CoffeeBingBong's Psionic Missile, physical
// converted to cold, takes two of the three +50% turns: x1.37 with his +10% Skill Effect Duration;
// his 3-5 minute dummy runs measured the boots at x1.75-1.77, which is that times the Aim line; the
// best turn counted all the time gave x1.96, 2026-11-03). The simulation plays the turns out in time.
const AFFIX_REWRITES = [
  [TURNS_AFFIX, (m, ctx) => {
    const turns = rotatingTurns(m[0], ctx);
    return turns && turns.average > 1 ? `+${fmtNum((turns.average - 1) * 100)}% additional damage` : '';
  }],
];
const rewriteAffix = (text, ctx) => {
  for (const [re, to] of AFFIX_REWRITES) {
    const m = re.exec(text.trim());
    if (m) return to(m, ctx);
  }
  return text;
};
const SPEAR_FORKS = 2;
const isSpellProjectile = (ctx) => ['Spell', 'Projectile'].every((t) => ctx?.mainTags?.includes(t));

// ctx: { level, config (combat toggles), mainTags (the main skill's tags) }. A rewrite to '' drops
// the line (it doesn't apply to this build or situation).
export function rewriteLine(line, ctx = {}) {
  for (const [re, to] of LINE_REWRITES) {
    const m = re.exec(line.trim());
    if (m) return to(m, ctx);
  }
  return line;
}

const textOf = (affixes, kinds, ctx) =>
  affixes
    .filter((a) => kinds.includes(a.kind) && a.text)
    .map((a) => (ctx ? rewriteAffix(a.text, ctx).split('\n').map((l) => rewriteLine(l, ctx)).filter(Boolean).join('\n') : a.text))
    .filter(Boolean);

function toGear(item, report, ctx) {
  const type = equipmentType(item.type);
  if (!type) {
    report.unmapped.push(`Gear ${item.name ?? item.baseId}: unknown equipment type "${item.type}"`);
    return undefined;
  }
  const affixes = item.affixes ?? [];
  for (const a of affixes) if (!a.text) report.unmapped.push(`${item.uniqueName ?? item.name}: affix #${a.id} has no text`);
  const otherKinds = [...new Set(affixes.map((a) => a.kind))].filter((k) => !['base', 'implicit', 'prefix', 'suffix'].includes(k));
  const gear = {
    id: item.id,
    equipmentType: type,
    rarity: item.uniqueId ? 'legendary' : 'rare',
    legendaryName: item.uniqueName ?? undefined,
    baseGearName: item.name ?? undefined,
    baseStats: textOf(affixes, ['base'], ctx).join('\n') || undefined,
    baseAffixes: textOf(affixes, ['implicit'], ctx),
    customAffixes: textOf(affixes, otherKinds, ctx),
  };
  if (item.uniqueId) gear.legendaryAffixes = textOf(affixes, ['prefix', 'suffix'], ctx);
  else Object.assign(gear, { prefixes: textOf(affixes, ['prefix'], ctx), suffixes: textOf(affixes, ['suffix'], ctx) });
  return gear;
}

// Fixed lines of a Noble/Magnificent support the engine has no template for, as lines it counts.
// Psionic Missile: Emission's pulse is "150% of Explosion Damage" once per cast, after the
// explosion: x2.5 a cast while the skill fires one projectile (with more, the shotgun falloff
// would shrink the explosions' share and this overcounts)
const SPECIAL_EXTRAS = {
  'Psionic Missile: Emission (Noble)': ['+150% additional damage for the supported skill'],
};

// The engine reads one rolled line per support: several "X% additional damage for the supported
// skill" lines become the one line they multiply to
const ADDN_SUPPORTED = /^([+-]?\d+(?:\.\d+)?)% additional damage for the supported skill$/;
function mergeAdditional(lines) {
  const addn = lines.filter((l) => ADDN_SUPPORTED.test(l.trim()));
  if (addn.length < 2) return lines;
  const mult = addn.reduce((m, l) => m * (1 + Number(ADDN_SUPPORTED.exec(l.trim())[1]) / 100), 1);
  const pct = Math.round((mult - 1) * 1000) / 10;
  return [`${pct >= 0 ? '+' : ''}${pct}% additional damage for the supported skill`, ...lines.filter((l) => !addn.includes(l))];
}

function toSkillSlot(group, lookup, report, ctx) {
  const skill = group.skill;
  if (!skill) return undefined;
  const data = lookup.get(norm(skill.name));
  if (!data) {
    report.unmapped.push(`Skill ${skill.name ?? '#' + skill.baseId}: not in the calculation engine`);
    return undefined;
  }
  const supportSkills = {};
  group.supports.forEach((support, i) => {
    const s = SUPPORT.get(norm(support.name));
    const special = SPECIAL_SUPPORTS.get(norm(support.name));
    if (s) supportSkills[i + 1] = { skillType: 'support', name: s.name, level: support.level ?? 20 };
    // Noble/Magnificent: the rolled line from the log and the rank (the gem's level, 1-5), which adds
    // the engine's rank bonus. Without the roll only the fixed lines count, and that's said.
    else if (special) {
      // SS14's new supports: the log has the rolled value but no text for it yet
      const valued = (support.affixes ?? []).find((a) => a.values?.length);
      const roll = (support.affixes ?? []).find((a) => a.text) ?? (valued && { ...valued, text: specialSupportRolledText(SKILL_DATA, special.name, valued.values[0]) });
      const lines = mergeAdditional([...(roll?.text ? roll.text.split('\n') : []), ...(SPECIAL_EXTRAS[special.name] ?? [])]);
      supportSkills[i + 1] = {
        skillType: special.skillType,
        name: special.name,
        tier: 0,
        rank: Math.max(1, Math.min(5, support.level ?? 1)),
        craftedAffix: lines.map((l) => rewriteLine(l, ctx)).filter(Boolean).join('\n'),
        value: Number(roll?.values?.[0] ?? 0),
      };
      if (!roll?.text) report.unmapped.push(`Support ${special.name} on ${data.name}: its rolled line isn't in the log yet, so only its fixed lines count`);
    }
    // Activation Media only decide when the skill fires; buffs are taken as always up anyway
    else if (/^Activation Medium:/.test(support.name ?? '')) report.unmapped.push(`Support ${support.name} on ${data.name}: casts it automatically; its buff is already counted as always up`);
    else if (!SUPPORT_BUFFS.has(support.name)) report.unmapped.push(`Support ${support.name ?? '#' + support.baseId} on ${data.name}: not modelled yet`);
  });
  return { skillName: data.name, enabled: true, level: skill.level ?? 20, supportSkills };
}

// A talent node's text, without its divinity cap, for comparing versions
const nodeText = (s) =>
  String(s ?? '')
    .replace(/\s*\(Max (?:Active )?Divinity(?: Effect)?: \d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
// A node's line for all its points: a node's stats add up per point, so signed numbers, percents
// and "Adds A - B" ranges are multiplied; other numbers (intervals, stack caps) are not
const timesPoints = (text, points) =>
  points === 1
    ? text
    : text
        .replace(/(Adds )(\d+(?:\.\d+)?) - (\d+(?:\.\d+)?)/g, (m, a, lo, hi) => `${a}${fmtNum(lo * points)} - ${fmtNum(hi * points)}`)
        .replace(/([+-])(\d+(?:\.\d+)?)/g, (m, sign, d) => `${sign}${fmtNum(d * points)}`)
        .replace(/(^|[^+\-\d.])(\d+(?:\.\d+)?)%/g, (m, pre, d) => `${pre}${fmtNum(d * points)}%`);

// A slate line at the board's Effect bonus: percentages and flat damage keep decimals (the game shows
// "+8.5% Intelligence", "Adds 3.4 - 3.4 Fire Damage"); whole-number stats round
const WHOLE_NUMBER_STAT = /skill level|stacks?\b|to max|jumps?\b|quantity|projectiles?\b/i;
function scaleSlateLine(line, effect) {
  if (effect === 1) return line;
  const whole = WHOLE_NUMBER_STAT.test(line) && !/%/.test(line);
  // Not the divisor in "per 5 Intelligence" or "every 2 m"
  return line.replace(/(?<!per |every |per\s|every\s)(?<![\d.])(\d+(?:\.\d+)?)/g, (d) => {
    const v = Number(d) * effect;
    return whole ? String(Math.round(v)) : fmtNum(Math.round(v * 10) / 10);
  });
}

// A talent prism's "All <type> Talent within the area also gain: <stat>" lines, as stat lines: the
// stat once per point in talents of that type in the prism's area (CoffeeBingBong's 5 Legendary
// Mediums x 17.5 Max Frostbite Rating = the 118 his sheet shows, 2026-11-03), scaled by the prism's
// "+X% to the effects of Random Affixes on this Prism". Lines that can't be named are reported.
function prismLines(tree, report) {
  const prism = tree.prism;
  if (!prism?.affixes?.length) return [];
  // The random lines' texts are read off the prism's tooltip, which already shows them with its
  // "+X% to the effects of Random Affixes on this Prism" applied (the player: +2 Agility stays 2)
  const boost = 1;
  const inArea = (n) => prism.area.some((q) => q.x === n.x && q.y === n.y);
  const lines = [];
  for (const a of prism.affixes) {
    if (!a.text) {
      report.unmapped.push(`${prism.name ?? 'Prism'} on ${tree.name}: line #${a.id} isn't named yet, so it isn't counted`);
      continue;
    }
    // "Talent" here means a point: a Micro node with 3 points taken counts 3 times (the player's
    // rule; Legendary Medium nodes hold one point, so they count once)
    const allocated = (type) => tree.nodes.filter((n) => n.points > 0 && inArea(n) && n.name?.toLowerCase() === `${type} Talent`.toLowerCase()).reduce((s, n) => s + n.points, 0);
    const each = /^All (Legendary Medium|Medium|Micro) Talent within the area also gain:\s*([\s\S]+)$/i.exec(a.text);
    if (each) {
      const count = allocated(each[1]);
      if (count) lines.push(...timesPoints(each[2].trim(), count * boost).split('\n'));
      continue;
    }
    // "When activating 2 Legendary Medium Talent within the area, +2 to Max Agility Blessing Stacks":
    // once, with whole stacks rounded down after the prism's boost
    const when = /^When activating (\d+) (Legendary Medium|Medium|Micro) Talent within the area,\s*([\s\S]+)$/i.exec(a.text);
    if (when && allocated(when[2]) >= Number(when[1])) {
      const line = timesPoints(when[3].trim(), boost);
      lines.push(/stacks?\b/i.test(line) ? line.replace(/([+-])(\d+(?:\.\d+)?)/, (m, sign, d) => `${sign}${Math.floor(Number(d))}`) : line);
    }
  }
  return lines;
}

// Log positions are 1-based {x: row, y: column}; the engine's are 0-based {x: column, y: row}.
// The engine's tree data is from an older season. Where a node's current text (the log's node id,
// named through tlidb) differs from what the engine has at that spot, e.g. Magister's "+8%
// additional Hit Damage for skills cast by Spell Burst" that the engine still has as "+1 Max Spell
// Burst", the current text goes in as a stat line (lines) instead.
function toTalentTree(tree, report, lines) {
  const data = TREES.get(norm(tree.name));
  if (!data) {
    report.unmapped.push(`Talent tree ${tree.name ?? '#' + tree.id}: not in the calculation engine`);
    return undefined;
  }
  const cores = (tree.cores ?? []).map((c) => c.name).filter(Boolean);
  for (const name of cores) if (!CORE_TALENTS.has(name)) report.unmapped.push(`Core talent ${name}: not in the calculation engine`);
  const allocatedNodes = [];
  for (const n of tree.nodes.filter((n) => n.points)) {
    const spot = { x: n.y - 1, y: n.x - 1 };
    const engineNode = data.nodes.find((e) => e.position.x === spot.x && e.position.y === spot.y);
    if (n.text && nodeText(n.text) !== nodeText(engineNode?.rawAffix)) {
      lines.push(...timesPoints(n.text.replace(DIVINITY_SUFFIX, ''), n.points).split('\n'));
      continue;
    }
    allocatedNodes.push({ ...spot, points: n.points });
  }
  return { name: data.name, allocatedNodes, selectedCoreTalents: cores.filter((name) => CORE_TALENTS.has(name)) };
}

function toMemory(memory, ctx) {
  const affixes = memory.item.affixes ?? [];
  // AwakenInitAffix: a revived memory's record of its lines before the revival (the tooltip shows each
  // once), not lines of its own
  const randomKinds = [...new Set(affixes.map((a) => a.kind))].filter((k) => !['base', 'implicit', 'AwakenInitAffix'].includes(k));
  return {
    id: memory.item.id,
    memoryType: memory.item.name,
    baseStat: textOf(affixes, ['base'], ctx).join('\n'),
    // The memory's own level (it sets its trait's level), not the item level
    level: memory.memoryLevel ?? 30,
    fixedAffixes: textOf(affixes, ['implicit'], ctx),
    randomAffixes: textOf(affixes, randomKinds, ctx),
  };
}

// pactspirits: up to three { name, level, area? } to equip, using the engine's names and levels 1-6.
// A pet inferred from the log knows its board area, so the Destinies installed in its ring spots
// replace those spots' own stats (the engine otherwise counts every ring spot's stat).
function toPactspiritPage(pactspirits = [], destinies = []) {
  const page = {};
  pactspirits.slice(0, 3).forEach((p, i) => {
    const rings = {};
    for (const d of destinies) {
      const { area, ring } = destinySpot(d);
      const affix = (d.affixes ?? []).find((a) => a.text)?.text;
      if (p.area != null && area === p.area && ring && affix) {
        rings[ring] = { installedDestiny: { destinyName: d.name ?? 'Destiny', destinyType: /^Medium/.test(d.name ?? '') ? 'Medium' : 'Micro', resolvedAffix: affix } };
      }
    }
    page[`slot${i + 1}`] = { pactspiritName: p.name, level: p.level ?? 6, rings };
  });
  return page;
}

// Supports whose buff helps every skill, not just the one they support. The engine only applies
// support stats to the supported skill, so these go in as character-wide lines while the buff is
// up (combat toggles; the simulation assumes buffs are always up).
// Periodic Burst (engine data / tlidb): "+20.5% Attack and Cast Speed after using a Mobility Skill"
// A support gem's number at a level, from its tlidb card's level table (column 2)
const supportValueAt = (name, level) => {
  const card = Object.values(SKILL_DATA).find((c) => c.name === name);
  const rows = card?.progression?.rows ?? [];
  const row = rows.find((r) => Number(r[0]) === Math.min(20, Number(level) || 20)) ?? rows.at(-1);
  const v = Number(String(row?.[1] ?? '').split(',')[0]);
  return Number.isFinite(v) ? v : null;
};

// Supports on other skills whose effect reaches the main skill's hits, as stat lines
const SUPPORT_BUFFS = new Set(['Deepened Curse']);
function supportBuffLines(character, config) {
  const supports = character.skills.active.flatMap((g) => (g.skill ? g.supports.map((s) => s.name) : []));
  const lines = [];
  if (supports.includes('Periodic Burst') && config.hasUsedMobilitySkillRecently) lines.push('+20.5% Attack Speed', '+20.5% Cast Speed');
  // Deepened Curse on a curse: "Enemies take +5% additional damage if affected by curses inflicted by
  // the supported skill for at least 2 s" (the curse is kept up: always)
  for (const g of character.skills.active) {
    const dc = g.skill && ACTIVE.get(norm(g.skill.name))?.tags?.includes('Curse') ? g.supports.find((s) => s.name === 'Deepened Curse') : null;
    const v = dc && config.targetEnemyIsCursed !== false ? supportValueAt('Deepened Curse', dc.level) : null;
    if (v) lines.push(`+${v}% additional damage`);
  }
  return lines;
}

// What the main skill is and what the build does to its damage: its tags, whether physical damage
// is converted to an element anywhere (gear, slates, talents) and the Skill Effect Duration (the
// Info tab's; a revived memory's "before" lines excluded)
export function mainContext(character, mainSkill = mainActiveSkill(character)?.name) {
  const text = [...character.equipment.flatMap((e) => e.item?.affixes ?? []), ...character.memories.flatMap((m) => (m.item?.affixes ?? []).filter((a) => a.kind !== 'AwakenInitAffix')), ...character.slates.flatMap((s) => s.talents ?? []), ...character.talentTrees.flatMap((t) => t.nodes.filter((n) => n.points))].map((a) => a.text ?? '').join('\n');
  return {
    mainTags: mainSkill ? ACTIVE.get(norm(mainSkill))?.tags ?? [] : [],
    convertsPhysical: /Physical Damage (?:will be |is )?converted to (?:Cold|Fire|Lightning)|of (?:the skill's )?Physical Damage to (?:Cold|Fire|Lightning) Damage/i.test(text),
    skillEffectDurationPct: [...text.matchAll(/^\+(\d+(?:\.\d+)?)% Skill Effect Duration$/gim)].reduce((s, m) => s + Number(m[1]), 0),
  };
}

export function buildSaveData(character, configOverrides = {}, { pactspirits, hero } = {}) {
  const report = { unmapped: [] };
  const mainSkill = mainActiveSkill(character)?.name;
  // Rewrites can depend on the level, the combat toggles and what the main skill is
  const ctx = { level: character.player.level ?? 95, config: configOverrides, ...mainContext(character, mainSkill), intimidatingEffectPct: intimidatingEffect(character) };
  const inventory = [];
  const equippedGear = {};
  for (const { slot, item } of character.equipment) {
    if (!item?.detailsKnown) continue;
    const gear = toGear(item, report, ctx);
    if (!gear) continue;
    inventory.push(gear);
    equippedGear[GEAR_SLOTS[slot]] = { id: gear.id };
  }

  const activeSkills = {};
  character.skills.active.forEach((g, i) => (activeSkills[i + 1] = toSkillSlot(g, ACTIVE, report, ctx)));
  const passiveSkills = {};
  character.skills.passive.forEach((g, i) => (passiveSkills[i + 1] = toSkillSlot(g, PASSIVE, report, ctx)));
  // A gem bought or swapped in after logging in shows up in the log by id only; its level comes
  // with the next login
  const levelUnknown = [...character.skills.active, ...character.skills.passive]
    .flatMap((g) => [g.skill, ...g.supports])
    .filter((s) => s?.name && s.level == null)
    .map((s) => s.name);
  if (levelUnknown.length) report.unmapped.push(`Levels not in the log yet, taken as 20 until you log in again: ${[...new Set(levelUnknown)].join(', ')}`);

  const talentTrees = {};
  const talentLines = [];
  character.talentTrees.forEach((t, i) => (talentTrees[`tree${i + 1}`] = toTalentTree(t, report, talentLines)));

  const memorySlots = {};
  for (const m of character.memories) {
    if (MEMORY_SLOTS[m.slot] && MEMORY_TYPES.has(m.item.name)) memorySlots[MEMORY_SLOTS[m.slot]] = toMemory(m, ctx);
  }

  // Character-wide stat lines, each with where it comes from (for the line coverage list)
  const extraLines = [];
  const addLines = (source, lines) => extraLines.push(...lines.filter(Boolean).map((text) => ({ source, text })));
  // Slates are applied as plain stat lines; their grid placement only matters for adjacency effects.
  // The board's Effect bonus (Nether King's Divinity, e.g. +70%) scales every line; whole-number
  // stats (skill levels, stacks) round to the nearest whole number (+1 x 1.7 = +2), per the player
  // Each slate talent's Effect bonus comes from the log (Nether King's Divinity reaching it, e.g.
  // +70%); the "Divinity slate effect %" setting adds to all of them. "(Max Divinity Effect: N)": at
  // most N copies of that line count across all slates.
  const extraEffect = Number(configOverrides.slateEffectPct) || 0;
  const copies = new Map();
  const slateTalents = [...character.slates.flatMap((s) => s.talents), ...copiedSlateTalents(character.slates, report)]
    .filter((t) => t.text)
    .filter((t) => {
      const limit = Number(DIVINITY_CAP.exec(t.text)?.[1] ?? Infinity);
      const key = t.text.replace(DIVINITY_SUFFIX, '').trim().toLowerCase();
      copies.set(key, (copies.get(key) ?? 0) + 1);
      return copies.get(key) <= limit;
    });
  addLines(
    'Slates',
    slateTalents.flatMap((t) =>
      t.text
        .replace(DIVINITY_SUFFIX, '')
        .split('\n')
        .map((l) => rewriteLine(scaleSlateLine(l, 1 + ((t.effectPct ?? 0) + extraEffect) / 100), ctx)),
    ),
  );
  addLines('Talents (current text)', talentLines.map((l) => rewriteLine(l, ctx)));
  addLines('Prisms', character.talentTrees.flatMap((t) => prismLines(t, report)).map((l) => rewriteLine(l, ctx)));
  // Destinies on the Pact board ("Micro Fate: Intelligence": +14 Intelligence). Those in an equipped
  // pet's ring spots go in through the pet (toPactspiritPage); the rest count as plain stats.
  const destinies = (character.destinies ?? []).filter((d) => d.active);
  const petAreas = new Set((pactspirits ?? []).slice(0, 3).map((p) => p.area).filter((a) => a != null));
  const inPetRing = (d) => {
    const { area, ring } = destinySpot(d);
    return !!ring && petAreas.has(area);
  };
  addLines(
    'Destinies',
    destinies.filter((d) => !inPetRing(d)).flatMap((d) => (d.affixes ?? []).map((a) => (a.text ? rewriteLine(a.text, ctx) : null))),
  );
  const unnamed = destinies.filter((d) => !(d.affixes ?? []).some((a) => a.text)).length;
  if (unnamed) report.unmapped.push(`Destinies: ${unnamed} on the Pact board have no text in the game data yet (run the tlidb import)`);
  addLines('Support buffs', supportBuffLines(character, configOverrides));
  // Scent Weaver Sage: the Scent Bottle ingredients picked in the UI (the log doesn't list them)
  for (const { source, text } of sageIngredientLines(hero)) addLines(source, [text]);
  // Elixir skill lines the engine's parser couldn't read, for the slotted elixirs
  for (const name of character.skills.active.map((g) => g.skill?.name).filter((n) => ELIXIR_SYNC.unparsed[n])) {
    report.unmapped.push(`Elixir ${name}: "${ELIXIR_SYNC.unparsed[name].join(' / ')}" is not counted`);
  }
  // A sample build's own stat lines (memories, Destinies, slates typed in as text), by source
  for (const { source, text } of character.extraLines ?? []) addLines(source || 'Custom lines', String(text ?? '').split('\n').map((l) => rewriteLine(l, ctx)));
  const slateLines = extraLines.map((l) => l.text);
  report.lineSources = extraLines;
  if (!hero?.name) report.unmapped.push('Hero and traits: not set (the log only has ids). Pick them under "Hero & pactspirits"');
  else {
    const names = Object.values(hero.traits ?? {}).filter(Boolean);
    for (const name of names) if (!traitModel(name) && !heroNote(name)) report.unmapped.push(`Hero trait ${name}: not modelled yet`);
    const simOnly = names.filter((name) => traitModel(name) === 'sim');
    if (simOnly.length) report.unmapped.push(`Hero traits ${simOnly.join(', ')}: in the in-game simulation only, not the formula`);
    // What each picked trait's numbers leave out (modelled or not)
    report.unmapped.push(...heroNotes(hero));
    report.unmapped.push(...sageNotes(hero));
  }
  if (!pactspirits?.length) report.unmapped.push('Pactspirits: not set (the log only has ids). Pick them under "Hero & pactspirits"');

  // One setting for the three elemental resistances
  const { enemyElementalRes, ...engineConfig } = configOverrides;
  // Bing #2's Trouble Maker: Whimsy Signal at its trait level's value instead of +20%
  const troubleMaker = bingTraitLevel(hero, 'Trouble Maker');
  if (troubleMaker && engineConfig.whimsySignalDmgPct == null) engineConfig.whimsySignalDmgPct = TROUBLE_MAKER_SIGNAL[troubleMaker - 1];
  if (enemyElementalRes != null) Object.assign(engineConfig, { enemyColdRes: enemyElementalRes, enemyFireRes: enemyElementalRes, enemyLightningRes: enemyElementalRes });

  return {
    report,
    saveData: {
      equipmentPage: { equippedGear, inventory },
      talentPage: { talentTrees, inventory: { prismList: [], inverseImageList: [] } },
      skillPage: { activeSkills, passiveSkills },
      heroPage: { selectedHero: hero?.name || undefined, traits: toHeroTraits(hero), memorySlots, memoryInventory: [] },
      pactspiritPage: toPactspiritPage(pactspirits, (character.destinies ?? []).filter((d) => d.active)),
      divinityPage: { placedSlates: [], inventory: [] },
      configurationPage: {
        ...tob.DEFAULT_CONFIGURATION,
        level: character.player.level ?? 95,
        ...engineConfig,
        customAffixLines: [...slateLines, ...(engineConfig.customAffixLines ?? [])],
      },
      calculationsPage: { selectedSkillName: mainSkill ? ACTIVE.get(norm(mainSkill)).name : undefined },
    },
  };
}

// Every stat line handed to the engine, with whether its parser understood it. The engine drops a
// keyword prefix like "[Beacon] " before parsing, so this does too.
const KEYWORD_PREFIX = /^\[[^\]]+\]\s*/;
function lineCoverage(saveData, lineSources = []) {
  const lines = [];
  const add = (source, text) => {
    for (const line of String(text ?? '').split('\n')) {
      const t = line.replace(DIVINITY_SUFFIX, '').trim();
      if (t) lines.push({ source, text: t, parsed: tob.parseMod(t.replace(KEYWORD_PREFIX, '')) !== undefined });
    }
  };
  for (const g of saveData.equipmentPage.inventory) {
    const name = g.legendaryName ?? g.baseGearName ?? g.equipmentType;
    for (const text of [g.baseStats, ...(g.baseAffixes ?? []), ...(g.prefixes ?? []), ...(g.suffixes ?? []), ...(g.legendaryAffixes ?? []), ...(g.customAffixes ?? [])]) add(name, text);
  }
  for (const m of Object.values(saveData.heroPage.memorySlots)) for (const text of [m.baseStat, ...m.fixedAffixes, ...m.randomAffixes]) add(m.memoryType, text);
  for (const { source, text } of lineSources) add(source, text);
  return lines;
}

export function runEngine(character, configOverrides, options) {
  const { saveData: raw, report } = buildSaveData(character, configOverrides, options);
  const parsed = tob.SaveDataSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'Could not build an engine save', issues: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`), report };
  }
  const saveData = parsed.data;

  // The engine reports problems through console.error; collect them instead
  const engineErrors = [];
  const consoleError = console.error;
  console.error = (...args) => engineErrors.push(args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  try {
    const loadout = tob.loadSave(saveData);
    const results = tob.calculateOffense({ loadout, configuration: saveData.configurationPage });
    // Said out loud rather than shown as a silent 0: a main skill the engine has no damage model
    // for, and support lines it couldn't turn into numbers
    const main = saveData.calculationsPage.selectedSkillName;
    const shape = main && tob.hasGeneratedActiveSkill(main) ? SKILL_SHAPES[main] : null;
    if (main && !(results.skills[main]?.totalDps > 0)) {
      const refused = SKILL_SHAPES[main]?.coverage === 'refused' ? SKILL_SHAPES[main].reason : null;
      report.unmapped.push(`Skill ${main}: no damage model yet, so its DPS can't be computed${refused ? ` (${refused})` : ''}`);
    } else if (shape) {
      report.unmapped.push(`Skill ${main}: damage read from its tlidb card (${shape.coverage})${shape.reason ? `. ${shape.reason}` : ''}`);
    }
    const supportLines = new Set(tob.collectUnimplementedSupportAffixes(loadout).map((a) => `Support ${a.skillName}: "${a.text.replace(/\n/g, ' / ')}" is not counted`));
    report.unmapped.push(...supportLines);
    return {
      ok: true,
      mainSkill: saveData.calculationsPage.selectedSkillName ?? null,
      results,
      lines: lineCoverage(saveData, report.lineSources),
      unmapped: report.unmapped,
      errors: [...new Set([...results.errors, ...engineErrors])],
    };
  } catch (err) {
    return { ok: false, error: err.message, unmapped: report.unmapped, errors: engineErrors };
  } finally {
    console.error = consoleError;
  }
}
