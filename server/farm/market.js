// The economy the drop tracker values loot with: ETor's public price service (the YiHuo ETor FE
// tracker's own market, https://etor-beta.710421059.xyz/etor-api), read-only:
//   GET /api/player/season-status        -> { currentSeasonId: "1601", ... }
//   GET /api/prices-snapshot/<seasonId>  -> { data: [{ id: "<baseId>", price: <FE>, updatedAt }] }
// Prices are in Flame Elementium per unit (FE itself is 1 and isn't listed). The snapshot is cached
// in data/prices/etor-<season>.json and refreshed every REFRESH_MS; when the service is down the
// cache keeps being used. Nothing about the player is ever sent.
import fs from 'node:fs';
import path from 'node:path';
import { writableDir } from '../paths.js';

export const ETOR_API = 'https://etor-beta.710421059.xyz/etor-api';
export const FE_ID = '100300'; // Flame Elementium
export const SALE_TAX = 0.125; // the Exchange's cut on every sale
const REFRESH_MS = 15 * 60_000;
const MAX_PRICE = 10_000_000;
const MAX_ROWS = 20_000;
const CACHE_DIR = writableDir('prices');

const isId = (s) => typeof s === 'string' && /^\d{1,12}$/.test(s);

// Rows of a snapshot body as { id: { price, updatedAt } }, dropping anything malformed
export function parseSnapshot(body) {
  const rows = {};
  const data = Array.isArray(body?.data) ? body.data.slice(0, MAX_ROWS) : [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const id = typeof row.id === 'number' ? String(row.id) : row.id;
    const price = typeof row.price === 'string' ? Number(row.price.trim()) : row.price;
    if (!isId(id) || typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > MAX_PRICE) continue;
    const updatedAt = typeof row.updatedAt === 'string' ? Date.parse(row.updatedAt) : NaN;
    rows[id] = { price, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 };
  }
  return rows;
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'tli-build-planner' }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  if (!/^application\/json/i.test(res.headers.get('content-type') ?? '')) throw new Error(`Not JSON from ${url}`);
  return res.json();
}

// ETor's market for one season (the game's season id, e.g. 1601 = SS14 Tartarus; omitted = the one
// ETor calls current). Call refresh() and read .table.
export class EtorMarket {
  constructor({ cacheDir = CACHE_DIR, fetchImpl = globalThis.fetch, seasonId = null } = {}) {
    this.cacheDir = cacheDir;
    this.fetchImpl = fetchImpl;
    this.seasonId = seasonId ? String(seasonId) : null;
    this.table = { seasonId: null, fetchedAt: 0, rows: {} };
    this.lastError = null;
    this.refreshing = null;
    if (this.seasonId) this.loadCache(this.seasonId);
  }

  cacheFile(seasonId) {
    return path.join(this.cacheDir, `etor-${seasonId}.json`);
  }

  // The cached snapshot for the season, if there is one
  loadCache(seasonId = this.seasonId) {
    if (!seasonId) return false;
    try {
      const raw = JSON.parse(fs.readFileSync(this.cacheFile(seasonId), 'utf8'));
      if (raw?.rows && typeof raw.rows === 'object') {
        this.table = { seasonId: String(seasonId), fetchedAt: Number(raw.fetchedAt) || 0, rows: raw.rows };
        return true;
      }
    } catch {
      // No cache yet
    }
    return false;
  }

  // Switch seasons (the log says which season the character plays): cached prices load at once,
  // fresh ones come with the next refresh
  setSeason(seasonId) {
    const id = seasonId ? String(seasonId) : null;
    if (!id || id === this.seasonId) return;
    this.seasonId = id;
    if (!this.loadCache(id)) this.table = { seasonId: id, fetchedAt: 0, rows: {} };
  }

  stale(now = Date.now()) {
    return now - this.table.fetchedAt > REFRESH_MS;
  }

