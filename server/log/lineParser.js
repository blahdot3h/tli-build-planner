import { parseTree, isTreeLine } from './treeParser.js';

// [2026.10.06-04.41.02:102][842]TLLua: Display: [Game] ItemChange@ Add Id=... (timestamps are UTC)
const LINE = /^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\]\[\s*\d+\]([^:\s]+):\s?(.*)$/;
const GAME_MSG = /^(?:\w+:\s)?\[Game\]\s?(.*)$/;

const MESSAGES = [
  [/^ItemChange@ ProtoName=(\w+) (start|end)/, (m) => ({ type: 'proto', name: m[1], phase: m[2] })],
  [/^ItemChange@ Reset PageId=(-?\d+)/, (m) => ({ type: 'pageReset', page: +m[1] })],
  [
    /^ItemChange@ (?:Add|Update) Id=(\S+) BagNum=(\d+) in PageId=(-?\d+) SlotId=(-?\d+)/,
    (m) => ({ type: 'itemSet', id: m[1], num: +m[2], page: +m[3], slot: +m[4] }),
  ],
  [
    /^ItemChange@ Delete Id=(\S+) in PageId=(-?\d+) SlotId=(-?\d+)/,
    (m) => ({ type: 'itemDelete', id: m[1], page: +m[2], slot: +m[3] }),
  ],
  [
    /^BagMgr@:(PutOn|PutOff) FromPageId:(-?\d+) FromSlotId:(-?\d+) => ToPageId:(-?\d+) ToSlotId:(-?\d+)/,
    (m) => ({
      type: m[1] === 'PutOn' ? 'equipRequest' : 'unequipRequest',
      from: { page: +m[2], slot: +m[3] },
      to: { page: +m[4], slot: +m[5] },
    }),
  ],
  [/^AttrUtils:SetPlayerLv = (\d+)/, (m) => ({ type: 'level', level: +m[1] })],
  // Whose attributes the game is about to show: your own at login and on your character screen,
  // another player's on their "view player" page (then SetPlayerLv is theirs too)
  [/^AttrUtils:SetPlayerId = (\d+)/, (m) => ({ type: 'attrPlayer', playerId: m[1] })],
  [
    /^----Socket (Send|Recv)Message STT----(\w+)----/,
    (m) => ({ type: 'net', dir: m[1] === 'Send' ? 'send' : 'recv', name: m[2] }),
  ],
  // Hovering an item makes the game compute its own DPS and DEF figures: now -> with that item
  [
    /^AttributeMgr:SetPlayerEquipment\(BaseId=(\d+), GoldId=(\d+), (\d+)\)/,
    (m) => ({ type: 'compareItem', baseId: +m[1], goldId: +m[2], slot: +m[3] }),
  ],
  [
    /^AttributeMgr:Log\(BaseId=(\d+), GoldId=(\d+)\) (DPS|DEF): ([\d.]+) -> ([\d.]+)/,
    (m) => ({ type: 'gameStat', stat: m[3].toLowerCase(), baseId: +m[1], goldId: +m[2], current: +m[4], compared: +m[5] }),
  ],
  // The hideout training dummy's window ("WoodenMan"). Its damage readout isn't logged.
  [/^WoodenMan (Run|Hide|Destory)\s*$/, (m) => ({ type: 'dummy', phase: { Run: 'show', Hide: 'hide', Destory: 'close' }[m[1]] })],
  // The game page in front: "PageStack@ CurRunView = 93844_S16MercenaryMainCtrl" (the follower page),
  // TalentCtrl, PetCtrl, FightCtrl (back in the game world)...
  [/^PageStack@ CurRunView = \d+_(\w+?)(?:Ctrl)?\s*$/, (m) => ({ type: 'uiPage', page: m[1] })],
  // A talent tree shown on the talent page: "TabTalentItem@:UpdateView <slot> <tree id> <slot>". With
  // another last number ("1 63 13") it's a tree offered when picking one, not one of yours.
  [/^TabTalentItem@:UpdateView (\d+) (\d+) (\d+)/, (m) => ({ type: 'talentTab', slot: +m[1], tree: +m[2], own: m[1] === m[3] })],
  // A button clicked (a skill opened on the follower page shows its tooltip)
  [/^UIButton@ normal-click (\w+)/, (m) => ({ type: 'uiClick', button: m[1] })],
  // Sounds played recently (capped at 50); high while you're hitting things
  [/^SoundTriggerTimestamps RawCount: (\d+)/, (m) => ({ type: 'combatNoise', count: +m[1] })],
];

