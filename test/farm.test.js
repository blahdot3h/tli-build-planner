import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { FarmTracker, groupDrops, STALE_AFTER_MS } from '../server/farm/tracker.js';
import { PriceBook, marketPrice, parseSnapshot } from '../server/farm/market.js';
import { FarmService } from '../server/farm/service.js';

const T0 = Date.UTC(2026, 10, 2, 4, 0, 0);
const at = (sec) => T0 + sec * 1000;

const FE = '100300_fe-stack';
const MAP = '430002_map-stack';
const ECHO = '6118_echo-stack';

// The events server/log/lineParser.js emits, in the shapes the tracker reads
const player = (sec) => ({ type: 'dump', time: at(sec), name: 'GetPlayerData', lineCount: 1, tree: { player: { PlayerId: '979', SeasonId: '1601', Name: 'Coffee' } } });
const reset = (sec, page) => ({ type: 'pageReset', time: at(sec), page });
const stack = (sec, id, num, page) => ({ type: 'itemSet', time: at(sec), id, num, page, slot: 1 });
const proto = (sec, name, phase) => ({ type: 'proto', time: at(sec), name, phase });
const map = (sec, areaId, mapType = 'Mystic') => ({ type: 'area', time: at(sec), areaId, mapId: '2000003', mapType, checkType: null, ownerPlayerId: null });
const town = (sec) => ({ type: 'area', time: at(sec), areaId: 'hideout', mapId: '111000', mapType: null, checkType: 'MainCity', ownerPlayerId: null });

// Login with the bag re-sent: FE 100 on page 102, 33 maps on page 103
function loggedIn() {
  const t = new FarmTracker({ now: at(0) });
  t.handle(player(0));
  t.handle(reset(1, 102));
  t.handle(stack(1, FE, 100, 102));
  t.handle(reset(1, 103));
  t.handle(stack(1, MAP, 33, 103));
  t.flush();
  return t;
}

test('a map run: its cost from the map device, its loot from pickups, paused in town, ended by the next map', () => {
  const t = loggedIn();
  assert.equal(t.baselineTrusted, true);
  assert.equal(t.player.id, '979');
  const finished = [];
  t.on('run', (run) => finished.push(run));

  t.handle(town(10));
  assert.equal(t.current, null);
  // Opening the map in the hideout consumes one: the cost of the run that follows
  t.handle(proto(20, 'Spv3Open', 'start'));
  t.handle(stack(20, MAP, 32, 103));
  t.handle(proto(20, 'Spv3Open', 'end'));
  t.handle(map(25, 'A1'));
  assert.equal(t.status, 'active');
  assert.deepEqual(t.current.cost.map((c) => [c.baseId, c.qty]), [['430002', 1]]);

  t.handle(proto(30, 'PickItems', 'start'));
  t.handle(stack(30, FE, 130, 102));
  t.handle(stack(30, ECHO, 1, 102));
  t.handle(proto(30, 'PickItems', 'end'));
  assert.deepEqual(t.current.loot.map((d) => [d.baseId, d.qty]), [['100300', 30], ['6118', 1]]);

  // The Sandlord campsite hands loot over as server pushes instead of pickups
  t.handle(map(40, 'A1-camp', 'S10CampsiteMap'));
  t.handle(proto(45, 'Push2', 'start'));
  t.handle(stack(45, FE, 200, 102));
  t.handle(proto(45, 'Push2', 'end'));
  t.handle(proto(46, 'Push2', 'start'));
  t.handle(stack(46, MAP, 31, 103));
  t.handle(proto(46, 'Push2', 'end'));
  assert.deepEqual(t.current.loot.map((d) => [d.baseId, d.qty]), [['100300', 30], ['6118', 1], ['100300', 70]]);
  assert.equal(t.current.cost.length, 1, 'a push that takes from the bag in a map is not a cost');

  t.handle(town(60));
  assert.equal(t.status, 'paused');
  assert.equal(t.current.durationMs, 35_000);
  t.handle(map(70, 'A1'));
  assert.equal(t.status, 'active');
  assert.equal(t.liveDuration(at(75)), 40_000);

  t.handle(map(100, 'A2'));
  assert.equal(finished.length, 1);
  assert.equal(finished[0].areaId, 'A1');
  assert.equal(finished[0].durationMs, 65_000);
  assert.equal(finished[0].end, at(100));
  assert.equal(t.current.areaId, 'A2');
  assert.equal(t.current.loot.length, 0);
  // The live clock stops once the log has gone quiet
  assert.equal(t.liveDuration(at(100) + STALE_AFTER_MS + 60_000), STALE_AFTER_MS);
});

