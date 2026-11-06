import { EventEmitter } from 'node:events';

// Bag "pages" as they appear in ItemChange@ lines
export const PAGE = {
  EQUIPPED: -1,
  SLATES: -4,
  SKILLS: -6,
  GEAR_BAG: 100,
  SKILL_BAG: 101,
  MATERIAL_BAG: 102,
  MISC_BAG: 103,
};

const ITEM_ID = /^\d+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FEED_LIMIT = 200;
const COMPARISONS_KEPT = 30;
const DUMMY_TESTS_KEPT = 50;
// The game's recent-sounds counter (capped at 50) sits well above this while you hit something
const ATTACKING_NOISE = 10;

// The game's own DPS/DEF figures, logged when an item is compared. comparisons: one entry per
// item + slot (latest hover), oldest first. panel: the attribute panel's rows the last time your
// character screen's attribute tab was open ({ at, level, rows: [{ id, name, values }] });
// viewedPanel: the same for the last other player whose attributes you looked at.
const emptyGameStats = () => ({ dps: null, def: null, comparisons: new Map(), panel: null, viewedPanel: null });
// "AttrUtils:SetPlayerId" names whose attributes follow; another player's stay theirs this long
const ATTR_VIEW_MS = 30_000;

// Item instance ids look like "418_901001ec-9d37-11f1-bd79-000000000200": base id + uuid
export const baseIdOf = (itemId) => Number(String(itemId).split('_')[0]);

// Any object in a dump with an instance Id and a BaseId is an item with full details
// (affixes, rolls, level). Dumps truncate long lists, so not every owned item shows up.
function harvestItems(tree) {
  const found = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.Id === 'string' && ITEM_ID.test(o.Id) && o.BaseId !== undefined) found.push(o);
    for (const v of Object.values(o)) walk(v);
  };
  walk(tree);
  return found;
}

// Live game state rebuilt from log events.
// Events: 'login', 'items' (raw item details), 'equipment', 'feed' (entry), 'dummy' (a dummy
// session opened or closed), 'telemetry' (game DPS/DEF figures or dummy session changed)
export class GameState extends EventEmitter {
  constructor() {
    super();
    this.catalog = new Map(); // item id -> raw details; kept across sessions since items don't change id
    this.sessions = new Map(); // playerId -> { login, level, pages, gameStats, dummyTests } for characters played earlier
    this.reset();
  }

  // The character to show: the one logged in now, or one played earlier in this log
  view(playerId) {
    const current = this.login?.tree.player?.PlayerId;
    if (!playerId || String(playerId) === String(current)) return this;
    const s = this.sessions.get(String(playerId));
    return s ? { ...s, catalog: this.catalog, slotChangedAt: new Map() } : this;
  }

  // Sessions never include the character logged in now (it's removed on login)
  characters() {
    const list = [...this.sessions.values()].map((s) => ({
      playerId: String(s.login.tree.player.PlayerId),
      name: s.login.tree.player.Name,
      level: s.level,
      loginAt: s.login.time,
      current: false,
    }));
    const p = this.login?.tree.player;
    if (p) list.push({ playerId: String(p.PlayerId), name: p.Name, level: this.level, loginAt: this.login.time, current: true });
    return list;
  }

  // A new log file means a new game session: forget everything except item details
  reset() {
    this.login = null; // { time, tree } from the last GetPlayerData dump
    this.level = null;
    this.pages = new Map(); // page -> Map(slot -> { id, num })
    this.proto = null; // server message currently being applied; null during login sync
    this.displaced = new Map(); // item id -> equipped slot it was just pushed out of
    this.feed = [];
    this.slotChangedAt = new Map(); // equipped slot -> wall-clock ms, live changes only
    this.live = false; // false while catching up on what was already in the log
    this.gameStats = emptyGameStats();
    this.dummyTests = []; // hideout dummy sessions: { start, end, gear, gameDps, defs, attacking }
    this.dummy = null; // the dummy session in progress
    this.comparing = null; // the item the game is computing DPS/DEF for
    this.attrViewing = null; // { playerId, at, level } from the last AttrUtils:SetPlayerId
  }

