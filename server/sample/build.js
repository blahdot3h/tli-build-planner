// A sample build (a plan, not a logged character) turned into the character shape the log gives
// (server/game/character.js), so the engine, the in-game simulation and the talent tools all work on
// it unchanged.
//
// spec: {
//   id, name, level,
//   hero: { name, traits: { level1, level45, level45b, ... }, levels: { [trait]: 1-5 } },
//   pactspirits: [{ name, level }],
//   gear: { [slot 1-10]: { legendary, roll 0-1, corroded, random: { "<Random ...>": line }, extra: [lines] }
//                      | { rare: { type, name, implicit: [lines], lines: [lines] } } },
//   skills: { active: [{ name, level, supports: [{ name, level } | { name, rank, tier, roll }] }] (5),
//             passive: [...] (4) },
//   talents: [{ tree, points: { [nodeId]: points }, cores: [names] }],
//   extraLines: [{ source, text }],   memories, Destinies, slates... typed as stat lines
//   scenario: { ...combat toggles },
// }
import { talentPosition } from '../game/character.js';
import { tierFromTable } from '../game/tiers.js';
import { SKILL_DATA } from '../engine/bridge.js';
import { specialSupportLine } from '../engine/ss14-supports.js';
import { SAMPLE_SLOTS } from './catalog.js';

const RANGE = /\((-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)\)/g;
const decimals = (s) => (String(s).split('.')[1] ?? '').length;

// A tlidb line with each (min–max) set to a roll: 0 the low end, 1 the high end, 0.5 the middle
export function rollLine(text, roll = 0.5) {
  return String(text).replace(RANGE, (m, a, b) => {
    const lo = Number(a);
    const hi = Number(b);
    const d = Math.max(decimals(a), decimals(b));
    const v = lo + (hi - lo) * roll;
    return String(Math.round(v * 10 ** d) / 10 ** d);
  });
}

const PLACEHOLDER = /^<.+>$/;
const affix = (kind, text) => ({ kind, id: null, values: [], text });

export function legendaryItem(slot, spec, legend) {
  const roll = spec.roll ?? 0.5;
  const source = spec.corroded && legend.corroded.length ? legend.corroded : legend.lines;
  // "<Random stat affix>": the picked option, else nothing
  const lines = source.flatMap((line) => (PLACEHOLDER.test(line.trim()) ? (spec.random?.[line.trim()] ? [spec.random[line.trim()]] : []) : [line]));
  return {
    id: `sample-${slot}`,
    baseId: null,
    name: legend.type,
    type: legend.type,
    detailsKnown: true,
    level: null,
    rarity: 100,
    uniqueId: legend.id,
    uniqueName: legend.name,
    forge: spec.corroded ? ['CORRODED'] : [],
    icon: legend.icon,
    dropLevel: legend.dropLevel,
    trove: legend.trove,
    affixes: [
      ...legend.base.map((text) => affix('base', text)),
      ...legend.implicit.map((text) => affix('implicit', rollLine(text, roll))),
      ...lines.map((text) => affix('prefix', rollLine(text, roll))),
      ...(spec.extra ?? []).filter(Boolean).map((text) => affix('enchant', text)),
    ],
  };
}

// A rare, or any item given line by line (a logged item copied with its exact rolls: legendaryName
// keeps its name, base its base stats, other its enchants and imprints)
export function rareItem(slot, rare, icon, gd = null) {
  const lines = (rare.lines ?? []).map((l) => String(l).trim()).filter(Boolean);
  const clean = (list) => (list ?? []).map((l) => String(l).trim()).filter(Boolean);
  // A crafted line's tier from the craft table (the game colours lines by tier)
  const crafted = (kind, text) => {
    const tier = !rare.legendaryName && gd ? tierFromTable(gd, rare.type, kind, text) : null;
    return tier != null ? { ...affix(kind, text), tier } : affix(kind, text);
  };
  return {
    id: `sample-${slot}`,
    baseId: null,
    name: rare.name || `Rare ${rare.type}`,
    type: rare.type,
    icon,
    detailsKnown: true,
    level: null,
    rarity: rare.legendaryName ? 100 : 4,
    uniqueId: rare.legendaryName ? `copy:${rare.legendaryName}` : null,
    uniqueName: rare.legendaryName ?? null,
    forge: [],
    affixes: [
      ...clean(rare.base).map((text) => affix('base', text)),
      ...clean(rare.implicit).map((text) => affix('implicit', text)),
      ...lines.map((text, i) => crafted(rare.legendaryName || i < 3 ? 'prefix' : 'suffix', text)),
      ...clean(rare.other).map((text) => affix('enchant', text)),
    ],
  };
}