test('stacks whose previous total is unknown never count, and the bag being re-sent is not a pickup', () => {
  const t = new FarmTracker({ now: at(0) });
  t.handle(player(0));
  t.handle(map(5, 'A1'));
  // No bag pages yet: this could be the first time the stack is reported
  t.handle(proto(10, 'PickItems', 'start'));
  t.handle(stack(10, FE, 7416, 102));
  t.handle(proto(10, 'PickItems', 'end'));
  assert.equal(t.current.loot.length, 0);
  // Seen once, the next change counts
  t.handle(proto(20, 'PickItems', 'start'));
  t.handle(stack(20, FE, 7420, 102));
  t.handle(proto(20, 'PickItems', 'end'));
  assert.deepEqual(t.current.loot.map((d) => [d.baseId, d.qty]), [['100300', 4]]);

  // A "pickup" of 25 kinds and thousands of items is the bag coming back after a reload
  t.handle(proto(30, 'PickItems', 'start'));
  for (let i = 0; i < 25; i++) t.handle(stack(30, `${5000 + i}_s${i}`, 200, 102));
  t.handle(proto(30, 'PickItems', 'end'));
  assert.equal(t.current.loot.length, 1);

  // A pickup can't shrink a stack: the snapshot was stale, so trust is withdrawn
  t.handle(proto(40, 'PickItems', 'start'));
  t.handle(stack(40, FE, 7000, 102));
  t.handle(proto(40, 'PickItems', 'end'));
  assert.equal(t.current.loot.length, 1);
  t.handle(proto(50, 'PickItems', 'start'));
  t.handle(stack(50, FE, 7100, 102));
  t.handle(proto(50, 'PickItems', 'end'));
  assert.equal(t.current.loot.length, 1, 'nothing counts until the stack has been seen again');
});

test("someone else's map and a town-type area pause instead of starting a run; sub-areas continue it", () => {
  const t = loggedIn();
  t.handle(map(10, 'A1'));
  t.handle({ ...map(20, 'B1'), ownerPlayerId: '123' });
  assert.equal(t.status, 'paused');
  assert.equal(t.current.areaId, 'A1');
  t.handle(map(30, 'A1'));
  t.handle(map(40, 'A1-camp', 'S10CampsiteMap'));
  assert.equal(t.current.areaId, 'A1');
  assert.equal(t.current.subAreas, 1);
  assert.equal(t.status, 'active');
  t.handle({ ...map(50, 'arena', 'BossChallengeMap'), areaId: 'arena' });
  assert.equal(t.status, 'paused');
  assert.equal(t.history.length, 0);
});

test('a new log file or a new session ends the run in progress; earlier runs merge without duplicates', () => {
  const t = loggedIn();
  t.handle(map(10, 'A1'));
  t.newSession(at(40));
  assert.equal(t.current, null);
  assert.equal(t.history.length, 1);
  assert.equal(t.history[0].end, at(10));
  assert.equal(t.sessionStart, at(40));

  t.addHistory([
    { playerId: '979', areaId: 'A1', start: at(10), end: at(10), durationMs: 0, loot: [], cost: [] },
    { playerId: '979', areaId: 'A0', start: at(-600), end: at(-500), durationMs: 100_000, loot: [{ baseId: '100300', qty: 50, at: at(-550) }], cost: [] },
  ]);
  assert.deepEqual(
    t.history.map((r) => r.areaId),
    ['A0', 'A1'],
  );

  t.handle(map(50, 'A2'));
  t.resetLog();
  assert.equal(t.current, null);
  assert.equal(t.history.length, 3);
  assert.equal(t.player, null);
});

