import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../server/gamedata/index.js';
import { describeItem } from '../server/game/character.js';
import { affixFamily, affixLibrary, buildSummary, itemSignature, rollBucket, rollFractions } from '../server/cloud/signature.js';
import { CloudClient, buyPrice } from '../server/cloud/client.js';
import { priceOf, setCloudPrices } from '../server/sample/prices.js';

const gd = loadGameData(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'gamedata'));

// A ranged legendary line and a wand's Ultimate line from the imported tables
const rangedAffix = () => gd.all('affixes').find(([, a]) => /^\+\(\d+–\d+\)% [A-Za-z ]+$/.test(a.text));
const ultimateRow = (type) => gd.get('craftTiers', type).find((r) => r.library === 'Ultimate Affix' && r.tier === '1');

test('roll fractions and buckets follow the range in the affix text', () => {
  assert.deepEqual(rollFractions('+(75–85) Attack and Spell Critical Strike Rating', [80]), [0.5]);
  assert.deepEqual(rollFractions('Adds (10–13) - (14–19) Physical Damage', [13, 14]), [1, 0]);
  assert.deepEqual(rollFractions('(-20–-15)% additional Physical Damage taken', [-20]), [0]);
  assert.deepEqual(rollFractions('+(35–48)% Skill Area / +(35–48)% Minion Skill Area', [48]), [1]); // a repeated range shares one roll
  assert.equal(rollBucket([0.5]), 2);
  assert.equal(rollBucket([1]), 4);
  assert.equal(rollBucket([0.99, 0.95]), 4);
  assert.equal(rollBucket([]), null);
  assert.equal(affixFamily(130320001), '1303200');
  assert.equal(affixFamily(600010), '600010');
});

test('a legendary signs with its id and each rolled line\'s bucket; the family is the legendary alone', () => {
  const [affixId, affix] = rangedAffix();
  const [, lo, hi] = /\((\d+)–(\d+)\)/.exec(affix.text).map(Number);
  const unique = gd.all('uniques').find(([, u]) => u.baseId && gd.get('items', u.baseId));
  const [uniqueId, u] = unique;
  const raw = { Id: `${u.baseId}_x`, BaseId: u.baseId, UniqueItmId: Number(uniqueId), Level: 86, Prefix: [{ Id: Number(affixId), DynArgs: [hi] }] };
  const item = describeItem(`${u.baseId}_x`, raw, gd);
  const sig = itemSignature(item, gd);
  assert.equal(sig.kind, 'legendary');
  assert.equal(sig.family, `L${uniqueId}`);
  assert.equal(sig.signature, `L${uniqueId}|${affixId}:4`);
  assert.deepEqual(sig.mods, [{ id: String(affixId), roll: 4, rollPct: 100 }]);
  const low = itemSignature(describeItem(`${u.baseId}_y`, { ...raw, Prefix: [{ Id: Number(affixId), DynArgs: [lo] }] }, gd), gd);
  assert.equal(low.signature, `L${uniqueId}|${affixId}:0`);
  assert.equal(low.family, sig.family);
});

test('a rare signs with its base and its Ultimate / T0 lines only; plain gear is its base id', () => {
  const type = 'Wand';
  const [baseId] = gd.all('items').find(([, it]) => it.type === type);
  const row = ultimateRow(type);
  assert.equal(affixLibrary(gd, type, row.part, row.text.replace(/\((-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?)\)/g, '$1')), 'Ultimate Affix');
  // An item whose lines come with text (sample-build style): one Ultimate line, one ordinary T3 line
  const ultimateText = row.text.replace(/\((-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?)\)/g, '$2');
  const item = {
    baseId,
    type,
    uniqueId: null,
    affixes: [
      { kind: row.part, id: 150099901, values: [1], text: ultimateText, tier: '1' },
      { kind: 'suffix', id: 150088803, values: [1], text: '+11% Erosion Resistance', tier: '3' },
    ],
  };
  const sig = itemSignature(item, gd);
  assert.equal(sig.kind, 'rare');
  assert.equal(sig.family, `R${baseId}`);
  assert.equal(sig.signature, `R${baseId}|1500999T1`);
  assert.equal(sig.mods[0].library, 'Ultimate Affix');
  const plain = itemSignature({ baseId, type, uniqueId: null, affixes: [{ kind: 'suffix', id: 150088803, values: [1], text: '+11% Erosion Resistance', tier: '3' }] }, gd);
  assert.equal(plain.signature, `B${baseId}`);
  assert.equal(plain.kind, 'base');
});

