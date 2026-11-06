// Rebuilds everything the planner knows about hero traits from tlidb's hero pages, which
// scripts/import-tlidb.js caches in data/tlidb-cache/<slug>.html:
//   node scripts/import-hero-traits.js
//   1. data/gamedata/heroTraits.local.json: every trait id the game log can list (the older heroes'
//      pointOverView.activeId, the tree heroes' treeActivatedNodes node ids; tlidb's data-id /
//      data-node-id) -> { name, hero, level }, so the log's ids get names.
//   2. vendor/torchlight-of-building/src/data/hero-trait/hero-traits.ts: the engine's hero trait
//      table with tlidb's current names, levels and texts (five levels merged as (1/2/3/4/5)), so
//      the trait models in .../tli/hero/hero-trait-mods.ts are keyed by the game's names. Run
//      `node scripts/build-engine.js --force` afterwards.
// Tide Whisper Selena: Dance of the Deep (#2) lives in server/sim/selena.js, so its ids are kept but
// the engine table doesn't list it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data', 'tlidb-cache');
const LOCAL = path.join(ROOT, 'data', 'gamedata', 'heroTraits.local.json');
const ENGINE = path.join(ROOT, 'vendor', 'torchlight-of-building', 'src', 'data', 'hero-trait', 'hero-traits.ts');

// tlidb page slug -> the engine's hero name, in the engine's order
const HEROES = {
  Anger: 'Berserker Rehan: Anger (#1)',
  Seething_Silhouette: 'Berserker Rehan: Seething Silhouette (#2)',
  Ranger_of_Glory: 'Divineshot Carino: Ranger of Glory (#1)',
  Lethal_Flash: 'Divineshot Carino: Lethal Flash (#2)',
  Zealot_of_War: 'Divineshot Carino: Zealot of War (#3)',
  Wind_Stalker: 'Cateye Erika: Wind Stalker (#1)',
  Lightning_Shadow: 'Cateye Erika: Lightning Shadow (#2)',
  Vendettas_Sting: "Cateye Erika: Vendetta's Sting (#3)",
  Blast_Nova: 'Escapist Bing: Blast Nova (#1)',
  Creative_Genius: 'Escapist Bing: Creative Genius (#2)',
  Flame_of_Pleasure: 'Frostfire Gemma: Flame of Pleasure (#1)',
  Frostbitten_Heart: 'Frostfire Gemma: Frostbitten Heart (#2)',
  'Ice-Fire_Fusion': 'Frostfire Gemma: Ice-Fire Fusion (#3)',
  Wisdom_of_The_Gods: 'Oracle Thea: Wisdom of The Gods (#1)',
  Incarnation_of_the_Gods: 'Oracle Thea: Incarnation of The Gods (#2)',
  Blasphemer: 'Oracle Thea: Blasphemer (#3)',
  Spacetime_Illusion: 'Spacetime Witness Youga: Spacetime Illusion (#1)',
  Spacetime_Elapse: 'Spacetime Witness Youga: Spacetime Elapse (#2)',
  The_Ultimate_One: 'Spacetime Witness Youga: The Ultimate One (#3)',
  Order_Calling: 'Commander Moto: Order Calling (#1)',
  Charge_Calling: 'Commander Moto: Charge Calling (#2)',
  High_Court_Chariot: 'Lightbringer Rosa: High Court Chariot (#1)',
  Unsullied_Blade: 'Lightbringer Rosa: Unsullied Blade (#2)',
  Growing_Breeze: 'The Forsaken Iris: Growing Breeze (#1)',
  Vigilant_Breeze: 'The Forsaken Iris: Vigilant Breeze (#2)',
  Sing_with_the_Tide: 'Tide Whisper Selena: Sing with the Tide (#1)',
  Dance_of_the_Deep: 'Tide Whisper Selena: Dance of the Deep (#2)',
  Licorice_Note: 'Scent Weaver Sage: Licorice Note (#1)',
};
const PLANNER_ONLY = new Set(['Dance_of_the_Deep']);

const NUM = /[-+]?\d+(?:\.\d+)?/g;
const clean = (s) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

// The traits on a hero page: name, id (when tagged), required level and the text of each level
function pageTraits(html) {
  const traits = [];
  const re = /<div class="fw-bold"(?: data-(?:node-)?id="(\d+)")?>([^<]+)<\/div>\s*Require lv (\d+)([\s\S]*?)(?=<div class="fw-bold"(?: data-(?:node-)?id="\d+")?>[^<]+<\/div>\s*Require lv|<\/section>|<footer|$)/g;
  for (const m of html.matchAll(re)) {
    const [, id, name, lv, rawBody] = m;
    const body = rawBody.split(/Skill Shop/)[0];
    const tiers = [...body.matchAll(/<div data-tier-content="(\d+)">([\s\S]*?)(?=<div data-tier-content=|$)/g)].map((t) => clean(t[2]));
    traits.push({ id: id ?? null, name: name.trim(), level: Number(lv), levels: tiers.length ? tiers : [clean(body)] });
  }
  return traits;
}