test("prices: FE is 1, yours beat the market, your newer Exchange search beats ETor's, organs are never priced", () => {
  const rows = parseSnapshot({
    data: [
      { id: '6118', price: 100, updatedAt: '2026-11-02T04:00:00Z' },
      { id: 430002, price: '40.5', updatedAt: '2026-11-02T04:00:00Z' },
      { id: 'abc', price: 1 },
      { id: '1', price: -2 },
      { id: '2', price: 'lots' },
      null,
    ],
  });
  assert.deepEqual(Object.keys(rows), ['6118', '430002']);
  assert.equal(rows['430002'].price, 40.5);

  const book = new PriceBook({
    market: { seasonId: '1601', fetchedAt: 1, rows },
    search: { 6118: { price: 90, at: Date.UTC(2026, 10, 2, 5), listings: 12 }, 430002: { price: 10, at: Date.UTC(2026, 10, 1), listings: 3 } },
    manual: { 5028: 0.2 },
    excluded: new Set(['400008']),
    categoryOf: (id) => (id === '7777' ? 'organ' : null),
  });
  assert.deepEqual(book.resolve('100300'), { price: 1, source: 'currency', updatedAt: 0 });
  assert.equal(book.resolve('5028').source, 'manual');
  assert.equal(book.resolve('6118').source, 'search');
  assert.equal(book.resolve('6118').price, 90);
  assert.equal(book.resolve('430002').source, 'market', 'the search is older than the market row');
  assert.equal(book.resolve('7777').price, 0);
  assert.equal(book.resolve('999').source, 'none');
  // The Exchange's cut comes off loot, never off costs or FE
  assert.equal(book.lootValue('6118'), 90 * 0.875);
  assert.equal(book.costValue('6118'), 90);
  assert.equal(book.lootValue('100300'), 1);
  assert.equal(book.lootValue('400008'), 0);
  assert.equal(new PriceBook({ market: { rows }, applyTax: false }).lootValue('6118'), 100);

  const grouped = groupDrops([{ baseId: '6118', qty: 1, at: 5 }, { baseId: '6118', qty: 2, at: 3 }, { baseId: '100300', qty: 30, at: 4 }], book);
  assert.deepEqual(
    grouped.map((g) => [g.baseId, g.qty, g.at, g.value]),
    [['6118', 3, 3, 3 * 90 * 0.875], ['100300', 30, 4, 30]],
  );
});

test("a representative price from an Exchange search's listings skips a lone lowball and outliers", () => {
  assert.equal(marketPrice([]), null);
  assert.equal(marketPrice([5]).price, 5);
  assert.equal(marketPrice([150, 1000, 1010, 1020]).price, 1000, 'one lowball on an expensive item');
  assert.equal(marketPrice([2, 3, 4]).price, 3, 'median up to 5 listings');
  const p = marketPrice([10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16, 500]);
  assert.ok(p.price >= 10 && p.price <= 12, `25th percentile without the 500 outlier, got ${p.price}`);
  assert.equal(p.listings, 15);
});

