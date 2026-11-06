import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineParser } from '../server/log/lineParser.js';
import { GameState } from '../server/game/state.js';
import { buildCharacter, restoreCharacter, snapshotSource } from '../server/game/character.js';

const MAIN = '120_ce2459cb-9d34-11f1-8e30-0000000013ee';
const RING = '418_901001ec-9d37-11f1-bd79-000000000200';

const login = [
  '[2026.10.06-04.40.47:481][146]TLNetGame: Display: [Game] ----Socket RecvMessage STT----GetPlayerData----SynId = 9',
  '[2026.10.06-04.40.47:498][146]TLNetGame: Display: [Game] ',
  '+player+PlayerId [959518510646603776]',
  '|      +Name [CoffeeDeadProb]',
  '|      +Level [90]',
  '[2026.10.06-04.40.47:512][149]TLLua: Display: [Game] ItemChange@ Reset PageId=-1',
  `[2026.10.06-04.40.47:512][149]TLLua: Display: [Game] ItemChange@ Add Id=${MAIN} BagNum=1 in PageId=-1 SlotId=2`,
  `[2026.10.06-04.40.47:513][149]TLLua: Display: [Game] ItemChange@ Add Id=${RING} BagNum=1 in PageId=-1 SlotId=6`,
];

// Game data that knows one item and one affix
const gd = {
  get: () => null,
  name: (kind, id) => (kind === 'items' && id === 418 ? 'Ring of Testing' : null),
  affixText: (id, values) => (id === 7 ? `+${values[0]}% damage` : null),
  icon: () => null,
  iconByName: () => null,
};

function loggedIn() {
  const state = new GameState();
  const parser = new LineParser((ev) => state.apply(ev));
  parser.feed(login);
  parser.flush();
  state.catalog.set(RING, { Id: RING, BaseId: 418, Level: 80, Prefix: { 1: { Id: 7, DynArgs: { 1: 12 } } } });
  return state;
}

test('a snapshot with its source rebuilds like the live character', () => {
  const state = loggedIn();
  const live = buildCharacter(state, gd);
  // Stored in MongoDB and read back; the item catalog has since forgotten the ring
  const source = JSON.parse(JSON.stringify(snapshotSource(state)));
  const { character, gear } = restoreCharacter({ character: { ...live, calc: {} }, source }, gd, new Map());
  assert.deepEqual(character.player, live.player);
  assert.deepEqual(character.equipment, live.equipment);
  assert.equal(character.equipment[5].item.affixes[0].text, '+12% damage');
  assert.equal(gear, `2:${MAIN}|6:${RING}`);
});

test('an older snapshot without a source gets its names and text looked up again', () => {
  const live = buildCharacter(loggedIn(), gd);
  const old = structuredClone(live);
  const ring = old.equipment[5];
  ring.changedAt = 123;
  ring.item.name = null;
  ring.item.affixes[0].text = null;
  delete old.destinies;
  const { character, gear } = restoreCharacter({ character: { ...old, calc: {}, dummyTests: [] } }, gd, new Map());
  assert.equal(character.equipment[5].item.name, 'Ring of Testing');
  assert.equal(character.equipment[5].item.affixes[0].text, '+12% damage');
  assert.equal(character.equipment[5].changedAt, null);
  assert.deepEqual(character.destinies, []);
  assert.equal(character.calc, undefined);
  assert.equal(gear, `2:${MAIN}|6:${RING}`);
});
