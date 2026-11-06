// The Worker's routes against an in-memory SQLite standing in for D1 (same SQL dialect; D1's
// prepare/bind/first/all/run/batch are shimmed below). Run from the repo root: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker, { foldPrices } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: db.prepare(sql).run(...args) }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.all())),
  };
}

const env = () => ({ DB: fakeD1(), PRICE_WINDOW_DAYS: '14', ALLOWED_ORIGINS: '*', REPORTER_SALT: 'test' });
const ctx = { waitUntil: () => {} };
const call = (e, method, pathname, body) =>
  worker.fetch(new Request(`https://market.test${pathname}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }), e, ctx);
const read = async (res) => ({ status: res.status, body: await res.json(), headers: res.headers });

test('observations are validated, deduped per reporter and day, folded into prices and searchable', async () => {
  const e = env();
  const now = Date.now();
  const bad = await read(await call(e, 'POST', '/v1/observations', { season: '1601', reporter: 'reporter-one', observations: [{ signature: 'nonsense', price: 5 }] }));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /signature/);

  const obs = (reporter, price, signature = 'L112340|51434011:4', extra = {}) => ({ season: '1601', reporter, observations: [{ signature, price, name: 'Aeterna Martyr', uniqueId: '112340', baseId: '3510', type: 'INT Gloves', source: 'manual', seenAt: now, ...extra }] });
  for (const [r, p] of [['reporter-one', 1000], ['reporter-one', 1100], ['reporter-two', 1300], ['reporter-three', 900]]) {
    const res = await read(await call(e, 'POST', '/v1/observations', obs(r, p)));
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  await read(await call(e, 'POST', '/v1/observations', obs('reporter-four', 400, 'L112340|51434011:0')));
  // A base item seen in an Exchange search
  await read(await call(e, 'POST', '/v1/observations', { season: '1601', reporter: 'reporter-one', observations: [{ signature: 'B100301', price: 0.5, listings: 40, source: 'exchange', name: 'Snowpaper', seenAt: now }] }));

  const folded = await foldPrices(e);
  assert.equal(folded.signatures, 3);
  assert.equal(folded.families, 2);

  const search = await read(await call(e, 'GET', '/v1/prices?q=aeterna'));
  assert.equal(search.status, 200);
  assert.equal(search.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=300');
  assert.equal(search.headers.get('Access-Control-Allow-Origin'), '*');
  const top = search.body.prices.find((p) => p.signature === 'L112340|51434011:4');
  assert.equal(top.n, 3); // reporter-one's second price replaced the first (same day)
  assert.equal(top.reporters, 3);
  assert.equal(top.median, 1100);
  assert.equal(top.name, 'Aeterna Martyr');

  const family = await read(await call(e, 'GET', '/v1/prices/family/L112340?season=1601'));
  assert.equal(family.body.family.n, 4);
  assert.equal(family.body.family.min, 400);
  assert.deepEqual(
    family.body.signatures.map((s) => s.signature),
    ['L112340|51434011:0', 'L112340|51434011:4'],
  );

  const exp = await read(await call(e, 'GET', '/v1/export/prices'));
  assert.equal(exp.body.season, '1601');
  assert.equal(exp.body.families.length, 2);
  assert.equal(exp.body.signatures.length, 3);
  const seasons = await read(await call(e, 'GET', '/v1/seasons'));
  assert.deepEqual(seasons.body.seasons.map((s) => s.season), ['1601']);
});

test('builds post anonymously, list by hero / skill / item family, and read back whole', async () => {
  const e = env();
  const build = {
    seasonId: '1601',
    level: 95,
    hero: 'Selena - Dance of the Deep',
    heroTraits: ['Crimson Tide'],
    mainSkill: 'Frost Terra',
    dps: 1.5e9,
    dpsKind: 'simulated',
    gear: [{ slot: 'Gloves', name: 'Aeterna Martyr', uniqueId: '112340', baseId: '3510', signature: 'L112340|51434011:4' }],
    skills: [{ skill: 'Frost Terra', supports: ['Willpower'] }],
    pactspirits: ['Dreamweaver'],
  };
  const posted = await read(await call(e, 'POST', '/v1/builds', { reporter: 'reporter-one', build }));
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  const again = await read(await call(e, 'POST', '/v1/builds', { reporter: 'reporter-one', build }));
  assert.equal(again.body.id, posted.body.id); // the same build keeps one id
  await call(e, 'POST', '/v1/builds', { reporter: 'reporter-two', build: { ...build, hero: 'Bing', mainSkill: 'Lightning Bolt', dps: 2e9, gear: [] } });

  const byHero = await read(await call(e, 'GET', '/v1/builds?hero=Bing'));
  assert.equal(byHero.body.builds.length, 1);
  assert.equal(byHero.body.builds[0].mainSkill, 'Lightning Bolt');
  const byItem = await read(await call(e, 'GET', '/v1/builds?family=L112340'));
  assert.deepEqual(
    byItem.body.builds.map((b) => b.id),
    [posted.body.id],
  );
  const all = await read(await call(e, 'GET', '/v1/builds'));
  assert.deepEqual(
    all.body.builds.map((b) => b.dps),
    [2e9, 1.5e9],
  );
  const one = await read(await call(e, 'GET', `/v1/builds/${posted.body.id}`));
  assert.equal(one.body.build.build.gear[0].family, 'L112340');
  assert.equal(JSON.stringify(one.body).includes('reporter'), false);

  const missing = await read(await call(e, 'GET', '/v1/builds/0000000000000000'));
  assert.equal(missing.status, 404);
  const rejected = await read(await call(e, 'POST', '/v1/builds', { reporter: 'x', build }));
  assert.equal(rejected.status, 400);
});

test('rate limiting answers 429 when a limiter says no', async () => {
  const e = { ...env(), RL_READ: { limit: async () => ({ success: false }) } };
  const res = await read(await call(e, 'GET', '/v1/health'));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
});
