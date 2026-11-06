// Supports as they are this season (SS14), from tlidb's cards (data/gamedata/skillData.json), for the
// vendored engine whose support data stopped at SS12-SS13:
//   - a support the engine has keeps its wording, but its per-level numbers come from tlidb when the
//     card's one scaling line is the same stat (SS14 cut Psychic Burst from 35.5% to 30% at level 20,
//     Spell Concentration from 32% to 30%, ...)
//   - supports new in SS14 join the engine's list, as the steady-state lines its parser knows (the
//     skill cast over and over, the enemy always under the support's debuff, the player's rule)
//   - Noble and Magnificent supports the engine lacks (Splitting Lightning Bolt's) join its lists with
//     no fixed lines, so their rolled line and rank bonus count
const STOP = new Set(['the', 'for', 'supported', 'skill', 'skills', 'by', 'when', 'is', 'of', 'to', 'with', 'and', 'a', 'an', 'its', 'are', 'that']);
const words = (s) =>
  new Set(
    String(s)
      .toLowerCase()
      .replace(/\{value\}|[+-]?\d+(?:\.\d+)?%?/g, ' ')
      .split(/[^a-z]+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
const similar = (a, b) => {
  const x = words(a);
  const y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, new Set([...x, ...y]).size);
};
const fmt = (n) => String(Math.round(n * 100) / 100);

// tlidb's level table for a support: the scaling column's value at each level 1-40, or null
function levelValues(card) {
  const p = card?.progression;
  if (!p || p.columns.length !== 3 || p.rows.length < 40) return null;
  const values = p.rows.slice(0, 40).map((r) => Number(String(r[1]).replace('%', '')));
  return values.every(Number.isFinite) ? values : null;
}

const cardsByName = (skillData) => new Map(Object.values(skillData ?? {}).map((c) => [c.name, c]));

export function syncSupportLevels(tob, skillData) {
  const cards = cardsByName(skillData);
  const synced = [];
  for (const s of tob.SupportSkills) {
    const card = cards.get(s.name);
    if (!card || card.type !== 'Support' || s.templates?.length !== 1) continue;
    const values = levelValues(card);
    if (!values) continue;
    const tlidbLine = card.progression.columns[1];
    if (similar(s.templates[0].template, tlidbLine) < 0.6) continue;
    const before = s.templates[0].levelValues[19];
    s.templates[0].levelValues = values;
    if (before !== values[19]) synced.push(`${s.name}: ${before} -> ${values[19]} at level 20`);
  }
  return synced;
}

// New SS14 supports, as lines the engine's parser knows at each level (v = tlidb's scaling value)
const NEW_SUPPORTS = {
  // Turmoil on the enemy: +17% additional damage taken from the supported skill, +v% Turmoil Effect per
  // Spell Burst stack consumed recently, up to 6 (a Spell Burst build is always at 6)
  'Turmoil Burst': { targets: [{ tags: ['Spell'] }], lines: (v) => [`+${fmt(17 * (1 + (6 * v) / 100))}% additional damage for the supported skill`] },
  // It inflicts the Enhanced Mark itself (+15% additional Projectile Damage taken), so the target is always marked
  'Target Projection': { targets: [{ tags: ['Projectile'] }], lines: (v) => [`+${fmt(v)}% additional damage for the supported skill`, '+15% additional damage for the supported skill'] },
  // The +30% Infiltration Effect taken isn't counted (it only matters with an Infiltration on the enemy)
  'Weakness Infiltration': { targets: [{ tags: ['Attack'] }, { tags: ['Spell'] }], lines: (v) => [`+${fmt(v)}% additional damage for the supported skill`] },
  // Needs at least 2 Empower skills on you (Spell Burst builds keep Aim and Timid up)
  'Empowered Insight': { targets: [{ tags: ['Spell'] }], lines: (v) => [`+${fmt(v)}% additional damage for the supported skill`] },
};

export function registerNewSupports(tob, skillData) {
  const cards = cardsByName(skillData);
  const added = [];
  for (const [name, def] of Object.entries(NEW_SUPPORTS)) {
    const card = cards.get(name);
    const values = levelValues(card);
    if (!card || !values || tob.SupportSkills.some((s) => s.name === name)) continue;
    const perLevel = values.map((v) => def.lines(v));
    tob.SupportSkills.push({
      type: 'Support',
      name,
      tags: (card.tags ?? []).filter((t) => t !== 'Support'),
      description: [card.details.join('\n')],
      supportTargets: def.targets,
      cannotSupportTargets: [],
      manaCostMultiplierPct: card.header?.manaCostMultiplier ?? 100,
      // One template per line, each with its value per level
      templates: perLevel[0].map((_, i) => ({ template: perLevel[19][i].replace(/[+-]?\d+(?:\.\d+)?%/, '+{value}%'), levelValues: perLevel.map((lines) => Number(/[+-]?(\d+(?:\.\d+)?)%/.exec(lines[i])[1])) })),
    });
    added.push(name);
  }
  return added;
}

export function registerSpecialSupports(tob, skillData) {
  const added = [];
  for (const card of Object.values(skillData ?? {})) {
    const list = card.type === 'Support (Magnificent)' ? tob.MagnificentSupportSkills : card.type === 'Support (Noble)' ? tob.NobleSupportSkills : null;
    if (!list || list.some((s) => s.name === card.name)) continue;
    list.push({
      type: card.type,
      name: card.name,
      tags: (card.tags ?? []).filter((t) => t !== 'Support'),
      // One part only: the engine then counts the rolled line and the rank bonus, no fixed lines
      description: [[...(card.simple ?? []), ...(card.details ?? [])].join('\n')],
      supportTarget: /^(.+?):/.exec(card.name)?.[1] ?? null,
      manaCostMultiplierPct: card.header?.manaCostMultiplier ?? 110,
    });
    added.push(card.name);
  }
  return added;
}

// A Noble or Magnificent support's rolled line from the value the log has for it, when the log has
// no text for that affix yet (SS14's new supports): the card's tier line with its range, and the
// sign in front of it, replaced by the value. "+(22–24)% additional damage..." with 27 gives "+27%
// additional damage..."; "(-26.5–-25.5)%..." with -22.6 gives "-22.6%..."
const ROLL_RANGE = /[+-]?\(([+-]?\d+(?:\.\d+)?)\s*[–—-]\s*([+-]?\d+(?:\.\d+)?)\)/;
export function specialSupportRolledText(skillData, name, value) {
  const v = Number(value);
  if (value == null || !Number.isFinite(v)) return null;
  const line = specialSupportLine(skillData, name, 1);
  if (!line || !ROLL_RANGE.test(line)) return null;
  return line.replace(ROLL_RANGE, v >= 0 ? `+${v}` : `${v}`);
}

// A Noble or Magnificent support's rollable line at a tier (0 is the best), from its card's tier table
export function specialSupportLine(skillData, name, tier = 1) {
  const card = cardsByName(skillData).get(name);
  const rows = card?.tiers?.rows ?? [];
  const row = rows.find((r) => Number(r[0]) === tier) ?? rows.at(-1);
  return row ? String(row[1]).split('\n')[0] : (card?.details?.[0] ?? null);
}
