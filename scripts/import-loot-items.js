// Names, categories and pictures for everything that can drop, keyed by the game's base id (the
// prefix of every "ItemChange@ ... Id=<baseId>_<uuid>" line): currency, crafting materials, beacons,
// compasses, Fluorescent Memories, Destinies, organs, skill gems, legendary gear... The planner's
// tlidb import only covers gear, skills, legendaries and the like, so drop tracking needs this.
//
//   node scripts/import-loot-items.js
//
// Sources (both public, fetched on each run, nothing vendored):
//   - ETor's own item list (ids, tlidb picture, tlidb page per item; names are Chinese there) as
//     mirrored in github.com/ArtemNA/tli-tracker (MIT). The tlidb page's English slug names the item.
//   - sattatracker's English id table (MIT, same mirror) for ids the ETor list lacks or names in Chinese.
// Writes data/gamedata/lootItems.json: { "<baseId>": { name, category, icon, tlidb } }, which
// server/gamedata loads as the "lootItems" table. Hand fixes go in lootItems.local.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'gamedata', 'lootItems.json');
const MIRROR = 'https://raw.githubusercontent.com/ArtemNA/tli-tracker/main/data-src/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) tli-build-planner';

// The ETor list's Chinese type labels, grouped the way the tracker values them (organs are never
// priced; FE is the unit)
const CATEGORY_BY_TYPE = {
  传奇装备: 'legendary',
  主动技能: 'skill', 辅助技能: 'skill', 崇高辅助技能: 'skill', 华贵辅助技能: 'skill', 被动技能: 'skill', 触媒技能: 'skill', 模组化技能: 'skill',
  命运: 'destiny', 未定宿命: 'destiny', 命运相关: 'destiny',
  罗盘: 'compass', 赛季罗盘: 'compass', 星盘: 'compass', 探针: 'compass',
  信标: 'beacon',
  记忆荧光: 'memory', '复苏材料（月相）': 'memory', 复苏材料: 'memory', 追忆游丝: 'memory', 追忆碎絮: 'memory',
  塔罗斯技能: 'tartarus', 始源塔罗斯技能: 'tartarus',
  神格契约: 'divinity', 神骸: 'divinity', 神威纹章: 'divinity', 神格残片: 'divinity', 升华之楔: 'divinity', 归一之楔: 'divinity', 神威辉石: 'divinity',
  巨力之神: 'divinity', 狩猎之神: 'divinity', 知识之神: 'divinity', 征战之神: 'divinity', 欺诈之神: 'divinity', 机械之神: 'divinity', 冥王的神格: 'divinity', 冥王的残缺神格: 'divinity', 魂钉: 'divinity',
  异度棱镜: 'prism', 特殊棱镜: 'prism', 棱镜水平仪: 'prism', 棱镜校尺: 'prism', 棱镜修复仪: 'prism', 逆像的残影: 'prism',
  燃料: 'currency', 通用道具: 'material', 原初之核: 'map',
};
const ORGAN_PREFIXES = ['核心器官', '特殊器官', '完美', '普通器官'];
const CJK = /[\u3400-\u9fff]/;

export function categoryOf(cnType, id) {
  if (String(id) === '100300') return 'currency';
  if (CATEGORY_BY_TYPE[cnType]) return CATEGORY_BY_TYPE[cnType];
  if (ORGAN_PREFIXES.some((p) => String(cnType ?? '').startsWith(p))) return 'organ';
  return 'other';
}

// "https://tlidb.com/cn/Secret_of_the_Glacial_Abyss" -> "Secret of the Glacial Abyss"
export function nameFromTlidbUrl(url) {
  if (!url) return null;
  const slug = decodeURIComponent(String(url).replace(/\/+$/, '').split('/').pop() ?? '');
  const name = slug.replace(/_/g, ' ').trim();
  return name && !CJK.test(name) ? name : null;
}

const clean = (s) => String(s ?? '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();

export function buildLootItems(etorList, enTable) {
  const seen = new Map();
  for (const rec of etorList) seen.set(String(rec.id), (seen.get(String(rec.id)) ?? 0) + 1);
  const out = {};
  for (const rec of etorList) {
    const id = String(rec.id ?? '');
    if (!/^\d+$/.test(id)) continue;
    const slug = nameFromTlidbUrl(rec.url);
    const table = clean(enTable[id]?.name);
    // An id reused across seasons is listed more than once; the last record is current, and its
    // tlidb page names it better than the older table
    const name = (seen.get(id) > 1 && slug) || table || slug;
    if (!name || CJK.test(name)) continue;
    const icon = /^https:\/\/cdn\.tlidb\.com\//.test(rec.img ?? '') ? rec.img : null;
    const tlidb = /^https:\/\/tlidb\.com\//.test(rec.url ?? '') ? rec.url.replace('/cn/', '/en/') : null;
    out[id] = { name, category: categoryOf(rec.type, id), ...(icon ? { icon } : {}), ...(tlidb ? { tlidb } : {}) };
  }
  for (const [id, rec] of Object.entries(enTable)) {
    if (out[id] || !/^\d+$/.test(id)) continue;
    const name = clean(rec?.name);
    if (!name || CJK.test(name)) continue;
    out[id] = { name, category: categoryOf(null, id), type: clean(rec.type) || undefined };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => Number(a) - Number(b)));
}

async function main() {
  const get = async (file) => {
    const res = await fetch(MIRROR + file, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} ${MIRROR}${file}`);
    return res.json();
  };
  const [etor, en] = await Promise.all([get('etor_items_cn.json'), get('sattatracker_en_id_table.json')]);
  const items = buildLootItems(Array.isArray(etor) ? etor : [], en && typeof en === 'object' ? en : {});
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ _source: 'ETor item list + sattatracker English id table (MIT), via github.com/ArtemNA/tli-tracker; names from tlidb page slugs', _fetchedAt: new Date().toISOString(), ...items }, null, 0));
  const cats = {};
  for (const v of Object.values(items)) cats[v.category] = (cats[v.category] ?? 0) + 1;
  console.log(`${Object.keys(items).length} items -> ${path.relative(ROOT, OUT)}`, cats);
}

if (import.meta.main ?? path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