test('a build summary carries gear signatures, hero, main skill and DPS but no player id or name', () => {
  const [uniqueId, u] = gd.all('uniques').find(([, x]) => x.baseId && gd.get('items', x.baseId));
  const item = describeItem(`${u.baseId}_x`, { Id: `${u.baseId}_x`, BaseId: u.baseId, UniqueItmId: Number(uniqueId), Level: 86 }, gd);
  const character = {
    player: { playerId: 7, name: 'Coffee', level: 95, seasonId: '1601' },
    equipment: [{ label: 'Gloves', item }, { label: 'Helmet', item: null }],
    heroTraits: [{ name: 'Crimson Tide' }],
    pactspirits: [{ name: 'Dreamweaver' }],
    skills: { active: [{ skill: { name: 'Frost Terra' }, supports: [{ name: 'Willpower' }] }] },
    calc: { mainSkill: 'Frost Terra', sim: { supported: true, avgDps: 12345 }, choices: { hero: 'Selena - Dance of the Deep' } },
  };
  const b = buildSummary(character, gd);
  assert.equal(JSON.stringify(b).includes('Coffee'), false);
  assert.equal(JSON.stringify(b).includes('"playerId"'), false);
  assert.equal(b.seasonId, '1601');
  assert.equal(b.hero, 'Selena - Dance of the Deep');
  assert.equal(b.mainSkill, 'Frost Terra');
  assert.equal(b.dps, 12345);
  assert.equal(b.dpsKind, 'simulated');
  assert.deepEqual(b.gear.map((g) => [g.slot, g.family]), [['Gloves', `L${uniqueId}`]]);
  assert.deepEqual(b.skills, [{ skill: 'Frost Terra', supports: ['Willpower'] }]);
  assert.deepEqual(b.pactspirits, ['Dreamweaver']);
});

function fakeStore() {
  const docs = new Map();
  return {
    docs,
    loadSettings: async () => [...docs].map(([id, v]) => ({ _id: id, ...v })),
    saveSettings: (id, v) => docs.set(id, { ...(docs.get(id) ?? {}), ...v }),
  };
}