  // Download the season's snapshot (and the current season id when none is known). Errors are kept
  // in lastError; the table only changes on success.
  async refresh({ force = false, now = Date.now() } = {}) {
    if (!force && !this.stale(now)) return false;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        if (!this.seasonId) {
          const status = await getJson(`${ETOR_API}/api/player/season-status`, this.fetchImpl);
          const id = typeof status?.currentSeasonId === 'number' ? String(status.currentSeasonId) : status?.currentSeasonId;
          if (!isId(id)) throw new Error('ETor season status has no season id');
          this.seasonId = id;
        }
        const body = await getJson(`${ETOR_API}/api/prices-snapshot/${this.seasonId}`, this.fetchImpl);
        const rows = parseSnapshot(body);
        if (!Object.keys(rows).length) throw new Error('ETor price snapshot was empty');
        this.table = { seasonId: this.seasonId, fetchedAt: now, rows };
        this.lastError = null;
        try {
          fs.mkdirSync(this.cacheDir, { recursive: true });
          fs.writeFileSync(this.cacheFile(this.seasonId), JSON.stringify({ source: ETOR_API, seasonId: this.seasonId, fetchedAt: now, rows }));
        } catch {
          // The cache is a convenience
        }
        return true;
      } catch (err) {
        this.lastError = err.message;
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  status() {
    return { source: 'ETor (etor-beta.710421059.xyz)', seasonId: this.table.seasonId, fetchedAt: this.table.fetchedAt || null, rows: Object.keys(this.table.rows).length, error: this.lastError };
  }
}

// A representative FE price from an Exchange search's listings: a lone lowball on an expensive
// item is skipped, outliers beyond 1.5 IQR dropped, then a low percentile that gets lower as the
// sample grows (median up to 5 listings, 35th to 12, 25th beyond). { price, samples, listings }
export function marketPrice(unitPrices) {
  const sorted = (unitPrices ?? []).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const min = sorted[0];
  const minCount = sorted.filter((p) => p === min).length;
  let chosen;
  if (sorted.length > 1 && min > 100 && minCount <= 3 && minCount < sorted.length) chosen = sorted[minCount];
  else {
    const kept = filterOutliers(sorted);
    const q = sorted.length <= 5 ? 0.5 : sorted.length <= 12 ? 0.35 : 0.25;
    chosen = percentile(kept, q) ?? percentile(sorted, 0.5) ?? min;
  }
  return { price: roundPrice(chosen), samples: sorted.filter((p) => p <= chosen).length, listings: sorted.length };
}

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo);
}

function filterOutliers(sorted) {
  if (sorted.length < 6) return sorted;
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  if (!(iqr > 0)) return sorted;
  const kept = sorted.filter((p) => p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr);
  return kept.length ? kept : sorted;
}

export function roundPrice(p) {
  const digits = p < 0.1 ? 4 : p < 1 ? 3 : p < 10 ? 2 : p < 100 ? 1 : 0;
  const f = 10 ** digits;
  return Math.round(p * f) / f;
}

// What an item is worth, best source first: FE is 1; a price you typed; the newer of your own
// Exchange price check and ETor's market; organs are never priced (they aren't tradable)
//   market: EtorMarket.table, search: { id: { price, at } }, manual: { id: fe },
//   excluded: Set of ids counted at 0, applyTax: take the Exchange's 12.5% off loot (never off costs),
//   categoryOf: (id) => 'organ' | ...
export class PriceBook {
  constructor({ market, search = {}, manual = {}, excluded = new Set(), applyTax = true, categoryOf = () => null }) {
    this.market = market;
    this.search = search;
    this.manual = manual;
    this.excluded = excluded;
    this.applyTax = applyTax;
    this.categoryOf = categoryOf;
  }

  // { price, source: 'currency' | 'manual' | 'search' | 'market' | 'none', updatedAt }
  resolve(id) {
    const key = String(id);
    if (key === FE_ID) return { price: 1, source: 'currency', updatedAt: 0 };
    if (this.manual[key] != null) return { price: Number(this.manual[key]) || 0, source: 'manual', updatedAt: 0 };
    if (this.categoryOf(key) === 'organ') return { price: 0, source: 'none', updatedAt: 0 };
    const m = this.market?.rows?.[key];
    const s = this.search[key];
    if (s && (!m || s.at > m.updatedAt)) return { price: s.price, source: 'search', updatedAt: s.at };
    if (m) return { price: m.price, source: 'market', updatedAt: m.updatedAt };
    return { price: 0, source: 'none', updatedAt: 0 };
  }

  // Per unit, after the Exchange's cut (FE is never taxed)
  lootValue(id) {
    const key = String(id);
    if (this.excluded.has(key)) return 0;
    const p = this.resolve(key).price;
    return this.applyTax && key !== FE_ID ? p * (1 - SALE_TAX) : p;
  }

  costValue(id) {
    const key = String(id);
    return this.excluded.has(key) ? 0 : this.resolve(key).price;
  }
}
