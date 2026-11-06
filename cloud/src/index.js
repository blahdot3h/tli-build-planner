// TLI market API: a Cloudflare Worker over D1 (see ../wrangler.toml, ../schema.sql).
//
//   GET  /v1/health
//   GET  /v1/seasons                                  seasons with data, newest first
//   GET  /v1/prices?season=&q=&family=&kind=&limit=   folded prices by signature (q: name search)
//   GET  /v1/prices/family/:family?season=            one family's price and every signature of it
//   GET  /v1/prices/signature/:signature?season=
//   GET  /v1/export/prices?season=                    every folded price of a season (the planner
//                                                     downloads this once and caches it)
//   POST /v1/observations  { season, reporter, observations: [...] }   up to 50 sightings
//   GET  /v1/builds?season=&hero=&skill=&family=&limit=
//   GET  /v1/builds/:id
//   POST /v1/builds        { reporter, build }
//
// Reads are public and cached (Cache-Control), writes need no account: a reporter id the planner
// makes once (a random UUID) is hashed before it's stored, and one reporter counts once per item
// per day. Per-IP rate limits come from the ratelimits bindings; without them (local dev) nothing
// is limited. Prices are folded hourly (scheduled) from the last PRICE_WINDOW_DAYS of observations.

const MAX_OBSERVATIONS = 50;
const MAX_BODY = 256 * 1024;
const MAX_PRICE = 100_000_000;
const MAX_LIMIT = 200;
const DAY = 86_400_000;
const SEASON = /^\d{1,6}$/;
const SIGNATURE = /^[LRB]\d{1,12}(\|[\w:,+?]{1,400})?$/;
const KINDS = new Set(['legendary', 'rare', 'base']);
const SOURCES = new Set(['exchange', 'manual', 'screenshot']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const limited = await rateLimited(request, env);
      if (limited) return json({ error: 'Too many requests, slow down' }, 429, { ...cors, 'Retry-After': '60' });
      const res = await route(request, url, env, ctx);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      console.error(err);
      return json({ error: 'Internal error' }, 500, cors);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(foldPrices(env));
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new HttpError(400, message);

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin') ?? '';
  const allow = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0] ?? '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function rateLimited(request, env) {
  const limiter = request.method === 'POST' ? env.RL_WRITE : env.RL_READ;
  if (!limiter) return false;
  const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await limiter.limit({ key });
  return !success;
}

function json(body, status = 200, headers = {}, cacheSeconds = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}` : 'no-store',
      ...headers,
    },
  });
}

async function route(request, url, env, ctx) {
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'v1') throw new HttpError(404, 'Not found');
  const [, head, sub, arg] = parts;
  const q = url.searchParams;
  const get = request.method === 'GET';
  const post = request.method === 'POST';

  if (head === 'health' && get) return json({ ok: true, at: Date.now() });
  if (head === 'seasons' && get) return seasons(env);
  if (head === 'prices' && get) {
    if (!sub) return searchPrices(env, q);
    if (sub === 'family' && arg) return familyPrices(env, q, decodeURIComponent(arg));
    if (sub === 'signature' && arg) return signaturePrice(env, q, decodeURIComponent(arg));
  }
  if (head === 'export' && sub === 'prices' && get) return exportPrices(env, q);
  if (head === 'observations' && post) return postObservations(env, await readJson(request));
  if (head === 'builds') {
    if (get && !sub) return listBuilds(env, q);
    if (get && sub) return getBuild(env, sub);
    if (post && !sub) return postBuild(env, await readJson(request));
  }
  // Operators can fold on demand: POST /v1/admin/fold with the FOLD_TOKEN secret
  if (head === 'admin' && sub === 'fold' && post) {
    if (!env.FOLD_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.FOLD_TOKEN}`) throw new HttpError(403, 'Forbidden');
    return json(await foldPrices(env));
  }
  throw new HttpError(404, 'Not found');
}