test('the client downloads and caches folded prices, prices items by roll or family, and sends sightings only when sharing', async () => {
  const [uniqueId, u] = gd.all('uniques').find(([, x]) => x.baseId && gd.get('items', x.baseId));
  const family = `L${uniqueId}`;
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/v1/export/prices')) {
      return {
        ok: true,
        json: async () => ({
          season: '1601',
          families: [{ family, kind: 'legendary', name: u.name, n: 6, reporters: 4, p25: 900, median: 1200, lastSeen: 5 }],
          signatures: [{ signature: `${family}|1:4`, family, kind: 'legendary', name: u.name, n: 2, reporters: 2, p25: 3000, median: 3100, lastSeen: 5 }],
        }),
      };
    }
    if (url.includes('/v1/observations')) return { ok: true, json: async () => ({ ok: true, accepted: init.body ? JSON.parse(init.body).observations.length : 0 }) };
    if (url.includes('/v1/builds')) return { ok: true, json: async () => ({ ok: true, id: 'abc123def456' }) };
    return { ok: false, status: 404, json: async () => ({ error: 'nope' }) };
  };
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tli-cloud-'));
  const store = fakeStore();
  const client = new CloudClient({ store, gamedata: gd, url: 'https://market.example/', fetchImpl, cacheDir, now: () => 10_000_000_000 });
  await client.start();
  assert.match(store.docs.get('cloud').reporterId, /^[0-9a-f-]{36}$/); // made once, kept
  assert.equal(client.status().share, false);

  assert.equal(await client.refresh(), true);
  assert.equal(client.status().season, '1601');
  assert.equal(client.status().families, 1);
  assert.ok(fs.existsSync(path.join(cacheDir, 'cloud-1601.json')));
  assert.equal(await client.refresh(), false); // fresh enough

  // By name (the sample build's lookup): the family's buy price, p25 once 4+ sightings
  assert.deepEqual(client.priceByName(u.name.toUpperCase()).fe, 900);
  assert.equal(buyPrice({ n: 2, p25: 5, median: 7 }), 7);
  setCloudPrices((name) => client.priceByName(name));
  assert.equal(priceOf(u.name).fe, 900);
  assert.match(priceOf(u.name).source, /TLI market/);
  setCloudPrices(null);

  // By item: the family unless two reporters saw this exact roll
  const item = describeItem(`${u.baseId}_x`, { Id: `${u.baseId}_x`, BaseId: u.baseId, UniqueItmId: Number(uniqueId), Level: 86 }, gd);
  const priced = client.priceFor(item);
  assert.equal(priced.fe, 900);
  assert.equal(priced.exact, false);
  client.table.signatures.set(family, { ...client.table.families.get(family), signature: family, n: 2, reporters: 2, p25: 1500, median: 1500 });
  assert.equal(client.priceFor(item).exact, true);

  // Not sharing: sightings are dropped
  client.observeItem(item, 1000);
  assert.equal(client.status().queued, 0);
  client.setShare(true);
  assert.equal(store.docs.get('cloud').share, true);
  const obs = client.observeItem(item, 1000);
  assert.equal(obs.signature, family);
  assert.equal(obs.name, u.name);
  client.observeExchange({ currency: 100300, refers: [100300 + 1], unitPrices: [5, 1, 3, 2, 4], time: 999_000 });
  assert.equal(client.status().queued, 2);
  client.setSeason('1601');
  const sent = await client.flush();
  assert.equal(sent.sent, 2);
  const post = calls.find((c) => c.url.endsWith('/v1/observations'));
  assert.equal(post.body.season, '1601');
  assert.equal(post.body.reporter, store.docs.get('cloud').reporterId);
  assert.equal(post.body.observations[1].signature, 'B100301');
  assert.equal(post.body.observations[1].price, 1); // the cheapest tenth of five listings
  assert.equal(post.body.observations[1].source, 'exchange');

  // A new client in the same data dir starts from the cache
  const again = new CloudClient({ store: fakeStore(), gamedata: gd, url: 'https://market.example', fetchImpl, cacheDir, now: () => 10_000_000_000 });
  await again.start();
  again.setSeason('1601');
  assert.equal(again.status().families, 1);

  // Sharing a build posts its summary and returns the id
  const shared = await client.shareBuild({ player: { playerId: 7, name: 'Coffee', level: 95 }, equipment: [{ label: 'Gloves', item }], calc: { mainSkill: 'Frost Terra' } });
  assert.equal(shared.id, 'abc123def456');
  assert.equal(shared.build.seasonId, '1601');
  assert.equal(JSON.stringify(calls.at(-1).body).includes('Coffee'), false);
});

test('a client left on the placeholder URL is disabled and never calls out', async () => {
  const client = new CloudClient({ store: fakeStore(), gamedata: gd, fetchImpl: async () => assert.fail('must not fetch'), cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tli-cloud-')) });
  await client.start();
  assert.equal(client.status().enabled, false);
  assert.equal(await client.refresh({ force: true }), false);
  client.setShare(true);
  client.observeExchange({ currency: 100300, refers: [1], unitPrices: [1], time: 1 });
  assert.equal(client.status().queued, 0);
});
