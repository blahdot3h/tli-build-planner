// SQLite persistence (node:sqlite, built into Node 22.13+ and Electron): the same methods as the
// MongoDB store (server/db/mongo.js) over one file, so the planner and the downloadable overlay
// need no database server. Every collection is a table of JSON documents with the columns the
// queries filter and sort on. Writes are synchronous and never throw into the log pipeline: a
// failure is kept in status().error.
//
// Tables mirror the Mongo collections: characters, items, snapshots, logins, events, settings,
// dummy_tests, farm_runs (see mongo.js for what each holds).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, json TEXT NOT NULL, last_snapshot_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, base_id TEXT, details TEXT NOT NULL, first_seen_at INTEGER, last_seen_at INTEGER);
CREATE INDEX IF NOT EXISTS items_base ON items (base_id);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, reason TEXT NOT NULL, label TEXT, taken_at INTEGER NOT NULL,
  character TEXT NOT NULL, scenario TEXT, choices TEXT, source TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_player ON snapshots (player_id, taken_at);
CREATE TABLE IF NOT EXISTS logins (id TEXT PRIMARY KEY, player_id TEXT, at INTEGER, tree TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_player ON events (player_id, at);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS dummy_tests (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, start INTEGER NOT NULL, end_at INTEGER, json TEXT NOT NULL,
  character TEXT, reading REAL, reading_at INTEGER
);
CREATE INDEX IF NOT EXISTS dummy_player ON dummy_tests (player_id, start);
CREATE TABLE IF NOT EXISTS farm_runs (id TEXT PRIMARY KEY, start INTEGER NOT NULL, json TEXT NOT NULL, saved_at INTEGER);
CREATE INDEX IF NOT EXISTS farm_start ON farm_runs (start);
`;

const json = (v) => JSON.stringify(v ?? null);
const parse = (s) => (s == null ? null : JSON.parse(s));
const date = (ms) => (ms == null ? null : new Date(ms));

export class SqliteStore {
  constructor(file) {
    this.file = file;
    this.dbName = file === ':memory:' ? 'memory' : path.basename(file);
    this.ok = false;
    this.error = null;
    this.writes = 0;
    this.lastWriteAt = null;
  }

  async connect() {
    try {
      if (this.file !== ':memory:') fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.db = new DatabaseSync(this.file);
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
      this.db.exec(SCHEMA);
      this.ok = true;
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
  }

  close() {
    this.db?.close();
    this.ok = false;
  }

  status() {
    return { ok: this.ok, dbName: this.dbName, kind: 'sqlite', file: this.file, error: this.error, writes: this.writes, lastWriteAt: this.lastWriteAt };
  }

  // Runs a write; errors are recorded, not thrown (the log pipeline never waits on storage)
  write(fn) {
    if (!this.ok) return undefined;
    try {
      const result = fn();
      this.writes++;
      this.lastWriteAt = Date.now();
      return result;
    } catch (err) {
      this.error = err.message;
      return undefined;
    }
  }

  // ---- items ----

  async loadItems() {
    if (!this.ok) return [];
    return this.db
      .prepare('SELECT id, details FROM items')
      .all()
      .map((r) => ({ _id: r.id, details: parse(r.details) }));
  }

  saveItems(items) {
    if (!items.length) return;
    const now = Date.now();
    this.write(() => {
      const stmt = this.db.prepare(
        `INSERT INTO items (id, base_id, details, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET base_id = excluded.base_id, details = excluded.details, last_seen_at = excluded.last_seen_at`,
      );
      this.db.exec('BEGIN');
      try {
        for (const raw of items) stmt.run(String(raw.Id), raw.BaseId == null ? null : String(raw.BaseId), json(raw), now, now);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    });
  }

  // ---- characters and snapshots ----

  // Keyed by player + game time, so re-reading the same log never duplicates anything
  saveCharacter(character, reason, at, source = null) {
    const playerId = String(character.player.playerId);
    this.write(() => {
      const now = Date.now();
      const prev = parse(this.db.prepare('SELECT json FROM characters WHERE id = ?').get(playerId)?.json) ?? {};
      this.db
        .prepare('INSERT OR REPLACE INTO characters (id, json, last_snapshot_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(playerId, json({ ...prev, ...character.player }), at, now);
      const src = this.saveLoginSync(playerId, source);
      this.db
        .prepare('INSERT OR IGNORE INTO snapshots (id, player_id, reason, label, taken_at, character, scenario, choices, source) VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, ?)')
        .run(`${playerId}:${at}`, playerId, reason, at, json(character), src == null ? null : json(src));
    });
  }

  // A build saved from the UI, with the toggles and picks it was saved with
  async saveBuild(character, { label, scenario, choices, source }) {
    if (!this.ok) throw new Error(`SQLite is unavailable: ${this.error}`);
    const playerId = String(character.player.playerId);
    const at = Date.now();
    const id = `${playerId}:${at}`;
    const src = this.saveLoginSync(playerId, source);
    this.db
      .prepare('INSERT INTO snapshots (id, player_id, reason, label, taken_at, character, scenario, choices, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, playerId, 'saved', label ?? null, at, json(character), scenario == null ? null : json(scenario), choices == null ? null : json(choices), src == null ? null : json(src));
    this.writes++;
    this.lastWriteAt = at;
    return id;
  }

  // The login dump goes in once per login (as JSON text: its keys include "..." markers); the
  // snapshot keeps a reference to it
  saveLoginSync(playerId, source) {
    if (!source) return null;
    const { tree, ...rest } = source;
    const login = rest.login ?? `${playerId}:${source.loginTime}`;
    if (tree) this.db.prepare('INSERT OR IGNORE INTO logins (id, player_id, at, tree) VALUES (?, ?, ?, ?)').run(login, playerId, source.loginTime ?? null, JSON.stringify(tree));
    return { ...rest, login };
  }

  async saveLogin(playerId, source) {
    return this.saveLoginSync(playerId, source);
  }

  snapshotDoc(row) {
    if (!row) return null;
    const doc = {
      _id: row.id,
      playerId: row.player_id,
      reason: row.reason,
      takenAt: date(row.taken_at),
      character: parse(row.character),
    };
    if (row.label != null) doc.label = row.label;
    if (row.scenario != null) doc.scenario = parse(row.scenario);
    if (row.choices != null) doc.choices = parse(row.choices);
    if (row.source != null) doc.source = parse(row.source);
    return doc;
  }

  // A stored snapshot with its login dump put back in source.tree (null if there's none)
  async loadSnapshot(id) {
    if (!this.ok) return null;
    const doc = this.snapshotDoc(this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(String(id)));
    if (doc?.source?.login) {
      const login = this.db.prepare('SELECT tree FROM logins WHERE id = ?').get(doc.source.login);
      if (login) doc.source.tree = JSON.parse(login.tree);
    }
    return doc;
  }

  // The newest snapshot the game gave of one character, or of anyone (saved builds load only when
  // picked, since they bring their toggles back)
  async latestSnapshot(playerId = null) {
    if (!this.ok) return null;
    const row = playerId
      ? this.db.prepare("SELECT id FROM snapshots WHERE player_id = ? AND reason != 'saved' ORDER BY taken_at DESC LIMIT 1").get(String(playerId))
      : this.db.prepare("SELECT id FROM snapshots WHERE reason != 'saved' ORDER BY taken_at DESC LIMIT 1").get();
    return row ? this.loadSnapshot(row.id) : null;
  }

  // One character's snapshots, newest first, with what each changed from the one before
  async listSnapshots(playerId, limit = 200) {
    if (!this.ok || !playerId) return [];
    const rows = this.db.prepare('SELECT id, reason, label, taken_at, character, scenario FROM snapshots WHERE player_id = ? ORDER BY taken_at ASC').all(String(playerId));
    let before = null;
    const list = rows.map((r) => {
      const character = parse(r.character);
      const gear = new Map((character?.equipment ?? []).map((e) => [e.label, e.item]));
      const changes = before ? gearChanges(before, gear) : [];
      if (r.reason !== 'saved') before = gear;
      return {
        id: r.id,
        reason: r.reason,
        label: r.label ?? null,
        takenAt: r.taken_at,
        level: character?.player?.level ?? null,
        mainSkill: character?.calc?.mainSkill ?? null,
        avgDps: character?.calc?.sim?.avgDps ?? null,
        hasSettings: r.scenario != null,
        changes,
      };
    });
    return list.reverse().slice(0, limit);
  }

  async loadCharacters() {
    if (!this.ok) return [];
    return this.db
      .prepare('SELECT id, json, last_snapshot_at, updated_at FROM characters')
      .all()
      .map((r) => ({ ...parse(r.json), _id: r.id, lastSnapshotAt: date(r.last_snapshot_at), updatedAt: date(r.updated_at) }));
  }

  async history(playerId, limit = 50) {
    if (!this.ok || !playerId) return [];
    return this.db
      .prepare('SELECT id, reason, taken_at, character FROM snapshots WHERE player_id = ? ORDER BY taken_at DESC LIMIT ?')
      .all(String(playerId), limit)
      .map((r) => ({ _id: r.id, reason: r.reason, takenAt: date(r.taken_at), character: { player: parse(r.character)?.player ?? null } }));
  }

  // ---- settings and the planner's view ----

  settingsDoc(id) {
    const row = this.db.prepare('SELECT json, updated_at FROM settings WHERE id = ?').get(String(id));
    return row ? { ...parse(row.json), _id: String(id), updatedAt: date(row.updated_at) } : null;
  }

  // Top-level fields merge into what's stored, as Mongo's $set does
  saveSettings(id, settings) {
    this.write(() => {
      const prev = this.settingsDoc(id);
      const { _id, updatedAt, ...rest } = prev ?? {};
      const now = Date.now();
      this.db.prepare('INSERT OR REPLACE INTO settings (id, json, updated_at) VALUES (?, ?, ?)').run(String(id), json({ ...rest, ...settings }), now);
    });
  }

  async loadSettings() {
    if (!this.ok) return [];
    return this.db
      .prepare("SELECT id, json, updated_at FROM settings WHERE id != 'ui'")
      .all()
      .map((r) => ({ ...parse(r.json), _id: r.id, updatedAt: date(r.updated_at) }));
  }

  deleteSettings(id) {
    this.write(() => this.db.prepare('DELETE FROM settings WHERE id = ?').run(String(id)));
  }

  async loadView() {
    if (!this.ok) return null;
    return this.settingsDoc('ui')?.selected ?? null;
  }

  saveView(selected) {
    this.saveSettings('ui', { selected });
  }

  // ---- events ----

  saveEvent(playerId, entry) {
    const id = String(playerId);
    this.write(() =>
      this.db
        .prepare('INSERT OR IGNORE INTO events (id, player_id, at, json) VALUES (?, ?, ?, ?)')
        .run(`${id}:${entry.at}:${entry.kind}:${entry.slot ?? ''}:${entry.itemId ?? ''}`, id, entry.at, json({ ...entry, playerId: id })),
    );
  }

  // ---- dummy tests ----

  // Log-derived fields are refreshed on every replay; the reading is only ever set from the UI
  saveDummyTest(playerId, test, character) {
    const id = String(playerId);
    this.write(() =>
      this.db
        .prepare(
          `INSERT INTO dummy_tests (id, player_id, start, end_at, json, character) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET player_id = excluded.player_id, start = excluded.start, end_at = excluded.end_at, json = excluded.json, character = excluded.character`,
        )
        .run(`${id}:${test.start}`, id, test.start, test.end ?? null, json(test), json(character)),
    );
  }

  saveDummyReading(playerId, start, reading) {
    const id = String(playerId);
    this.write(() =>
      this.db
        .prepare(
          `INSERT INTO dummy_tests (id, player_id, start, json, reading, reading_at) VALUES (?, ?, ?, '{}', ?, ?)
           ON CONFLICT(id) DO UPDATE SET reading = excluded.reading, reading_at = excluded.reading_at`,
        )
        .run(`${id}:${start}`, id, start, reading, Date.now()),
    );
  }

  // Every saved dummy session (without the build snapshot)
  async loadDummyTests() {
    if (!this.ok) return [];
    return this.db
      .prepare('SELECT id, player_id, start, end_at, json, reading, reading_at FROM dummy_tests')
      .all()
      .map((r) => {
        const doc = { ...parse(r.json), _id: r.id, playerId: r.player_id, start: date(r.start), end: date(r.end_at) };
        if (r.reading != null) {
          doc.reading = r.reading;
          doc.readingAt = date(r.reading_at);
        }
        return doc;
      });
  }

  // ---- farm runs ----

  saveFarmRun(run) {
    const { id: _id, ...rest } = run;
    this.write(() =>
      this.db
        .prepare('INSERT OR REPLACE INTO farm_runs (id, start, json, saved_at) VALUES (?, ?, ?, ?)')
        .run(`${run.playerId}:${run.areaId}:${run.start}`, run.start, json(rest), Date.now()),
    );
  }

  async loadFarmRuns(sinceMs) {
    if (!this.ok) return [];
    return this.db
      .prepare('SELECT json FROM farm_runs WHERE start >= ? ORDER BY start ASC')
      .all(sinceMs)
      .map((r) => parse(r.json));
  }
}

// "Necklace: Law of Greed off", "Ring 1: A -> B" between two snapshots' gear (label -> item)
export function gearChanges(before, after) {
  const name = (item) => item?.uniqueName ?? item?.name ?? 'an item';
  const changes = [];
  for (const label of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(label);
    const b = after.get(label);
    if ((a?.id ?? null) === (b?.id ?? null)) continue;
    if (!b) changes.push(`${label}: ${name(a)} off`);
    else if (!a) changes.push(`${label}: ${name(b)} on`);
    else changes.push(`${label}: ${name(a)} → ${name(b)}`);
  }
  return changes;
}