async function readJson(request) {
  const len = Number(request.headers.get('Content-Length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'Body too large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Body too large');
  try {
    return JSON.parse(text);
  } catch {
    throw bad('Body must be JSON');
  }
}

// ---- validation ----

const seasonOf = (q) => {
  const s = q.get('season');
  if (s && !SEASON.test(s)) throw bad('season must be the game season id, e.g. 1601');
  return s ?? null;
};
const limitOf = (q, dflt = 50) => Math.max(1, Math.min(MAX_LIMIT, Number(q.get('limit')) || dflt));
const str = (v, max, what) => {
  if (v == null) return null;
  if (typeof v !== 'string' || v.length > max) throw bad(`${what} must be a string of at most ${max} characters`);
  return v;
};
const id = (v, what) => {
  if (v == null || v === '') return null;
  const s = String(v);
  if (!/^\d{1,12}$/.test(s)) throw bad(`${what} must be a numeric id`);
  return s;
};

async function reporterHash(reporter, env) {
  if (typeof reporter !== 'string' || !/^[\w-]{8,64}$/.test(reporter)) throw bad('reporter must be the planner-made id (8-64 word characters)');
  const data = new TextEncoder().encode(`${env.REPORTER_SALT ?? 'tli-market'}:${reporter}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanObservation(o, now) {
  if (!o || typeof o !== 'object') throw bad('each observation must be an object');
  const signature = str(o.signature, 420, 'signature');
  if (!signature || !SIGNATURE.test(signature)) throw bad(`bad signature ${JSON.stringify(signature)}`);
  const family = signature.split('|')[0];
  const kind = signature[0] === 'L' ? 'legendary' : signature[0] === 'R' ? 'rare' : 'base';
  if (o.kind != null && (!KINDS.has(o.kind) || o.kind !== kind)) throw bad('kind does not match the signature');
  const price = Number(o.price);
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) throw bad('price must be a positive number of FE');
  const source = o.source ?? 'manual';
  if (!SOURCES.has(source)) throw bad('source must be exchange, manual or screenshot');
  const seenAt = Number(o.seenAt) || now;
  if (seenAt > now + DAY || seenAt < now - 90 * DAY) throw bad('seenAt must be within the last 90 days');
  const listings = o.listings == null ? null : Math.max(1, Math.min(10_000, Math.floor(Number(o.listings)) || 1));
  const mods = o.mods == null ? null : JSON.stringify(o.mods).slice(0, 4000);
  return {
    signature,
    family,
    kind,
    uniqueId: id(o.uniqueId, 'uniqueId'),
    baseId: id(o.baseId, 'baseId'),
    type: str(o.type, 60, 'type'),
    name: str(o.name, 120, 'name'),
    price: Math.round(price * 10000) / 10000,
    listings,
    source,
    mods,
    seenAt,
    day: Math.floor(seenAt / DAY),
  };
}

// ---- observations ----

async function postObservations(env, body) {
  const season = body?.season;
  if (!SEASON.test(String(season ?? ''))) throw bad('season is required');
  const reporter = await reporterHash(body?.reporter, env);
  const list = Array.isArray(body?.observations) ? body.observations : null;
  if (!list?.length) throw bad('observations must be a non-empty array');
  if (list.length > MAX_OBSERVATIONS) throw bad(`at most ${MAX_OBSERVATIONS} observations per request`);
  const now = Date.now();
  const rows = list.map((o) => cleanObservation(o, now));
  const stmt = env.DB.prepare(
    `INSERT INTO observations (season, signature, family, kind, unique_id, base_id, type, name, price, listings, source, mods, reporter, seen_at, day, received_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
     ON CONFLICT (season, signature, reporter, day, source) DO UPDATE SET
       price = excluded.price, listings = excluded.listings, mods = excluded.mods, name = COALESCE(excluded.name, name),
       seen_at = excluded.seen_at, received_at = excluded.received_at`,
  );
  await env.DB.batch(rows.map((r) => stmt.bind(String(season), r.signature, r.family, r.kind, r.uniqueId, r.baseId, r.type, r.name, r.price, r.listings, r.source, r.mods, reporter, r.seenAt, r.day, now)));
  return json({ ok: true, accepted: rows.length });
}

// ---- prices ----

const priceRow = (r) => ({
  season: r.season,
  signature: r.signature,
  family: r.family,
  kind: r.kind,
  uniqueId: r.unique_id,
  baseId: r.base_id,
  type: r.type,
  name: r.name,
  n: r.n,
  reporters: r.reporters,
  min: r.min,
  p10: r.p10,
  p25: r.p25,
  median: r.median,
  p75: r.p75,
  max: r.max,
  mods: r.mods ? JSON.parse(r.mods) : undefined,
  lastSeen: r.last_seen,
  updatedAt: r.updated_at,
});

async function latestSeason(env) {
  const row = await env.DB.prepare('SELECT season FROM item_prices GROUP BY season ORDER BY MAX(last_seen) DESC LIMIT 1').first();
  return row?.season ?? null;
}

async function seasons(env) {
  const { results } = await env.DB.prepare('SELECT season, COUNT(*) AS items, MAX(last_seen) AS last_seen FROM item_prices GROUP BY season ORDER BY last_seen DESC').all();
  return json({ seasons: results.map((r) => ({ season: r.season, items: r.items, lastSeen: r.last_seen })) }, 200, {}, 300);
}

async function searchPrices(env, q) {
  const season = seasonOf(q) ?? (await latestSeason(env));
  if (!season) return json({ season: null, prices: [] }, 200, {}, 60);
  const where = ['season = ?1'];
  const args = [season];
  const text = (q.get('q') ?? '').trim().slice(0, 80);
  if (text) {
    where.push(`name LIKE ?${args.length + 1}`);
    args.push(`%${text.replace(/[%_]/g, '')}%`);
  }
  if (q.get('family')) {
    where.push(`family = ?${args.length + 1}`);
    args.push(q.get('family'));
  }
  if (q.get('kind') && KINDS.has(q.get('kind'))) {
    where.push(`kind = ?${args.length + 1}`);
    args.push(q.get('kind'));
  }
  const { results } = await env.DB.prepare(`SELECT * FROM item_prices WHERE ${where.join(' AND ')} ORDER BY n DESC, median ASC LIMIT ${limitOf(q)}`).bind(...args).all();
  return json({ season, prices: results.map(priceRow) }, 200, {}, 300);
}

async function familyPrices(env, q, family) {
  if (!SIGNATURE.test(family) || family.includes('|')) throw bad('family must be like L112340, R3510 or B100300');
  const season = seasonOf(q) ?? (await latestSeason(env));
  const fam = season ? await env.DB.prepare('SELECT * FROM family_prices WHERE season = ?1 AND family = ?2').bind(season, family).first() : null;
  const { results } = season ? await env.DB.prepare('SELECT * FROM item_prices WHERE season = ?1 AND family = ?2 ORDER BY median ASC LIMIT 200').bind(season, family).all() : { results: [] };
  return json({ season, family: fam ? priceRow({ ...fam, signature: fam.family }) : null, signatures: results.map(priceRow) }, 200, {}, 300);
}

async function signaturePrice(env, q, signature) {
  if (!SIGNATURE.test(signature)) throw bad('bad signature');
  const season = seasonOf(q) ?? (await latestSeason(env));
  const row = season ? await env.DB.prepare('SELECT * FROM item_prices WHERE season = ?1 AND signature = ?2').bind(season, signature).first() : null;
  return json({ season, price: row ? priceRow(row) : null }, 200, {}, 300);
}

async function exportPrices(env, q) {
  const season = seasonOf(q) ?? (await latestSeason(env));
  if (!season) return json({ season: null, families: [], signatures: [] }, 200, {}, 60);
  const [fam, sig] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM family_prices WHERE season = ?1').bind(season),
    env.DB.prepare('SELECT * FROM item_prices WHERE season = ?1').bind(season),
  ]);
  return json({ season, exportedAt: Date.now(), families: fam.results.map((r) => priceRow({ ...r, signature: r.family })), signatures: sig.results.map(priceRow) }, 200, {}, 600);
}

// ---- folding ----

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// One group's stats: each reporter's newest price counts once (a bot re-posting all day can't move
// the number), outliers beyond 1.5 IQR dropped once there are enough samples
function fold(rows) {
  const newest = new Map();
  for (const r of rows) if (!newest.has(r.reporter) || newest.get(r.reporter).seen_at < r.seen_at) newest.set(r.reporter, r);
  let prices = [...newest.values()].map((r) => r.price).sort((a, b) => a - b);
  if (prices.length >= 6) {
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const iqr = q3 - q1;
    if (iqr > 0) {
      const kept = prices.filter((p) => p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr);
      if (kept.length) prices = kept;
    }
  }
  const sample = rows.reduce((best, r) => (!best || r.seen_at > best.seen_at ? r : best), null);
  const round = (v) => (v == null ? null : Math.round(v * 100) / 100);
  return {
    n: rows.length,
    reporters: newest.size,
    min: round(prices[0]),
    p10: round(percentile(prices, 0.1)),
    p25: round(percentile(prices, 0.25)),
    median: round(percentile(prices, 0.5)),
    p75: round(percentile(prices, 0.75)),
    max: round(prices[prices.length - 1]),
    lastSeen: sample.seen_at,
    sample,
  };
}

const commonest = (rows, key) => {
  const counts = new Map();
  for (const r of rows) if (r[key]) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

export async function foldPrices(env) {
  const windowDays = Number(env.PRICE_WINDOW_DAYS) || 14;
  const now = Date.now();
  const since = now - windowDays * DAY;
  const { results } = await env.DB.prepare('SELECT season, signature, family, kind, unique_id, base_id, type, name, price, listings, mods, reporter, seen_at FROM observations WHERE seen_at >= ?1').bind(since).all();
  const bySignature = new Map();
  const byFamily = new Map();
  for (const r of results) {
    const sk = `${r.season}\n${r.signature}`;
    const fk = `${r.season}\n${r.family}`;
    (bySignature.get(sk) ?? bySignature.set(sk, []).get(sk)).push(r);
    (byFamily.get(fk) ?? byFamily.set(fk, []).get(fk)).push(r);
  }
  const statements = [env.DB.prepare('DELETE FROM item_prices'), env.DB.prepare('DELETE FROM family_prices')];
  const itemStmt = env.DB.prepare(
    `INSERT INTO item_prices (season, signature, family, kind, unique_id, base_id, type, name, n, reporters, min, p10, p25, median, p75, max, mods, last_seen, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
  );
  for (const rows of bySignature.values()) {
    const f = fold(rows);
    const s = f.sample;
    statements.push(itemStmt.bind(s.season, s.signature, s.family, s.kind, s.unique_id, s.base_id, commonest(rows, 'type'), commonest(rows, 'name'), f.n, f.reporters, f.min, f.p10, f.p25, f.median, f.p75, f.max, s.mods, f.lastSeen, now));
  }
  const familyStmt = env.DB.prepare(
    `INSERT INTO family_prices (season, family, kind, unique_id, base_id, type, name, n, reporters, min, p10, p25, median, p75, max, last_seen, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
  );
  for (const rows of byFamily.values()) {
    const f = fold(rows);
    const s = f.sample;
    statements.push(familyStmt.bind(s.season, s.family, s.kind, s.unique_id, s.base_id, commonest(rows, 'type'), commonest(rows, 'name'), f.n, f.reporters, f.min, f.p10, f.p25, f.median, f.p75, f.max, f.lastSeen, now));
  }
  // D1 batches run as one transaction; big ones go in chunks after the deletes
  for (let i = 0; i < statements.length; i += 500) await env.DB.batch(statements.slice(i, i + 500));
  // Old observations only cost storage
  await env.DB.prepare('DELETE FROM observations WHERE seen_at < ?1').bind(now - 120 * DAY).run();
  return { ok: true, signatures: bySignature.size, families: byFamily.size, observations: results.length, at: now };
}

// ---- builds ----

const buildRow = (r, withJson = false) => ({
  id: r.id,
  season: r.season,
  hero: r.hero,
  mainSkill: r.main_skill,
  level: r.level,
  dps: r.dps,
  dpsKind: r.dps_kind,
  createdAt: r.created_at,
  ...(withJson ? { build: JSON.parse(r.json) } : {}),
});

async function listBuilds(env, q) {
  const where = [];
  const args = [];
  const add = (sql, v) => {
    where.push(sql.replace('?', `?${args.length + 1}`));
    args.push(v);
  };
  const season = seasonOf(q);
  if (season) add('b.season = ?', season);
  if (q.get('hero')) add('b.hero = ?', q.get('hero').slice(0, 80));
  if (q.get('skill')) add('b.main_skill = ?', q.get('skill').slice(0, 80));
  let from = 'builds b';
  if (q.get('family')) {
    from = 'builds b JOIN build_items bi ON bi.build_id = b.id';
    add('bi.family = ?', q.get('family').slice(0, 40));
  }
  const sql = `SELECT DISTINCT b.id, b.season, b.hero, b.main_skill, b.level, b.dps, b.dps_kind, b.created_at FROM ${from}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY b.dps DESC LIMIT ${limitOf(q)}`;
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return json({ builds: results.map((r) => buildRow(r)) }, 200, {}, 120);
}

async function getBuild(env, idArg) {
  if (!/^[\w-]{8,40}$/.test(idArg)) throw bad('bad build id');
  const row = await env.DB.prepare('SELECT * FROM builds WHERE id = ?1').bind(idArg).first();
  if (!row) throw new HttpError(404, 'No such build');
  return json({ build: buildRow(row, true) }, 200, {}, 300);
}

async function postBuild(env, body) {
  const reporter = await reporterHash(body?.reporter, env);
  const b = body?.build;
  if (!b || typeof b !== 'object') throw bad('build is required');
  const season = b.seasonId == null ? null : String(b.seasonId);
  if (season && !SEASON.test(season)) throw bad('seasonId must be the game season id');
  const hero = str(b.hero, 80, 'hero');
  const mainSkill = str(b.mainSkill, 80, 'mainSkill');
  const level = b.level == null ? null : Math.max(1, Math.min(120, Math.floor(Number(b.level)) || 1));
  const dps = b.dps == null ? null : Number(b.dps);
  if (dps != null && !(Number.isFinite(dps) && dps >= 0)) throw bad('dps must be a number');
  const gear = Array.isArray(b.gear) ? b.gear.slice(0, 20) : [];
  for (const g of gear) {
    if (!g || typeof g !== 'object' || !SIGNATURE.test(String(g.signature ?? ''))) throw bad('each gear entry needs a signature');
    str(g.slot, 40, 'gear slot');
    str(g.name, 120, 'gear name');
  }
  const clean = {
    seasonId: season,
    level,
    hero,
    heroTraits: (Array.isArray(b.heroTraits) ? b.heroTraits : []).slice(0, 30).map((t) => str(t, 80, 'trait')),
    mainSkill,
    dps,
    dpsKind: b.dpsKind === 'simulated' ? 'simulated' : 'formula',
    gear: gear.map((g) => ({ slot: g.slot ?? null, name: g.name ?? null, uniqueId: id(g.uniqueId, 'uniqueId'), baseId: id(g.baseId, 'baseId'), signature: g.signature, family: String(g.signature).split('|')[0] })),
    skills: (Array.isArray(b.skills) ? b.skills : []).slice(0, 12).map((s) => ({ skill: str(s?.skill, 80, 'skill'), supports: (Array.isArray(s?.supports) ? s.supports : []).slice(0, 6).map((x) => str(x, 80, 'support')) })),
    pactspirits: (Array.isArray(b.pactspirits) ? b.pactspirits : []).slice(0, 10).map((p) => str(p, 80, 'pactspirit')),
    notes: str(b.notes, 500, 'notes'),
  };
  const text = JSON.stringify(clean);
  if (text.length > 32_000) throw bad('build too large');
  // The same build (same content) from the same reporter keeps one id
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${reporter}:${text}`));
  const buildId = [...new Uint8Array(digest)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const statements = [
    env.DB.prepare('INSERT OR REPLACE INTO builds (id, season, hero, main_skill, level, dps, dps_kind, json, reporter, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)').bind(buildId, season, hero, mainSkill, level, dps, clean.dpsKind, text, reporter, now),
    env.DB.prepare('DELETE FROM build_items WHERE build_id = ?1').bind(buildId),
    ...clean.gear.map((g) => env.DB.prepare('INSERT OR REPLACE INTO build_items (build_id, family, signature, slot) VALUES (?1, ?2, ?3, ?4)').bind(buildId, g.family, g.signature, g.slot)),
  ];
  await env.DB.batch(statements);
  return json({ ok: true, id: buildId });
}