// The attribute panel (your character screen's attribute tab, or another player's): the game logs
// every row as "RoleAttrMgr@Attri.Id  Spell DPS  10103" followed by "RoleAttrMgr@[1] = 76854379.18"
// (two values for main/off hand: "[1] = 0.0, [2] = 0.0"), then "TabAttrItem:_UpdateTotalPanel()"
const ATTR_ROW = /^RoleAttrMgr@Attri\.Id\s+(.+?)\s+(\d+)\s*$/;
const ATTR_VALUES = /^RoleAttrMgr@\[1\] = (.+)$/;
const ATTR_PANEL_END = 'TabAttrItem:_UpdateTotalPanel()';
// "WoodenManMgr@GetDefenseValue" is followed by a line holding just the value
const DUMMY_DEF_LABEL = 'WoodenManMgr@GetDefenseValue';
const BARE_NUMBER = /^\s*(\d+(?:\.\d+)?)\s*$/;

// An Exchange price check: the client sends XchgSearchPrice with what it looks for
// (+filters+1+key [4] / +refer [330001] = the item's id, Snowpaper Fragment here) and gets back
// every listing's unit price, cheapest first (+prices+1+currency [100300] = Flame Elementium,
// +unitPrices+1 [0.034] ...). Both dumps follow their message line; the SynId pairs them.
const XCHG = /^----Socket (Send|Recv)Message STT----XchgSearchPrice----SynId = (\d+)/;
// Entering an area (a map, the hideout, a town): "SwitchBattleAreaUtil:_JoinFightSuccess()" is
// followed by a dump with the area's ids (+areaId, +mapId, +maptype [Mystic] for a map, +checkType
// [MainCity] for the hideout/town, +worldInitArgs+ownerPlayerId when it's someone else's map)
const AREA_LABEL = 'SwitchBattleAreaUtil:_JoinFightSuccess()';
const str = (v) => (v == null ? null : String(v));
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.keys(v).sort((a, b) => a - b).map((k) => v[k]) : [v]);
const collectRefers = (node, out = []) => {
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'refer') out.push(...asArray(v).map(Number).filter(Number.isFinite));
      else collectRefers(v, out);
    }
  }
  return out;
};

// Turns raw log lines into game events. A table dump is a "[Game] " line with an empty
// message followed by untimestamped tree lines; it is named after the network message
// received just before it (e.g. GetPlayerData at login).
export class LineParser {
  constructor(emit) {
    this.emit = emit;
    this.reset();
  }

  reset() {
    this.dump = null;
    this.lastRecv = null;
    this.expectDummyDef = false;
    this.xchgNext = null; // { dir, synId } of an Exchange price check whose dump comes next
    this.xchgSent = new Map(); // synId -> what was searched
    this.areaNext = null; // { at } when an area-entry dump comes next
    this.attrPanel = null; // { time, rows } while the attribute panel's rows are coming in
    this.attrRow = null; // the row named by the last "Attri.Id" line, waiting for its value

    this.stats = {
      lines: 0,
      timedLines: 0,
      gameLines: 0,
      dumps: 0,
      lastTime: null,
      lastGameTime: null,
      lastGameLine: null,
    };
  }

  feed(lines) {
    for (const line of lines) this.line(line);
  }

  // A dump only ends when the next timestamped line arrives; call this when the log goes quiet.
  flush() {
    if (this.dump) this.finishDump();
    this.finishAttrPanel();
  }

  finishAttrPanel() {
    const panel = this.attrPanel;
    this.attrPanel = null;
    this.attrRow = null;
    if (panel?.rows.length) this.emit({ type: 'attrPanel', time: panel.time, rows: panel.rows });
  }

