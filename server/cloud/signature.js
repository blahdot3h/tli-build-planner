// Fingerprints for the public price database (cloud/): what makes one copy of an item worth
// more than another, with nothing about the player in it.
//
// - A legendary: its id plus each rolled line's roll bucket (0 = bottom fifth of the range, 4 = top
//   fifth), so "Law of Greed with top-rolled damage" prices apart from a floor roll. Its family is
//   the legendary alone; the family price is what any copy goes for.
// - A rare (crafted) piece: its base type plus its key lines: Ultimate-library affixes and T0 / T0+
//   lines, each as the affix family (the id without its tier digits) and tier. A rare with one or
//   two Ultimate lines is what people pay for; the rest of its lines don't move the price much.
// - Anything else (gems, currency, memories): its base id, as ETor and TITrack price them.
import { tierFromId } from '../game/tiers.js';

const RANGE = /\((-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)\)/g;
const BUCKETS = 5;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tierOrder = (t) => (t === '0+' ? -1 : Number(t));

// Where each rolled value sits in its range, 0..1 (a line "+(75–85) Crit Rating" rolled 80 is 0.5).
// A range repeated later in the text shares one roll, as the game's text does.
export function rollFractions(text, values) {
  if (!text || !values?.length) return [];
  const out = [];
  const seen = new Map();
  let i = 0;
  for (const m of text.matchAll(RANGE)) {
    const key = m[0];
    if (seen.has(key)) continue;
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    const v = values[i++];
    if (typeof v !== 'number') break;
    const f = hi === lo ? 1 : (v - Math.min(lo, hi)) / Math.abs(hi - lo);
    const frac = Math.max(0, Math.min(1, f));
    seen.set(key, frac);
    out.push(frac);
  }
  return out;
}

export const rollBucket = (fractions) => (fractions.length ? Math.min(BUCKETS - 1, Math.floor((fractions.reduce((a, b) => a + b, 0) / fractions.length) * BUCKETS)) : null);

// The craft library ("Basic Affix", "Advanced Affix", "Ultimate Affix") whose row a rolled line
// came from, by matching the text against the type's craft table; null when no row matches
export function affixLibrary(gd, type, part, text) {
  if (!type || !text) return null;
  const rows = gd.get('craftTiers', type);
  if (!rows) return null;
  let found = null;
  for (const r of rows) {
    if (r.part !== part) continue;
    const pattern = `^${escapeRe(r.text).replace(/\\\((-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)\\\)/g, '(-?\\d+(?:\\.\\d+)?)')}$`;
    if (!new RegExp(pattern).test(text)) continue;
    if (!found || tierOrder(r.tier) < tierOrder(found.tier)) found = r;
  }
  return found?.library ?? null;
}

// The affix family of a crafted line: a 9-digit id less its tier digits ("1303200" for 130320001)
export const affixFamily = (id) => (/^\d{9}$/.test(String(id)) ? String(id).slice(0, -2) : String(id));

// item: describeItem()'s output ({ baseId, type, uniqueId, affixes: [{ kind, id, values, text, tier }] })
// -> { kind, signature, family, uniqueId, baseId, type, mods }
export function itemSignature(item, gd) {
  const baseId = String(item.baseId ?? '');
  if (item.uniqueId) {
    const mods = [];
    for (const a of item.affixes ?? []) {
      if (!['prefix', 'suffix', 'implicit', 'awakened'].includes(a.kind) && !(a.kind === 'base' && a.values?.length)) continue;
      const text = gd.get('affixes', a.id)?.text ?? a.text;
      const fractions = rollFractions(text, a.values ?? []);
      if (!fractions.length) continue;
      mods.push({ id: String(a.id), roll: rollBucket(fractions), rollPct: Math.round((fractions.reduce((x, y) => x + y, 0) / fractions.length) * 100) });
    }
    mods.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const family = `L${item.uniqueId}`;
    return { kind: 'legendary', family, signature: mods.length ? `${family}|${mods.map((m) => `${m.id}:${m.roll}`).join(',')}` : family, uniqueId: String(item.uniqueId), baseId, type: item.type ?? null, mods };
  }
  const key = [];
  for (const a of item.affixes ?? []) {
    if (!['prefix', 'suffix'].includes(a.kind)) continue;
    const tier = a.tier ?? tierFromId(a.id);
    const library = affixLibrary(gd, item.type, a.kind, a.text);
    const top = tier === '0' || tier === '0+';
    if (library !== 'Ultimate Affix' && !top) continue;
    key.push({ id: String(a.id), family: affixFamily(a.id), tier: tier ?? null, library: library ?? null, part: a.kind });
  }
  if (key.length) {
    key.sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0));
    const family = `R${baseId}`;
    return { kind: 'rare', family, signature: `${family}|${key.map((m) => `${m.family}T${m.tier ?? '?'}`).join(',')}`, uniqueId: null, baseId, type: item.type ?? null, mods: key };
  }
  return { kind: 'base', family: `B${baseId}`, signature: `B${baseId}`, uniqueId: null, baseId, type: item.type ?? null, mods: [] };
}

// A build as the public build database keeps it: no player id or name, gear by name and
// signature, the hero and main skill, the simulated DPS. character is the planner's view
// (server/game/character.js buildCharacter + calc).
export function buildSummary(character, gd, { seasonId = null } = {}) {
  if (!character?.player) return null;
  const calc = character.calc ?? {};
  const gear = (character.equipment ?? [])
    .filter((e) => e.item)
    .map((e) => {
      const sig = itemSignature(e.item, gd);
      return { slot: e.label, name: e.item.uniqueName ?? e.item.name ?? null, uniqueId: e.item.uniqueId ?? null, baseId: e.item.baseId ?? null, signature: sig.signature, family: sig.family };
    });
  const skillName = (s) => s?.name ?? null;
  const skills = (character.skills?.active ?? character.skills ?? [])
    .filter((g) => g?.skill)
    .map((g) => ({ skill: skillName(g.skill), supports: (g.supports ?? []).map(skillName).filter(Boolean) }));
  return {
    seasonId: seasonId ?? character.player.seasonId ?? null,
    level: character.player.level ?? null,
    hero: calc.choices?.hero ?? calc.choices?.heroInferred ?? character.hero?.name ?? null,
    heroTraits: (character.heroTraits ?? []).map((t) => t.name).filter(Boolean),
    mainSkill: calc.mainSkill ?? null,
    dps: calc.sim?.supported ? calc.sim.avgDps : (calc.dps?.combat?.total ?? null),
    dpsKind: calc.sim?.supported ? 'simulated' : 'formula',
    gear,
    skills,
    pactspirits: (character.pactspirits ?? []).map((p) => p.name).filter(Boolean),
    plannerVersion: process.env.npm_package_version ?? null,
  };
}
