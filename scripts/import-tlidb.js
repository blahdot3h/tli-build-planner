// Builds data/gamedata/*.json from tlidb.com, the community database generated from the game's
// own tables. tlidb pages carry the same internal ids the game writes to UE_game.log:
//   - every stat line is <span data-modifier-id="ID">text with (min–max) ranges</span>
//   - skill / base item pages show "id: N"; legendary pages show "id: N" plus a hidden "base: N"
//   - the Talent page tags each talent node with data-id="ID" (same ids as the log's geniusId)
// Skill pages also give skillData.json: the current-season card's header, text and hidden per-level
// values, plus the Progression tables, keyed by the same game id as skills.json.
//
//   node scripts/import-tlidb.js            use cached pages where present
//   node scripts/import-tlidb.js --refresh  re-download everything (new season / patch)
//
// Pages are cached in data/tlidb-cache so a re-run only parses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data', 'tlidb-cache');
const OUT = path.join(ROOT, 'data', 'gamedata');
const BASE_URL = 'https://tlidb.com/en/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 tli-build-planner';
const CONCURRENCY = 4;
const DELAY_MS = 250;
const REFRESH = process.argv.includes('--refresh');

// Gear categories as tlidb's search index labels them
const GEAR_CATEGORIES = [
  'Claw', 'Dagger', 'Cane', 'Rod', 'Wand', 'Scepter', 'Cudgel', 'Pistol',
  'One-Handed Sword', 'One-Handed Hammer', 'One-Handed Axe',
  'Two-Handed Sword', 'Two-Handed Hammer', 'Two-Handed Axe', 'Tin Staff', 'Bow', 'Crossbow', 'Musket', 'Fire Cannon',
  'STR Helmet', 'DEX Helmet', 'INT Helmet', 'STR Chest Armor', 'DEX Chest Armor', 'INT Chest Armor',
  'STR Gloves', 'DEX Gloves', 'INT Gloves', 'STR Boots', 'DEX Boots', 'INT Boots',
  'STR Shield', 'DEX Shield', 'INT Shield', 'Belt', 'Necklace', 'Ring', 'Spirit Ring', 'Vorax Gear',
];
// Destiny: the Fates installed on the Pact board ("Micro Fate: Intelligence"); Prism: talent prisms
const ENTITY_CATEGORIES = ['Skill', 'Legendary', 'Hero Memories', 'Fluorescent Memory', 'Divinity Slate', 'Pactspirit', 'Hero Trait', 'Destiny', 'Prism', ...GEAR_CATEGORIES];
// Skill listing pages (tlidb's Skill menu) and the type they give each skill they list. The names
// follow the vendored engine's SkillType (vendor/.../src/data/skill/types.ts), which has no
// Triggered or Modularization type. Triggered_Skill is in the menu but 404s on tlidb (Oct 2026).
const SKILL_LISTINGS = {
  Active_Skill: 'Active',
  Support_Skill: 'Support',
  Passive_Skill: 'Passive',
  Triggered_Skill: 'Triggered',
  Activation_Medium_Skill: 'Activation Medium',
  Noble_Support_Skill: 'Support (Noble)',
  Magnificent_Support_Skill: 'Support (Magnificent)',
  Modularization_Skill: 'Modularization',
  // SS14: skills only followers (Tartarus prisoners) use
  Tartarus_Skill: 'Tartarus',
  Origin_Tartarus_Skill: 'Origin Tartarus',
};
// Listing pages: they hold most affix text (crafting, corrosion, every gear type), the talent nodes
// and the skill types
const LISTING_PAGES = ['Craft', 'Corrosion', 'Legendary_Gear', 'Talent', 'Divinity_Slate', 'Hero', 'Pactspirit', ...Object.keys(SKILL_LISTINGS)];

// Pictures for entries the import kept from earlier runs but didn't parse this time
const PICTURES_FROM_PAGE = {
  uniques: (html) => ({ icon: legendaryPage(html).icon }),
  heroTraits: (html) => heroPage(html),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.ok) return res.text();
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await sleep(2000 * attempt);
    return download(url, attempt + 1);
  }
  throw new Error(`${res.status} ${url}`);
}

const cacheFile = (slug) => path.join(CACHE, `${decodeURIComponent(slug).replace(/[^\w.-]+/g, '_')}.html`);

