// The planner's side of the public market (cloud/): downloads the folded prices for the season once
// in a while (cached in <data>/prices/cloud-<season>.json, used offline), and, only when sharing is
// turned on, sends what this player saw: Exchange price checks from the log, prices typed for an
// item, and builds the player chooses to share. Nothing identifies the player: the reporter id is a
// random UUID made once and kept in the planner's own settings; the market stores a hash of it.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { buildSummary, itemSignature } from './signature.js';
import { writableDir } from '../paths.js';

export const DEFAULT_URL = 'https://tli-market.YOUR-SUBDOMAIN.workers.dev';
const REFRESH_MS = 30 * 60_000;
const FLUSH_MS = 5000;
const BATCH = 50;
const FE_ID = 100300;

export class CloudClient extends EventEmitter {
  constructor({ store, gamedata, url = process.env.TLI_CLOUD_URL || DEFAULT_URL, fetchImpl = globalThis.fetch, cacheDir = null, now = Date.now } = {}) {
    super();
    this.store = store;
    this.gd = gamedata;
    this.url = url.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
    this.cacheDir = cacheDir ?? writableDir('prices');
    this.now = now;
    this.settings = { share: false, reporterId: null };
    this.seasonId = null;
    this.table = { season: null, fetchedAt: 0, families: new Map(), signatures: new Map(), byName: new Map() };
    this.queue = [];
    this.flushTimer = null;
    this.refreshing = null;
    this.lastError = null;
    this.sent = 0;
    this.enabled = !/YOUR-SUBDOMAIN/.test(this.url); // the placeholder URL means no market is set up
  }

  async start() {
    for (const doc of await this.store.loadSettings()) if (doc._id === 'cloud') this.settings = { ...this.settings, share: !!doc.share, reporterId: doc.reporterId ?? null };
    if (!this.settings.reporterId) {
      this.settings.reporterId = randomUUID();
      this.store.saveSettings('cloud', { reporterId: this.settings.reporterId });
    }
  }

  status() {
    return {
      enabled: this.enabled,
      url: this.url,
      share: this.settings.share,
      reporter: this.settings.reporterId ? `${this.settings.reporterId.slice(0, 8)}…` : null,
      season: this.table.season,
      fetchedAt: this.table.fetchedAt || null,
      families: this.table.families.size,
      signatures: this.table.signatures.size,
      queued: this.queue.length,
      sent: this.sent,
      error: this.lastError,
    };
  }

  setShare(on) {
    this.settings.share = !!on;
    this.store.saveSettings('cloud', { share: this.settings.share });
    if (!on) this.queue = [];
    else this.scheduleFlush();
    this.emit('cloud', this.status());
    return this.status();
  }

  // The season the character plays (the log says): cached prices load at once, fresh ones come
  // with the next refresh
  setSeason(seasonId) {
    const id = seasonId ? String(seasonId) : null;
    if (!id || id === this.seasonId) return;
    this.seasonId = id;
    if (!this.loadCache(id)) this.table = { season: id, fetchedAt: 0, families: new Map(), signatures: new Map(), byName: new Map() };
    this.emit('cloud', this.status());
  }

  cacheFile(season) {
    return path.join(this.cacheDir, `cloud-${season}.json`);
  }

