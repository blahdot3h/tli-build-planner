// Farming tracker: what YiHuo ETor's overlay shows, from the planner's own log reading. Drops and
// map runs come from server/farm/tracker.js, prices from ETor's public market (server/farm/market.js)
// plus the player's own Exchange price checks and prices typed in the UI. Finished runs are kept in
// MongoDB (farmRuns) so totals survive a restart; settings (tax, manual prices, excluded items, the
// session start) are the "farm" settings document.
// Events: 'farm' (the view changed)
import { EventEmitter } from 'node:events';
import { EtorMarket, FE_ID, PriceBook } from './market.js';
import { FarmTracker, groupDrops, runCostValue, runLootValue } from './tracker.js';

const PUSH_DEBOUNCE_MS = 400;
const QUIET_FLUSH_MS = 1500; // a bag page's Add lines are all in once the log has been quiet this long
const TICK_MS = 1000;
const HISTORY_DAYS = 14;
const RUNS_SHOWN = 40;
const NOTABLE_SHOWN = 15;
// A legendary worth less than this isn't worth asking about: nearly every base has one legendary
// that sells and the rest fetch next to nothing
const ASK_MIN_FE = 10;
// The log's "+maptype" values, named for the panel
const MAP_TYPE_NAMES = { Mystic: 'Netherrealm', S4GlobalMap: 'Timemark map', S12Map: 'Sub-area', S7BossMap: 'Boss arena', S5NightmareMystic: 'Nightmare', S10PillageMap: 'Pillage', S10CampsiteMap: 'Campsite' };

export class FarmService extends EventEmitter {
  constructor({ store, gamedata, logService, market = new EtorMarket(), now = () => Date.now() }) {
    super();
    this.setMaxListeners(0);
    this.store = store;
    this.gd = gamedata;
    this.now = now;
    // No session start of its own: the totals cover the game session (this log file) until "New
    // session" is pressed, so restarting the planner never drops the maps run before it
    this.tracker = new FarmTracker({ now: 0 });
    this.market = market;
    // identified: gear drop id -> legendary id or 'rare', from the yes/no prompts; denied: the
    // legendaries a drop was said not to be. The item catalog the log fills resolves the rest once
    // the game sends an identified item's details
    this.settings = { applyTax: true, manual: {}, excluded: [], sessionStart: null, identified: {}, denied: {} };
    this.catalog = () => logService?.state?.catalog ?? null;
    this.logStart = null; // first log time seen in this log file: the game session's start
    this.lastEventAt = 0;
    this.pushTimer = null;
    this.tracker.on('change', () => this.schedulePush());
    this.tracker.on('run', (run) => this.store.saveFarmRun?.(run));
    logService?.on?.('gameEvent', (ev) => this.onEvent(ev));
    logService?.on?.('logReset', () => {
      this.tracker.resetLog();
      this.logStart = null;
      this.schedulePush();
    });
  }