  // Whether an attribute line at this time is about someone other than the logged-in character
  // (the "view player" page sets a different, or a short placeholder, player id first)
  viewingOther(time) {
    const v = this.attrViewing;
    if (!v || time - v.at > ATTR_VIEW_MS) return false;
    const own = this.login?.tree.player?.PlayerId;
    return !own || String(v.playerId) !== String(own);
  }

  page(id) {
    if (!this.pages.has(id)) this.pages.set(id, new Map());
    return this.pages.get(id);
  }

  equippedSlotOf(itemId) {
    for (const [slot, entry] of this.page(PAGE.EQUIPPED)) if (entry.id === itemId) return slot;
    return null;
  }

  apply(ev) {
    switch (ev.type) {
      case 'dump':
        return this.onDump(ev);
      case 'level':
        // Another player's level while looking at their attributes
        if (this.viewingOther(ev.time)) {
          this.attrViewing.level = ev.level;
          return;
        }
        // Ignore the transient "SetPlayerLv = 1" logged around logins
        if (ev.level > 1 || !this.login) this.level = ev.level;
        return;
      case 'attrPlayer':
        this.attrViewing = { playerId: ev.playerId, at: ev.time, level: null };
        return;
      case 'attrPanel':
        return this.onAttrPanel(ev);
      case 'proto':
        this.proto = ev.phase === 'start' ? ev.name : null;
        return;
      case 'pageReset':
        this.proto = null;
        this.pages.set(ev.page, new Map());
        return;
      case 'itemSet':
        return this.onItemSet(ev);
      case 'itemDelete':
        return this.onItemDelete(ev);
      case 'compareItem':
        this.comparing = ev;
        return;
      case 'gameStat':
        return this.onGameStat(ev);
      case 'dummy':
        if (ev.phase === 'show') this.openDummy(ev.time);
        else if (ev.phase === 'close') this.closeDummy(ev.time);
        return;
      case 'dummyDef':
        return this.onDummyDef(ev);
      case 'combatNoise':
        return this.onCombatNoise(ev);
    }
  }

  gearKey() {
    return [...this.page(PAGE.EQUIPPED)].map(([slot, e]) => `${slot}:${e.id}`).sort().join('|');
  }

  // The game logs "DPS: now -> with item" then "DEF: now -> with item" for each hover
  onGameStat(ev) {
    const stats = this.gameStats;
    stats[ev.stat] = { value: ev.current, at: ev.time, gear: this.gearKey() };
    const slot = this.comparing?.baseId === ev.baseId ? this.comparing.slot : null;
    const key = `${ev.baseId}:${ev.goldId}:${slot}`;
    let entry = stats.comparisons.get(key);
    if (!entry || entry[ev.stat]) {
      entry = { at: ev.time, baseId: ev.baseId, goldId: ev.goldId, slot };
      stats.comparisons.delete(key);
      stats.comparisons.set(key, entry);
      if (stats.comparisons.size > COMPARISONS_KEPT) stats.comparisons.delete(stats.comparisons.keys().next().value);
    }
    entry[ev.stat] = { now: ev.current, with: ev.compared };
    this.emit('telemetry');
  }

  // The attribute panel's rows: yours (kept with the character) or another player's
  onAttrPanel(ev) {
    const other = this.viewingOther(ev.time);
    const panel = { at: ev.time, level: other ? this.attrViewing.level : this.level, playerId: other ? this.attrViewing.playerId : null, rows: ev.rows };
    if (other) this.gameStats.viewedPanel = panel;
    else this.gameStats.panel = { ...panel, gear: this.gearKey() };
    this.emit('telemetry');
  }

  openDummy(time) {
    if (this.dummy) return; // re-shown after being hidden
    const gear = this.gearKey();
    const gameDps = this.gameStats.dps?.gear === gear ? this.gameStats.dps.value : null;
    this.dummy = { start: time, end: null, gear, gameDps, defs: [], attacking: new Set() };
    this.dummyTests.push(this.dummy);
    if (this.dummyTests.length > DUMMY_TESTS_KEPT) this.dummyTests.shift();
    this.emit('telemetry');
    this.emit('dummy', this.dummy);
  }

  closeDummy(time) {
    if (!this.dummy) return;
    const test = this.dummy;
    test.end = time;
    this.dummy = null;
    this.emit('telemetry');
    this.emit('dummy', test);
  }

