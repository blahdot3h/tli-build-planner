// Drops and map runs from the log's events, the way the YiHuo ETor / TITrack trackers count them.
//
// Loot is the change in each bag stack: every "ItemChange@ Add/Update Id=<baseId>_<uuid> BagNum=<total>"
// line gives a stack's new total, so a pickup counts once however many lines report it. A change
// only counts when the stack's previous total is trusted: after the game re-sent the bag page
// ("ItemChange@ Reset PageId=102" + its Add lines at login or when the bag opens), or once the
// stack has been seen since. Pickups are the lines inside "ItemChange@ ProtoName=PickItems start/end";
// what the map device consumed is inside "ProtoName=Spv3Open".
//
// A run starts on entering an area that isn't the hideout/town ("checkType [MainCity]") and ends
// when the next one starts; going back to town pauses it, re-entering the same area resumes it.
// Costs paid in town (opening the map) belong to the next run.
import { EventEmitter } from 'node:events';

export const FE_ID = '100300';
const FIRST_BAG_PAGE = 100; // 100 gear, 101 skills, 102 currency/materials, 103 other; negatives are equipped
const GEAR_PAGE = 100;
const CALIBRATION_PAGES = [102, 103]; // once both have been re-sent, every stack's total is trusted
const TOWN_MAP_TYPES = new Set(['WorldBossChallengeMap', 'BossChallengeMap', 'TeamTdMap']);
// Areas entered from inside a map that continue the same run
const SUB_MAP_TYPES = new Set(['S12Map', 'S7BossMap', 'S5NightmareMystic', 'S10PillageMap', 'S10CampsiteMap']);
const COST_PROTOS = new Set(['Spv3Open', 'Spv3RefreshAffix', 'ClimbTowerOpen']);
const PICK_PROTOS = new Set(['PickItem', 'PickItems']);
const EXCHANGE_LOOT_IDS = new Set(['5140', '5142', '5143', '5144']); // memory items traded in-map count as loot
const COST_WINDOW_BEFORE_MS = 10_000;
const COST_WINDOW_AFTER_MS = 2_500;
const PUSH2_COST_WINDOW_MS = 1_500;
const MASS_REFRESH_TYPES = 20; // a "pickup" this big is the bag being re-sent, not loot
const MASS_REFRESH_QTY = 3_000;
export const STALE_AFTER_MS = 5 * 60_000; // the live timer stops when the log goes quiet this long

export const baseIdOf = (itemId) => String(itemId).split('_')[0];

// Events: 'change' (anything the view shows moved), 'run' (a run finished: the run)
export class FarmTracker extends EventEmitter {
  constructor({ now = Date.now() } = {}) {
    super();
    this.history = []; // finished runs, oldest first
    this.sessionStart = now;
    this.nextId = 1;
    this.search = {}; // baseId -> { price, at, listings } from the player's Exchange price checks
    this.lastLogTime = 0;
    this.current = null;
    this.resetLog();
  }

  // A new log file (the game restarted): the bag and the run in progress are gone
  resetLog() {
    this.finishCurrent(this.lastLogTime);
    this.player = null;
    this.inventory = new Map(); // stackId -> { baseId, qty, page, time }
    this.baselineTrusted = false;
    this.trustedPages = new Set();
    this.seenSinceInvalidation = new Set();
    this.block = null; // { kind: 'proto' | 'reset', name, page, time, items: [] } being collected
    this.pendingCosts = [];
    this.push2Cache = [];
    this.status = 'paused';
    this.resumedAt = null;
    this.lastArea = null;
    this.dirty = true;
  }

  // ---- events from the log parser ----

  handle(ev) {
    if (ev.time) this.lastLogTime = Math.max(this.lastLogTime, ev.time);
    switch (ev.type) {
      case 'proto':
        this.closeBlock();
        if (ev.phase === 'start') this.block = { kind: 'proto', name: ev.name, time: ev.time, items: [] };
        return;
      case 'pageReset':
        this.closeBlock();
        this.block = { kind: 'reset', page: ev.page, time: ev.time, items: [] };
        return;
      case 'itemSet':
        return this.item({ stackId: ev.id, baseId: baseIdOf(ev.id), qty: ev.num, page: ev.page, time: ev.time });
      case 'itemDelete':
        return this.item({ stackId: ev.id, baseId: baseIdOf(ev.id), qty: 0, page: ev.page, time: ev.time });
      case 'dump':
        this.closeBlock();
        if (ev.name === 'GetPlayerData' && ev.tree?.player?.PlayerId != null) {
          const p = ev.tree.player;
          this.onPlayer({ id: String(p.PlayerId), seasonId: p.SeasonId != null ? String(p.SeasonId) : null, name: p.Name ?? null }, ev.time);
        }
        return;
      case 'area':
        this.closeBlock();
        return this.onArea(ev);
      case 'exchangePrice':
        return this.onExchangePrice(ev);
      default:
        return;
    }
  }

