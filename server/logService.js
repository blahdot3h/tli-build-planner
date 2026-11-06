import { EventEmitter } from 'node:events';
import { findLogPath } from './log/locator.js';
import { LogTailer } from './log/tailer.js';
import { LineParser } from './log/lineParser.js';
import { GameState } from './game/state.js';
import { buildCharacter, describeDummyTest, describeItem, describeTelemetry, gearKey, itemName, restoreCharacter, snapshotSource } from './game/character.js';
import { calculate, DUMMY_PRESETS } from './calc/index.js';
import { applyLayout, layoutProblems } from './game/slates.js';
import * as tob from './engine/tob.bundle.js';
import { SKILL_DATA } from './engine/bridge.js';

// A skill's tags, from its tlidb card and the engine ("Spell", "Projectile", "Area", …)
const skillTags = (name) => [...new Set([...(Object.values(SKILL_DATA).find((c) => c.name === name)?.tags ?? []), ...(tob.ActiveSkills.find((s) => s.name === name)?.tags ?? [])])];
// Whether a support's targets fit a skill with those tags: a target is a tag set the skill must have
// all of, or a word for what the skill does; the list is any-of, cannotSupportTargets none-of
const targetFits = (t, tags) => {
  if (typeof t === 'object' && t) return (t.tags ?? []).every((x) => tags.includes(x));
  if (t === 'any' || t === 'hit_enemies' || t === 'deal_damage' || t === 'inflict_ailment') return true;
  if (t === 'dot') return tags.some((x) => /dot|persistent|damage over time/i.test(x));
  if (t === 'spell_burst') return tags.includes('Spell');
  if (/^summon/.test(String(t))) return tags.some((x) => /minion|summon|magus|troop/i.test(x));
  return true;
};
const supportFits = (s, tags) => (!(s.supportTargets ?? []).length || s.supportTargets.some((t) => targetFits(t, tags))) && !(s.cannotSupportTargets ?? []).some((t) => targetFits(t, tags));
import { withSkillTips } from './calc/skillTips.js';
import { optimizePactspirits } from './calc/pactspirits.js';
import { optimizeTalents } from './calc/talents.js';

const POLL_MS = 500;
const SEARCH_MS = 10_000; // how often to look for the log when the game isn't installed/found
const IDLE_FLUSH_MS = 1500; // a dump is complete once the log has been quiet this long
const SETTLE_MS = 3000; // snapshot a login / gear swap once this much log time has passed
const STATUS_EVERY_MS = 5000;
const GAME_WRITING_MS = 30_000;
// Events that change the build (and so the DPS calculation); others only refresh what's shown
const BUILD_EVENTS = new Set(['dump', 'level', 'pageReset', 'itemSet', 'itemDelete']);
// Game pages the log only names, never fills in: screenshot them as they come up (server/capture.js)
const UI_EVENTS = new Set(['uiPage', 'talentTab', 'uiClick']);
// The talent page goes tree by tree (talentTab); the Pact board matters when the log cut its list off
const CAPTURED_PAGES = { S16MercenaryMain: 'Follower', ContractPoint: 'Pact board', TalentBlock: 'Divinity slate board' };
const SCREEN_LIVE_MS = 15_000; // only for what's happening now, not old log lines read at startup
const SCREEN_SETTLE_MS = 1200; // the page draws after the log line
// Choices that come from screenshots (read into the build by hand): a change to one auto-saves a build
const SCREENSHOT_CHOICES = { talents: 'talent trees', pactBoard: 'Pact board', extraLines: 'stat lines', follower: 'follower', prism: 'prism' };
const AUTOSAVE_MS = 1500;
// Talent tree ids in "TabTalentItem@:UpdateView": a profession tree's id is its talents' prefix
// (Magister 31, Warlock 53, Prophet 34); the six god trees are 1-6 (Goddess of Knowledge 3 = 30...)
const treeName = (id, gd) => {
  const prefix = String(id < 10 ? id * 10 : id);
  const tree = (gd.all?.('talentTrees') ?? []).map(([, t]) => t).find((t) => Object.keys(t.nodes ?? {})[0]?.startsWith(prefix));
  return tree?.name ?? `#${id}`;
};