test('the service turns log events into the overlay view: this map, the session, the runs', async () => {
  const saved = [];
  const store = {
    loadSettings: async () => [{ _id: 'farm', settings: { applyTax: true, manual: {}, excluded: [], sessionStart: null } }],
    loadFarmRuns: async () => [],
    saveSettings: () => {},
    saveFarmRun: (run) => saved.push(run),
  };
  const LOOT = { 100300: { name: 'Flame Elementium', category: 'currency' }, 6118: { name: 'Echo of the Gods', category: 'memory', icon: 'x.webp' }, 430002: { name: 'Beginning of the End', category: 'map' } };
  const ITEMS = { 3510: { name: 'All Magic Grip', type: 'INT Gloves' } };
  const UNIQUES = { 112339: { name: "Israfel's Laws", baseId: 3510 }, 112340: { name: 'Aeterna Martyr', baseId: 3510 }, 112341: { name: "Vow's Grasp", baseId: 3510 } };
  const TABLES = { lootItems: LOOT, items: ITEMS, uniques: UNIQUES };
  const gamedata = { get: (kind, id) => TABLES[kind]?.[id] ?? null, all: (kind) => Object.entries(TABLES[kind] ?? {}), icon: () => null };
  const market = {
    seasonId: null,
    table: { seasonId: '1601', fetchedAt: at(0), rows: { 6118: { price: 100, updatedAt: 1 }, 430002: { price: 40, updatedAt: 1 }, 112339: { price: 370, updatedAt: 1 }, 112340: { price: 4, updatedAt: 1 } } },
    setSeason(id) {
      this.seasonId = id;
    },
    refresh: async () => false,
    stale: () => false,
    status: () => ({ source: 'test', seasonId: '1601', fetchedAt: at(0), rows: 2, error: null }),
  };
  const logService = new EventEmitter();
  // The planner starts (and replays the log) after the map was opened: the session still covers it
  let clock = at(50);
  const service = new FarmService({ store, gamedata, logService, market, now: () => clock });
  await service.start();
  try {
    const feed = (ev) => logService.emit('gameEvent', ev);
    feed(player(0));
    assert.equal(market.seasonId, '1601', 'the market follows the season the log names');
    feed(reset(1, 102));
    feed(stack(1, FE, 100, 102));
    feed(reset(1, 103));
    feed(stack(1, MAP, 33, 103));
    service.tracker.flush();
    feed(town(10));
    assert.equal(service.view(at(10)).status, 'town');

    feed(proto(20, 'Spv3Open', 'start'));
    feed(stack(20, MAP, 32, 103));
    feed(proto(20, 'Spv3Open', 'end'));
    feed(map(25, 'A1'));
    feed(proto(30, 'PickItems', 'start'));
    feed(stack(30, FE, 130, 102));
    feed(stack(30, ECHO, 1, 102));
    feed(proto(30, 'PickItems', 'end'));

    clock = at(85);
    const v = service.view(at(85));
    assert.equal(v.status, 'in-map');
    assert.equal(v.player.name, 'Coffee');
    assert.equal(v.trusted, true);
    assert.equal(v.current.mapName, 'Netherrealm');
    assert.equal(v.current.running, true);
    assert.equal(v.current.activeMs, 60_000);
    assert.equal(v.current.lootValue, 30 + 100 * 0.875);
    assert.equal(v.current.costValue, 40);
    assert.equal(v.current.profit, 77.5);
    assert.equal(v.current.fePerMin, 77.5);
    assert.deepEqual(
      v.current.loot.map((d) => [d.name, d.qty, d.value, d.price.source, d.isFe]),
      [['Echo of the Gods', 1, 87.5, 'market', false], ['Flame Elementium', 30, 30, 'currency', true]],
    );
    assert.deepEqual(v.current.cost.map((d) => [d.name, d.qty, d.value]), [['Beginning of the End', 1, 40]]);
    assert.equal(v.session.runs, 1, 'a map opened before the planner started still counts');
    assert.equal(v.session.start, at(0), 'the session is the game session: the first log time');
    assert.equal(v.session.profit, 77.5);
    assert.equal(v.session.fePerHour, 77.5 * 60);
    assert.equal(v.session.notable[0].name, 'Echo of the Gods');
    assert.equal(v.prices.seasonId, '1601');
    assert.equal(v.prices.applyTax, true);

    feed(town(90));
    assert.equal(service.view(at(95)).status, 'paused');
    feed(map(100, 'A2'));
    assert.equal(saved.length, 1, 'the finished run is stored');
    const after = service.view(at(100));
    assert.equal(after.runs.length, 1, 'the table lists finished maps');
    assert.equal(after.runs[0].areaId, 'A1');
    assert.equal(after.runs[0].activeMs, 65_000);
    assert.equal(after.runs[0].topDrop.name, 'Echo of the Gods');
    assert.equal(after.current.areaId, 'A2');
    assert.equal(after.session.runs, 2, 'the session counts the map in progress');

    // Settings: no cut, a price of your own, an item left out
    service.setSettings({ applyTax: false, manual: { 6118: 120 }, excluded: { 100300: true } });
    const s = service.view(at(100));
    assert.equal(s.prices.applyTax, false);
    assert.deepEqual(s.prices.manual.map((m) => [m.id, m.fe, m.name]), [['6118', 120, 'Echo of the Gods']]);
    assert.equal(s.session.lootValue, 120);

    // A new session: totals start over, the run in progress ends
    clock = at(200);
    const fresh = service.newSession();
    assert.equal(fresh.session.runs, 0);
    assert.equal(fresh.current, null);
    assert.equal(fresh.runs.length, 2);
    assert.equal(fresh.runs[0].areaId, 'A2');
    assert.equal(fresh.runs[0].inSession, false);
  } finally {
    service.stop();
  }
});