  // The log went quiet: a bag page's Add lines are all in
  flush() {
    if (this.block?.kind === 'reset') this.closeBlock();
  }

  item(line) {
    if (this.block) {
      this.block.items.push(line);
      return;
    }
    // A stray line (no block): keep the snapshot right without recording anything
    this.apply([line]);
  }

  closeBlock() {
    const block = this.block;
    this.block = null;
    if (!block) return;
    if (block.kind === 'reset') return this.onPageReset(block.page, block.items);
    const { name, items, time } = block;
    if (PICK_PROTOS.has(name)) this.onLoot(items);
    else if (COST_PROTOS.has(name)) this.onMapCost(time, items);
    else if (name === 'ResetItemsLayout') {
      for (const page of new Set(items.map((i) => i.page))) this.onPageReset(page, items.filter((i) => i.page === page));
    } else if (name === 'Push2') this.onPush2(time, items);
    else if (name === 'ExchangeItem') {
      for (const [baseId, delta, at] of this.apply(items)) if (delta > 0 && this.current && EXCHANGE_LOOT_IDS.has(baseId)) this.addLoot(baseId, delta, at);
    } else this.apply(items);
  }

  // Updates the bag snapshot; returns [baseId, delta, time, stackId, page] for every change whose
  // previous total was trusted
  apply(items) {
    const out = [];
    for (const it of items) {
      if (it.page < FIRST_BAG_PAGE) continue;
      const prev = this.inventory.get(it.stackId);
      if (prev && it.time < prev.time) continue;
      const prevQty = prev?.qty ?? 0;
      const trusted = this.baselineTrusted || this.trustedPages.has(it.page) || this.seenSinceInvalidation.has(it.stackId);
      if (it.qty > 0) this.inventory.set(it.stackId, { baseId: it.baseId, qty: it.qty, page: it.page, time: it.time });
      else this.inventory.delete(it.stackId);
      this.seenSinceInvalidation.add(it.stackId);
      const delta = Math.max(0, it.qty) - prevQty;
      if (trusted && delta !== 0) out.push([it.baseId, delta, it.time, it.stackId, it.page]);
    }
    return out;
  }

  onLoot(items) {
    const types = new Set(items.map((i) => i.baseId));
    const total = items.reduce((s, i) => s + Math.max(0, i.qty), 0);
    if (types.size > MASS_REFRESH_TYPES && total > MASS_REFRESH_QTY) {
      this.apply(items);
      return;
    }
    const changes = this.apply(items);
    const net = new Map();
    for (const [baseId, delta] of changes) net.set(baseId, (net.get(baseId) ?? 0) + delta);
    if ([...net.values()].some((d) => d < 0)) {
      // A pickup can't shrink the bag: the snapshot was out of date
      this.invalidateBaseline();
      return;
    }
    if (!this.current) return;
    for (const [baseId, delta, at, stackId, page] of changes) if (delta > 0) this.addLoot(baseId, delta, at, stackId, page);
  }

  // A piece of gear (bag page 100) is logged by its base only: an unidentified legendary looks
  // like any rare of that base. It keeps its stack id (the item's own id) so it can be marked, or
  // recognized once the game sends the item's details
  addLoot(baseId, qty, at, stackId = null, page = null) {
    const drop = { baseId, qty, at };
    if (page === GEAR_PAGE && stackId) {
      drop.stackId = stackId;
      drop.gear = true;
    }
    this.current.loot.push(drop);
    this.changed();
  }