// A support gem. Noble and Magnificent ones carry their rolled line (from their tier table) and rank,
// as the log gives them (the bridge reads a special support's level as its rank)
export function supportEntry(s, gd) {
  const icon = gd?.iconByName('skills', s.name) ?? null;
  // Activation Medium rolls (cooldown, duration) time the simulation's buffs
  if (!/\((Noble|Magnificent)\)$/.test(s.name)) return { id: null, baseId: null, name: s.name, icon, level: s.level ?? 20, ...(s.affixes?.length ? { affixes: s.affixes } : {}) };
  const line = s.line ?? specialSupportLine(SKILL_DATA, s.name, s.tier ?? 1);
  const text = line ? rollLine(line, s.roll ?? 0.5) : '';
  const value = Number(/[+-]?\d+(?:\.\d+)?/.exec(text)?.[0] ?? 0);
  return { id: null, baseId: null, name: s.name, icon, level: s.rank ?? 5, affixes: text ? [{ kind: 'prefix', id: null, values: [value], text }] : [] };
}

function skillGroup(slot, s, gd) {
  if (!s?.name) return { slot, skill: null, supports: [] };
  return {
    slot,
    skill: { id: null, baseId: null, name: s.name, icon: gd?.iconByName('skills', s.name) ?? null, level: s.level ?? 20, skillItemLevel: null, activating: null },
    supports: (s.supports ?? []).filter((x) => x?.name).slice(0, 5).map((x) => supportEntry(x, gd)),
  };
}

// A picture per item type a rare can be (any base of that type tlidb has art for), per game data
const typeIconCache = new WeakMap();
export function typeIcon(gd, type) {
  if (!gd?.all) return null;
  if (!typeIconCache.has(gd)) {
    const icons = {};
    for (const [, it] of gd.all('items')) if (it.type && it.icon && !it.legendaryBase) icons[it.type] = it.icon;
    typeIconCache.set(gd, icons);
  }
  return typeIconCache.get(gd)[type] ?? null;
}

// A slate as the bridge reads it ({ name, talents: [{ text, effectPct }] }), with its art
const slateWithIcon = (s, gd) => ({ ...s, icon: s.icon ?? gd?.iconByName('slates', s.name) ?? gd?.iconByName('uniques', s.name) ?? null });

// A tree from tlidb's node list with the spec's points on it; core talents by name
export function sampleTree(index, t, gd) {
  const data = gd.get('talentTrees', String(t.tree ?? '').replace(/ /g, '_'));
  if (!data) return null;
  const nodes = Object.entries(data.nodes).map(([id, n]) => {
    const { x, y } = talentPosition(id);
    const info = gd.get('talents', id);
    return { id: Number(id), name: info?.name ?? n.name, tree: data.name, text: info?.text ?? null, icon: n.icon ?? null, points: Math.max(0, Math.min(n.maxPoints, Number(t.points?.[id] ?? 0))), x, y };
  });
  const cores = (t.cores ?? [])
    .map((name) => {
      const [id, c] = Object.entries(data.cores ?? {}).find(([, c]) => c.name === name) ?? [];
      return id ? { id: Number(id), name, tree: data.name, text: gd.get('talents', id)?.text ?? null, icon: c.icon ?? null } : null;
    })
    .filter(Boolean);
  // A prism copied from a logged tree: { x, y, area, name, affixes }
  return { id: index + 1, name: data.name, points: nodes.reduce((s, n) => s + n.points, 0), nodes, cores, prism: t.prism ?? null, truncated: false };
}

const PASSIVE_SLOTS = [1001, 1007, 1013, 1019];

export function sampleCharacter(spec, gd, legendaries) {
  const byName = new Map(legendaries.map((l) => [l.name, l]));
  const equipment = SAMPLE_SLOTS.map(({ slot, label }) => {
    const g = spec.gear?.[slot];
    let item = null;
    if (g?.legendary && byName.has(g.legendary)) item = legendaryItem(slot, g, byName.get(g.legendary));
    else if (g?.rare?.type) item = rareItem(slot, g.rare, typeIcon(gd, g.rare.type), gd);
    return { slot, label, item, changedAt: null };
  });
  return {
    sample: true,
    player: { playerId: `sample:${spec.id}`, name: spec.name ?? 'Sample build', level: spec.level ?? 85, exp: null, heroId: null, heroName: spec.hero?.name ?? null, heroPurchaseId: null, seasonId: null },
    loginAt: null,
    equipment,
    skills: {
      active: [0, 1, 2, 3, 4].map((i) => skillGroup(i + 1, spec.skills?.active?.[i], gd)),
      passive: PASSIVE_SLOTS.map((slot, i) => skillGroup(slot, spec.skills?.passive?.[i], gd)),
    },
    heroTraits: [],
    // A copied character keeps its memories and Destinies as the log gave them; slates are the
    // spec's (copied or made in the slate editor)
    memories: spec.memories ?? [],
    talentTrees: (spec.talents ?? []).map((t, i) => sampleTree(i, t, gd)).filter(Boolean),
    slates: (spec.slates ?? []).filter((s) => s?.talents).map((s) => slateWithIcon(s, gd)),
    pactspirits: [],
    destinies: spec.destinies ?? [],
    extraLines: (spec.extraLines ?? []).filter((l) => l?.text),
    recorded: { historyMaxDps: null },
    gameStats: { dps: null, def: null, comparisons: [] },
    dummyTests: [],
    gaps: [],
  };
}

// Talent points a character has at a level: one per level plus the campaign's extra points
// (CoffeeBingTest has 106 at level 91)
export const talentPointsAt = (level) => Math.max(0, Math.round(level) + 15);