  loadCache(season) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.cacheFile(season), 'utf8'));
      if (Array.isArray(raw?.families) && Array.isArray(raw?.signatures)) {
        this.setTable(season, raw.fetchedAt || 0, raw.families, raw.signatures);
        return true;
      }
    } catch {
      // No cache yet
    }
    return false;
  }

  setTable(season, fetchedAt, families, signatures) {
    const byName = new Map();
    for (const f of families) if (f.name) byName.set(f.name.toLowerCase(), f);
    this.table = { season, fetchedAt, families: new Map(families.map((f) => [f.family, f])), signatures: new Map(signatures.map((s) => [s.signature, s])), byName };
  }

  stale() {
    return this.now() - this.table.fetchedAt > REFRESH_MS;
  }

  async api(pathname, init = {}) {
    const res = await this.fetchImpl(`${this.url}${pathname}`, {
      ...init,
      headers: { Accept: 'application/json', 'User-Agent': 'tli-build-planner', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status} from ${pathname}`);
    return body;
  }

  // Download the season's folded prices (the whole table, one cached request)
  async refresh({ force = false } = {}) {
    if (!this.enabled || (!force && !this.stale())) return false;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const body = await this.api(`/v1/export/prices${this.seasonId ? `?season=${this.seasonId}` : ''}`);
        if (!body?.season) return false;
        const fetchedAt = this.now();
        this.setTable(String(body.season), fetchedAt, body.families ?? [], body.signatures ?? []);
        if (!this.seasonId) this.seasonId = String(body.season);
        this.lastError = null;
        try {
          fs.writeFileSync(this.cacheFile(body.season), JSON.stringify({ source: this.url, season: body.season, fetchedAt, families: body.families ?? [], signatures: body.signatures ?? [] }));
        } catch {
          // The cache is a convenience
        }
        this.emit('cloud', this.status());
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

  // ---- reading prices ----

  familyPrice(family) {
    return this.table.families.get(family) ?? null;
  }

  signaturePrice(signature) {
    return this.table.signatures.get(signature) ?? null;
  }

  // What the market says an item like this one goes for: this exact roll where enough people saw
  // one, else any copy. { fe, source, n, reporters, exact, ... } or null
  priceFor(item) {
    const sig = itemSignature(item, this.gd);
    const exact = this.signaturePrice(sig.signature);
    const family = this.familyPrice(sig.family);
    const pick = (row, isExact) => ({ fe: buyPrice(row), median: row.median, p25: row.p25, n: row.n, reporters: row.reporters, exact: isExact, source: `TLI market (${row.n} sighting${row.n === 1 ? '' : 's'}${isExact ? ', this roll' : ''})`, lastSeen: row.lastSeen, signature: sig.signature, family: sig.family });
    if (exact && exact.reporters >= 2) return pick(exact, true);
    if (family) return pick(family, false);
    return exact ? pick(exact, true) : null;
  }

  // By name (legendaries and base items), for the sample build's prices: a family's buy price
  priceByName(name) {
    const row = name ? this.table.byName.get(String(name).toLowerCase()) : null;
    return row ? { fe: buyPrice(row), source: `TLI market (${row.n} sighting${row.n === 1 ? '' : 's'})`, n: row.n, reporters: row.reporters, at: row.lastSeen, family: row.family } : null;
  }

  // ---- sending ----

  // An item (describeItem output) seen at a price: queued when sharing is on
  observeItem(item, fe, { source = 'manual', seenAt = this.now(), listings = null } = {}) {
    const price = Number(fe);
    if (!item || !(price > 0)) return null;
    const sig = itemSignature(item, this.gd);
    const obs = {
      signature: sig.signature,
      kind: sig.kind,
      uniqueId: sig.uniqueId,
      baseId: sig.baseId,
      type: sig.type,
      name: item.uniqueName ?? item.name ?? this.gd.name('uniques', sig.uniqueId) ?? this.gd.name('items', sig.baseId) ?? null,
      price,
      listings,
      source,
      mods: sig.mods.length ? sig.mods : undefined,
      seenAt,
    };
    this.enqueue(obs);
    return obs;
  }

  // An Exchange price check from the log (lineParser 'exchangePrice'): the item searched and the
  // cheapest tenth of its listings, as TITrack and the farm tracker price things
  observeExchange(ev) {
    if (ev.currency !== FE_ID || ev.refers?.length !== 1 || !ev.unitPrices?.length) return null;
    const sorted = [...ev.unitPrices].filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const baseId = String(ev.refers[0]);
    const obs = {
      signature: `B${baseId}`,
      kind: 'base',
      baseId,
      name: this.gd.name('uniques', baseId) ?? this.gd.name('items', baseId) ?? this.gd.name('skills', baseId) ?? this.gd.get('lootItems', baseId)?.name ?? null,
      price: sorted[Math.floor(sorted.length * 0.1)],
      listings: sorted.length,
      source: 'exchange',
      seenAt: ev.time,
    };
    this.enqueue(obs);
    return obs;
  }

  enqueue(obs) {
    if (!this.settings.share || !this.enabled) return;
    this.queue.push(obs);
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushTimer || !this.queue.length) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => {});
    }, FLUSH_MS);
    this.flushTimer.unref?.();
  }

  async flush() {
    if (!this.settings.share || !this.enabled || !this.queue.length) return { sent: 0 };
    if (!this.seasonId) {
      this.lastError = 'No season known yet (log in to the game)';
      return { sent: 0 };
    }
    let sent = 0;
    while (this.queue.length) {
      const batch = this.queue.splice(0, BATCH);
      try {
        await this.api('/v1/observations', { method: 'POST', body: JSON.stringify({ season: this.seasonId, reporter: this.settings.reporterId, observations: batch }) });
        sent += batch.length;
        this.sent += batch.length;
        this.lastError = null;
      } catch (err) {
        this.lastError = err.message;
        this.queue.unshift(...batch);
        break;
      }
    }
    this.emit('cloud', this.status());
    return { sent, error: this.lastError };
  }

  // A build shared on purpose (never automatic): the character as the planner shows it, summarized
  async shareBuild(character, { notes = null } = {}) {
    if (!this.enabled) throw new Error('No market URL is configured (TLI_CLOUD_URL)');
    const build = buildSummary(character, this.gd, { seasonId: this.seasonId });
    if (!build) throw new Error('No character loaded yet');
    if (notes) build.notes = String(notes).slice(0, 500);
    const body = await this.api('/v1/builds', { method: 'POST', body: JSON.stringify({ reporter: this.settings.reporterId, build }) });
    this.emit('cloud', this.status());
    return { id: body.id, url: `${this.url}/v1/builds/${body.id}`, build };
  }
}

// What a buyer can expect to pay: the lower quartile once a few people have seen one, else the median
export const buyPrice = (row) => (row.n >= 4 && row.p25 != null ? row.p25 : row.median);