// Tails the game log and keeps the character up to date.
// Events: 'status', 'character', 'feedEntry', 'captures'
export class LogService extends EventEmitter {
  constructor({ store, gamedata, captures }) {
    super();
    this.setMaxListeners(0); // one set of listeners per open browser tab
    this.store = store;
    this.gd = gamedata;
    this.state = new GameState();
    this.parser = new LineParser((ev) => {
      this.settle(ev.time);
      this.state.apply(ev);
      if (BUILD_EVENTS.has(ev.type)) this.markChanged();
      // An Exchange price check in game (the sample builds learn prices from them)
      if (ev.type === 'exchangePrice') this.emit('exchangePrice', ev);
      if (UI_EVENTS.has(ev.type)) this.onScreen(ev);
      // Every event as parsed, for the farming tracker (server/farm)
      this.emit('gameEvent', ev);
    });
    this.captures = captures ?? null;
    this.screen = null; // the game page in front, from the log
    this.overlayClients = 0; // overlay app windows connected (they take the automatic screenshots)
    this.pendingSnapshot = null; // { reason, at }
    this.scenarios = new Map(); // playerId -> scenario toggles chosen in the UI
    this.choices = new Map(); // playerId -> { hero, pactspirits, measuredDps } picked in the UI
    this.pactSeen = new Map(); // playerId -> { spot: destiny } every Pact board spot a login dump has listed
    this.dummyReadings = new Map(); // "playerId:start" -> DPS the dummy showed, typed in the UI
    this.dummyHistory = new Map(); // "playerId:start" -> saved dummy session, so ones from older logs still show
    // What the UI shows: { playerId, snapshotId } picked there, or null to follow whoever is logged
    // in. snapshotId null means the character as it is now: live if it's in this log, else its
    // newest snapshot.
    this.selected = null;
    this.snapshot = null; // the stored snapshot shown when the view isn't live
    this.known = new Map(); // playerId -> { name, level, lastSeenAt } for every character in MongoDB
    this.cached = null;
    this.stale = true;
    this.telemetryStale = false; // only the game's figures / dummy sessions changed
    this.changed = true;

    this.state.on('telemetry', () => {
      this.telemetryStale = true;
      this.changed = true;
    });
    // Keep each dummy session with the build used for it, so readings can be re-checked later
    this.state.on('dummy', (test) => {
      const character = buildCharacter(this.state, this.gd);
      if (!character) return;
      const playerId = String(character.player.playerId);
      const summary = describeDummyTest(test);
      this.dummyHistory.set(`${playerId}:${summary.start}`, { ...summary, playerId });
      this.store.saveDummyTest(playerId, summary, character);
    });

    this.state.on('items', (items) => this.store.saveItems(items));
    this.state.on('login', (login) => {
      this.pendingSnapshot = { reason: 'login', at: login.time };
      // Logging in while the planner runs brings the view back to that character
      if (this.state.live && this.selected) this.follow();
    });
    this.state.on('equipment', (ev) => {
      this.pendingSnapshot = { reason: this.pendingSnapshot?.reason ?? 'gear-change', at: ev.time };
    });
    this.state.on('feed', (entry) => {
      const playerId = this.state.login?.tree.player?.PlayerId;
      if (playerId && entry.kind !== 'dump') this.store.saveEvent(playerId, entry);
      this.emit('feedEntry', this.describeFeed(entry));
    });
  }

  async start() {
    // Item details captured in earlier sessions fill gaps left by the log's truncated lists
    for (const doc of await this.store.loadItems()) this.state.catalog.set(doc._id, doc.details);
    for (const c of await this.store.loadCharacters()) this.known.set(String(c._id), { name: c.name, level: c.level, lastSeenAt: +c.lastSnapshotAt || 0 });
    const view = await this.store.loadView();
    for (const doc of await this.store.loadSettings()) {
      if (doc.scenario) this.scenarios.set(doc._id, doc.scenario);
      if (doc.choices) this.choices.set(doc._id, doc.choices);
      if (doc.pactSeen) this.pactSeen.set(doc._id, doc.pactSeen);
    }
    for (const doc of await this.store.loadDummyTests()) {
      const start = +doc.start;
      const { attackingSeconds = 0, bursts = [], def = null, gameDps = null, gear = null } = doc;
      this.dummyHistory.set(doc._id, { id: String(start), start, end: doc.end ? +doc.end : null, attackingSeconds, bursts, def, gameDps, gear, playerId: doc.playerId });
      if (doc.reading != null) this.dummyReadings.set(doc._id, doc.reading);
    }
    this.logPath = findLogPath();
    this.lastSearchAt = Date.now();
    if (this.logPath) this.attach(this.logPath);
    this.tick(); // catches up on everything already in the log
    this.state.live = true;
    // Reopen on what was shown last time; with nothing picked and nobody logged in, the newest snapshot
    if (!view || !(await this.select(view.playerId, view.snapshotId, { remember: false }))) await this.select(null, null, { remember: false });
    this.timer = setInterval(() => this.tick(), POLL_MS);
  }

