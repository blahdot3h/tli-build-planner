// Hover text for the skills and supports shown in the UI, from tlidb's skill cards
// (data/gamedata/skillData.json): the card's lines at the gem's level, its cast time / mana / added
// damage effectiveness, and a Noble or Magnificent support's rolled line.
import { SKILL_DATA } from '../engine/bridge.js';
import { specialSupportRolledText } from '../engine/ss14-supports.js';

const byName = (() => {
  let map = null;
  return (name) => {
    map ??= new Map(Object.values(SKILL_DATA ?? {}).map((c) => [c.name, c]));
    return map.get(name) ?? null;
  };
})();

function header(card) {
  const h = card.header ?? {};
  const bits = [];
  if (h.castTime) bits.push(`Cast time ${h.castTime} s`);
  if (h.cooldown) bits.push(`Cooldown ${h.cooldown} s`);
  if (h.manaCost) bits.push(`Mana ${h.manaCost}${h.manaCostIsPct ? '%' : ''}`);
  if (h.addedDmgEffPct) bits.push(`Added damage ${h.addedDmgEffPct}%`);
  if (h.manaCostMultiplier) bits.push(`Mana multiplier ${h.manaCostMultiplier}%`);
  return bits.join(' · ');
}

// The card's description at a level: its level table's text column when it has one, else the
// card's lines (which tlidb shows at level 20)
function linesAt(card, level) {
  const cols = (card.progression?.columns ?? []).map((c) => String(c).toLowerCase());
  const at = cols.indexOf('descript');
  const row = at >= 0 ? card.progression.rows.find((r) => Number(r[0]) === Math.min(20, Number(level) || 20)) : null;
  if (row?.[at]) return String(row[at]).split('\n');
  return [...(card.simple ?? [])];
}

export function skillTip(skill) {
  if (!skill?.name) return null;
  const card = byName(skill.name);
  if (!card) return skill.name;
  const lines = [`${card.name}${skill.level != null ? ` (Lv ${skill.level})` : ''}`, header(card), ...linesAt(card, skill.level)];
  // A Noble/Magnificent support's rolled line: the log's text, else its value on the card's line
  for (const a of skill.affixes ?? []) {
    const text = a.text ?? (a.values?.length ? specialSupportRolledText(SKILL_DATA, card.name, a.values[0]) : null);
    if (text) lines.push(`Rolled: ${text}`);
  }
  return lines.filter(Boolean).join('\n');
}

// The character's skill groups with a tip on every skill and support
export function withSkillTips(skills) {
  const tip = (s) => (s ? { ...s, tip: skillTip(s) } : s);
  const groups = (list) => (list ?? []).map((g) => ({ ...g, skill: tip(g.skill), supports: (g.supports ?? []).map(tip) }));
  return { ...skills, active: groups(skills?.active), passive: groups(skills?.passive) };
}
