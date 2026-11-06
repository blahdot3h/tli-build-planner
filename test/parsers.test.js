import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTree, asList, isTruncated } from '../server/log/treeParser.js';
import { LineParser } from '../server/log/lineParser.js';
import { GameState } from '../server/game/state.js';
import { describeDummyTest } from '../server/game/character.js';

const MAIN = '120_ce2459cb-9d34-11f1-8e30-0000000013ee';
const OFF = '418_901001ec-9d37-11f1-bd79-000000000200';

const line = (sec, msg) => `[2026.10.06-04.41.${sec}][842]TLLua: Display: [Game] ${msg}`;
const push = (sec, msg) => [
  line(sec, 'ItemChange@ ProtoName=Push2 start'),
  line(sec, msg),
  line(sec, 'ItemChange@ ProtoName=Push2 end'),
];

function run(lines) {
  const state = new GameState();
  const parser = new LineParser((ev) => state.apply(ev));
  parser.feed(lines);
  parser.flush();
  return { state, parser };
}

const login = [
  '[2026.10.06-04.40.47:481][146]TLNetGame: Display: [Game] ----Socket RecvMessage STT----GetPlayerData----SynId = 9',
  '[2026.10.06-04.40.47:498][146]TLNetGame: Display: [Game] ',
  '+player+PlayerId [959518510646603776]',
  '|      +Name [CoffeeDeadProb]',
  '|      +Level [90]',
  '[2026.10.06-04.40.47:512][149]TLLua: Display: [Game] ItemChange@ Reset PageId=-1',
  `[2026.10.06-04.40.47:512][149]TLLua: Display: [Game] ItemChange@ Add Id=${MAIN} BagNum=1 in PageId=-1 SlotId=2`,
  `[2026.10.06-04.40.47:513][149]TLLua: Display: [Game] ItemChange@ Add Id=${OFF} BagNum=1 in PageId=-1 SlotId=3`,
];

test('tree dump nesting follows the column of each +', () => {
  const tree = parseTree([
    '+Item+Suffix+1+Id [110010003]',
    '|    |      | +DynArgs+1 [36.0]',
    '|    |      | |       +2 [-14.0]',
    '|    |      +2+Id [140011303]',
    `|    +Id [${MAIN}]`,
    '+PageId [-1]',
  ]);
  assert.deepEqual(tree, {
    Item: {
      Suffix: { 1: { Id: 110010003, DynArgs: { 1: 36, 2: -14 } }, 2: { Id: 140011303 } },
      Id: MAIN,
    },
    PageId: -1,
  });
});

test('truncated lists are flagged and skipped by asList', () => {
  const tree = parseTree(['+list+1+a [5]', '|    +31+...']);
  assert.equal(isTruncated(tree.list), true);
  assert.deepEqual(asList(tree.list), [{ a: 5 }]);
});

test('ids too large for a double stay strings', () => {
  assert.equal(parseTree(['+PlayerId [959518510646603776]']).PlayerId, '959518510646603776');
});

test('a dump after RecvMessage is named after that message', () => {
  const events = [];
  const parser = new LineParser((ev) => events.push(ev));
  parser.feed(login.slice(0, 5));
  parser.flush();
  const dump = events.find((e) => e.type === 'dump');
  assert.equal(dump.name, 'GetPlayerData');
  assert.equal(dump.tree.player.Name, 'CoffeeDeadProb');
  assert.equal(dump.time, Date.UTC(2026, 9, 6, 4, 40, 47, 498));
});

test('login restores equipped gear without feed noise', () => {
  const { state } = run(login);
  assert.equal(state.page(-1).get(2).id, MAIN);
  assert.equal(state.page(-1).get(3).id, OFF);
  assert.deepEqual(state.feed.map((e) => e.kind), ['login']);
});

test("item compares log the game's own DPS and DEF figures", () => {
  const at = (ms, msg) => `[2026.10.06-04.41.05:${ms}][479]TLLua: Display: [Game] ${msg}`;
  const { state } = run([
    ...login,
    at('502', 'AttributeMgr:SetPlayerEquipment(BaseId=418, GoldId=0, 3)'),
    at('505', 'AttributeMgr:SetPlayerEquipment(BaseId=nil, GoldId=nil, nil)'),
    at('506', 'AttributeMgr:Log(BaseId=418, GoldId=0) DPS: 132559.31147635 -> 285964.63764365'),
    at('506', 'AttributeMgr:Log(BaseId=418, GoldId=0) DEF: 29571.534478467 -> 31122.869584309'),
  ]);
  assert.equal(state.gameStats.dps.value, 132559.31147635);
  assert.equal(state.gameStats.def.value, 29571.534478467);
  assert.deepEqual([...state.gameStats.comparisons.values()].map(({ slot, dps, def }) => ({ slot, dps, def })), [
    { slot: 3, dps: { now: 132559.31147635, with: 285964.63764365 }, def: { now: 29571.534478467, with: 31122.869584309 } },
  ]);
});

