// Item prices from TITrack Economy (titrack.ninja; TITrack is MIT, github.com/astockman99/TITrack):
// median Flame Elementium prices the community's TITrack apps read off the in-game Exchange, per
// season. It covers stackable items (skill gems, Destinies, prisms, slates, organs, compasses,
// currency), not legendary gear, whose rolls make every copy different.
//
//   node scripts/import-titrack.js        every season TITrack lists
//
// Writes data/prices/titrack.json: { fetchedAt, seasons: [{ id, name, items: { name: {...} } }] },
// newest season first. Prices are a season's latest (TITrack shows the last 7 days as a trend), so an
// ended season's are end-of-season prices.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'prices');
const URL_BASE = 'https://titrack.ninja/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) tli-build-planner';

// The page embeds its data as escaped JSON in the Next.js payload
export function parseEconomyPage(html) {
  const text = html.replace(/\\"/g, '"');
  const seasons = JSON.parse(/"seasons":(\[[^\]]*\])/.exec(text)?.[1] ?? '[]');
  const items = {};
  const re = /\{"config_base_id":(\d+),"name":"([^"]*)","category":"([^"]*)","icon_url":"[^"]*","price_fe_median":([\d.]+),"change_24h":(-?[\d.]+|null),"change_7d":(-?[\d.]+|null),"unique_devices":(\d+)(?:,"sparkline":\[([^\]]*)\])?/g;
  for (const m of text.matchAll(re)) {
    items[m[2]] = {
      id: Number(m[1]),
      category: m[3],
      fe: Number(m[4]),
      change24hPct: m[5] === 'null' ? null : Number(m[5]),
      change7dPct: m[6] === 'null' ? null : Number(m[6]),
      contributors: Number(m[7]),
      week: m[8] ? m[8].split(',').map(Number) : [],
    };
  }
  return { seasons, items };
}

async function main() {
  const get = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.text();
  };
  const first = parseEconomyPage(await get(URL_BASE));
  const seasons = [];
  for (const s of first.seasons) {
    const { items } = parseEconomyPage(await get(`${URL_BASE}?season=${s.season_id}`));
    seasons.push({ id: s.season_id, name: s.name, items });
    console.log(`${s.name}: ${Object.keys(items).length} items`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'titrack.json'), JSON.stringify({ source: URL_BASE, fetchedAt: new Date().toISOString(), seasons }, null, 1));
}

if (import.meta.main ?? path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
