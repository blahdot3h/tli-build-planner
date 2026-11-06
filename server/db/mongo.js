// The mongodb package is loaded only when a connection string is given, so a packaged overlay
// without MongoDB never loads it

// MongoDB persistence. The log pipeline never waits on it: writes are queued, and failures
// are recorded in status() so the app keeps working (minus history) when Mongo is down.
//
// Collections: characters (one per player), items (full item details by instance id, so
// details captured in one session fill gaps in the next), snapshots (character at login, after
// gear changes, and builds saved from the UI), logins (each login dump, which snapshots taken in
// that session rebuild from), events (equip/unequip/login feed), dummyTests (hideout dummy
// sessions from the log plus the reading typed in the UI), settings (per-character choices and the
// planner's own view, _id "ui"), farmRuns (finished map runs with their drops and costs).
export class MongoStore {
  constructor(uri, dbName) {
    this.uri = uri;
    this.dbName = dbName;
    this.ok = false;
    this.error = null;
    this.writes = 0;
    this.lastWriteAt = null;
    this.queue = Promise.resolve();
  }

  async connect() {
    if (!this.uri) {
      this.error = 'MONGODB is not set in .env';
      return;
    }
    try {
      const { MongoClient } = await import('mongodb');
      this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 3000 });
      await this.client.connect();
      const db = this.client.db(this.dbName);
      this.characters = db.collection('characters');
      this.items = db.collection('items');
      this.snapshots = db.collection('snapshots');
      this.logins = db.collection('logins');
      this.events = db.collection('events');
      this.settings = db.collection('settings');
      this.dummyTests = db.collection('dummyTests');
      this.farmRuns = db.collection('farmRuns');
      await Promise.all([
        this.snapshots.createIndex({ playerId: 1, takenAt: -1 }),
        this.events.createIndex({ playerId: 1, at: -1 }),
        this.items.createIndex({ baseId: 1 }),
        this.dummyTests.createIndex({ playerId: 1, start: -1 }),
        this.farmRuns.createIndex({ start: -1 }),
      ]);
      this.ok = true;
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
  }

  status() {
    return { ok: this.ok, dbName: this.dbName, kind: 'mongo', error: this.error, writes: this.writes, lastWriteAt: this.lastWriteAt };
  }

  write(fn) {
    if (!this.ok) return;
    this.queue = this.queue.then(fn).then(
      () => {
        this.writes++;
        this.lastWriteAt = Date.now();
      },
      (err) => {
        this.error = err.message;
      },
    );
  }

  async loadItems() {
    if (!this.ok) return [];
    return this.items.find({}, { projection: { details: 1 } }).toArray();
  }

  saveItems(items) {
    if (!items.length) return;
    const now = new Date();
    this.write(() =>
      this.items.bulkWrite(
        items.map((raw) => ({
          updateOne: {
            filter: { _id: raw.Id },
            update: { $set: { baseId: raw.BaseId, details: raw, lastSeenAt: now }, $setOnInsert: { firstSeenAt: now } },
            upsert: true,
          },
        })),
        { ordered: false },
      ),
    );
  }

  // Keyed by player + game time, so re-reading the same log never duplicates anything. source
  // (snapshotSource()) lets the snapshot be rebuilt later with newer code.
  saveCharacter(character, reason, at, source = null) {
    const playerId = String(character.player.playerId);
    this.write(async () => {
      await this.characters.updateOne(
        { _id: playerId },
        { $set: { ...character.player, lastSnapshotAt: new Date(at), updatedAt: new Date() } },
        { upsert: true },
      );
      await this.snapshots.updateOne(
        { _id: `${playerId}:${at}` },
        { $setOnInsert: { playerId, reason, takenAt: new Date(at), character, source: await this.saveLogin(playerId, source) } },
        { upsert: true },
      );
    });
  }

  // A build saved from the UI: the character as shown plus the combat toggles and picks it was
  // saved with, which come back when it's loaded
  async saveBuild(character, { label, scenario, choices, source }) {
    if (!this.ok) throw new Error(`MongoDB is unavailable: ${this.error}`);
    const playerId = String(character.player.playerId);
    const at = Date.now();
    const id = `${playerId}:${at}`;
    await this.snapshots.insertOne({ _id: id, playerId, reason: 'saved', label, takenAt: new Date(at), character, scenario, choices, source: await this.saveLogin(playerId, source) });
    return id;
  }

  // The login dump goes in once per login (as JSON text: its keys include "..." markers); the
  // snapshot keeps a reference to it
  async saveLogin(playerId, source) {
    if (!source) return null;
    const { tree, ...rest } = source;
    const login = rest.login ?? `${playerId}:${source.loginTime}`;
    if (tree) await this.logins.updateOne({ _id: login }, { $setOnInsert: { playerId, at: new Date(source.loginTime), tree: JSON.stringify(tree) } }, { upsert: true });
    return { ...rest, login };
  }

  // A stored snapshot with its login dump put back in source.tree (null if there's none)
  async loadSnapshot(id) {
    if (!this.ok) return null;
    const doc = await this.snapshots.findOne({ _id: String(id) });
    if (doc?.source?.login) {
      const login = await this.logins.findOne({ _id: doc.source.login });
      if (login) doc.source.tree = JSON.parse(login.tree);
    }
    return doc;
  }

  // The newest snapshot the game gave of one character, or of anyone (saved builds load only when
  // picked, since they bring their toggles back)
  async latestSnapshot(playerId = null) {
    if (!this.ok) return null;
    const [doc] = await this.snapshots
      .find({ ...(playerId ? { playerId: String(playerId) } : {}), reason: { $ne: 'saved' } }, { projection: { _id: 1 } })
      .sort({ takenAt: -1 })
      .limit(1)
      .toArray();
    return doc ? this.loadSnapshot(doc._id) : null;
  }

  // One character's snapshots, newest first, with what each changed from the one before
  async listSnapshots(playerId, limit = 200) {
    if (!this.ok || !playerId) return [];
    const docs = await this.snapshots
      .find(
        { playerId: String(playerId) },
        {
          projection: {
            reason: 1,
            label: 1,
            takenAt: 1,
            scenario: 1,
            'character.player.level': 1,
            'character.calc.mainSkill': 1,
            'character.calc.sim.avgDps': 1,
            'character.equipment.label': 1,
            'character.equipment.item.id': 1,
            'character.equipment.item.name': 1,
            'character.equipment.item.uniqueName': 1,
          },
        },
      )
      .sort({ takenAt: 1 })
      .toArray();
    let before = null;
    const list = docs.map((d) => {
      const gear = new Map((d.character?.equipment ?? []).map((e) => [e.label, e.item]));
      const changes = before ? gearChanges(before, gear) : [];
      if (d.reason !== 'saved') before = gear;
      return {
        id: d._id,
        reason: d.reason,
        label: d.label ?? null,
        takenAt: +d.takenAt,
        level: d.character?.player?.level ?? null,
        mainSkill: d.character?.calc?.mainSkill ?? null,
        avgDps: d.character?.calc?.sim?.avgDps ?? null,
        hasSettings: !!d.scenario,
        changes,
      };
    });
    return list.reverse().slice(0, limit);
  }

  async loadCharacters() {
    if (!this.ok) return [];
    return this.characters.find({}).toArray();
  }

  // What the planner was showing (a character or snapshot picked in the UI), so it reopens there
  async loadView() {
    if (!this.ok) return null;
    return (await this.settings.findOne({ _id: 'ui' }))?.selected ?? null;
  }

  saveView(selected) {
    this.write(() => this.settings.updateOne({ _id: 'ui' }, { $set: { selected, updatedAt: new Date() } }, { upsert: true }));
  }

  saveEvent(playerId, entry) {
    const id = String(playerId);
    this.write(() =>
      this.events.updateOne(
        { _id: `${id}:${entry.at}:${entry.kind}:${entry.slot ?? ''}:${entry.itemId ?? ''}` },
        { $setOnInsert: { ...entry, playerId: id, at: new Date(entry.at) } },
        { upsert: true },
      ),
    );
  }

  // Per-character choices the log can't provide (DPS scenario toggles)
  async loadSettings() {
    if (!this.ok) return [];
    return this.settings.find({ _id: { $ne: 'ui' } }).toArray();
  }

  saveSettings(playerId, settings) {
    this.write(() => this.settings.updateOne({ _id: String(playerId) }, { $set: { ...settings, updatedAt: new Date() } }, { upsert: true }));
  }

  // A settings document gone for good (a sample build deleted in the UI)
  deleteSettings(id) {
    this.write(() => this.settings.deleteOne({ _id: String(id) }));
  }

  // Log-derived fields are refreshed on every replay; the reading is only ever set from the UI
  saveDummyTest(playerId, test, character) {
    const id = String(playerId);
    this.write(() =>
      this.dummyTests.updateOne(
        { _id: `${id}:${test.start}` },
        { $set: { ...test, playerId: id, start: new Date(test.start), end: test.end ? new Date(test.end) : null, character } },
        { upsert: true },
      ),
    );
  }

  saveDummyReading(playerId, start, reading) {
    const id = String(playerId);
    this.write(() =>
      this.dummyTests.updateOne(
        { _id: `${id}:${start}` },
        { $set: { reading, readingAt: new Date() }, $setOnInsert: { playerId: id, start: new Date(start) } },
        { upsert: true },
      ),
    );
  }

  // Every saved dummy session (without the build snapshot), so sessions from earlier logs still show
  async loadDummyTests() {
    if (!this.ok) return [];
    return this.dummyTests.find({}, { projection: { character: 0 } }).toArray();
  }

  // A finished map run (server/farm/tracker.js), keyed by player + area + start so a replayed log
  // never duplicates one
  saveFarmRun(run) {
    const { id: _id, ...rest } = run;
    this.write(() => this.farmRuns.updateOne({ _id: `${run.playerId}:${run.areaId}:${run.start}` }, { $set: { ...rest, savedAt: new Date() } }, { upsert: true }));
  }

  // Runs started since a time, oldest first
  async loadFarmRuns(sinceMs) {
    if (!this.ok) return [];
    const docs = await this.farmRuns.find({ start: { $gte: sinceMs } }).sort({ start: 1 }).toArray();
    return docs.map(({ _id, savedAt, ...run }) => run);
  }

  async history(playerId, limit = 50) {
    if (!this.ok || !playerId) return [];
    return this.snapshots
      .find({ playerId: String(playerId) }, { projection: { reason: 1, takenAt: 1, 'character.player': 1 } })
      .sort({ takenAt: -1 })
      .limit(limit)
      .toArray();
  }
}

// "Necklace: Law of Greed off", "Ring 1: A -> B" between two snapshots' gear (label -> item)
function gearChanges(before, after) {
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