  onMapCost(time, items) {
    const trusted = (i) => this.baselineTrusted || this.trustedPages.has(i.page) || this.seenSinceInvalidation.has(i.stackId);
    const untrusted = items.filter((i) => !trusted(i)).map((i) => i.baseId);
    const costs = this.apply(items)
      .filter(([, d]) => d < 0)
      .map(([baseId, d, at]) => ({ baseId, qty: -d, at, estimated: false }));
    // Without a trusted previous total all we know is that one was used
    for (const baseId of untrusted) costs.push({ baseId, qty: 1, at: time, estimated: true });
    const active = this.status === 'active';
    for (const cost of costs) {
      const run = this.current;
      if (run && active && cost.at >= run.start - COST_WINDOW_BEFORE_MS && cost.at <= run.start + COST_WINDOW_AFTER_MS) run.cost.push(cost);
      else this.pendingCosts.push(cost);
    }
    if (costs.length) this.changed();
  }

  // Bag updates the server pushes rather than pickups you make. In a map they are loot handed over
  // (the Sandlord campsite logs every drop this way, no PickItems at all); in town, something
  // taken from the bag just before a map starts is part of its cost
  onPush2(time, items) {
    const changes = this.apply(items);
    if (this.status === 'active') {
      if (this.current) for (const [baseId, d, at, stackId, page] of changes) if (d > 0) this.addLoot(baseId, d, at, stackId, page);
      return;
    }
    for (const [baseId, d] of changes) if (d < 0) this.push2Cache.push({ baseId, qty: -d, at: time, estimated: false });
  }

  onPageReset(page, items) {
    if (page == null || page < FIRST_BAG_PAGE) {
      this.apply(items);
      return;
    }
    const listed = new Set(items.map((i) => i.stackId));
    for (const [id, stack] of this.inventory) if (stack.page === page && !listed.has(id)) this.inventory.delete(id);
    for (const it of items) {
      if (it.page < FIRST_BAG_PAGE) continue;
      if (it.qty > 0) this.inventory.set(it.stackId, { baseId: it.baseId, qty: it.qty, page: it.page, time: it.time });
      this.seenSinceInvalidation.add(it.stackId);
    }
    this.trustedPages.add(page);
    if (CALIBRATION_PAGES.every((p) => this.trustedPages.has(p))) this.baselineTrusted = true;
    this.changed();
  }

  onPlayer(player, time) {
    const changed = !this.player || this.player.id !== player.id || this.player.seasonId !== player.seasonId;
    if (changed) {
      this.finishCurrent(time);
      this.inventory.clear();
    }
    this.player = player;
    // A fresh login may follow changes the log never showed
    this.invalidateBaseline();
    this.changed();
  }

  onArea(ev) {
    const info = { areaId: ev.areaId ?? '', mapId: ev.mapId ?? '', mapType: ev.mapType ?? '', checkType: ev.checkType ?? '', ownerPlayerId: ev.ownerPlayerId ?? '' };
    this.lastArea = { ...info, at: ev.time };
    if (this.player && info.ownerPlayerId && info.ownerPlayerId !== this.player.id) return this.pause(ev.time);
    const town = info.checkType === 'MainCity' || TOWN_MAP_TYPES.has(info.mapType) || (!info.mapType && !info.checkType);
    if (town || !info.areaId) return this.pause(ev.time);
    const run = this.current;
    if (run) {
      if (run.areaId === info.areaId) return this.resume(ev.time);
      if (SUB_MAP_TYPES.has(info.mapType)) {
        run.subAreas += 1;
        return this.resume(ev.time);
      }
    }
    this.finishCurrent(ev.time);
    this.startRun(ev.time, info);
  }

  onExchangePrice(ev) {
    if (ev.currency !== 100300 || ev.refers?.length !== 1 || !ev.unitPrices?.length) return;
    const sorted = [...ev.unitPrices].filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
    if (!sorted.length) return;
    const id = String(ev.refers[0]);
    const prev = this.search[id];
    if (prev && prev.at > ev.time) return;
    // The cheapest tenth of the listings, as TITrack prices things
    this.search[id] = { price: sorted[Math.floor(sorted.length * 0.1)], at: ev.time, listings: sorted.length };
    this.changed();
  }

  // ---- runs ----