async function page(slug) {
  const file = cacheFile(slug);
  if (!REFRESH && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  // tlidb's newer page addresses drop the colon its search index still has
  // ("Micro_Fate%3A_Intelligence" is now "Micro_Fate_Intelligence")
  const html = await download(BASE_URL + slug).catch((err) =>
    /^404 /.test(err.message) && slug.includes('%3A') ? download(BASE_URL + slug.replace(/%3A/g, '')) : Promise.reject(err),
  );
  fs.writeFileSync(file, html);
  await sleep(DELAY_MS);
  return html;
}

async function pages(slugs, label) {
  const results = new Map();
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < slugs.length) {
      const slug = slugs[next++];
      try {
        results.set(slug, await page(slug));
      } catch (err) {
        console.warn(`  skipped ${slug}: ${err.message}`);
      }
      if (++done % 100 === 0) console.log(`  ${label}: ${done}/${slugs.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

// ---------- HTML helpers ----------

const ENTITIES = { '&ndash;': '–', '&mdash;': '—', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

function toText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&\w+;/g, (e) => ENTITIES[e] ?? e)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// Inner HTML of the element whose opening tag ends at `from`, honoring nested tags of the same name
function innerHtml(html, from, tag) {
  const open = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  open.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = open.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index);
  }
  return html.slice(from);
}

// Every stat line on a page: [{ id, text }]. Pages can show several seasons of the same item;
// the current season comes first, so the first text seen for an id wins.
function modifiers(html) {
  const found = [];
  for (const m of html.matchAll(/<span data-modifier-id="(\d+)">/g)) {
    found.push({ id: m[1], text: toText(innerHtml(html, m.index + m[0].length, 'span')) });
  }
  return found;
}

const first = (re, html) => re.exec(html)?.[1] ?? null;

// Pages show one "card ui_item popupItem" per season, the current season first; the older card
// follows with class previousItem (module pages repeat the pair in each tab). Inner HTML of the
// first card, or null.
function firstCard(html) {
  const m = /<div class="card ui_item popupItem[^"]*">/.exec(html);
  return m ? innerHtml(html, m.index + m[0].length, 'div') : null;
}

function entity(html) {
  // Name and tags from the current-season card only: reading the whole page doubled every skill's
  // tags (Fire Burst had [Spell, Area, Fire, Spell, Area, Fire]). Ids sit in the page's Info card.
  const card = firstCard(html);
  return {
    name: toText(first(/<h5 class="card-title"[^>]*>([\s\S]*?)<\/h5>/, card ?? html) ?? first(/<title>([^<-]+)/, html) ?? ''),
    tags: [...(card ?? html).matchAll(/<span class="border p-1 mb-1 tag tlborder">([\s\S]*?)<\/span>/g)].map((m) => toText(m[1])),
    id: first(/<(?:div|li)>id: (\d+)<\/(?:div|li)>/, html) ?? first(/btn-secondary mb-1">id: (\d+)</, html),
    base: first(/btn-secondary mb-1">base: (\d+)</, html),
    baseSlug: first(/<li>Base: <a [^>]*href="([^"]+)"/, html),
    // Pages without a card (heroes, pactspirits) would otherwise give the site's logo
    icon: card ? cardIcon(card) : null,
  };
}

// A card's picture: a skill's icon, a base item's generic art, a legendary's own art. Pictures
// tlidb hasn't put on its CDN yet have only alt2 (the game's asset path, which 403s there), so
// they give no icon rather than the next picture in the card (a legendary's granted skill).
function cardIcon(card) {
  const img = first(/(<img\b[^>]*>)/, card);
  return img ? first(/\bsrc="([^"]+)"/, img) : null;
}

// A hero page (tlidb files them under Hero Trait): the hero's portrait and each trait's icon by
// trait name, from <img src="ICON" class="ui_char_base"></div><div ...><div class="fw-bold"
// [data-id="ID"]>Name</div>. Names, not ids: older heroes' pages don't tag their traits.
function heroPage(html) {
  const traits = {};
  const re = /<img src="([^"]+)"[^>]*class="ui_char_base"[^>]*\/><\/div><div class="flex-grow-1 mx-2 my-1"><div class="fw-bold"[^>]*>([^<]+)<\/div>/g;
  for (const m of html.matchAll(re)) traits[toText(m[2])] ??= m[1];
  return { portrait: first(/<img src="([^"]+)"[^>]*class="size128 border tlborder"/, html), traits };
}

// A legendary page's current-season card as the game shows it: the base item's stats (the
// data-block="attrs2" lines and the lines under them), then its own lines in order (tierParent "t1"),
// the corroded version's lines ("t0" in the Corroded card), the options behind each "<Random ...>"
// placeholder, its level requirement, drop level and drop sources. Lines keep tlidb's (min–max)
// ranges. New lines can be Chinese on tlidb until it translates them; they're kept as they are.
// A line with a <br> ("-100% Critical Strike Rating<br>+100% Critical Strike Damage") is two stat
// lines in one affix: kept as "line\nline"
const divTexts = (html, cls) => [...html.matchAll(new RegExp(`<div class="${cls}">`, 'g'))].map((m) => toText(innerHtml(html, m.index + m[0].length, 'div'))).filter(Boolean);
const tierLines = (html, from, cls) => {
  const m = /<div class="tierParent">/.exec(html.slice(from));
  return m ? divTexts(innerHtml(html, from + m.index + m[0].length, 'div'), cls) : [];
};

export function legendaryPage(html) {
  const card = firstCard(html) ?? '';
  const attrs = /<div data-block="attrs2"[^>]*>/.exec(card);
  const attrsHtml = attrs ? innerHtml(card, attrs.index + attrs[0].length, 'div') : '';
  const base = [...attrsHtml.matchAll(/<div>([\s\S]*?)<\/div>/g)].map((m) => toText(m[1]).replace(/\n/g, ' ')).filter(Boolean);
  const hr = card.indexOf('<hr');
  const head = attrs ? card.slice(attrs.index + attrs[0].length + attrsHtml.length, hr >= 0 ? hr : undefined) : '';
  const implicit = [...head.matchAll(/<div class="text-center">([\s\S]*?)<\/div>/g)].map((m) => toText(m[1]).replace(/\n/g, ' ')).filter(Boolean);
  const corrodedAt = html.search(/>Corroded<\/div>/);
  const random = {};
  for (const m of html.matchAll(/<h5 class="card-header text-center"[^>]*>&lt;([^&]+)&gt;\s*(Corroded)?\s*<\/h5>/g)) {
    random[`<${m[1].trim()}>${m[2] ? ' (corroded)' : ''}`] = tierLines(html, m.index, m[2] ? 't0' : 't1');
  }
  const sources = /Func_Tips_DropSource">Drop Source<\/div>\s*<div class="card-body">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  return {
    season: first(/<div class="item_ver">([^<]*)<\/div>/, card)?.replace(/Season$/, '') ?? null,
    icon: cardIcon(card),
    reqLevel: Number(first(/>Require lv (\d+)</, card)) || null,
    dropLevel: Number(first(/<li>drop level: (\d+)<\/li>/, html)) || null,
    base,
    implicit,
    lines: tierLines(card, 0, 't1'),
    corroded: corrodedAt >= 0 ? tierLines(html, corrodedAt, 't0') : [],
    random,
    dropSources: [...sources.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => toText(m[1])),
  };
}

// A talent tree page: <img class="size128"> portrait, then one card per node / core talent:
//   <img src="ICON" ...> ... <span class="fw-bold" data-talent-id="ID">Micro Talent</span>
//   [<span>6pts</span>] <span>0/3</span>
// "Npts" is how many points the tree needs before the card can be taken: the column gate for
// nodes, the unlock for core talents (whose icons live under CoreTalentIcon). The current season's
// tree comes first on the page.
function parseTreePage(html) {
  const image = first(/<img src="([^"]+\/TalentV2\/UI\/Textures\/NoAtlas\/[^"]+)"[^>]*class="size128"/, html);
  const nodes = {};
  const cores = {};
  const card = /<img src="([^"]+)"[^>]*\/>\s*<\/div>\s*<div class="flex-grow-1[^"]*">\s*<div class="d-flex justify-content-between">\s*<span class="fw-bold" data-talent-id="(\d+)">([^<]+)<\/span>\s*(?:<span>(\d+)pts<\/span>\s*)?<span>\d+\/(\d+)<\/span>/g;
  for (const m of html.matchAll(card)) {
    const [, icon, id, name, points, maxPoints] = m;
    const core = icon.includes('/CoreTalentIcon/');
    const target = core ? cores : nodes;
    if (target[id]) continue;
    target[id] = { name: toText(name), icon, maxPoints: Number(maxPoints), [core ? 'unlockPoints' : 'requiredPoints']: Number(points ?? 0) };
  }
  return { image, nodes, cores, links: treeLinks(html, nodes) };
}

// The lines joining nodes on the page's tree drawing, as [from, to] node ids: "to" can only take
// points once "from" (in the column before, same row or one off) is full. In the drawing node
// centres sit at x = 96 + 128 * (column - 1), y = 80 + 96 * (row - 1) with radius 32, and a line
// runs from the later node's left edge to the earlier node's right edge, 2px below the centres.
// Node ids give their spot: <tree><column><row>00.
export function treeLinks(html, nodes) {
  const group = /<g class="connections"[^>]*>([\s\S]*?)<\/g>/.exec(html)?.[1] ?? '';
  const at = new Map(Object.keys(nodes).map((id) => [`${Number(id.slice(-6, -4))}:${Number(id.slice(-4, -2))}`, Number(id)]));
  const nodeAt = (x, y, edge) => at.get(`${(x - edge - 96) / 128 + 1}:${(y - 82) / 96 + 1}`);
  const links = [];
  for (const m of group.matchAll(/<line x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"/g)) {
    const [x1, y1, x2, y2] = m.slice(1).map(Number);
    const [later, earlier] = x1 > x2 ? [[x1, y1], [x2, y2]] : [[x2, y2], [x1, y1]];
    const to = nodeAt(later[0], later[1], -32);
    const from = nodeAt(earlier[0], earlier[1], 32);
    if (from && to) links.push([from, to]);
  }
  return links;
}

// ---------- helpers ported from TLI Builder ----------
// normalizeFractions, extractDurations and dedupLines are ported from normalize_fractions,
// extract_durations and _dedup_lines in TLI Builder's backend/tools/skill_importer.py
// (https://github.com/Tyrayla/TLIBuilder), under its MIT licence:
//
//   MIT License
//
//   Copyright (c) 2026 Tyrayla
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// Only the code is ported; every value comes from our own tlidb cache.

// tlidb leaves many values as unreduced fractions: Overload's hidden "(Lv1:61/20)" is 3.05,
// Path of Flames' "43/2%" is 21.5%. Each two-number N/M group becomes its decimal (6 significant
// digits). A chain of 3+ numbers is a per-tier list ("Normal/Magic/Rare/Boss enemy grants
// 1/3/6/100"), and a string carrying a word/word list ("Normal/Magic", "Fire/Cold") is left whole,
// since its numbers are likely a parallel list too.
const FRACTION = /\b\d+(?:\/\d+)+\b/g;
const WORD_SLASH_LIST = /[A-Za-z]+\/[A-Za-z]+/;

export function normalizeFractions(text) {
  if (typeof text !== 'string' || !text.includes('/') || WORD_SLASH_LIST.test(text)) return text;
  return text.replace(FRACTION, (group) => {
    const parts = group.split('/');
    if (parts.length !== 2) return group;
    const [num, den] = parts.map(Number);
    return den === 0 ? group : String(Number((num / den).toPrecision(6)));
  });
}

// Every duration or timing clause in a skill's lines, one entry per clause in text order, with the
// line kept as `source`:
//   skill         the skill's or buff's own duration ("Lasts 6 s.")
//   entity        a spawned thing's lifetime ("The Thunderbolts last for 6s")
//   per_stack     one stack of a stacking buff ("... lasting for 1.2 s, up to 8 stacks"), with maxStacks
//   interval      a tick or proc period ("every 0.5 s", "every second", "Interval: 1s")
//   duration_mod  a bonus to some duration ("+3 s duration for Sentries")
//   window        a damage or restore-over-time window ("Deals X every second for 2 s")
// A bare "1 s" fragment is skipped: nothing says what it times.
const DN = String.raw`([\d.]+)`;
const DUR_SKILL = new RegExp(String.raw`^\s*lasts?\s+(?:for\s+)?${DN}\s*s\b`, 'i');
const DUR_ENTITY = new RegExp(String.raw`^(.*?\S)\s+lasts?\s+(?:for\s+)?${DN}\s*s\b`, 'i');
const DUR_MOD = new RegExp(String.raw`\+\s*${DN}\s*s\b[^.]*?\bduration\b(?:\s+for\s+([A-Za-z][\w ]*?))?(?:[.,]|$)`, 'i');
const DUR_MOD_REV = new RegExp(String.raw`\bduration\b[^.]*?\+\s*${DN}\s*s\b`, 'i');
const DUR_STACK_DUR = new RegExp(String.raw`(?:lasting for|for|lasts?(?:\s+for)?)\s+${DN}\s*s\b`, 'i');
const DUR_MAX_STACK = /(?:up to|stacking up to)\s+(\d+)\s*(?:time|stack)/i;
const DUR_INTERVAL = new RegExp(String.raw`every\s+(?:${DN}\s*s|second)\b|interval:\s*${DN}`, 'i');
const DUR_WINDOW = new RegExp(String.raw`(?:deals|restores|inflict\w*|gain\w*|reaps)\b[^.]*?\b(?:within|in|for)\s+${DN}\s*s\b`, 'i');
const DUR_ANY = new RegExp(String.raw`${DN}\s*s\b`);
const DUR_ARTICLE = /^(?:the|a|an|each|this|that)\s+/i;

const seconds = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const durEntry = (kind, secs, source, subject = null, maxStacks = null) => ({ kind, seconds: seconds(secs), subject, maxStacks, source });

export function extractDurations(lines) {
  const out = [];
  for (const raw of lines ?? []) {
    const s = raw.trim();
    if (!s || (!DUR_ANY.test(s) && !s.toLowerCase().includes('duration'))) continue;
    const stacked = /stack/i.test(s);
    let m = DUR_SKILL.exec(s);
    if (m) {
      out.push(durEntry('skill', m[1], s));
      continue;
    }
    m = DUR_ENTITY.exec(s);
    if (m && !stacked) {
      const subject = m[1].trim().replace(DUR_ARTICLE, '').trim();
      const words = subject ? subject.split(/\s+/).length : 0;
      if (words >= 1 && words <= 4) {
        out.push(durEntry('entity', m[2], s, subject));
        continue;
      }
    }
    m = DUR_MOD.exec(s) ?? DUR_MOD_REV.exec(s);
    if (m) {
      out.push(durEntry('duration_mod', m[1], s, m[2]?.trim() || null));
      continue;
    }
    if (stacked) {
      m = DUR_STACK_DUR.exec(s);
      if (m) {
        const max = DUR_MAX_STACK.exec(s);
        out.push(durEntry('per_stack', m[1], s, null, max ? Number(max[1]) : null));
        continue;
      }
    }
    m = DUR_INTERVAL.exec(s);
    if (m) {
      out.push(durEntry('interval', m[1] || m[2] || '1', s));
      continue;
    }
    m = DUR_WINDOW.exec(s);
    if (m) out.push(durEntry('window', m[1], s));
  }
  return out;
}

// Drops repeated lines, keyed on the line with its whitespace collapsed, keeping the first.
// `seen` (our addition) carries the keys across calls.
const lineKey = (line) => line.trim().split(/\s+/).join(' ');

export function dedupLines(lines, seen = new Set()) {
  const out = [];
  for (const line of lines) {
    const key = lineKey(line);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(line);
    }
  }
  return out;
}

// ---------- skill pages ----------

const ANCHORS = /<small class="description">([\s\S]*?)<\/small>/;
const ALL_ANCHORS = new RegExp(ANCHORS, 'g');

// tlidb hides each scaling value's per-level anchors after its line: "(Lv1:61/20) (Lv21:81/20)
// (Lv41:101/20)". A line with two values (Adds 2 - 3 Cold Damage) lists one run per value, each
// starting again at Lv1. Returns [{ level: value }, ...].
function anchorRuns(text) {
  const runs = [];
  let prev = Infinity;
  for (const [, level, raw] of text.matchAll(/\(Lv(\d+):([^)]*)\)/g)) {
    if (Number(level) <= prev) runs.push({});
    const value = normalizeFractions(raw.trim());
    runs.at(-1)[level] = Number.isFinite(Number(value)) ? Number(value) : value;
    prev = Number(level);
  }
  return runs;
}

// Text lines of one block: <br> and list items break lines. Anchors are cut from the line and,
// when `anchors` is given, stored under the line's text.
function blockLines(html, anchors = null) {
  const lines = [];
  for (const part of html.split(/<br\s*\/?>|<\/?li>/i)) {
    const line = normalizeFractions(toText(part.replace(ALL_ANCHORS, '')).replace(/\n/g, ' '));
    if (!line) continue;
    lines.push(line);
    const runs = anchors && ANCHORS.exec(part);
    if (runs) anchors[line] = anchorRuns(runs[1]);
  }
  return lines;
}

// A section is a run of blocks (explicitMod divs, or <hr>-separated parts of a table cell). A block
// opening with "Name:" is one form of the skill (Sweep Slash:, Combo Starter 2:), and forms can share
// a line (Hammer of Ash's Pummel:, Ember Projectile: and Explosion: each "Deals 369% Weapon Attack
// Damage."), so a form only drops repeats within itself. tlidb ends most sections with an unnamed
// block restating lines from above (Berserking Blade's "This skill +20% Steep Strike chance."):
// unnamed blocks drop every line already shown.
function sectionLines(blocks) {
  const seen = new Set();
  return blocks.flatMap((block) => {
    const lines = dedupLines(block, block[0]?.endsWith(':') ? new Set() : seen);
    for (const line of lines) seen.add(lineKey(line));
    return lines;
  });
}

const cellText = (html) => sectionLines(html.split(/<hr\b[^>]*>/i).map((block) => blockLines(block))).join('\n');

// Header rows: <div>Cast Speed</div><div class="ps-2">0.8 s</div>
function skillHeader(card) {
  const rows = {};
  for (const m of card.matchAll(/<div class="d-flex justify-content-center">\s*<div>([^<]*)<\/div>\s*<div class="ps-2">([^<]*)<\/div>/g)) {
    rows[toText(m[1]).replace(/:$/, '')] = toText(m[2]);
  }
  const num = (v) => (v == null ? null : parseFloat(v));
  const manaCost = rows['Mana Cost'] ?? null;
  return {
    castTime: num(rows['Cast Speed']), // "0.8 s": tlidb labels the base cast time "Cast Speed"
    cooldown: num(rows.Cooldown), // "10 s"
    manaCost: num(manaCost), // "8", or "15%" of Max Mana
    manaCostIsPct: manaCost == null ? null : manaCost.endsWith('%'),
    addedDmgEffPct: num(rows['Effectiveness of added damage']), // "161%"
    mainStats: rows['Main Stat']?.split(/,\s*/) ?? null, // "Strength, Intelligence"
    sealedMana: num(rows['Sealed Mana']), // "50%" of Max Mana (auras and other passives)
    manaCostMultiplier: num(rows['Mana Cost Multiplier']), // "110.0%" (supports)
  };
}

// The card's text: a "Simple" and a "Details" note (div.detailsNote), each followed by explicitMod
// blocks. Cards without a Details note (supports, Activation Media, Noble and Magnificent supports)
// show a summary block and then one block per effect; those blocks count as details.
function cardText(card) {
  const blocks = { simple: [], details: [] };
  const anchors = {};
  const hasDetails = /<div class="detailsNote"[^>]*>Details<\/div>/.test(card);
  let section = null;
  for (const m of card.matchAll(/<div class="detailsNote"[^>]*>([^<]*)<\/div>|<div class="explicitMod">/g)) {
    if (m[1] !== undefined) {
      section = m[1].trim() === 'Details' ? 'details' : 'simple';
      continue;
    }
    if (!section) continue;
    const lines = blockLines(innerHtml(card, m.index + m[0].length, 'div'), anchors);
    blocks[section === 'simple' && !hasDetails && blocks.simple.length ? 'details' : section].push(lines);
  }
  return { simple: sectionLines(blocks.simple), details: sectionLines(blocks.details), anchors: Object.keys(anchors).length ? anchors : null };
}

// The "<Title> /N" tables under the cards: Progression /40 has a row per level (positional columns:
// level | Effectiveness of added damage | damage | Descript, with 2-3 Eff/damage pairs on multi-form
// skills, and supports naming each column after the line it scales); Progression /3 and /4 a row per
// Noble/Magnificent or Activation Medium tier; Minion /60 a summon's stats per level. Module pages
// repeat the table in each tab, and the first one goes with the first card.
function skillTables(html) {
  const tables = [];
  for (const m of html.matchAll(/<h5 class="card-header">((?:Progression|Minion) \/\d+)\s*<\/h5>/g)) {
    const start = html.indexOf('<table', m.index);
    const end = html.indexOf('</table>', start);
    const nextCard = html.indexOf('<h5 class="card-header">', m.index + m[0].length);
    if (start < 0 || end < 0 || (nextCard >= 0 && nextCard < start)) continue;
    const table = html.slice(start, end);
    const columns = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((c) => cellText(c[1]));
    const rows = [...table.matchAll(/<tr>\s*(<td[\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c, i) => {
        const text = cellText(c[1]);
        return i === 0 && /^\d+$/.test(text) ? Number(text) : text; // level / tier
      }),
    );
    tables.push({ title: m[1], columns, rows });
  }
  return tables;
}

// Everything the current-season card and its tables say; nothing is interpreted beyond tidying
// the text (fractions, repeated lines) and reading the header numbers.
function skillPage(html) {
  const card = firstCard(html) ?? '';
  const { simple, details, anchors } = cardText(card);
  const tables = skillTables(html);
  const table = (pick) => {
    const t = tables.find(pick);
    return t ? { columns: t.columns, rows: t.rows } : null;
  };
  return {
    season: first(/<div class="item_ver">([^<]*)<\/div>/, card)?.replace(/Season$/, '') ?? null,
    header: skillHeader(card),
    simple,
    details,
    progression: table((t) => t.columns[0] === 'level'),
    anchors,
    durations: extractDurations(details.length ? details : simple),
    tiers: table((t) => t.columns[0] === 'Tier'),
    minion: table((t) => t.title.startsWith('Minion')),
  };
}

// A few SS14 Tartarus skills are only on tlidb in Chinese (塔罗斯：... / 始源塔罗斯：...) and on no
// listing page: their name gives their type
const tartarusType = (name) => (/^(Origin Tartarus|始源塔罗斯)/.test(name ?? '') ? 'Origin Tartarus' : /^(Tartarus|塔罗斯)/.test(name ?? '') ? 'Tartarus' : null);

// A fresh import merged over the last one. tlidb's listing pages stopped carrying modifier ids in
// Oct 2026 (SS14), so a refresh finds far fewer affix ids than the log uses: every entry the pages no
// longer give is kept, as are id lists (a legendary's or base's affix ids) the new page lacks.
// Entries the new pages do give replace the old ones (the current season wins).
export function mergeTables(previous, fresh) {
  const merged = { ...previous };
  for (const [id, entry] of Object.entries(fresh)) {
    const prev = merged[id];
    // Lists (a craft pool) are replaced whole
    if (!prev || typeof prev !== 'object' || typeof entry !== 'object' || Array.isArray(prev) || Array.isArray(entry)) {
      merged[id] = entry;
      continue;
    }
    const next = { ...prev, ...entry };
    for (const key of ['affixes', 'baseAffixes']) {
      if (Array.isArray(prev[key]) && prev[key].length && !(Array.isArray(entry[key]) && entry[key].length)) next[key] = prev[key];
    }
    merged[id] = next;
  }
  return merged;
}

// The Craft page's affix table: every affix each item type can roll, by kind (Base Affix, Basic /
// Advanced / Ultimate Pre-fix and Suffix, Corrosion Base, ...), with its (min–max) range. Rows are
// <tr><td>Affix Effect</td><td>Source</td><td>Type</td></tr>.
export function craftPool(html) {
  const pool = {};
  // The first cell can hold markup but never crosses into the next cell; rows with more cells (the
  // blending tables) keep their first three
  for (const m of html.matchAll(/<tr><td>((?:(?!<\/td>|<\/tr>)[\s\S])*?)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td>(?:<td>[^<]*<\/td>)*<\/tr>/g)) {
    const text = toText(m[1].replace(/<br\s*\/?>/gi, '\n'));
    const source = toText(m[2]);
    const kind = toText(m[3]);
    if (!text || !source) continue;
    (pool[source] ??= []).push({ text, kind: kind || null });
  }
  return pool;
}

// A gear type's Craft tab (on its listing page, id "<Type>Craft"): every affix it can roll, tier by
// tier. Two tables, prefixes then suffixes; rows are
// <tr data-tier="2"><td>2<td>MODIFIER<td>LV<td>WEIGHT<td>LIBRARY (no closing tags). Tier "0+" is the
// best, then 0, 1, 2 ... 7; LV is the item level the tier needs (Ultimate affixes need 100 at every tier).
export function craftTiers(html, type) {
  const key = String(type).replace(/[^A-Za-z0-9]/g, '');
  const start = html.indexOf(`id="${key}Craft"`);
  if (start < 0) return [];
  // The next tab after this one (its own opening tag carries class="tab-pane" too)
  const end = html.indexOf('class="tab-pane', html.indexOf('>', start));
  const tables = html.slice(start, end > 0 ? end : undefined).split('<thead>').slice(1);
  const rows = [];
  tables.forEach((table, i) => {
    for (const m of table.matchAll(/<tr data-tier="([^"]+)"><td>[^<]*<td>([\s\S]*?)<td>(\d+)<td>(\d+)<td>([^<\n]*)/g)) {
      const text = toText(m[2].replace(/<br\s*\/?>/gi, '\n'));
      if (text) rows.push({ part: i === 0 ? 'prefix' : 'suffix', tier: m[1], text, lv: Number(m[3]), weight: Number(m[4]), library: m[5].trim() });
    }
  });
  return rows;
}

// ---------- import ----------

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const indexFile = path.join(CACHE, '_autocomplete_en.json');
  if (REFRESH || !fs.existsSync(indexFile)) {
    fs.writeFileSync(indexFile, await download('https://tlidb.com/i18n/autocomplete_en.json'));
  }
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const categoryOf = new Map(index.map((e) => [e.value, e.desc]));
  // Display names; some page titles are just the URL slug ("Undying_Faith")
  const labelOf = new Map(index.map((e) => [e.value, e.label]));

  const slugsIn = (cats) => [...new Set(index.filter((e) => cats.includes(e.desc)).map((e) => e.value))];
  const gearListings = GEAR_CATEGORIES.map((c) => c.replace(/ /g, '_'));

  console.log(`Fetching ${LISTING_PAGES.length + gearListings.length} listing pages...`);
  const listings = await pages([...LISTING_PAGES, ...gearListings], 'listings');
  // Skills the search index files under another category (SS14's Splitting Lightning Bolt is a
  // "Tip" there) still sit on the skill listing pages: import those as skills too
  const pageKey = (slug) => decodeURIComponent(slug).replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
  const indexedSkills = new Set(index.filter((e) => e.desc === 'Skill').map((e) => pageKey(e.value)));
  const listedOnly = new Set();
  for (const listing of Object.keys(SKILL_LISTINGS)) {
    for (const m of (listings.get(listing) ?? '').matchAll(/<div class="flex-grow-1 mx-2 my-1"><a data-hover="[^"]*" href="([^"]+)">/g)) {
      if (!indexedSkills.has(pageKey(m[1]))) listedOnly.add(m[1]);
    }
  }
  for (const slug of listedOnly) categoryOf.set(slug, 'Skill');
  if (listedOnly.size) console.log(`  ${listedOnly.size} skills only on the listing pages, e.g. ${[...listedOnly].slice(0, 4).join(', ')}`);
  // Legendaries too: SS14's Broken Dream, Last Stand and Immolating World are "Tip"s in the search
  // index but sit on the Legendary Gear listing
  const indexedLegendaries = new Set(index.filter((e) => e.desc === 'Legendary').map((e) => pageKey(e.value)));
  const listedLegendaries = new Set();
  for (const m of (listings.get('Legendary_Gear') ?? '').matchAll(/<div class="flex-grow-1 mx-2 my-1"><a data-hover="[^"]*ItemGold_hover[^"]*" href="([^"]+)">/g)) {
    if (!indexedLegendaries.has(pageKey(m[1]))) listedLegendaries.add(m[1]);
  }
  for (const slug of listedLegendaries) categoryOf.set(slug, 'Legendary');
  if (listedLegendaries.size) console.log(`  ${listedLegendaries.size} legendaries only on the listing page: ${[...listedLegendaries].join(', ')}`);
  const entitySlugs = [...new Set([...slugsIn(ENTITY_CATEGORIES), ...listedOnly, ...listedLegendaries])];
  console.log(`Fetching ${entitySlugs.length} item / skill / legendary pages (cached after the first run)...`);
  const entities = await pages(entitySlugs, 'pages');

  const affixes = {};
  const addAffixes = (html) => {
    for (const { id, text } of modifiers(html)) if (!affixes[id] && text) affixes[id] = { text };
  };
  for (const html of listings.values()) addAffixes(html);

  // Skill type by page: a listing links each of its skills as
  // <div class="flex-grow-1 mx-2 my-1"><a data-hover="..." href="Slug">. The newer listings drop the
  // colon from the slug ("Activation_Medium_Spell_Burst" for the search index's
  // "Activation_Medium%3A_Spell_Burst"), so pages are matched on letters and digits only (pageKey).
  const skillTypes = new Map();
  for (const [listing, type] of Object.entries(SKILL_LISTINGS)) {
    for (const m of (listings.get(listing) ?? '').matchAll(/<div class="flex-grow-1 mx-2 my-1"><a data-hover="[^"]*" href="([^"]+)">/g)) {
      if (!skillTypes.has(pageKey(m[1]))) skillTypes.set(pageKey(m[1]), type);
    }
  }

  const items = {};
  const uniques = {};
  const skills = {};
  const skillData = {};
  const memories = {};
  const slates = {};
  const pactspirits = {};
  const heroTraits = {};

  for (const [slug, html] of entities) {
    addAffixes(html);
    const category = categoryOf.get(slug);
    const e = entity(html);
    e.name = labelOf.get(slug) ?? e.name;
    const mods = [...new Set(modifiers(html).map((m) => m.id))];
    if (category === 'Skill' && e.id) {
      skills[e.id] = { name: e.name, slug, tags: e.tags, icon: e.icon };
      const { season, ...page } = skillPage(html);
      skillData[e.id] = { name: e.name, slug, type: skillTypes.get(pageKey(slug)) ?? tartarusType(e.name), season, tags: e.tags, ...page };
    } else if (category === 'Legendary' && e.id) {
      uniques[e.id] = { name: e.name, slug, baseId: e.base ? Number(e.base) : null, baseSlug: e.baseSlug, affixes: mods, ...legendaryPage(html) };
    } else if ((category === 'Hero Memories' || category === 'Fluorescent Memory') && e.id) {
      memories[e.id] = { name: e.name, slug, category, icon: e.icon };
      items[e.id] = { name: e.name, type: category, slug, icon: e.icon };
    } else if (category === 'Divinity Slate') {
      // One page covers a god's slate shapes, each with its own id under its own card, whose
      // picture is that shape
      for (const m of html.matchAll(/<(?:div|li)>id: (\d+)<\/(?:div|li)>/g)) {
        const icon = [...html.slice(0, m.index).matchAll(/<img src="([^"]+)"[^>]*class="size128/g)].at(-1)?.[1] ?? null;
        slates[m[1]] = { name: e.name, slug, icon };
        items[m[1]] = { name: e.name, type: 'Divinity Slate', slug, icon };
      }
    } else if (category === 'Pactspirit') {
      const icon = first(/<img src="([^"]+)"[^>]*class="pactspirit_smallicon/, html);
      pactspirits[slug] = { name: e.name, slug, id: e.id ? Number(e.id) : null, icon };
    } else if (category === 'Hero Trait') {
      heroTraits[slug] = { name: e.name, slug, id: e.id ? Number(e.id) : null, ...heroPage(html) };
    } else if (GEAR_CATEGORIES.includes(category) && e.id) {
      items[e.id] = { name: e.name, type: category, slug, baseAffixes: mods, icon: e.icon };
    } else if ((category === 'Destiny' || category === 'Prism') && e.id) {
      // The log names a Destiny by item id and its roll by modifier id (100350009 = "+(12–15) Intelligence")
      items[e.id] = { name: e.name, type: category, slug, affixes: mods, icon: e.icon };
    }
  }
  const untyped = Object.values(skillData).filter((s) => !s.type);
  if (untyped.length) console.warn(`  ${untyped.length} skills on no skill listing page, e.g. ${untyped.slice(0, 5).map((s) => s.name).join(', ')}`);
  // Legendary bases name the slot type of the base they're built on
  for (const u of Object.values(uniques)) {
    if (u.baseId && !items[u.baseId] && u.baseSlug) {
      const baseEntry = Object.values(items).find((i) => i.slug === u.baseSlug);
      if (baseEntry) items[u.baseId] = { ...baseEntry, legendaryBase: true };
    }
  }

  // Talent nodes: <span data-id="ID">Micro Talent</span><span><a href="Tree">Tree Name</a></span></div> text
  const talents = {};
  const talentHtml = listings.get('Talent') ?? '';
  for (const m of talentHtml.matchAll(/<span data-id="(\d+)">([^<]+)<\/span><span><a href="([^"]+)">([^<]+)<\/a><\/span><\/div>/g)) {
    if (talents[m[1]]) continue;
    const after = m.index + m[0].length;
    const text = toText(talentHtml.slice(after, talentHtml.indexOf('</div>', after)));
    talents[m[1]] = { name: m[2], tree: m[4], treeSlug: m[3], text };
  }
  // Core talents on each tree page: <span class="fw-bold" data-talent-id="ID">Name</span>
  for (const html of [...listings.values(), ...entities.values()]) {
    for (const m of html.matchAll(/data-talent-id="(\d+)">([^<]+)<\/span>/g)) {
      if (!talents[m[1]]) talents[m[1]] = { name: m[2], core: true };
    }
  }

  // Talent tree pages (linked from the Talent page): the tree's portrait, and every node and core
  // talent with its icon, max points and, for cores, the points the tree needs to unlock it
  const treeSlugs = [...new Set([...talentHtml.matchAll(/href="([A-Z][A-Za-z_]+)"/g)].map((m) => m[1]))].filter((s) => !s.endsWith('_Season'));
  console.log(`Fetching ${treeSlugs.length} talent tree pages...`);
  const treePages = await pages(treeSlugs, 'trees');
  const talentTrees = {};
  for (const [slug, html] of treePages) {
    const tree = parseTreePage(html);
    if (!Object.keys(tree.nodes).length && !Object.keys(tree.cores).length) continue;
    talentTrees[slug] = { name: slug.replace(/_/g, ' '), ...tree };
    for (const [id, n] of Object.entries(tree.nodes)) talents[id] = { ...(talents[id] ?? { name: n.name }), icon: n.icon, maxPoints: n.maxPoints };
    for (const [id, n] of Object.entries(tree.cores)) talents[id] = { ...(talents[id] ?? { name: n.name, core: true }), icon: n.icon, unlockPoints: n.unlockPoints };
  }

  // Affix pools for crafting rares, by item type (the sample build's rare editor), and each type's
  // tiers with the item level they need (from its listing page's Craft tab)
  const craft = craftPool(listings.get('Craft') ?? '');
  const craftTierTable = Object.fromEntries(
    GEAR_CATEGORIES.map((c) => [c, craftTiers(listings.get(c.replace(/ /g, '_')) ?? '', c)]).filter(([, rows]) => rows.length),
  );

  const tables = { affixes, items, uniques, skills, skillData, talents, talentTrees, memories, slates, pactspirits, heroTraits, craft, craftTiers: craftTierTable };
  const counts = {};
  for (const [name, data] of Object.entries(tables)) {
    const file = path.join(OUT, `${name}.json`);
    const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const merged = mergeTables(previous, data);
    // Skills kept from an earlier import that this one didn't find still get a type where the name says
    if (name === 'skillData') for (const s of Object.values(merged)) s.type ??= tartarusType(s.name);
    // Entries kept from an earlier import whose slug tlidb's index now gives to a keyword Tip
    // ("Trinity", "Spacetime_Illusion"): their pictures from the page still in the cache
    const fill = PICTURES_FROM_PAGE[name];
    for (const entry of fill ? Object.values(merged) : []) {
      if (entry?.slug && !entry.icon && !entry.portrait && fs.existsSync(cacheFile(entry.slug))) Object.assign(entry, fill(fs.readFileSync(cacheFile(entry.slug), 'utf8')));
    }
    fs.writeFileSync(file, JSON.stringify(merged, null, 1));
    counts[name] = { fromTlidb: Object.keys(data).length, total: Object.keys(merged).length };
  }
  const meta = {
    source: 'https://tlidb.com/en/',
    importedAt: new Date().toISOString(),
    pages: listings.size + entities.size,
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.total])),
    fromThisImport: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.fromTlidb])),
  };
  fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify(meta, null, 2));
  console.log('Wrote data/gamedata:', meta.counts);
}

// Import only when run as a script, so tests can import the helpers above
// (import.meta.main is Node 24+; the path check covers older Node)
if (import.meta.main ?? path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
