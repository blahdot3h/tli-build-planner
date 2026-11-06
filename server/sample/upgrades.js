// What to change next in a sample build, ranked by what each change alone does to simulated DPS:
// every legendary that fits a gear slot (Treasure Trove ones marked), crafted rares, gem levels,
// support swaps (Noble and Magnificent ones included), pactspirits and hero trait levels. Each
// candidate is a full calculate() of the changed build, so situational toggles a new item brings
// (an item that inflicts Frail turns "Enemy has Frail" on) count too.
import { calculate } from '../calc/index.js';
import { sampleCharacter } from './build.js';
import { priceOf } from './prices.js';

const clone = (v) => structuredClone(v);
// A "<Random ...>" line's pick: Intelligence where offered (Bing #2 is an Intelligence hero)
const randomPicks = (legend) =>
  Object.fromEntries(
    Object.entries(legend.random ?? {})
      .filter(([k]) => !k.endsWith('(corroded)'))
      .map(([k, options]) => [k, options.find((o) => /Intelligence/.test(o)) ?? options[0]])
      .filter(([, v]) => v),
  );
const rollRanges = (text, roll) => text.replace(/\((-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?)\)/g, (m, a, b) => String(Math.round(Number(a) + (Number(b) - Number(a)) * roll)));

export const SLOT_RARE_TYPES = { 1: 'INT Helmet', 2: 'Wand', 3: 'Wand', 4: 'INT Chest Armor', 5: 'Necklace', 6: 'Ring', 7: 'Ring', 8: 'Belt', 9: 'INT Gloves', 10: 'INT Boots' };

// Crafting limits, from each gear type's tier table (tlidb Craft tabs). T2 is the best tier item level
// 82-85 gear rolls, craftable with Flame Sand (the cheap way); "any" allows every tier up to 0+ and
// Ultimate affixes, which need item level 100.
export const CRAFT_LIMITS = {
  T2: { maxTier: 2, maxLevel: 85, short: 'T2, ilvl 82-85', cost: 'cheap' },
  any: { maxTier: -1, maxLevel: 100, short: 'top tiers + Ultimate', cost: 'expensive' },
};
const tierRank = (t) => (t === '0+' ? -1 : Number(t));
// Lines that can add damage to a lightning spell build (defence, minion and other-element lines are skipped)
const MAYBE_DAMAGE = /damage|skill level|intelligence|critical|cast speed|penetration|spell burst|elemental/i;
const NOT_DAMAGE = /minion|taken|block|mitigation|regain|regenerat|max life|energy shield|armor|evasion|physical|fire|cold|erosion|combo|terra|sentry|curse|shadow|attack damage|melee|barrage|projectile split/i;

// Each affix family's best row within the limit
function craftRows(gd, type, limit) {
  const best = new Map();
  for (const r of gd.get('craftTiers', type) ?? []) {
    if (tierRank(r.tier) < limit.maxTier || r.lv > limit.maxLevel) continue;
    if (!MAYBE_DAMAGE.test(r.text) || NOT_DAMAGE.test(r.text)) continue;
    const family = `${r.part}:${r.text.replace(/[+-]?\(?\d+(?:\.\d+)?(?:–\d+(?:\.\d+)?)?\)?/g, '#')}`;
    const prev = best.get(family);
    if (!prev || tierRank(r.tier) < tierRank(prev.tier)) best.set(family, r);
  }
  return [...best.values()];
}

const dpsOf = (spec, gd, catalog) => {
  const ch = sampleCharacter(spec, gd, catalog.legendaries);
  const calc = calculate(ch, gd, spec.scenario, { hero: spec.hero ?? null, pactspirits: spec.pactspirits ?? [] });
  return calc.sim?.supported ? calc.sim.avgDps : (calc.dps?.combat?.total ?? 0);
};

