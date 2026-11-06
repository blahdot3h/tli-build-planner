import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../server/db/sqlite.js';
import { openStore } from '../server/db/index.js';

const character = (playerId, { level = 90, gear = {} } = {}) => ({
  player: { playerId, name: 'Coffee', level },
  equipment: Object.entries({ Helmet: null, Necklace: null, ...gear }).map(([label, item]) => ({ label, item })),
  calc: { mainSkill: 'Frost Terra', sim: { avgDps: 1234 } },
});

async function openTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tli-db-'));
  const store = new SqliteStore(path.join(dir, 'planner.sqlite'));
  await store.connect();
  assert.equal(store.ok, true, store.error);
  return store;
}

test('openStore picks SQLite without MONGODB and reports it in status', async () => {
  const store = await openStore({ TLI_DB: ':memory:' });
  assert.equal(store.status().kind, 'sqlite');
  assert.equal(store.ok, true);
  store.close();
});

test('snapshots: keyed by player and time, saved builds apart, latest skips them, list diffs gear', async () => {
  const store = await openTemp();
  const tree = { player: { PlayerId: 7, '...': 'cut' } };
  store.saveCharacter(character('7'), 'login', 1000, { loginTime: 1000, tree, level: 90, pages: {}, items: {} });
  store.saveCharacter(character('7'), 'login', 1000, { loginTime: 1000, tree, level: 90, pages: {}, items: {} }); // a replayed log
  store.saveCharacter(character('7', { gear: { Necklace: { id: 'n1', uniqueName: 'Law of Greed' } } }), 'gear', 2000, { loginTime: 1000, tree, level: 90, pages: {}, items: {} });
  const savedId = await store.saveBuild(character('7', { level: 91 }), { label: 'My build', scenario: { frostbitten: true }, choices: { pick: 1 }, source: { loginTime: 1000, tree, level: 91, pages: {}, items: {} } });
  assert.match(savedId, /^7:\d+$/);

  const latest = await store.latestSnapshot('7');
  assert.equal(latest._id, '7:2000');
  assert.equal(latest.reason, 'gear');
  assert.equal(+latest.takenAt, 2000);
  assert.deepEqual(latest.source.tree, tree); // the login dump comes back from the logins table
  assert.equal(latest.source.login, '7:1000');
  assert.equal((await store.latestSnapshot())._id, '7:2000');

  const saved = await store.loadSnapshot(savedId);
  assert.equal(saved.label, 'My build');
  assert.deepEqual(saved.scenario, { frostbitten: true });
  assert.deepEqual(saved.choices, { pick: 1 });
  assert.equal(saved.character.player.level, 91);

  const list = await store.listSnapshots('7');
  assert.deepEqual(
    list.map((s) => [s.id, s.reason, s.hasSettings, s.changes]),
    [
      [savedId, 'saved', true, ['Necklace: Law of Greed off']],
      ['7:2000', 'gear', false, ['Necklace: Law of Greed on']],
      ['7:1000', 'login', false, []],
    ],
  );
  assert.equal(list[1].avgDps, 1234);
  assert.equal(list[1].mainSkill, 'Frost Terra');

  const chars = await store.loadCharacters();
  assert.equal(chars.length, 1);
  assert.equal(chars[0]._id, '7');
  assert.equal(chars[0].name, 'Coffee');
  assert.equal(+chars[0].lastSnapshotAt, 2000);

  const history = await store.history('7', 10);
  assert.deepEqual(
    history.map((h) => h._id),
    [savedId, '7:2000', '7:1000'],
  );
  assert.equal(history[1].character.player.name, 'Coffee');
  store.close();
});

test('settings merge top-level fields, the view lives apart, deletes forget', async () => {
  const store = await openTemp();
  store.saveSettings('7', { scenario: { a: 1 } });
  store.saveSettings('7', { choices: { b: 2 } });
  store.saveSettings('sample:x', { sampleSpec: { id: 'x' } });
  store.saveView({ playerId: '7', snapshotId: null });
  const docs = await store.loadSettings();
  assert.deepEqual(
    docs.map((d) => d._id).sort(),
    ['7', 'sample:x'],
  );
  const mine = docs.find((d) => d._id === '7');
  assert.deepEqual(mine.scenario, { a: 1 });
  assert.deepEqual(mine.choices, { b: 2 });
  assert.deepEqual(await store.loadView(), { playerId: '7', snapshotId: null });
  store.deleteSettings('sample:x');
  assert.equal((await store.loadSettings()).length, 1);
  store.close();
});

test('items, events, dummy tests and farm runs round-trip', async () => {
  const store = await openTemp();
  store.saveItems([{ Id: '3510_abc', BaseId: 3510, UniqueItmId: 112340 }]);
  store.saveItems([{ Id: '3510_abc', BaseId: 3510, UniqueItmId: 112340, Level: 86 }]);
  const items = await store.loadItems();
  assert.deepEqual(items, [{ _id: '3510_abc', details: { Id: '3510_abc', BaseId: 3510, UniqueItmId: 112340, Level: 86 } }]);

  store.saveEvent('7', { at: 5, kind: 'equip', slot: 1, itemId: '3510_abc' });
  store.saveEvent('7', { at: 5, kind: 'equip', slot: 1, itemId: '3510_abc' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);

  store.saveDummyTest('7', { start: 100, end: 160, attackingSeconds: 30, bursts: [], def: 500, gameDps: null, gear: null }, { player: {} });
  store.saveDummyReading('7', 100, 9.5e6);
  store.saveDummyTest('7', { start: 100, end: 161, attackingSeconds: 31, bursts: [], def: 500, gameDps: null, gear: null }, { player: {} });
  const [dummy] = await store.loadDummyTests();
  assert.equal(dummy._id, '7:100');
  assert.equal(+dummy.start, 100);
  assert.equal(+dummy.end, 161);
  assert.equal(dummy.attackingSeconds, 31);
  assert.equal(dummy.reading, 9.5e6); // a replay keeps the reading
  assert.equal(dummy.character, undefined);

  store.saveFarmRun({ id: 1, playerId: '7', areaId: 9, start: 50, loot: [{ baseId: '100300', qty: 3 }] });
  store.saveFarmRun({ id: 2, playerId: '7', areaId: 9, start: 50, loot: [{ baseId: '100300', qty: 4 }] });
  store.saveFarmRun({ id: 3, playerId: '7', areaId: 9, start: 10, loot: [] });
  const runs = await store.loadFarmRuns(20);
  assert.deepEqual(runs, [{ playerId: '7', areaId: 9, start: 50, loot: [{ baseId: '100300', qty: 4 }] }]);
  assert.equal(store.status().writes > 0, true);
  store.close();
});
