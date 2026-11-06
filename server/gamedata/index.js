import fs from 'node:fs';
import path from 'node:path';

// Lookup tables that turn the log's numeric ids into names, text and stat modifiers.
// data/gamedata/<kind>.json is an object keyed by id, built by scripts/import-tlidb.js:
//   affixes, items (base ids), uniques, skills, talents, memories, slates, pactspirits, heroTraits
// <kind>.local.json holds hand-added entries the import can't produce (ids tlidb doesn't show) and
// fields it gets wrong (text tlidb still shows in Chinese); each entry's fields go over the
// imported entry's, and survive re-imports. Files starting with "_" hold metadata. Every lookup
// returns null when the table or id is missing, and the UI falls back to "#id".
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function loadGameData(dir, { manualFile } = {}) {
  const manual = loadGameManual(manualFile);
  const tables = new Map();
  let meta = null;
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    // Imported tables first, so hand-added entries land on top of them
    for (const file of files.sort((a, b) => a.endsWith('.local.json') - b.endsWith('.local.json'))) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (file === '_meta.json') meta = data;
      if (file.startsWith('_')) continue;
      const kind = path.basename(file, '.json').replace(/\.local$/, '');
      const table = tables.get(kind) ?? new Map();
      const local = file.endsWith('.local.json');
      for (const [id, entry] of Object.entries(data)) {
        if (id.startsWith('_')) continue;
        const imported = table.get(id);
        table.set(id, local && isRecord(imported) && isRecord(entry) ? { ...imported, ...entry } : entry);
      }
      tables.set(kind, table);
    }
  }

  const get = (kind, id) => tables.get(kind)?.get(String(id)) ?? null;

  // Pictures by name, indexed on first use: pactspirits (tlidb has no ids for them) and hero traits,
  // whose icons are listed on their hero's page ({ portrait, traits: { name: icon } })
  const byName = new Map();
  const namedIcons = (kind) => {
    if (!byName.has(kind)) {
      const rows = [...(tables.get(kind) ?? new Map()).values()];
      const pairs = kind === 'heroTraits' ? rows.flatMap((h) => Object.entries(h.traits ?? {})) : rows.filter((r) => r.icon).map((r) => [r.name, r.icon]);
      byName.set(kind, new Map(pairs));
    }
    return byName.get(kind);
  };

  return {
    dir,
    meta,
    get,
    // Every [id, entry] of a table (the sample build's pickers list them)
    all: (kind) => [...(tables.get(kind) ?? new Map())],
    name: (kind, id) => get(kind, id)?.name ?? null,
    // tlidb's picture (a CDN URL), null where tlidb has none yet
    icon: (kind, id) => get(kind, id)?.icon ?? null,
    iconByName: (kind, name) => (name ? (namedIcons(kind).get(name) ?? null) : null),
    // A hero's portrait: the hero page listing its level 1 trait
    heroPortrait: (traitName) => [...(tables.get('heroTraits')?.values() ?? [])].find((h) => h.traits?.[traitName])?.portrait ?? null,
    affixText(id, values) {
      const text = get('affixes', id)?.text;
      return text ? fillRolls(text, values) : (memoryBaseStat(id, values) ?? manualAffix(manual, id, values));
    },
    summary: () => ({ ...Object.fromEntries([...tables].map(([kind, rows]) => [kind, rows.size])), gameManual: manual.size }),
  };
}

// The game's own help manual (UE_game/Local/CommonCache/HelpManualV2AffixData, English JSON, cached
// by the game client) names affixes tlidb doesn't, e.g. hero memory random affixes. It lists one
// entry per affix family, 4021<NNN>00, with the top roll as the number: "+104% Spell Critical
// Strike Rating". The log's id ends in the tier instead of 00 and DynArgs holds the actual roll.
export function loadGameManual(file) {
  const byId = new Map();
  if (!file || !fs.existsSync(file)) return byId;
  try {
    for (const group of Object.values(JSON.parse(fs.readFileSync(file, 'utf8')))) {
      const data = group?.AffixsData ?? [];
      for (const a of Array.isArray(data) ? data : Object.values(data)) {
        if (a?.AffixId != null && a.AffixDesc) byId.set(String(a.AffixId), a.AffixDesc.replace(/<[^>]+>/g, '').replace(/\\n/g, '\n'));
      }
    }
  } catch {
    // An unreadable cache just means no fallback names
  }
  return byId;
}

function manualAffix(manual, id, values) {
  const key = String(id);
  const family = /^4021\d{5}$/.test(key) ? `${key.slice(0, -2)}00` : null;
  const text = manual.get(key) ?? (family && manual.get(family));
  if (!text) return null;
  if (new RegExp(RANGE.source).test(text)) return fillRolls(text, values);
  // A single top-roll number: the first number in the text is the rolled value
  return values.length && typeof values[0] === 'number' ? text.replace(/\d+(?:\.\d+)?/, formatRoll(values[0])) : text;
}

// tlidb shows rollable values as ranges: "+(369–525) Max Energy Shield". The log's DynArgs are
// the rolled values in the same order, so each range is replaced by its roll. A range repeated on
// a later line ("+(35–48)% Skill Area / +(35–48)% Minion Skill Area") shares one roll.
const RANGE = /\((-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)\)/g;

export function fillRolls(text, values) {
  let i = 0;
  const rolled = new Map();
  return text.replace(RANGE, (range) => {
    if (rolled.has(range)) return rolled.get(range);
    if (i >= values.length) return range;
    const roll = formatRoll(values[i++]);
    rolled.set(range, roll);
    return roll;
  });
}

function formatRoll(v) {
  if (typeof v !== 'number') return '?';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

// Hero memory base stats aren't on tlidb. Their ids are 4031<NN><version>, NN counting through
// the Origin, Discipline and Progress base stat lists in the order Torchlight of Building has
// them; the value is the roll. Checked against CoffeeDeadProb: Origin 403102241 with 33 is the
// +33 Dexterity the in-game sheet shows (213 vs 180 without it).
const MEMORY_BASE_STATS = [
  '+# Strength', '+# Dexterity', '+# Intelligence', '+#% damage', '+#% Minion Damage', // Origin
  '+# Max Life', '+# Max Mana', '+# Armor', '+# Evasion', '+# Max Energy Shield', // Discipline
  '+#% Attack Speed', '+#% Cast Speed', '+#% Movement Speed', '+#% Minion Attack Speed', '+#% Minion Cast Speed', // Progress
];

function memoryBaseStat(id, values) {
  const m = /^4031(\d\d)\d{3}$/.exec(String(id));
  const template = m && MEMORY_BASE_STATS[Number(m[1]) - 1];
  return template && values.length ? template.replace('#', formatRoll(values[0])) : null;
}
