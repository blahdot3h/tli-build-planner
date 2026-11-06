// Affix tiers (T0 best) the way the game shows them. A crafted line's tier is in its affix id: the
// last two digits (130320001 "+3 Spell Skill Level" on a wand is T1, 140320900 "Adds 87 - 107
// Physical Damage to Spells" is T0). Checked against the craft tier table's ranges on the 810
// lines of every rare the planner had seen (2026-11-02): they agree wherever the table is
// unambiguous (adjacent tiers share boundary values, "+11% Erosion Resistance" is the top of T4
// and the bottom of T3, so the table alone can't always tell). The id decides; the table tells
// T0+ apart (the id can't) and serves lines with no id (sample builds). Memory lines (4021NNNTT)
// carry theirs the same way. Legendary items' lines are fixed and have no tier.
const RANGE = /\((-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)\)/g;
const MEMORY_LINE = /^4021\d{5}$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The tier whose ranges the rolled text falls in, from one gear type's craft table ('0+', '0', '1', …).
// Where two tiers meet on a value ("+3 Spell Skill Level" is T0's low end and all of T1), the worse
// tier is taken: that's what such an item usually is, and what a sample build's T2 craft means.
const tierOrder = (t) => (t === '0+' ? -1 : Number(t));
export function tierFromTable(gd, type, part, text) {
  if (!type || !text) return null;
  const rows = gd.get('craftTiers', type);
  if (!rows) return null;
  let found = null;
  for (const r of rows) {
    if (r.part !== part) continue;
    const ranges = [...r.text.matchAll(RANGE)].map((m) => [Number(m[1]), Number(m[2])]);
    // The row's text with each escaped "(min–max)" turned into a number capture
    const pattern = `^${escapeRe(r.text).replace(/\\\((-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)\\\)/g, '(-?\\d+(?:\\.\\d+)?)')}$`;
    const m = new RegExp(pattern).exec(text);
    if (!m) continue;
    const nums = m.slice(1).map(Number);
    if (nums.every((n, i) => n >= Math.min(...ranges[i]) && n <= Math.max(...ranges[i])) && (found == null || tierOrder(r.tier) > tierOrder(found))) found = r.tier;
  }
  return found;
}

// The tier a crafted gear line's or a memory line's id ends in (null when the id isn't one of those)
export function tierFromId(id) {
  const s = String(id);
  if (!/^\d{9}$/.test(s) && !MEMORY_LINE.test(s)) return null;
  const tier = Number(s.slice(-2));
  return tier <= 9 ? String(tier) : null;
}

// item: { type, legendary }; affix: { id, kind, text }. Crafted prefixes and suffixes and memory
// lines have tiers; base stats, implicits, legendary lines and enchants don't.
export function affixTier(gd, item, affix) {
  if (!item || item.legendary || !affix) return null;
  if (MEMORY_LINE.test(String(affix.id))) return affix.kind === 'base' ? null : tierFromId(affix.id);
  if (!['prefix', 'suffix'].includes(affix.kind)) return null;
  const fromId = tierFromId(affix.id);
  if (fromId == null) return tierFromTable(gd, item.type, affix.kind, affix.text);
  if (fromId === '0' && tierFromTable(gd, item.type, affix.kind, affix.text) === '0+') return '0+';
  return fromId;
}