  startRun(time, info) {
    const cost = this.pendingCosts.splice(0).concat(this.push2Cache.filter((d) => d.at >= time - PUSH2_COST_WINDOW_MS && d.at <= time));
    this.push2Cache = [];
    this.current = {
      id: this.nextId++,
      playerId: this.player?.id ?? null,
      seasonId: this.player?.seasonId ?? null,
      areaId: info.areaId,
      mapId: info.mapId,
      mapType: info.mapType,
      start: time,
      end: null,
      durationMs: 0,
      subAreas: 0,
      loot: [],
      cost,
    };
    this.status = 'active';
    this.resumedAt = time;
    this.changed();
  }

  pause(time) {
    if (this.status === 'active' && this.current && this.resumedAt != null) this.current.durationMs += Math.max(0, time - this.resumedAt);
    this.status = 'paused';
    this.resumedAt = null;
    this.changed();
  }

  resume(time) {
    if (!this.current || this.status === 'active') return;
    this.status = 'active';
    this.resumedAt = time;
    this.changed();
  }

  finishCurrent(time) {
    this.pause(time);
    const run = this.current;
    if (!run) return;
    this.current = null;
    run.end = Math.max(run.start, time);
    this.history.push(run);
    this.emit('run', run);
    this.changed();
  }

  invalidateBaseline() {
    this.baselineTrusted = false;
    this.trustedPages.clear();
    this.seenSinceInvalidation.clear();
    this.dirty = true;
  }

  changed() {
    this.dirty = true;
    this.emit('change');
  }

  // Active (in-map) time of the run in progress, including the segment running now
  // Flame Elementium in the bag, as last seen (null before the bag was read)
  wallet() {
    let fe = null;
    for (const it of this.inventory.values()) if (it.baseId === FE_ID && it.qty > 0) fe = (fe ?? 0) + it.qty;
    return fe;
  }

  liveDuration(now = Date.now()) {
    const run = this.current;
    if (!run) return 0;
    let running = 0;
    if (this.status === 'active' && this.resumedAt != null) {
      const until = Math.min(now, Math.max(this.lastLogTime, this.resumedAt) + STALE_AFTER_MS);
      running = Math.max(0, until - this.resumedAt);
    }
    return run.durationMs + running;
  }

  // Totals start over (the run in progress ends and counts toward the old session)
  newSession(now = Date.now()) {
    this.finishCurrent(this.lastLogTime || now);
    this.sessionStart = now;
    this.changed();
  }

  // Runs from earlier logs (MongoDB) merged in, without duplicating this log's
  addHistory(runs) {
    const have = new Set(this.history.map((r) => `${r.playerId}:${r.areaId}:${r.start}`));
    for (const run of runs) {
      const key = `${run.playerId}:${run.areaId}:${run.start}`;
      if (have.has(key)) continue;
      have.add(key);
      this.history.push({ ...run, id: this.nextId++ });
    }
    this.history.sort((a, b) => a.start - b.start);
    this.dirty = true;
  }
}

// ---- valuing runs ----

export const runLootValue = (run, book) => run.loot.reduce((s, d) => s + (d.unknown ? 0 : d.qty * book.lootValue(d.baseId)), 0);
export const runCostValue = (run, book) => run.cost.reduce((s, d) => s + d.qty * book.costValue(d.baseId), 0);

// Drops of a run (or several) grouped by item: [{ baseId, qty, unit, value, at (first), price }].
// Gear still unidentified (drop.unknown, see FarmService.resolveLoot) is listed piece by piece, by
// its own id, and is worth nothing until marked
export function groupDrops(drops, book) {
  const by = new Map();
  for (const d of drops) {
    const key = d.unknown ? `?${d.stackId}` : d.baseId;
    const g = by.get(key) ?? { baseId: d.baseId, qty: 0, at: d.at, estimated: false, ...(d.unknown ? { unknown: true, stackId: d.stackId, ask: d.ask ?? null } : {}), ...(d.rare ? { rare: true } : {}) };
    g.qty += d.qty;
    g.at = Math.min(g.at, d.at);
    g.estimated = g.estimated || !!d.estimated;
    by.set(key, g);
  }
  return [...by.values()].map((g) => {
    const unit = g.unknown ? 0 : book.lootValue(g.baseId);
    return { ...g, unit, value: g.qty * unit, price: g.unknown ? { price: 0, source: 'none', updatedAt: 0 } : book.resolve(g.baseId) };
  });
}
