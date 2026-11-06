// Prices for a sample build's pieces, best source first:
//   1. prices you typed in the Sample build tab ("Solid River: 4000 FE on day 1")
//   2. Exchange price checks you did in game, read from UE_game.log (10th percentile of the
//      listings, as TITrack does; server/log/lineParser.js 'exchangePrice' events)
//   3. The public TLI market (server/cloud/client.js): what other planner users saw, by name
//   4. TITrack Economy (data/prices/titrack.json, scripts/import-titrack.js): the newest season that
//      has the item (softcore before hardcore, then older seasons, then Standard)
// Legendary gear has no TITrack price; only 1 to 3 price it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/prices/titrack.json');
let titrack;
function loadTitrack() {
  if (titrack === undefined) {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      // Softcore seasons first, newest first; Standard last
      const rank = (s) => (s.id === 0 ? 1e9 : /hardcore/i.test(s.name) ? 5e8 - s.id : -s.id);
      const seasons = [...raw.seasons].sort((a, b) => rank(a) - rank(b));
      const nameOfId = new Map();
      for (const s of seasons) for (const [name, p] of Object.entries(s.items)) if (!nameOfId.has(p.id)) nameOfId.set(p.id, name);
      titrack = { fetchedAt: raw.fetchedAt, seasons, nameOfId };
    } catch {
      titrack = null;
    }
  }
  return titrack;
}

const user = new Map(); // name -> { fe, at }
const learned = new Map(); // name -> { fe, lowest, listings, at, id }

export function loadPriceState(state = {}) {
  user.clear();
  learned.clear();
  for (const [name, p] of Object.entries(state.user ?? {})) user.set(name, p);
  for (const [name, p] of Object.entries(state.learned ?? {})) learned.set(name, p);
}

export const priceState = () => ({ user: Object.fromEntries(user), learned: Object.fromEntries(learned) });

export function setUserPrice(name, fe) {
  if (!name) return;
  if (fe == null || fe === '') user.delete(name);
  else user.set(name, { fe: Number(fe), at: Date.now() });
}

// The name of a game id: a legendary, a base item, a skill, or what TITrack calls it
export function nameOfId(id, gd) {
  return gd?.name('uniques', id) ?? gd?.name('items', id) ?? gd?.name('skills', id) ?? loadTitrack()?.nameOfId.get(Number(id)) ?? null;
}

// An Exchange price check from the log: its item and the listings' 10th-percentile FE price.
// Returns the learned entry, or null when the check can't be named or isn't in Flame Elementium.
export function learnExchangePrice(ev, gd) {
  if (ev.currency !== 100300 || !ev.unitPrices?.length || ev.refers?.length !== 1) return null;
  const name = nameOfId(ev.refers[0], gd);
  if (!name) return null;
  const sorted = [...ev.unitPrices].sort((a, b) => a - b);
  const entry = { fe: sorted[Math.floor(sorted.length * 0.1)], lowest: sorted[0], listings: sorted.length, at: ev.time, id: ev.refers[0] };
  const prev = learned.get(name);
  if (prev && prev.at > entry.at) return null;
  learned.set(name, entry);
  return { name, ...entry };
}

// The public market (server/cloud/client.js priceByName), the only source that prices legendary
// gear; set once the client is up
let cloudLookup = null;
export function setCloudPrices(fn) {
  cloudLookup = fn;
}

// { fe, source, contributors?, at? } or null
export function priceOf(name) {
  if (!name) return null;
  const mine = user.get(name);
  if (mine) return { fe: mine.fe, source: 'your price', at: mine.at };
  const checked = learned.get(name);
  if (checked) return { fe: checked.fe, source: 'Exchange price check', at: checked.at, listings: checked.listings };
  const market = cloudLookup?.(name);
  if (market) return market;
  const d = loadTitrack();
  for (const s of d?.seasons ?? []) {
    const p = s.items[name];
    if (p) return { fe: p.fe, source: `TITrack ${s.name}`, season: s.name, contributors: p.contributors, change7dPct: p.change7dPct };
  }
  return null;
}

export function priceSource() {
  const d = loadTitrack();
  return { source: 'TITrack Economy (titrack.ninja)', fetchedAt: d?.fetchedAt ?? null, seasons: d?.seasons.map((s) => s.name) ?? [], yours: user.size, checked: learned.size };
}