  // One attribute panel line; true when the line was one
  attrLine(msg, time) {
    const row = ATTR_ROW.exec(msg);
    if (row) {
      this.attrRow = { id: +row[2], name: row[1].trim() };
      if (!this.attrPanel) this.attrPanel = { time, rows: [] };
      return true;
    }
    const values = ATTR_VALUES.exec(msg);
    if (values) {
      if (this.attrRow && this.attrPanel) {
        const nums = values[1].split(/,\s*\[\d+\] = /).map(Number).filter(Number.isFinite);
        this.attrPanel.rows.push({ ...this.attrRow, values: nums });
      }
      this.attrRow = null;
      return true;
    }
    if (msg.startsWith(ATTR_PANEL_END)) {
      this.finishAttrPanel();
      return true;
    }
    return false;
  }

  line(line) {
    const st = this.stats;
    st.lines++;
    const m = LINE.exec(line);
    if (!m) {
      if (this.dump && isTreeLine(line)) this.dump.lines.push(line);
      return;
    }
    if (this.dump) this.finishDump();

    const time = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
    st.timedLines++;
    st.lastTime = time;
    if (!m[8].startsWith('TL')) return;
    const g = GAME_MSG.exec(m[9]);
    if (!g) return;

    const msg = g[1];
    st.gameLines++;
    st.lastGameTime = time;
    st.lastGameLine = msg.slice(0, 240);

    if (msg.trim() === '') {
      const named = this.lastRecv && st.timedLines - this.lastRecv.at <= 3;
      const xchg = this.xchgNext && st.timedLines - this.xchgNext.at <= 3 ? this.xchgNext : null;
      const area = !!this.areaNext && st.timedLines - this.areaNext.at <= 3;
      this.xchgNext = null;
      this.areaNext = null;
      this.dump = { time, name: named ? this.lastRecv.name : null, lines: [], xchg, area };
      return;
    }
    if (msg.startsWith(AREA_LABEL)) {
      this.areaNext = { at: st.timedLines };
      return;
    }
    if (this.attrLine(msg, time)) return;
    const x = XCHG.exec(msg);
    if (x) this.xchgNext = { dir: x[1] === 'Send' ? 'send' : 'recv', synId: x[2], at: st.timedLines };
    if (this.expectDummyDef) {
      this.expectDummyDef = false;
      const n = BARE_NUMBER.exec(msg);
      if (n) {
        this.emit({ type: 'dummyDef', value: +n[1], time });
        return;
      }
    }
    if (msg.startsWith(DUMMY_DEF_LABEL)) {
      this.expectDummyDef = true;
      return;
    }
    for (const [re, build] of MESSAGES) {
      const mm = re.exec(msg);
      if (!mm) continue;
      const ev = { ...build(mm), time };
      if (ev.type === 'net' && ev.dir === 'recv') this.lastRecv = { name: ev.name, at: st.timedLines };
      // A new player's attributes start: whatever panel was being read is complete
      if (ev.type === 'attrPlayer') this.finishAttrPanel();
      this.emit(ev);
      return;
    }
  }

  finishDump() {
    const { time, name, lines, xchg, area } = this.dump;
    this.dump = null;
    if (!lines.length) return;
    this.stats.dumps++;
    const tree = parseTree(lines);
    if (xchg) this.exchange(xchg, tree, time);
    if (area) {
      this.emit({
        type: 'area',
        time,
        areaId: str(tree.areaId ?? tree.AreaUniqueId),
        mapId: str(tree.mapId),
        mapType: str(tree.maptype),
        checkType: str(tree.checkType),
        ownerPlayerId: str(tree.worldInitArgs?.ownerPlayerId),
      });
    }
    this.emit({ type: 'dump', time, name, lineCount: lines.length, tree });
  }

  // A price check's request and its answer: one 'exchangePrice' event with the item ids searched
  // and the listings' unit prices
  exchange({ dir, synId }, tree, time) {
    if (dir === 'send') {
      this.xchgSent.set(synId, { refers: collectRefers(tree.filters ?? tree), filters: tree.filters ?? null, typ3: tree.typ3 ?? null });
      return;
    }
    const sent = this.xchgSent.get(synId);
    this.xchgSent.delete(synId);
    for (const p of asArray(tree.prices)) {
      const unitPrices = asArray(p?.unitPrices).map(Number).filter(Number.isFinite);
      if (!unitPrices.length) continue;
      this.emit({ type: 'exchangePrice', time, synId, refers: sent?.refers ?? [], typ3: sent?.typ3 ?? null, currency: Number(p.currency) || null, unitPrices });
    }
  }
}