  attach(logPath) {
    this.tailer = new LogTailer(logPath);
    this.tailer.on('reset', ({ reason }) => {
      if (reason === 'rotated') this.resetSession();
    });
    this.tailer.on('lines', (lines) => {
      this.lastLinesAt = Date.now();
      this.parser.feed(lines);
    });
  }

  // The game restarted and began a new log
  resetSession() {
    this.parser.reset();
    this.state.reset();
    this.state.live = true;
    this.pendingSnapshot = null;
    this.markChanged();
    this.emit('logReset');
    if (!this.selected) this.loadFallback();
  }

  markChanged() {
    this.stale = true;
    this.changed = true;
  }

  tick() {
    if (!this.tailer) {
      if (Date.now() - this.lastSearchAt > SEARCH_MS) {
        this.lastSearchAt = Date.now();
        this.logPath = findLogPath();
        if (this.logPath) this.attach(this.logPath);
      }
      return;
    }
    const linesBefore = this.parser.stats.lines;
    this.tailer.poll();
    const quietFor = Date.now() - (this.lastLinesAt ?? 0);
    if (quietFor > IDLE_FLUSH_MS) this.parser.flush();
    if (this.pendingSnapshot && quietFor > SETTLE_MS) this.saveSnapshot();

    if (this.changed) {
      this.changed = false;
      this.emit('character', this.character());
    }
    if (this.parser.stats.lines !== linesBefore || Date.now() - (this.lastStatusAt ?? 0) > STATUS_EVERY_MS) {
      this.lastStatusAt = Date.now();
      this.emit('status', this.status());
    }
  }

  // Snapshot a login sync or gear swap once the log has moved SETTLE_MS past it. Runs before
  // each event is applied, so replaying an old log snapshots each change separately.
  settle(logTime) {
    if (this.pendingSnapshot && logTime - this.pendingSnapshot.at >= SETTLE_MS) this.saveSnapshot();
  }

  saveSnapshot() {
    const { reason, at } = this.pendingSnapshot;
    this.pendingSnapshot = null;
    // Snapshots are always of the character logged in, whichever one the UI is showing
    const character = !this.selected && this.live() ? this.character() : this.build(null);
    if (!character) return;
    const { view: _view, ...stored } = character;
    this.store.saveCharacter(stored, reason, at, snapshotSource(this.state));
    const { playerId, name, level } = character.player;
    this.known.set(String(playerId), { name, level, lastSeenAt: at });
  }

  // The log lists the Pact board's first 30 spots only, and which 30 moves between logins (Kismet:
  // Tiger Roar, the Fate that inflicts Intimidated, dropped out at CoffeeBingBong's 2026-11-04
  // login and took Wings of Light's x2.7 with it). Every spot a login has listed is remembered per
  // character, and spots the current login doesn't list come back from that memory. Changing a
  // remembered spot in game shows at the next login that lists it; forgetting the Pact board in
  // the Character data panel clears the memory.
  withPactMemory(character) {
    if (!character?.player?.playerId) return character;
    const id = String(character.player.playerId);
    const seen = { ...(this.pactSeen.get(id) ?? {}) };
    const logged = new Set();
    let changed = false;
    for (const d of character.destinies ?? []) {
      if (d.point == null) continue;
      logged.add(d.point);
      if (JSON.stringify(seen[d.point]) !== JSON.stringify(d)) { seen[d.point] = d; changed = true; }
    }
    if (changed) { this.pactSeen.set(id, seen); this.store.saveSettings(id, { pactSeen: seen }); }
    const remembered = Object.values(seen).filter((d) => !logged.has(d.point)).map((d) => ({ ...d, remembered: true }));
    return remembered.length ? { ...character, destinies: [...(character.destinies ?? []), ...remembered] } : character;
  }

  // A character with its stats and DPS: the one logged in (playerId null) or one played earlier
  build(playerId) {
    const view = this.state.view(playerId);
    const character = this.withPactMemory(buildCharacter(view, this.gd));
    if (!character) return null;
    const id = String(character.player.playerId);
    const calc = calculate(character, this.gd, this.scenarios.get(id), this.choices.get(id));
    return {
      ...character,
      ...(calc.talentTreesByHand ? { talentTrees: calc.talentTreesByHand } : {}),
      skills: withSkillTips(character.skills),
      view: { live: true },
      dummyTests: this.withHistory(id, character.dummyTests, gearKey(view.pages)),
      calc,
    };
  }