test("the attribute panel's rows are kept, yours with the character and another player's apart", () => {
  const at = (sec, msg) => `[2026.10.06-04.41.${sec}][479]TLLua: Display: [Game] ${msg}`;
  const own = [
    at('10:000', 'AttrUtils:SetPlayerId = 959518510646603776'),
    at('10:001', 'AttrUtils:SetPlayerLv = 90'),
    at('10:002', 'RoleAttrMgr@Attri.Id  Attack DPS  10100'),
    at('10:002', 'RoleAttrMgr@[1] = 62876319.061528'),
    at('10:003', 'RoleAttrMgr@Attri.Id  Main-Hand Fire Attack Damage  10600'),
    at('10:003', 'RoleAttrMgr@[1] = 13398641.416571, [2] = 20518746.249194'),
    at('10:004', 'RoleAttrMgr@Attri.Id  Elixir Effect  21508'),
    at('10:004', 'RoleAttrMgr@[1] = 0.0'),
    at('10:100', 'TabAttrItem:_UpdateTotalPanel()'),
  ];
  const { state } = run([...login, ...own]);
  assert.equal(state.level, 90);
  assert.deepEqual(state.gameStats.panel.rows, [
    { id: 10100, name: 'Attack DPS', values: [62876319.061528] },
    { id: 10600, name: 'Main-Hand Fire Attack Damage', values: [13398641.416571, 20518746.249194] },
    { id: 21508, name: 'Elixir Effect', values: [0] },
  ]);
  assert.equal(state.gameStats.viewedPanel, null);
  // Looking at another player: their level and rows stay theirs
  const other = [
    at('20:000', 'AttrUtils:SetPlayerId = 8'),
    at('20:001', 'AttrUtils:SetPlayerLv = 99'),
    at('20:002', 'RoleAttrMgr@Attri.Id  Spell DPS  10103'),
    at('20:002', 'RoleAttrMgr@[1] = 76854379.189051'),
    at('20:100', 'TabAttrItem:_UpdateTotalPanel()'),
  ];
  const second = run([...login, ...own, ...other]).state;
  assert.equal(second.level, 90);
  assert.equal(second.gameStats.panel.rows.length, 3);
  assert.deepEqual(second.gameStats.viewedPanel, { at: Date.UTC(2026, 9, 6, 4, 41, 20, 2), level: 99, playerId: '8', rows: [{ id: 10103, name: 'Spell DPS', values: [76854379.189051] }] });
});

test('a hideout dummy session records attacking time and DEF', () => {
  const at = (s, msg, cat = 'TLLua') => `[2026.10.06-04.44.${s}][196]${cat}: Display: [Game] ${msg}`;
  const { state } = run([
    ...login,
    at('48:032', 'WoodenMan Run'),
    at('48:031', 'WoodenManMgr@GetDefenseValue'),
    at('48:031', '31122.869584309'),
    at('49:061', 'SoundTriggerTimestamps RawCount: 3, SmoothedCount: 3, CurrentTime: 9.1', 'TLGame'),
    at('50:061', 'SoundTriggerTimestamps RawCount: 50, SmoothedCount: 50, CurrentTime: 10.1', 'TLGame'),
    at('51:061', 'SoundTriggerTimestamps RawCount: 48, SmoothedCount: 50, CurrentTime: 11.1', 'TLGame'),
    at('52:039', 'WoodenManMgr@GetDefenseValue'),
    at('52:039', '33829.206069901'),
    at('56:061', 'SoundTriggerTimestamps RawCount: 50, SmoothedCount: 50, CurrentTime: 16.1', 'TLGame'),
    at('58:305', 'WoodenMan Destory'),
  ]);
  assert.equal(state.dummyTests.length, 1);
  assert.equal(state.dummy, null);
  const test = describeDummyTest(state.dummyTests[0]);
  assert.equal(test.end - test.start, 10_273);
  assert.equal(test.attackingSeconds, 3);
  assert.deepEqual(test.bursts.map((b) => b.seconds), [2, 1]);
  assert.deepEqual(test.def, { first: 31122.869584309, min: 31122.869584309, max: 33829.206069901 });
});

test('unequipping the main hand shifts the off hand over, then re-equip', () => {
  const { state } = run([
    ...login,
    // Take off the main hand: the off hand moves to slot 2 and the old main hand goes to the bag
    ...push('00:615', `ItemChange@ Add Id=${OFF} BagNum=1 in PageId=-1 SlotId=2`),
    ...push('00:615', `ItemChange@ Delete Id=${OFF} in PageId=-1 SlotId=3`),
    ...push('00:615', `ItemChange@ Add Id=${MAIN} BagNum=1 in PageId=100 SlotId=81`),
    // Put it back on into the now empty off hand slot
    ...push('02:102', `ItemChange@ Add Id=${MAIN} BagNum=1 in PageId=-1 SlotId=3`),
    ...push('02:103', `ItemChange@ Delete Id=${MAIN} in PageId=100 SlotId=81`),
  ]);

  assert.equal(state.page(-1).get(2).id, OFF);
  assert.equal(state.page(-1).get(3).id, MAIN);
  assert.equal(state.page(100).has(81), false);
  assert.deepEqual(
    state.feed.filter((e) => e.kind !== 'login').map(({ kind, slot, itemId, movedFrom }) => ({ kind, slot, itemId, movedFrom })),
    [
      { kind: 'equip', slot: 2, itemId: OFF, movedFrom: 3 },
      { kind: 'unequip', slot: 2, itemId: MAIN, movedFrom: undefined },
      { kind: 'equip', slot: 3, itemId: MAIN, movedFrom: null },
    ],
  );
});
