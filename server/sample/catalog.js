// What a sample build can be made of, for the sample build's pickers: legendaries by gear slot (tlidb's
// current-season lines with their roll ranges, drop level and drop sources), item types for rares,
// skills and supports the engine can compute, talent trees with their core talents, heroes and
// pactspirits.
import * as tob from '../engine/tob.bundle.js';
import { HERO_CATALOG, LEGENDARY_PACTSPIRITS, SKILL_DATA, SKILL_SHAPES } from '../engine/bridge.js';

const ONE_HANDED = ['Claw', 'Dagger', 'Cane', 'Rod', 'Wand', 'Scepter', 'Pistol', 'One-Handed Sword', 'One-Handed Hammer', 'One-Handed Axe'];
const TWO_HANDED = ['Two-Handed Sword', 'Two-Handed Hammer', 'Two-Handed Axe', 'Tin Staff', 'Cudgel', 'Bow', 'Crossbow', 'Musket', 'Fire Cannon'];
const armor = (piece) => ['STR', 'DEX', 'INT'].map((a) => `${a} ${piece}`);

export const SAMPLE_SLOTS = [
  { slot: 1, label: 'Helmet', types: armor('Helmet') },
  { slot: 2, label: 'Main hand', types: [...ONE_HANDED, ...TWO_HANDED] },
  { slot: 3, label: 'Off hand', types: [...ONE_HANDED, ...armor('Shield')] },
  { slot: 4, label: 'Chest', types: armor('Chest Armor') },
  { slot: 5, label: 'Necklace', types: ['Necklace'] },
  { slot: 6, label: 'Ring 1', types: ['Ring'] },
  { slot: 7, label: 'Ring 2', types: ['Ring'] },
  { slot: 8, label: 'Belt', types: ['Belt'] },
  { slot: 9, label: 'Gloves', types: armor('Gloves') },
  { slot: 10, label: 'Boots', types: armor('Boots') },
];
export const SLOT_LABELS = Object.fromEntries(SAMPLE_SLOTS.map((s) => [s.slot, s.label]));

// The campaign's Treasure Troves (tlidb drop sources "Treasure Trove: New Ear Hills" ... "Hall of
// Grandiosity", areas level 7-54). The first clear of each guarantees a legendary, which can only be
// one whose drop level the area reaches.
export const TREASURE_TROVES = [
  { name: 'New Ear Hills', level: 7 },
  { name: 'Nectar Valley', level: 16 },
  { name: 'Dawn Avenue', level: 27 },
  { name: 'Sanctuary of Solitude', level: 35 },
  { name: "Silver Sands' End", level: 44 },
  { name: 'Hall of Grandiosity', level: 54 },
];
export const TROVE_MAX_LEVEL = Math.max(...TREASURE_TROVES.map((t) => t.level));