  // A character from a stored snapshot, rebuilt with today's code, toggles and picks
  buildSnapshot(doc) {
    const { character, gear } = restoreCharacter(doc, this.gd, this.state.catalog);
    if (!character) return null;
    const id = String(character.player.playerId);
    this.snapshotGear = gear;
    return {
      ...character,
      view: { live: false, snapshotId: doc._id, reason: doc.reason, label: doc.label ?? null, takenAt: +doc.takenAt },
      dummyTests: this.withHistory(id, [], gear),
      calc: calculate(character, this.gd, this.scenarios.get(id), this.choices.get(id)),
    };
  }

  inLog(playerId) {
    return String(this.state.login?.tree.player?.PlayerId) === String(playerId) || this.state.sessions.has(String(playerId));
  }

  // Whether the view is a character in this log rather than a stored snapshot
  live() {
    const sel = this.selected;
    return sel ? !sel.snapshotId && this.inLog(sel.playerId) : !!this.state.login;
  }

  // This log's dummy sessions plus saved ones from earlier logs, newest first, with readings
  withHistory(playerId, tests, gear) {
    const inLog = new Set(tests.map((t) => String(t.start)));
    const older = [...this.dummyHistory.values()]
      .filter((t) => t.playerId === playerId && !inLog.has(String(t.start)))
      .map(({ playerId: _, gear: testGear, ...t }) => ({ ...t, gearChanged: testGear !== gear, earlierLog: true }));
    return [...tests, ...older]
      .sort((a, b) => b.start - a.start)
      .map((t) => ({ ...t, reading: this.dummyReadings.get(`${playerId}:${t.start}`) ?? null }));
  }

  // An item the log has details for, by its instance id ("3510_abc"): equipped or not, this
  // session or an earlier one (the items table). Null when unknown.
  itemById(id) {
    const equipped = this.character()?.equipment?.find((e) => e.item?.id === id)?.item;
    if (equipped) return equipped;
    const raw = this.state.catalog.get(id);
    return raw ? describeItem(id, raw, this.gd) : null;
  }

  character() {
    if (this.stale) {
      if (this.live()) this.cached = this.build(this.selected?.playerId ?? null);
      else this.cached = this.snapshot ? this.buildSnapshot(this.snapshot) : null;
      this.stale = false;
      this.telemetryStale = false;
    } else if (this.telemetryStale && this.cached) {
      // The game's figures or a dummy session changed: no need to rerun the DPS engine
      const id = String(this.cached.player.playerId);
      if (this.cached.view.live) {
        const view = this.state.view(this.selected?.playerId ?? null);
        const { gameStats, dummyTests } = describeTelemetry(view, this.gd);
        this.cached = { ...this.cached, gameStats, dummyTests: this.withHistory(id, dummyTests, gearKey(view.pages)) };
      } else {
        this.cached = { ...this.cached, dummyTests: this.withHistory(id, [], this.snapshotGear) };
      }
      this.telemetryStale = false;
    }
    return this.cached;
  }

  // The DPS the dummy showed for one of the viewed character's dummy sessions (null clears it)
  setDummyReading(start, reading) {
    const playerId = this.viewedPlayerId();
    if (!playerId) return null;
    const key = `${playerId}:${start}`;
    if (reading == null) this.dummyReadings.delete(key);
    else this.dummyReadings.set(key, reading);
    this.store.saveDummyReading(playerId, Number(start), reading);
    this.telemetryStale = true;
    this.changed = false;
    const character = this.character();
    this.emit('character', character);
    return character;
  }

  viewedPlayerId() {
    return this.character()?.player.playerId ?? this.state.login?.tree.player?.PlayerId ?? null;
  }

  // Show a character: playerId null follows whoever is logged in (the newest snapshot while nobody
  // is); a character not in this log comes from its newest snapshot, or snapshotId picks one. A
  // saved build brings back the toggles and picks it was saved with. Returns null when there's
  // nothing to show for that pick.
  async select(playerId, snapshotId = null, { remember = true } = {}) {
    const id = playerId ? String(playerId) : null;
    let snapshot = null;
    if (snapshotId) snapshot = await this.store.loadSnapshot(snapshotId);
    else if (id && !this.inLog(id)) snapshot = await this.store.latestSnapshot(id);
    else if (!id && !this.state.login) snapshot = await this.store.latestSnapshot();
    if ((snapshotId || (id && !this.inLog(id))) && !snapshot) return null;
    if (snapshotId && String(snapshot.playerId) !== id) return null;

    this.selected = id ? { playerId: id, snapshotId: snapshotId ?? null } : null;
    this.snapshot = snapshot;
    if (remember) this.store.saveView(this.selected);
    if (snapshot?.reason === 'saved') this.restoreSettings(String(snapshot.playerId), snapshot);
    this.refresh();
    return this.character();
  }