// The rare (up to 3 prefixes and 3 suffixes) worth the most DPS in a slot, picked one line at a time
// by the simulation, rolled in the middle of each range
export async function bestCraftedRare(spec, gd, catalog, slot, limitKey = 'T2', type = SLOT_RARE_TYPES[slot]) {
  const rows = craftRows(gd, type, CRAFT_LIMITS[limitKey]);
  const picked = [];
  const withLines = (lines) => {
    const s = clone(spec);
    s.gear = { ...s.gear, [slot]: { rare: { type, name: `Crafted ${type}`, lines } } };
    return s;
  };
  for (let k = 0; k < 6; k++) {
    const room = (part) => picked.filter((p) => p.part === part).length < 3;
    let best = null;
    for (const r of rows) {
      if (picked.includes(r) || !room(r.part)) continue;
      const dps = dpsOf(withLines([...picked, r].map((p) => rollRanges(p.text, 0.5))), gd, catalog);
      if (!best || dps > best.dps) best = { r, dps };
    }
    if (!best) break;
    picked.push(best.r);
    await new Promise((res) => setImmediate(res));
  }
  if (!picked.length) return null;
  return { rare: { type, name: `Crafted ${type} (${CRAFT_LIMITS[limitKey].short})`, lines: picked.map((p) => rollRanges(p.text, 0.5)) }, tiers: picked.map((p) => `T${p.tier}`) };
}

// The best craft for every slot under each limit: { [slot]: [{ key, gear, tiers }] }
export async function prepareCrafts(spec, gd, catalog, keys = ['T2'], onProgress) {
  const crafts = {};
  let done = 0;
  for (let slot = 1; slot <= 10; slot++) {
    for (const key of keys) {
      const r = await bestCraftedRare(spec, gd, catalog, slot, key);
      if (r) (crafts[slot] ??= []).push({ key, gear: { rare: r.rare }, tiers: r.tiers });
      onProgress?.(++done, 10 * keys.length);
    }
  }
  return crafts;
}

// Whether a change fits a price cap per item (FE). A known price decides (yours, an Exchange price
// check, TITrack). Without one: T2 crafts (Flame Sand), common gems and Treasure Trove-level
// legendaries count as under the cap; endgame legendaries, Noble/Magnificent supports, pactspirits,
// top-tier crafts and trait levels count as over it until their price is known. A legendary whose
// organ alone (TITrack) costs more than the cap is over it too.
export function budgetCheck(c, maxFe, price = priceOf(c.item)) {
  if (!(maxFe > 0)) return { ok: true };
  if (c.craft) return c.craft === 'T2' ? { ok: true, assumed: 'T2 craft with Flame Sand' } : { ok: false, why: 'top-tier and Ultimate crafting costs far more' };
  if (c.kind === 'trait') return { ok: false, why: 'trait levels come from upgraded memories' };
  if (price?.fe != null) return price.fe <= maxFe ? { ok: true } : { ok: false, why: `${price.fe} FE (${price.source})` };
  if (c.kind === 'gear') {
    const organ = priceOf(`Organ: ${c.item}`);
    if (organ?.fe > maxFe) return { ok: false, why: `its organ alone is ${organ.fe} FE` };
    return c.trove ? { ok: true, assumed: 'Treasure Trove-level legendary, no price yet' } : { ok: false, why: 'no price for this legendary yet' };
  }
  if (c.kind === 'support' || c.kind === 'gem') {
    return /\((Noble|Magnificent)\)$/.test(c.item ?? '') ? { ok: false, why: 'no price for this Noble/Magnificent support yet' } : { ok: true, assumed: 'common gem, no price yet' };
  }
  // Rare and magic pactspirits drop all the time; legendary ones need a price
  if (c.kind === 'pactspirit' && c.rarity && c.rarity !== 'Legendary') return { ok: true, assumed: `${c.rarity.toLowerCase()} pactspirit, no price yet` };
  return { ok: false, why: 'no price yet' };
}