  async start() {
    for (const doc of await this.store.loadSettings()) {
      if (doc._id === 'farm') this.settings = { ...this.settings, ...doc.settings };
    }
    if (this.store.loadFarmRuns) {
      const runs = await this.store.loadFarmRuns(this.now() - HISTORY_DAYS * 86_400_000);
      this.tracker.addHistory(runs);
    }
    // Prices: the season the log says the character plays, else what ETor calls current
    this.market.setSeason(this.tracker.player?.seasonId ?? null);
    this.market.refresh().then(() => this.schedulePush());
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.pushTimer);
  }

  onEvent(ev) {
    this.lastEventAt = this.now();
    if (ev.time && (this.logStart == null || ev.time < this.logStart)) this.logStart = ev.time;
    this.tracker.handle(ev);
    if (ev.type === 'dump' && ev.name === 'GetPlayerData') {
      const season = this.tracker.player?.seasonId;
      if (season && season !== this.market.seasonId) {
        this.market.setSeason(season);
        this.market.refresh({ force: true }).then(() => this.schedulePush());
      }
    }
  }

  tick() {
    if (this.lastEventAt && this.now() - this.lastEventAt > QUIET_FLUSH_MS) this.tracker.flush();
    if (this.market.stale(this.now())) this.market.refresh().then((changed) => changed && this.schedulePush());
    if (this.tracker.dirty) this.schedulePush();
  }

  schedulePush() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.tracker.dirty = false;
      this.emit('farm', this.view());
    }, PUSH_DEBOUNCE_MS);
  }

  // ---- settings ----

  saveSettings() {
    this.store.saveSettings('farm', { settings: this.settings });
  }

  // { applyTax?, manual?: { id: fe | null }, excluded?: { id: bool } }
  setSettings(patch = {}) {
    if (typeof patch.applyTax === 'boolean') this.settings.applyTax = patch.applyTax;
    for (const [id, fe] of Object.entries(patch.manual ?? {})) {
      if (!/^\d+$/.test(id)) continue;
      if (fe == null || fe === '') delete this.settings.manual[id];
      else if (Number.isFinite(Number(fe)) && Number(fe) >= 0) this.settings.manual[id] = Number(fe);
    }
    for (const [id, on] of Object.entries(patch.excluded ?? {})) {
      if (!/^\d+$/.test(id)) continue;
      const set = new Set(this.settings.excluded);
      if (on) set.add(id);
      else set.delete(id);
      this.settings.excluded = [...set];
    }
    this.saveSettings();
    this.schedulePush();
    return this.view();
  }

  // What an unidentified gear drop was: a legendary's id, 'rare' (nothing special), or null to
  // forget (it gets asked again)
  setIdentified(stackId, what) {
    const id = String(stackId ?? '');
    if (!id) throw new Error('Which drop?');
    if (what == null || what === '') {
      delete this.settings.identified[id];
      delete this.settings.denied[id];
    } else if (what === 'rare') this.settings.identified[id] = 'rare';
    else if (this.gd.get('uniques', what)) this.settings.identified[id] = String(what);
    else throw new Error('No such legendary');
    this.saveSettings();
    this.schedulePush();
    return this.view();
  }

  // The yes/no prompt answered: "was it <uniqueId>?" Yes marks it; no rules that one out, and when
  // nothing worth asking about is left on the base the drop is a rare
  answer(stackId, uniqueId, yes) {
    const id = String(stackId ?? '');
    const unique = String(uniqueId ?? '');
    if (!id || !this.gd.get('uniques', unique)) throw new Error('Which drop?');
    if (yes) return this.setIdentified(id, unique);
    const denied = new Set(this.settings.denied[id] ?? []);
    denied.add(unique);
    this.settings.denied[id] = [...denied];
    const drop = this.tracker.current?.loot.concat(...this.tracker.history.map((r) => r.loot)).find((d) => d.stackId === id);
    const next = drop ? this.candidates(drop.baseId, id) : [];
    if (!next.length) this.settings.identified[id] = 'rare';
    this.saveSettings();
    this.schedulePush();
    return this.view();
  }

  // Totals start over from now
  newSession() {
    this.tracker.newSession(this.now());
    this.settings.sessionStart = this.now();
    this.saveSettings();
    this.schedulePush();
    return this.view();
  }

  async refreshPrices() {
    await this.market.refresh({ force: true });
    this.schedulePush();
    return this.view();
  }

  // ---- the view ----

  book() {
    return new PriceBook({
      market: this.market.table,
      search: this.tracker.search,
      manual: this.settings.manual,
      excluded: new Set(this.settings.excluded),
      applyTax: this.settings.applyTax,
      categoryOf: (id) => this.gd.get('lootItems', id)?.category ?? null,
    });
  }

  // Gear drops, as what they turned out to be: a legendary (marked in the UI, or known from the item
  // catalog once the game sent the identified item's details) counts as that legendary; a rare
  // counts as its base; the rest is still unknown
  resolveLoot(loot) {
    const catalog = this.catalog();
    return loot.map((d) => {
      if (!d.gear || !d.stackId) return d;
      let what = this.settings.identified[d.stackId] ?? null;
      if (!what) {
        const raw = catalog?.get(d.stackId);
        if (raw?.UniqueItmId) what = String(raw.UniqueItmId);
        else if (raw && raw.RareValue != null) what = 'rare';
      }
      if (what === 'rare') return { ...d, rare: true, from: 'rare' };
      if (what) return { ...d, baseId: what, from: 'unique', base: d.baseId };
      // Still unknown: ask about the most valuable legendary left on this base, if any is worth it
      const [ask] = this.candidates(d.baseId, d.stackId);
      return ask ? { ...d, unknown: true, ask } : { ...d, rare: true, from: 'cheap' };
    });
  }

  // The legendaries that drop on a base, with what they fetch, dearest first
  legendariesOn(baseId) {
    const book = this.book();
    return (this.gd.all('uniques') ?? [])
      .filter(([, u]) => String(u.baseId) === String(baseId))
      .map(([id, u]) => ({ id, name: u.name, icon: u.icon ?? null, price: book.resolve(id).price }))
      .sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
  }

  // Those worth asking about for one drop: worth over ASK_MIN_FE and not yet ruled out
  candidates(baseId, stackId) {
    const denied = new Set(this.settings.denied[stackId] ?? []);
    return this.legendariesOn(baseId).filter((u) => u.price > ASK_MIN_FE && !denied.has(u.id));
  }

  // Name, picture and kind of a dropped item: the loot table, else the planner's gear/legendary/skill tables
  describe(id) {
    const unique = this.gd.get('uniques', id);
    if (unique) return { name: unique.name, icon: unique.icon ?? null, category: 'legendary' };
    const loot = this.gd.get('lootItems', id);
    if (loot) return { name: loot.name, icon: loot.icon ?? this.gd.icon('items', id) ?? null, category: loot.category };
    const item = this.gd.get('items', id);
    if (item) return { name: item.name, icon: item.icon ?? null, category: 'gear' };
    const skill = this.gd.get('skills', id);
    if (skill) return { name: skill.name, icon: skill.icon ?? null, category: 'skill' };
    return { name: `#${id}`, icon: null, category: 'other' };
  }

  // The session's totals count runs started at or after the session start: this game session (the
  // current log), or later if "New session" was pressed since
  sessionStart() {
    return Math.max(this.settings.sessionStart ?? 0, this.logStart ?? 0, this.tracker.sessionStart ?? 0) || null;
  }

  mapName(run) {
    return MAP_TYPE_NAMES[run.mapType] ?? (run.mapType || (run.mapId ? `Map ${run.mapId}` : 'Map'));
  }

  view(now = this.now()) {
    const t = this.tracker;
    const book = this.book();
    // Every run's loot with its gear resolved (see resolveLoot), computed once per run
    const resolved = new Map();
    const lootOf = (run) => {
      if (!resolved.has(run)) resolved.set(run, { ...run, loot: this.resolveLoot(run.loot) });
      return resolved.get(run);
    };
    const named = (groups) =>
      groups
        .map((g) => (g.unknown ? { ...g, name: `? ${this.describe(g.baseId).name}`, icon: this.describe(g.baseId).icon, category: 'unknown', isFe: false } : { ...g, ...this.describe(g.baseId), isFe: g.baseId === FE_ID }))
        .sort((a, b) => b.value - a.value || b.qty - a.qty);
    const summarize = (run, activeMs) => {
      const lootValue = runLootValue(lootOf(run), book);
      const costValue = runCostValue(run, book);
      const profit = lootValue - costValue;
      return { lootValue, costValue, profit, activeMs, fePerMin: activeMs > 0 ? profit / (activeMs / 60_000) : null };
    };

    const sessionStart = this.sessionStart();
    const finished = t.history.filter((r) => !sessionStart || r.start >= sessionStart);
    const current = t.current;
    const last = t.history[t.history.length - 1] ?? null;
    const currentActive = t.liveDuration(now);
    const sessionRuns = current ? [...finished, current] : finished;
    const activeMs = finished.reduce((s, r) => s + r.durationMs, 0) + currentActive;
    const lootValue = sessionRuns.reduce((s, r) => s + runLootValue(lootOf(r), book), 0);
    const costValue = sessionRuns.reduce((s, r) => s + runCostValue(r, book), 0);
    // Gear still to be marked, newest first: "was it <ask.name>?"
    const unknown = sessionRuns
      .flatMap((r) => lootOf(r).loot.filter((d) => d.unknown).map((d) => ({ stackId: d.stackId, baseId: d.baseId, at: d.at, mapName: this.mapName(r), ...this.describe(d.baseId), ask: d.ask })))
      .sort((a, b) => b.at - a.at);
    const profit = lootValue - costValue;
    const running = !!current && t.status === 'active' && now - t.lastLogTime < 5 * 60_000;

    let status = 'waiting';
    if (!t.player) status = 'no-player';
    else if (current && running) status = 'in-map';
    else if (current) status = 'paused';
    else if (t.lastArea?.checkType === 'MainCity') status = 'town';

    return {
      status,
      serverTime: now,
      player: t.player,
      wallet: t.wallet(),
      trusted: t.baselineTrusted,
      current: current
        ? {
            id: current.id,
            areaId: current.areaId,
            mapId: current.mapId,
            mapType: current.mapType,
            mapName: this.mapName(current),
            start: current.start,
            running,
            subAreas: current.subAreas,
            ...summarize(current, currentActive),
            loot: named(groupDrops(lootOf(current).loot, book)),
            cost: named(groupDrops(current.cost, book).map((g) => ({ ...g, unit: book.costValue(g.baseId), value: g.qty * book.costValue(g.baseId) }))),
          }
        : null,
      // The map before this one, with its drops (what the mini box shows between maps)
      lastRun: last
        ? { id: last.id, areaId: last.areaId, mapName: this.mapName(last), start: last.start, end: last.end, ...summarize(last, last.durationMs), loot: named(groupDrops(lootOf(last).loot, book)) }
        : null,
      unknown,
      session: {
        start: sessionStart,
        runs: finished.length + (current ? 1 : 0),
        activeMs,
        lootValue,
        costValue,
        profit,
        fePerHour: activeMs > 0 ? profit / (activeMs / 3_600_000) : null,
        fePerMap: sessionRuns.length ? profit / sessionRuns.length : null,
        avgRunMs: finished.length ? finished.reduce((s, r) => s + r.durationMs, 0) / finished.length : null,
        notable: named(groupDrops(sessionRuns.flatMap((r) => lootOf(r).loot), book)).slice(0, NOTABLE_SHOWN),
      },
      runs: [...t.history]
        .reverse()
        .slice(0, RUNS_SHOWN)
        .map((r) => {
          const drops = named(groupDrops(lootOf(r).loot, book));
          return { id: r.id, areaId: r.areaId, mapName: this.mapName(r), start: r.start, end: r.end, inSession: !sessionStart || r.start >= sessionStart, ...summarize(r, r.durationMs), drops: drops.length, topDrop: drops[0] ?? null };
        }),
      prices: {
        ...this.market.status(),
        applyTax: this.settings.applyTax,
        searches: Object.keys(t.search).length,
        manual: Object.entries(this.settings.manual).map(([id, fe]) => ({ id, fe, ...this.describe(id) })),
        excluded: this.settings.excluded.map((id) => ({ id, ...this.describe(id) })),
      },
    };
  }
}