  // The dummy window shows your DEF figure, logged about once a second; it rises with combat buffs
  onDummyDef(ev) {
    if (!this.dummy || this.dummy.defs.at(-1)?.value === ev.value) return;
    this.dummy.defs.push({ at: ev.time, value: ev.value });
    this.emit('telemetry');
  }

  onCombatNoise(ev) {
    if (!this.dummy || ev.count < ATTACKING_NOISE) return;
    const second = Math.floor(ev.time / 1000);
    if (this.dummy.attacking.has(second)) return;
    this.dummy.attacking.add(second);
    this.emit('telemetry');
  }

  onDump(ev) {
    const items = harvestItems(ev.tree);
    for (const item of items) this.catalog.set(item.Id, item);
    if (items.length) this.emit('items', items);

    const player = ev.tree.player;
    if (ev.name === 'GetPlayerData' && player?.PlayerId) {
      this.closeDummy(ev.time);
      // Keep the outgoing character viewable: its login data plus gear as it was left
      const previous = this.login?.tree.player?.PlayerId;
      const id = String(player.PlayerId);
      if (previous && String(previous) !== id) {
        const pages = new Map([...this.pages].map(([k, v]) => [k, new Map(v)]));
        // The game logs a transient "level 1" around each login, so never keep a level below the dump's
        const level = Math.max(this.level ?? 0, this.login.tree.player.Level ?? 0);
        this.sessions.set(String(previous), { login: this.login, level, pages, gameStats: this.gameStats, dummyTests: this.dummyTests });
        // A character played earlier in this log gets its game figures and dummy tests back
        const back = this.sessions.get(id);
        this.gameStats = back?.gameStats ?? emptyGameStats();
        this.dummyTests = back?.dummyTests ?? [];
      }
      this.sessions.delete(id);
      this.login = { time: ev.time, tree: ev.tree };
      this.level = player.Level ?? this.level;
      this.proto = null;
      this.pushFeed({ at: ev.time, kind: 'login', name: player.Name, level: player.Level, items: items.length });
      this.emit('login', this.login);
    } else if (items.length) {
      this.pushFeed({ at: ev.time, kind: 'dump', name: ev.name, lines: ev.lineCount, items: items.length });
    }
  }

  // Changes inside a server message (this.proto set) are live gear swaps; the Add/Update
  // flood right after login has no message wrapper and just restores the bags.
  onItemSet(ev) {
    const isEquip = ev.page === PAGE.EQUIPPED && this.proto;
    const movedFrom = isEquip ? this.equippedSlotOf(ev.id) : null;
    const page = this.page(ev.page);
    const prev = page.get(ev.slot);
    page.set(ev.slot, { id: ev.id, num: ev.num });

    if (isEquip && prev?.id !== ev.id) {
      if (prev) this.displaced.set(prev.id, ev.slot);
      this.slotChanged(ev.slot);
      this.pushFeed({ at: ev.time, kind: 'equip', slot: ev.slot, itemId: ev.id, movedFrom, replaced: prev?.id ?? null });
      this.emit('equipment', ev);
    } else if (this.proto && this.displaced.has(ev.id)) {
      // An item pushed out of an equipped slot landed in a bag
      const slot = this.displaced.get(ev.id);
      this.displaced.delete(ev.id);
      this.pushFeed({ at: ev.time, kind: 'unequip', slot, itemId: ev.id, to: ev.page });
    }
  }

  onItemDelete(ev) {
    const page = this.page(ev.page);
    if (page.get(ev.slot)?.id !== ev.id) return; // already replaced by a later Add
    page.delete(ev.slot);
    if (ev.page !== PAGE.EQUIPPED || !this.proto) return;

    this.slotChanged(ev.slot);
    // Removing the main hand shifts the off hand over: that's a move, not an unequip
    if (this.equippedSlotOf(ev.id) === null) {
      this.displaced.delete(ev.id);
      this.pushFeed({ at: ev.time, kind: 'unequip', slot: ev.slot, itemId: ev.id });
    }
    this.emit('equipment', ev);
  }

  slotChanged(slot) {
    if (this.live) this.slotChangedAt.set(slot, Date.now());
  }

  pushFeed(entry) {
    this.feed.push(entry);
    if (this.feed.length > FEED_LIMIT) this.feed.shift();
    this.emit('feed', entry);
  }
}