// Every priced piece of a build against a cap: gear, gems, pactspirits, Destinies
export function buildPrices(spec, catalog, maxFe) {
  const byName = new Map(catalog.legendaries.map((l) => [l.name, l]));
  const rows = [];
  const add = (where, c) => rows.push({ where, name: c.item, kind: c.kind, price: priceOf(c.item), ...budgetCheck(c, maxFe) });
  for (const s of catalog.slots) {
    const g = spec.gear?.[s.slot];
    if (g?.legendary) add(s.label, { kind: 'gear', item: g.legendary, trove: byName.get(g.legendary)?.trove });
    else if (g?.rare) add(s.label, { kind: 'gear', item: g.rare.name ?? `Crafted ${g.rare.type}`, craft: /T2/.test(g.rare.name ?? '') ? 'T2' : 'any' });
  }
  for (const group of [...(spec.skills?.active ?? []), ...(spec.skills?.passive ?? [])].filter(Boolean)) {
    add('Skill', { kind: 'gem', item: group.name });
    for (const sup of (group.supports ?? []).filter(Boolean)) add(`Support on ${group.name}`, { kind: 'support', item: sup.name });
  }
  for (const p of spec.pactspirits ?? []) add('Pactspirit', { kind: 'pactspirit', item: p.name, rarity: catalog.pactspirits.find((x) => x.name === p.name)?.rarity });
  for (const l of spec.extraLines ?? []) if (l.source?.startsWith('Destiny: ')) add('Destiny', { kind: 'destiny', item: l.source.slice(9) });
  return rows;
}

// How costly a change is, roughly, for the cheapest-first path. TITrack prices the gems; legendary
// gear isn't priced anywhere, so its drop level stands in (a Treasure Trove can drop the ones at 54
// or less; 82 means endgame maps only).
export const COST_TIERS = { cheap: 1, moderate: 3, expensive: 8 };
function costTier(c, price) {
  if (c.craft) return CRAFT_LIMITS[c.craft].cost;
  if (c.kind === 'gear') return c.trove ? 'cheap' : (c.dropLevel ?? 99) < 70 ? 'moderate' : 'expensive';
  if (c.kind === 'gem') return 'cheap';
  if (price?.fe != null) return price.fe < 150 ? 'cheap' : price.fe < 1500 ? 'moderate' : 'expensive';
  if (c.kind === 'support') return /\((Noble|Magnificent)\)$/.test(c.item ?? '') ? 'moderate' : 'cheap';
  return 'moderate';
}