// One text for all levels: numbers that change read (1/2/3/4/5); lines only the last level has are
// listed as "Level 5 adds"
function mergeLevels(levels) {
  const sets = levels.map((l) => l.split('\n').map((s) => s.trim()).filter((s) => s && !/^Level \d$/.test(s)));
  if (sets.length < 2) return sets[0].join('\n');
  const base = sets[0];
  const shape = (s) => s.replace(NUM, '#');
  const merged = base.map((line, i) => {
    const variants = sets.map((ls) => ls[i] ?? '');
    if (!variants.every((v) => shape(v) === shape(line))) return `${line} (level 5: ${sets.at(-1)[i] ?? '-'})`;
    const nums = variants.map((v) => v.match(NUM) ?? []);
    let k = 0;
    return line.replace(NUM, () => {
      const vals = nums.map((n) => n[k]);
      k++;
      return new Set(vals).size > 1 ? `(${vals.join('/')})` : vals[0];
    });
  });
  const extra = sets.at(-1).slice(base.length).filter((l) => !/^Level \d/.test(l));
  return merged.join('\n') + (extra.length ? `\nLevel 5 adds: ${extra.join(' / ')}` : '');
}

const ids = {};
const engine = [];
const ultimateTraits = {};
for (const [slug, hero] of Object.entries(HEROES)) {
  const file = path.join(CACHE, `${slug}.html`);
  if (!fs.existsSync(file)) {
    console.log(`no cached page for ${slug} (run scripts/import-tlidb.js)`);
    continue;
  }
  const traits = pageTraits(fs.readFileSync(file, 'utf8'));
  for (const t of traits) {
    if (t.id) ids[t.id] = { name: t.name, hero, level: t.level };
    if (slug === 'The_Ultimate_One') ultimateTraits[t.name] = null;
  }
  if (PLANNER_ONLY.has(slug)) continue;
  for (const t of traits) engine.push({ hero, name: t.name, level: t.level, affix: mergeLevels(t.levels) });
}

// 1. The id table (hand-added ids not on the pages are kept)
const previous = fs.existsSync(LOCAL) ? JSON.parse(fs.readFileSync(LOCAL, 'utf8')) : {};
for (const [id, entry] of Object.entries(previous)) if (/^\d+$/.test(id) && !ids[id]) ids[id] = entry;
const local = {
  _comment: 'Hero trait ids the game log lists (treeActivatedNodes node ids for tree heroes, pointOverView.activeId for the others), from tlidb hero pages\' data-id / data-node-id. Generated by scripts/import-hero-traits.js; Blasphemer and Spacetime Illusion pages carry no ids. The_Ultimate_One names that hero\'s traits so its portrait resolves.',
  ...Object.fromEntries(Object.entries(ids).sort((a, b) => Number(a[0]) - Number(b[0]))),
  ...(Object.keys(ultimateTraits).length ? { The_Ultimate_One: { traits: ultimateTraits } } : {}),
};
fs.writeFileSync(LOCAL, JSON.stringify(local, null, 2) + '\n');

// 2. The engine's table
const body = engine.map((e) => `  {\n    hero: ${JSON.stringify(e.hero)},\n    name: ${JSON.stringify(e.name)},\n    level: ${e.level},\n    affix:\n      ${JSON.stringify(e.affix)},\n  },`).join('\n');
const header = `// Hero trait data. Originally machine-generated by Torchlight of Building; regenerated by TLI\n// Build Planner's scripts/import-hero-traits.js from tlidb's hero pages (SS14) so names, levels\n// and texts match the game's current traits, with Spacetime Witness Youga: The Ultimate One (#3)\n// added. Values in a trait's text read (level 1/2/3/4/5). Rebuild the bundle after regenerating.\nimport type { BaseHeroTrait } from "./types";\n\nexport const HeroTraits = [\n`;
fs.writeFileSync(ENGINE, `${header}${body}\n] as const satisfies readonly BaseHeroTrait[];\n`);
console.log(`heroTraits.local.json: ${Object.keys(ids).length} trait ids; hero-traits.ts: ${engine.length} traits over ${new Set(engine.map((e) => e.hero)).size} heroes`);