  restoreSettings(playerId, { scenario, choices }) {
    if (scenario) this.scenarios.set(playerId, scenario);
    if (choices) this.choices.set(playerId, choices);
    this.store.saveSettings(playerId, { ...(scenario ? { scenario } : {}), ...(choices ? { choices } : {}) });
  }

  // Back to following whoever is logged in
  follow() {
    this.selected = null;
    this.snapshot = null;
    this.store.saveView(null);
    this.markChanged();
  }

  // Nobody is logged in any more (the game restarted): show the newest snapshot
  async loadFallback() {
    const snapshot = await this.store.latestSnapshot();
    if (this.selected || this.state.login) return;
    this.snapshot = snapshot;
    this.refresh();
  }

  // Rebuild the view and push it, with each tool's last result for that character
  refresh() {
    this.markChanged();
    this.changed = false;
    this.emit('character', this.character());
    this.emit('status', this.status());
    this.emit('optimizerResult', this.lastOptimizerResult());
    this.emit('talentResult', this.lastTalentResult());
  }

  // Save what's shown as a named build, with its current toggles and picks
  async saveBuild(label) {
    const current = this.character();
    if (!current) return { error: 'No character loaded yet' };
    const { view, ...character } = current;
    const playerId = String(character.player.playerId);
    const source = view.live ? snapshotSource(this.state.view(this.selected?.playerId ?? null)) : (this.snapshot?.source ?? null);
    const id = await this.store.saveBuild(character, {
      label: String(label ?? '').trim().slice(0, 80) || null,
      scenario: this.scenarios.get(playerId) ?? null,
      choices: this.choices.get(playerId) ?? null,
      source,
    });
    return { id };
  }

  snapshots(playerId) {
    return this.store.listSnapshots(playerId ?? this.viewedPlayerId());
  }