function candidates(spec, gd, catalog, { troveOnly = false, crafts = {} } = {}) {
  const out = [];
  const add = (kind, label, apply, extra = {}) => out.push({ kind, label, apply, ...extra });
  const slotLabel = (slot) => catalog.slots.find((s) => s.slot === slot).label;
  // Gear: legendaries per slot, and the slot's best crafted rares
  for (let slot = 1; slot <= 10; slot++) {
    const current = spec.gear?.[slot]?.legendary ?? null;
    for (const l of catalog.legendaries) {
      if (!l.slots.includes(slot) || l.name === current) continue;
      if (troveOnly && !l.trove) continue;
      add('gear', `${l.name} in ${slotLabel(slot)}`, (s) => (s.gear = { ...s.gear, [slot]: { legendary: l.name, roll: 0.5, random: randomPicks(l) } }), { slot, item: l.name, trove: l.trove, dropLevel: l.dropLevel });
    }
    for (const c of crafts[slot] ?? []) {
      const lines = c.gear.rare.lines;
      if (JSON.stringify(spec.gear?.[slot]?.rare?.lines) === JSON.stringify(lines)) continue;
      add('gear', `Crafted ${c.gear.rare.type} (${CRAFT_LIMITS[c.key].short}) in ${slotLabel(slot)}`, (s) => (s.gear = { ...s.gear, [slot]: clone(c.gear) }), { slot, item: `crafted ${c.key}`, craft: c.key, rareLines: lines, tiers: c.tiers });
    }
  }
  // Gems: the main skill to level 20
  const main = spec.skills?.active?.[0];
  if (main?.name && (main.level ?? 20) < 20) add('gem', `${main.name} to level 20`, (s) => (s.skills.active[0].level = 20));
  // Support swaps on the main skill: every support the engine knows that fits a spell projectile
  const fits = (sup) => !sup.tags?.length || sup.tags.some((t) => ['Spell', 'Projectile', 'Lightning', 'Elemental'].includes(t)) || sup.tags.every((t) => !['Attack', 'Melee', 'Minion', 'Summon', 'Channeled', 'Terra', 'Sentry'].includes(t));
  const supportNames = new Set((main?.supports ?? []).map((x) => x?.name));
  for (let i = 0; i < 5; i++) {
    const was = main?.supports?.[i]?.name;
    for (const sup of catalog.skills.supports.filter(fits)) {
      if (supportNames.has(sup.name)) continue;
      add('support', `${sup.name} instead of ${was ?? 'an empty slot'}`, (s) => {
        s.skills.active[0].supports = [...(s.skills.active[0].supports ?? [])];
        s.skills.active[0].supports[i] = { name: sup.name, level: main.level ?? 20 };
      }, { item: sup.name });
    }
    for (const sp of catalog.skills.special.filter((x) => x.target === main?.name)) {
      if (supportNames.has(sp.name)) continue;
      add('support', `${sp.name} (rank 1) instead of ${was ?? 'an empty slot'}`, (s) => {
        s.skills.active[0].supports = [...(s.skills.active[0].supports ?? [])];
        s.skills.active[0].supports[i] = { name: sp.name, rank: 1, tier: 2, roll: 0.5 };
      }, { item: sp.name });
    }
  }
  // Pactspirits: each one at level 1 in a free slot (or the third); rare and magic ones too, which
  // a price cap lets through
  const pets = spec.pactspirits ?? [];
  for (const p of catalog.pactspirits) {
    if (pets.some((x) => x.name === p.name)) continue;
    add('pactspirit', `${p.name} (level 1)`, (s) => (s.pactspirits = [...pets.slice(0, 2), { name: p.name, level: 1 }]), { item: p.name, rarity: p.rarity ?? 'Legendary' });
  }
  // Pactspirit levels and hero trait levels
  pets.forEach((p, i) => {
    if ((p.level ?? 1) < 6) add('pactspirit', `${p.name} to level ${(p.level ?? 1) + 1}`, (s) => (s.pactspirits[i] = { ...p, level: (p.level ?? 1) + 1 }), { item: p.name, rarity: catalog.pactspirits.find((x) => x.name === p.name)?.rarity ?? 'Legendary' });
  });
  for (const [name, level] of Object.entries(spec.hero?.levels ?? {})) {
    if (name === 'Creative Genius' || level >= 5) continue;
    add('trait', `${name} to level ${level + 1}`, (s) => (s.hero.levels = { ...s.hero.levels, [name]: level + 1 }), { item: name });
  }
  // Intelligence Destinies on the Pact board (TITrack prices them): one more each time
  for (const [name, line, max] of DESTINIES) {
    const have = (spec.extraLines ?? []).filter((l) => l.source === `Destiny: ${name}`).length;
    if (have < max) add('destiny', `${name} on the Pact board (${line}, ${have + 1} of ${max})`, (s) => (s.extraLines = [...(s.extraLines ?? []), { source: `Destiny: ${name}`, text: line }]), { item: name });
  }
  return out;
}
// CoffeeBingTest's Pact board holds 2 Medium and 5 Micro Intelligence Fates (+28-29 and +12-14)
const DESTINIES = [
  ['Medium Fate: Intelligence', '+28 Intelligence', 3],
  ['Micro Fate: Intelligence', '+13 Intelligence', 6],
];

// Apply the change with this label to a spec (in place); false when the build no longer offers it
export function applyCandidate(spec, gd, catalog, label, crafts = {}) {
  const c = candidates(spec, gd, catalog, { crafts }).find((x) => x.label === label);
  if (!c) return false;
  c.apply(spec);
  return true;
}

// Each candidate (or only those whose label is in `only`) applied alone, with its DPS; with a price
// cap (maxFe), only the ones under it
async function evaluate(spec, gd, catalog, { troveOnly, kinds, only, crafts, maxFe, onProgress }) {
  const base = dpsOf(spec, gd, catalog);
  const list = candidates(spec, gd, catalog, { troveOnly, crafts }).filter((c) => (!kinds || kinds.includes(c.kind)) && (!only || only.has(c.label)) && budgetCheck(c, maxFe).ok);
  const results = [];
  for (const [i, c] of list.entries()) {
    const next = clone(spec);
    c.apply(next);
    const dps = dpsOf(next, gd, catalog);
    const { apply, ...rest } = c;
    const price = priceOf(c.item);
    results.push({ ...rest, dps, gainPct: base ? (dps / base - 1) * 100 : 0, price, cost: costTier(c, price), assumed: budgetCheck(c, maxFe, price).assumed ?? null });
    if (i % 10 === 9) {
      onProgress?.(i + 1, list.length);
      await new Promise((r) => setImmediate(r));
    }
  }
  return { base, results: results.sort((a, b) => b.dps - a.dps), evaluated: list.length };
}