test('gear drops are unidentified until answered: "was it the dear legendary on this base?"', async () => {
  const ITEMS = { 3510: { name: 'All Magic Grip' }, 4601: { name: 'Frozen Ring' } };
  const UNIQUES = { 112339: { name: "Israfel's Laws", baseId: 3510 }, 112340: { name: 'Aeterna Martyr', baseId: 3510 }, 112500: { name: 'Vow of Gloves', baseId: 3510 }, 112600: { name: 'Restless Glacier', baseId: 4601 } };
  const TABLES = { lootItems: {}, items: ITEMS, uniques: UNIQUES };
  const gamedata = { get: (kind, id) => TABLES[kind]?.[id] ?? null, all: (kind) => Object.entries(TABLES[kind] ?? {}), icon: () => null };
  const rows = { 112339: { price: 370, updatedAt: 1 }, 112340: { price: 4, updatedAt: 1 }, 112500: { price: 50, updatedAt: 1 }, 112600: { price: 2, updatedAt: 1 } };
  const market = { seasonId: null, table: { seasonId: '1601', fetchedAt: at(0), rows }, setSeason() {}, refresh: async () => false, stale: () => false, status: () => ({ source: 'test', seasonId: '1601', fetchedAt: at(0), rows: 4, error: null }) };
  const store = { loadSettings: async () => [], loadFarmRuns: async () => [], saveSettings: () => {}, saveFarmRun: () => {} };
  const logService = new EventEmitter();
  logService.state = { catalog: new Map() };
  const service = new FarmService({ store, gamedata, logService, market, now: () => at(0) });
  await service.start();
  try {
    const feed = (ev) => logService.emit('gameEvent', ev);
    feed(player(0));
    feed(reset(1, 100));
    feed(reset(1, 102));
    feed(reset(1, 103));
    service.tracker.flush();
    feed(map(5, 'A1'));
    const GLOVES_A = '3510_aaaa';
    const GLOVES_B = '3510_bbbb';
    const RING = '4601_cccc';
    feed(proto(10, 'PickItems', 'start'));
    feed(stack(10, GLOVES_A, 1, 100));
    feed(stack(10, GLOVES_B, 1, 100));
    feed(stack(10, RING, 1, 100));
    feed(proto(10, 'PickItems', 'end'));

    let v = service.view(at(20));
    // The ring's only legendary is worth 2 FE: nothing to ask, it's just a ring
    assert.deepEqual(
      v.unknown.map((u) => [u.stackId, u.name, u.ask.name, u.ask.price]),
      [
        [GLOVES_A, 'All Magic Grip', "Israfel's Laws", 370],
        [GLOVES_B, 'All Magic Grip', "Israfel's Laws", 370],
      ],
    );
    assert.equal(v.current.lootValue, 0);
    assert.deepEqual(
      v.current.loot.map((d) => [d.name, d.category, d.value]),
      [['? All Magic Grip', 'unknown', 0], ['? All Magic Grip', 'unknown', 0], ['Frozen Ring', 'gear', 0]],
    );

    // Yes: it's Israfel's Laws, worth its market price (after the Exchange's cut)
    v = service.answer(GLOVES_A, '112339', true);
    assert.equal(v.unknown.length, 1);
    assert.equal(v.current.lootValue, 370 * 0.875);
    assert.equal(v.current.loot[0].name, "Israfel's Laws");
    assert.equal(v.current.loot[0].category, 'legendary');
    // No: the next one worth asking about (Vow of Gloves, 50) comes up; no again makes it a rare
    v = service.answer(GLOVES_B, '112339', false);
    assert.deepEqual(v.unknown.map((u) => u.ask.name), ['Vow of Gloves']);
    v = service.answer(GLOVES_B, '112500', false);
    assert.equal(v.unknown.length, 0);
    assert.equal(service.settings.identified[GLOVES_B], 'rare');
    assert.equal(v.current.lootValue, 370 * 0.875);
    // Forgetting a drop asks again from the top
    v = service.setIdentified(GLOVES_B, null);
    assert.deepEqual(v.unknown.map((u) => u.ask.name), ["Israfel's Laws"]);

    // The item catalog (the game sent the identified item's details) settles it without asking
    logService.state.catalog.set(GLOVES_B, { Id: GLOVES_B, BaseId: 3510, UniqueItmId: 112340, RareValue: 100 });
    v = service.view(at(30));
    assert.equal(v.unknown.length, 0);
    assert.equal(v.current.lootValue, 370 * 0.875 + 4 * 0.875);
    assert.equal(v.current.loot[1].name, 'Aeterna Martyr');
  } finally {
    service.stop();
  }
});