  // Every character: the ones in this log and every one with a snapshot, most recently seen first
  characters() {
    const viewed = String(this.viewedPlayerId() ?? '');
    const all = new Map([...this.known].map(([playerId, c]) => [playerId, { playerId, ...c, inLog: false, current: false }]));
    for (const c of this.state.characters()) {
      const saved = all.get(c.playerId);
      all.set(c.playerId, { playerId: c.playerId, name: c.name, level: c.level, lastSeenAt: Math.max(saved?.lastSeenAt ?? 0, c.loginAt), inLog: true, current: c.current });
    }
    return [...all.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((c) => ({ ...c, viewed: c.playerId === viewed }));
  }

  // Best legendary pactspirit trio for the current character and combat toggles. Takes ~10-20s;
  // progress goes out as 'optimizerProgress' events.
  async optimizePactspirits() {
    const current = this.character();
    if (!current) return { error: 'No character loaded yet' };
    if (this.optimizing) return { error: 'Already running' };
    this.optimizing = true;
    try {
      const { calc, ...character } = current;
      const result = await optimizePactspirits(character, calc.scenario?.values ?? {}, {
        hero: calc.choices?.hero ?? calc.choices?.heroInferred ?? undefined,
        current: calc.choices?.pactspirits?.length ? calc.choices.pactspirits : (calc.choices?.petsInferred ?? []),
        onProgress: (done, total) => this.emit('optimizerProgress', { done, total }),
      });
      this.optimizerResult = { ...result, playerId: String(character.player.playerId), at: Date.now() };
      this.emit('optimizerResult', this.optimizerResult);
      return this.optimizerResult;
    } finally {
      this.optimizing = false;
    }
  }

  lastOptimizerResult() {
    const playerId = String(this.viewedPlayerId() ?? '');
    return this.optimizerResult?.playerId === playerId ? this.optimizerResult : null;
  }

  // Talent advice for the current character: next points and damage-node swaps (~15-30 s);
  // progress goes out as 'talentProgress' events.
  async optimizeTalents() {
    const current = this.character();
    if (!current) return { error: 'No character loaded yet' };
    if (this.optimizingTalents) return { error: 'Already running' };
    this.optimizingTalents = true;
    try {
      const { calc, ...character } = current;
      const result = await optimizeTalents(character, this.gd, {
        scenario: calc.scenario?.values ?? {},
        build: {
          hero: calc.choices?.hero ?? calc.choices?.heroInferred ?? undefined,
          pactspirits: calc.choices?.pactspirits?.length ? calc.choices.pactspirits : (calc.choices?.petsInferred ?? []),
        },
        onProgress: (done, total) => this.emit('talentProgress', { done, total }),
      });
      this.talentResult = { ...result, playerId: String(character.player.playerId), at: Date.now() };
      this.emit('talentResult', this.talentResult);
      return this.talentResult;
    } finally {
      this.optimizingTalents = false;
    }
  }

  // A game page the log names but never fills in, as it comes up: screenshot it (each talent tree
  // shown, the follower page and each skill clicked open on it). Old log lines read at startup don't.
  onScreen(ev) {
    if (ev.type === 'uiPage') this.screen = ev.page;
    if (!this.captures || Math.abs(Date.now() - ev.time) > SCREEN_LIVE_MS) return;
    if (ev.type === 'talentTab' && ev.own) this.captureSoon(`Talent tree: ${treeName(ev.tree, this.gd)}`);
    else if (ev.type === 'uiPage' && CAPTURED_PAGES[ev.page]) this.captureSoon(CAPTURED_PAGES[ev.page]);
    else if (ev.type === 'uiClick' && CAPTURED_PAGES[this.screen]) this.captureSoon(`${CAPTURED_PAGES[this.screen]} (${ev.button})`);
  }

  // With the overlay app open it takes the screenshot (it hides itself first, so it isn't in it)
  captureSoon(label) {
    clearTimeout(this.captureTimer);
    this.captureTimer = setTimeout(() => {
      if (this.overlayClients > 0) this.emit('captureRequest', { label, reason: 'auto' });
      else this.capture(label, 'auto').catch((err) => console.error(err.message));
    }, SCREEN_SETTLE_MS);
  }

  // A screenshot of the game, for the logged-in character
  async capture(label, reason = 'button') {
    if (!this.captures) throw new Error('Screenshots are off');
    const playerId = this.state.login?.tree.player?.PlayerId != null ? String(this.state.login.tree.player.PlayerId) : null;
    const item = await this.captures.take({ label, reason, playerId });
    this.emit('captures', this.capturesList());
    return item;
  }

  capturesList() {
    const playerId = this.state.login?.tree.player?.PlayerId;
    return this.captures ? this.captures.list(playerId != null ? String(playerId) : null) : [];
  }

  lastTalentResult() {
    const playerId = String(this.viewedPlayerId() ?? '');
    return this.talentResult?.playerId === playerId ? this.talentResult : null;
  }

  // Hero, traits, pactspirits and a measured dummy DPS from the UI: saved per character, then DPS
  // is recalculated
  setChoices(values) {
    const playerId = this.viewedPlayerId();
    if (!playerId) return null;
    const fromShots = Object.keys(SCREENSHOT_CHOICES).filter((k) => k in values);
    // Forgetting the Pact board also forgets the spots remembered from earlier logins
    if ('pactBoard' in values && values.pactBoard == null) { this.pactSeen.delete(String(playerId)); this.store.saveSettings(playerId, { pactSeen: null }); }
    // Each screenshot-read choice remembers when it was read; forgetting one (null) clears that too
    const stamps = Object.fromEntries(fromShots.map((k) => [`${k}At`, values[k] == null ? undefined : Date.now()]));
    const choices = { ...(this.choices.get(String(playerId)) ?? {}), ...values, ...stamps };
    for (const [k, v] of Object.entries(choices)) if (v === undefined) delete choices[k];
    this.choices.set(String(playerId), choices);
    this.store.saveSettings(playerId, { choices });
    this.markChanged();
    this.changed = false;
    const character = this.character();
    this.emit('character', character);
    if (fromShots.length) this.autosave(fromShots.map((k) => SCREENSHOT_CHOICES[k]));
    return character;
  }

  // Every support tried in one support slot of one skill: { kind: 'active' | 'passive', slot, index,
  // listOnly }. Candidates are the engine's supports that fit the skill's tags (plus the Noble /
  // Magnificent ones made for it), minus gems already in the skill's other slots. With listOnly only
  // the candidates come back; otherwise the DPS with each, against the gem logged in that slot.
  compareSupports({ kind = 'active', slot, index, listOnly = false } = {}) {
    const current = this.character();
    if (!current?.calc?.engine?.ok) return { error: 'No character with a working calculation loaded yet' };
    const group = (current.skills?.[kind] ?? []).find((g) => g.slot === Number(slot));
    if (!group?.skill) return { error: 'No skill in that slot' };
    const i = Math.max(0, Math.min(4, Number(index) || 0));
    const key = `${kind}:${group.slot}:${i}`;
    const inOtherSlots = new Set(group.supports.filter((_, k) => k !== i).map((s) => s.name));
    const tags = skillTags(group.skill.name);
    const candidates = [
      ...tob.SupportSkills.filter((s) => supportFits(s, tags)).map((s) => ({ name: s.name, icon: this.gd.iconByName('skills', s.name) ?? null })),
      ...[...tob.MagnificentSupportSkills, ...tob.NobleSupportSkills]
        .filter((s) => (s.supportTarget ?? /^(.+?):/.exec(s.name)?.[1]) === group.skill.name)
        .map((s) => ({ name: s.name, icon: this.gd.iconByName('skills', s.name) ?? null, special: true })),
    ]
      .filter((c) => !inOtherSlots.has(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const logged = group.supports[i]?.name ?? null;
    if (listOnly) return { key, skill: group.skill.name, logged, candidates };

    const id = String(current.player.playerId);
    const scenario = this.scenarios.get(id);
    const choices = this.choices.get(id) ?? {};
    const { [key]: _own, ...otherSwaps } = choices.supportSwaps ?? {};
    const { view: _view, calc: _calc, dummyTests: _tests, ...character } = current;
    const figure = (c) => (c.engine?.ok ? (c.sim?.supported ? c.sim.avgDps : (c.dps?.combat?.total ?? 0)) : 0);
    const withSwap = (val) => figure(calculate(character, this.gd, scenario, { ...choices, supportSwaps: { ...otherSwaps, ...(val === undefined ? {} : { [key]: val }) } }));
    const base = withSwap(undefined);
    const rows = [{ name: null, icon: null, dps: withSwap(null) }, ...candidates.map((c) => ({ ...c, dps: c.name === logged ? base : withSwap({ name: c.name }) }))]
      .map((r) => ({ ...r, delta: r.dps - base, pct: base > 0 ? r.dps / base - 1 : null }))
      .sort((a, b) => b.dps - a.dps);
    return { key, skill: group.skill.name, logged, base, rows };
  }

  // A slate moved or turned on the board (a what-if kept in choices.slateLayout): { id, position?,
  // direction? } or { reset: true }. Refused when it would leave the board or overlap another slate.
  setSlateLayout(change = {}) {
    const current = this.character();
    if (!current) return { error: 'No character loaded yet' };
    const playerId = String(current.player.playerId);
    const choices = this.choices.get(playerId) ?? {};
    let layout = {};
    if (!change.reset) {
      const id = String(change.id ?? '');
      if (!(current.slates ?? []).some((s) => s.id === id)) return { error: 'No such slate on the board' };
      const was = choices.slateLayout?.[id] ?? {};
      const next = { ...was };
      if (change.position != null) next.position = Number(change.position);
      if (change.direction != null) next.direction = ((Number(change.direction) % 4) + 4) % 4;
      layout = { ...(choices.slateLayout ?? {}), [id]: next };
      const problems = layoutProblems(applyLayout(current.slates, layout, this.gd));
      if (problems.length) return { error: problems.join('; '), problems };
    }
    this.setChoices({ slateLayout: layout });
    return { ok: true, layout };
  }

  // What each skill (or slate) adds: the DPS without it, one calculation per item, on top of
  // whatever is already switched off; slates also get an "all" row (every slate off at once).
  // { base, rows: [{ key, name, without, share }] }
  contributions(kind = 'skills') {
    const current = this.character();
    if (!current?.calc?.engine?.ok) return { error: 'No character with a working calculation loaded yet' };
    const id = String(current.player.playerId);
    const scenario = this.scenarios.get(id);
    const choices = this.choices.get(id) ?? {};
    const { view: _view, calc, dummyTests: _tests, ...character } = current;
    const figure = (c) => (c.engine?.ok ? (c.sim?.supported ? c.sim.avgDps : (c.dps?.combat?.total ?? 0)) : 0);
    const base = figure(calc);
    const rows = [];
    if (kind === 'slates') {
      const off = new Set(choices.disabledSlates ?? []);
      const row = (key, name, ids) => {
        const without = figure(calculate(character, this.gd, scenario, { ...choices, disabledSlates: [...new Set([...off, ...ids])] }));
        rows.push({ key, name, without, share: base > 0 ? 1 - without / base : null });
      };
      const on = (character.slates ?? []).filter((s) => !off.has(s.id));
      for (const s of character.slates ?? []) {
        if (off.has(s.id)) rows.push({ key: s.id, name: s.name, off: true });
        else row(s.id, s.name ?? `Slate at ${s.position}`, [s.id]);
      }
      if (on.length > 1) row('all', 'Every slate together', on.map((s) => s.id));
      return { base, rows };
    }
    const off = new Set(choices.disabledSkills ?? []);
    for (const slotKind of ['active', 'passive']) {
      for (const g of character.skills?.[slotKind] ?? []) {
        if (!g.skill) continue;
        const key = `${slotKind}:${g.slot}`;
        if (off.has(key)) {
          rows.push({ key, name: g.skill.name, off: true });
          continue;
        }
        const without = figure(calculate(character, this.gd, scenario, { ...choices, disabledSkills: [...off, key] }));
        rows.push({ key, name: g.skill.name, without, share: base > 0 ? 1 - without / base : null });
      }
    }
    return { base, rows };
  }

  // A build saved by itself whenever something read off a screenshot goes in, so what was entered
  // by hand is never lost: the snapshot list shows them as "★ Auto: …" and loading one brings its
  // picks back. One save per burst of entries.
  autosave(what) {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.saveBuild(`Auto: ${[...new Set(what)].join(', ')} from screenshots`)
        .then((r) => r.error && console.error(`Auto-save skipped: ${r.error}`))
        .catch((err) => console.error(`Auto-save failed: ${err.message}`));
    }, AUTOSAVE_MS);
  }

  // Scenario toggles from the UI: saved per character, then DPS is recalculated
  setScenario(values) {
    const playerId = this.viewedPlayerId();
    if (!playerId) return null;
    // Picking a training dummy level sets that dummy's resistances and armor too
    const preset = DUMMY_PRESETS[values.dummyLevel];
    const scenario = { ...(this.scenarios.get(String(playerId)) ?? {}), ...values, ...(preset ?? {}) };
    // null puts a toggle back to its default (what the build and its follower say)
    for (const [key, value] of Object.entries(values)) if (value === null) delete scenario[key];
    this.scenarios.set(String(playerId), scenario);
    this.store.saveSettings(playerId, { scenario });
    this.markChanged();
    this.changed = false;
    const character = this.character();
    this.emit('character', character);
    return character;
  }

  feed() {
    return this.state.feed.slice(-100).map((entry) => this.describeFeed(entry));
  }

  describeFeed(entry) {
    return entry.itemId ? { ...entry, itemName: itemName(entry.itemId, this.state.catalog, this.gd) } : entry;
  }

  status() {
    const t = this.tailer;
    const st = this.parser.stats;
    const player = this.state.login?.tree.player;
    return {
      logPath: this.logPath ?? null,
      fileExists: !!t?.exists,
      fileSize: t?.size ?? 0,
      fileModifiedAt: t?.mtimeMs || null,
      lastReadAt: t?.lastReadAt ?? null,
      readError: t?.lastError ?? null,
      gameWriting: !!t?.exists && Date.now() - t.mtimeMs < GAME_WRITING_MS,
      lines: st.lines,
      gameLines: st.gameLines,
      dumps: st.dumps,
      lastGameTime: st.lastGameTime,
      lastGameLine: st.lastGameLine,
      character: player ? { name: player.Name, loginAt: this.state.login.time } : null,
      characters: this.characters(),
      itemsKnown: this.state.catalog.size,
      db: this.store.status(),
      gamedata: this.gd.summary(),
      serverTime: Date.now(),
    };
  }

  // "Test log connection": read whatever is new, then independently read the last line of the
  // file and confirm the parser has seen exactly that line.
  check() {
    if (!this.logPath) {
      return { ok: false, message: "Couldn't find Torchlight Infinite's log folder. Set TLI_LOG_PATH in .env to the full path of UE_game.log." };
    }
    let newLines = 0;
    let inSync = false;
    for (let attempt = 0; attempt < 3 && !inSync; attempt++) {
      newLines += this.tailer.poll();
      if (!this.tailer.exists) break;
      inSync = this.tailer.readLastLine() === this.tailer.lastLine;
    }
    const status = this.status();
    if (!status.fileExists) {
      return { ok: false, ...status, message: `No log file at ${this.logPath} yet. Start the game with logging enabled.` };
    }
    const ok = inSync && status.lines > 0;
    return {
      ok,
      inSync,
      newLines,
      ...status,
      message: ok
        ? `Reading the log: ${status.lines.toLocaleString()} lines parsed and caught up with the game.`
        : status.readError ?? 'The log kept changing while checking. Try again.',
    };
  }

  rescan() {
    if (!this.tailer) return;
    this.tailer.restart();
    this.resetSession();
    this.state.live = false;
    this.tick();
    this.state.live = true;
  }

  history() {
    return this.store.history(this.state.login?.tree.player?.PlayerId);
  }
}