// options: { troveOnly, craft: limits to craft rares under (['T2', 'any']), kinds, top, onProgress(done, total, stage) }
export async function rankUpgrades(spec, gd, catalog, { troveOnly = false, craft = ['T2', 'any'], maxFe = null, kinds = null, top = 40, onProgress } = {}) {
  const started = Date.now();
  const crafts = await prepareCrafts(spec, gd, catalog, craft, (d, t) => onProgress?.(d, t, 'crafting rares'));
  const { base, results, evaluated } = await evaluate(spec, gd, catalog, { troveOnly, kinds, crafts, maxFe, onProgress: (d, t) => onProgress?.(d, t, 'trying changes') });
  // The best few per slot or kind, so one slot's many legendaries don't crowd out the rest
  const perKey = new Map();
  const shown = results.filter((r) => {
    const key = r.kind === 'gear' ? `slot${r.slot}` : r.kind;
    const n = perKey.get(key) ?? 0;
    perKey.set(key, n + 1);
    return n < 4 && r.gainPct > 0.05;
  });
  return { base, evaluated, ms: Date.now() - started, upgrades: shown.slice(0, top), crafts };
}

// Cheapest-first path to a DPS target: at each step the change with the most DPS for its rough cost
// (log of the gain over its cost tier, COST_TIERS), applied, until the target is reached or nothing
// helps. After a full ranking only the previous top candidates are re-checked each step (a full
// re-rank every few steps), which keeps a path to a few minutes. Rares are crafted under `craft`.
const RECHECK = 60;
const FULL_EVERY = 4;
export async function pathToTarget(spec, gd, catalog, { target, troveOnly = false, craft = ['T2'], maxFe = null, maxSteps = 30, kinds = null, byCost = true, onProgress } = {}) {
  let current = clone(spec);
  const crafts = await prepareCrafts(current, gd, catalog, craft);
  const steps = [];
  let dps = dpsOf(current, gd, catalog);
  const start = dps;
  let shortlist = null;
  const score = (r, now) => (byCost ? Math.log(r.dps / now) / COST_TIERS[r.cost] : r.dps);
  for (let k = 0; k < maxSteps && dps < target; k++) {
    let full = !shortlist || k % FULL_EVERY === 0;
    let { results } = await evaluate(current, gd, catalog, { troveOnly, kinds, crafts, maxFe, only: full ? null : shortlist });
    let useful = results.filter((r) => r.dps > dps * 1.005);
    // The short list ran dry: look at everything again before giving up
    if (!useful.length && !full) {
      full = true;
      ({ results } = await evaluate(current, gd, catalog, { troveOnly, kinds, crafts, maxFe }));
      useful = results.filter((r) => r.dps > dps * 1.005);
    }
    if (!useful.length) break;
    useful.sort((a, b) => score(b, dps) - score(a, dps));
    const best = useful[0];
    if (full) shortlist = new Set(useful.slice(0, RECHECK).map((r) => r.label));
    shortlist.delete(best.label);
    candidates(current, gd, catalog, { troveOnly, crafts }).find((c) => c.label === best.label).apply(current);
    steps.push({ label: best.label, kind: best.kind, item: best.item ?? null, trove: best.trove ?? null, cost: best.cost, price: best.price, assumed: best.assumed ?? null, rareLines: best.rareLines ?? null, tiers: best.tiers ?? null, dps: best.dps, gainPct: (best.dps / dps - 1) * 100 });
    dps = best.dps;
    onProgress?.(k + 1, maxSteps);
  }
  return { start, end: dps, target, reached: dps >= target, craft, maxFe, steps, spec: current };
}