export function legendaryCatalog(gd) {
  const list = [];
  for (const [id, u] of gd.all('uniques')) {
    const type = gd.get('items', u.baseId)?.type ?? null;
    if (!u.lines?.length || !type) continue;
    const slots = SAMPLE_SLOTS.filter((s) => s.types.includes(type)).map((s) => s.slot);
    if (!slots.length) continue;
    list.push({
      id,
      name: u.name,
      type,
      slots,
      season: u.season ?? null,
      reqLevel: u.reqLevel ?? null,
      dropLevel: u.dropLevel ?? null,
      icon: u.icon ?? null,
      base: u.base ?? [],
      implicit: u.implicit ?? [],
      lines: u.lines,
      corroded: u.corroded ?? [],
      random: u.random ?? {},
      dropSources: u.dropSources ?? [],
      trove: u.dropLevel != null && u.dropLevel <= TROVE_MAX_LEVEL,
    });
  }
  // A name can appear twice (an older season's id): keep the current season's
  const byName = new Map();
  for (const l of list) {
    const prev = byName.get(l.name);
    if (!prev || (l.season ?? '') > (prev.season ?? '')) byName.set(l.name, l);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Skills the sample can use: actives with a damage model first (hand-written or read off tlidb), every
// passive and support the engine knows (SS14's included, see ss14-supports.js), and the Noble /
// Magnificent supports with their tier lines; each with tlidb's icon
export function skillCatalog(gd) {
  const icon = (name) => gd?.iconByName('skills', name) ?? null;
  const generated = (name) => SKILL_SHAPES[name]?.shape ? SKILL_SHAPES[name].coverage : null;
  const actives = tob.ActiveSkills.map((s) => ({
    name: s.name,
    tags: s.tags ?? [],
    icon: icon(s.name),
    model: tob.isSkillImplemented(s) ? (generated(s.name) ? `tlidb card (${generated(s.name)})` : 'engine') : null,
  })).sort((a, b) => (!!b.model - !!a.model) || a.name.localeCompare(b.name));
  const cards = new Map(Object.values(SKILL_DATA).map((c) => [c.name, c]));
  const special = [...tob.MagnificentSupportSkills.map((s) => ({ ...s, kind: 'Magnificent' })), ...tob.NobleSupportSkills.map((s) => ({ ...s, kind: 'Noble' }))].map((s) => ({
    name: s.name,
    kind: s.kind,
    icon: icon(s.name),
    target: s.supportTarget ?? /^(.+?):/.exec(s.name)?.[1] ?? null,
    // Tier 0 is the best roll; each tier's line with its range
    tiers: (cards.get(s.name)?.tiers?.rows ?? []).map((r) => ({ tier: Number(r[0]), line: String(r[1]).split('\n')[0] })).sort((a, b) => a.tier - b.tier),
  }));
  return {
    actives,
    passives: tob.PassiveSkills.map((s) => ({ name: s.name, tags: s.tags ?? [], icon: icon(s.name) })).sort((a, b) => a.name.localeCompare(b.name)),
    supports: tob.SupportSkills.map((s) => ({ name: s.name, tags: s.tags ?? [], icon: icon(s.name), season: cards.get(s.name)?.season ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
    special: special.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Divinity slates: the six gods' slates and the legendary ones (A Corner of Divinity, Fallen
// Starlight...), with their art; and the lines a slate can carry: talent nodes from every tree and the
// Nether King's, by text (the same line from several trees is listed once)
export function slateCatalog(gd) {
  const gods = [...new Map(gd.all('slates').map(([, s]) => [s.name, { name: s.name, icon: s.icon ?? null, legendary: false }])).values()];
  const legendary = gd
    .all('uniques')
    .filter(([, u]) => u.baseId && !gd.get('items', u.baseId)?.type && u.icon)
    .map(([, u]) => ({ name: u.name, icon: u.icon, legendary: true }));
  const lines = new Map();
  for (const [id, t] of gd.all('talents')) {
    // Lines tlidb hasn't translated yet (or mixes with notes) are left out
    if (!t.text || t.core || !/Talent$/.test(t.name ?? '') || /[㐀-鿿]|Source:/.test(t.text)) continue;
    const text = t.text.trim();
    if (!lines.has(text)) lines.set(text, { id: Number(id), text, type: t.name, tree: t.tree ?? null, icon: t.icon ?? null });
  }
  const order = { 'Legendary Medium Talent': 0, 'Medium Talent': 1, 'Micro Talent': 2 };
  return {
    types: [...gods, ...legendary.sort((a, b) => a.name.localeCompare(b.name))],
    lines: [...lines.values()].sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3) || a.text.localeCompare(b.text)),
  };
}

// A picture for each item type a rare can be (any base of that type tlidb has art for)
function typeIcons(gd) {
  const icons = {};
  for (const [, it] of gd.all('items')) if (it.type && it.icon && !it.legendaryBase) icons[it.type] = it.icon;
  return icons;
}

// Every talent tree with its nodes and core talents (current season, tlidb)
export function treeCatalog(gd) {
  return gd
    .all('talentTrees')
    .map(([slug, t]) => ({
      slug,
      name: t.name,
      image: t.image ?? null,
      cores: Object.entries(t.cores ?? {}).map(([id, c]) => ({ id: Number(id), name: c.name, unlockPoints: c.unlockPoints ?? 0, icon: c.icon ?? null, text: gd.get('talents', id)?.text ?? null })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Affix pools for crafted rares, by item type (tlidb's Craft page), only the kinds a rare rolls
function craftCatalog(gd) {
  const types = [...new Set(SAMPLE_SLOTS.flatMap((s) => s.types))];
  return Object.fromEntries(types.map((t) => [t, (gd.get('craft', t) ?? []).filter((a) => /Pre-fix|Suffix|Base Affix/.test(a.kind ?? ''))]));
}

export function sampleCatalog(gd, extra = {}) {
  const traitIcons = (list) => list.map((t) => ({ ...t, icon: gd.iconByName('heroTraits', t.name) }));
  return {
    slots: SAMPLE_SLOTS,
    troves: TREASURE_TROVES,
    legendaries: legendaryCatalog(gd),
    craft: craftCatalog(gd),
    typeIcons: typeIcons(gd),
    skills: skillCatalog(gd),
    trees: treeCatalog(gd),
    slates: slateCatalog(gd),
    // Heroes with their portraits and trait icons (like /api/catalog)
    heroes: HERO_CATALOG.map((h) => ({
      ...h,
      portrait: gd.heroPortrait(h.levels[1]?.[0]?.name),
      levels: Object.fromEntries(Object.entries(h.levels).map(([level, list]) => [level, traitIcons(list)])),
    })),
    // Every pactspirit the engine knows (rare and magic ones too), legendary first
    pactspirits: [...tob.Pactspirits]
      .sort((a, b) => (a.rarity === 'Legendary' ? 0 : 1) - (b.rarity === 'Legendary' ? 0 : 1) || a.name.localeCompare(b.name))
      .map((p) => ({ name: p.name, type: p.type, rarity: p.rarity, icon: gd.iconByName('pactspirits', p.name) })),
    legendaryPactspirits: LEGENDARY_PACTSPIRITS,
    ...extra,
  };
}
