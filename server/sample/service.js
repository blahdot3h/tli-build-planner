// Sample builds: plans you gear and spec by hand (not read from the log), computed by the same
// engine and simulation as a logged character. Several can be kept: each is saved in MongoDB
// (settings, _id "sample:<id>") with its plan (the last upgrade list and cheapest path), every edit is
// saved at once, "Save as" keeps a named copy, and the one open is remembered ("sampleCurrent").
// Events: 'sample' (the build changed), 'sampleProgress' ({ task, done, total }) for long tasks.
import { EventEmitter } from 'node:events';
import { calculate } from '../calc/index.js';
import { sampleCatalog } from './catalog.js';
import { sampleCharacter, talentPointsAt } from './build.js';
import { BING2_TALENTS, PRESETS, specFromCharacter } from './presets.js';
import { fitTalents } from './talentFit.js';
import { applyCandidate, buildPrices, pathToTarget, rankUpgrades } from './upgrades.js';
import { learnExchangePrice, loadPriceState, priceOf, priceSource, priceState, setUserPrice } from './prices.js';

const DEFAULT_ID = 'bing2';
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Patches merge into the spec: objects key by key (gear slot 3 alone, one scenario toggle), arrays
// and values replace; null deletes a key
export function mergeSpec(spec, patch) {
  const out = { ...spec };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null) delete out[k];
    else if (isObj(v) && isObj(out[k]) && !['hero'].includes(k)) out[k] = mergeSpec(out[k], v);
    else out[k] = v;
  }
  return out;
}

// A new id for a saved copy: its name in letters and digits, made unique
const slugOf = (name, taken) => {
  const base = String(name ?? 'build').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'build';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
};

export class SampleService extends EventEmitter {
  constructor({ store, gamedata, logService }) {
    super();
    this.setMaxListeners(0);
    this.store = store;
    this.gd = gamedata;
    this.log = logService;
    this.specs = new Map();
    this.plans = new Map(); // id -> { upgrades, path, crafts, forVersion }
    this.cached = new Map();
    this.catalogCache = null;
    this.busy = null; // the long task running, if any
    this.currentId = DEFAULT_ID;
    this.maxFe = null; // the price cap per item the page shows prices against
    // Exchange price checks in game teach prices (the log service replays the whole log at start)
    logService?.on?.('exchangePrice', (ev) => {
      const learned = learnExchangePrice(ev, this.gd);
      if (!learned) return;
      this.store.saveSettings('prices', priceState());
      this.emit('sample', this.page());
    });
  }

  async start() {
    for (const doc of await this.store.loadSettings()) {
      if (String(doc._id).startsWith('sample:') && doc.sampleSpec) {
        this.specs.set(doc.sampleSpec.id, doc.sampleSpec);
        if (doc.plan) this.plans.set(doc.sampleSpec.id, doc.plan);
      }
      if (doc._id === 'prices') loadPriceState(doc);
      if (doc._id === 'sampleCurrent' && doc.currentId) this.currentId = doc.currentId;
    }
    if (!this.specs.has(DEFAULT_ID) && !this.specs.size) this.specs.set(DEFAULT_ID, { ...PRESETS.trove.build(DEFAULT_ID), version: 1 });
    if (!this.specs.has(this.currentId)) this.currentId = [...this.specs.keys()][0];
  }

  // ---- prices ----

  // A price you know ("Solid River 4000 on day 1"); null forgets it
  setPrice(name, fe) {
    setUserPrice(name, fe);
    this.store.saveSettings('prices', priceState());
    this.catalogCache = null;
    return this.page();
  }

  setMaxFe(maxFe) {
    this.maxFe = Number(maxFe) > 0 ? Number(maxFe) : null;
    return this.page();
  }

  // ---- catalog ----

  catalog() {
    if (!this.catalogCache) {
      const catalog = sampleCatalog(this.gd, { recommendedTalents: BING2_TALENTS });
      // TITrack prices for every skill gem the pickers offer
      const names = [...catalog.skills.actives, ...catalog.skills.passives, ...catalog.skills.supports, ...catalog.skills.special].map((s) => s.name);
      catalog.prices = Object.fromEntries(names.map((n) => [n, priceOf(n)]).filter(([, p]) => p));
      this.catalogCache = catalog;
    }
    return this.catalogCache;
  }

  craftTiers(type) {
    return this.gd.get('craftTiers', type) ?? [];
  }

  presets() {
    return Object.entries(PRESETS).map(([key, p]) => ({ key, name: p.name, description: p.description, target: p.target ?? null }));
  }

  // ---- the open build ----

  // The spec with its character, stats and DPS
  view(id = this.currentId) {
    const spec = this.specs.get(id);
    if (!spec) return null;
    if (!this.cached.has(id)) {
      const character = sampleCharacter(spec, this.gd, this.catalog().legendaries);
      const calc = calculate(character, this.gd, spec.scenario, { hero: spec.hero ?? null, pactspirits: spec.pactspirits ?? [] });
      const points = character.talentTrees.reduce((s, t) => s + t.points, 0);
      this.cached.set(id, { spec, character: { ...character, calc }, talentPoints: { allocated: points, available: talentPointsAt(spec.level ?? 85) } });
    }
    return this.cached.get(id);
  }

  // Every kept build, newest change first, with the DPS of those already computed
  saves() {
    return [...this.specs.values()]
      .map((s) => ({ id: s.id, name: s.name ?? s.id, level: s.level ?? null, updatedAt: s.updatedAt ?? null, avgDps: this.cached.get(s.id)?.character.calc.sim?.avgDps ?? null, hasPlan: !!(this.plans.get(s.id)?.path || this.plans.get(s.id)?.upgrades), open: s.id === this.currentId }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  // What the page shows: the build, its presets, prices, its plan, and the other kept builds
  page(id = this.currentId) {
    const view = this.view(id);
    if (!view) return null;
    const plan = this.plans.get(id) ?? {};
    // A plan made for an earlier version of the build is still shown, marked as such
    const stale = plan.forVersion != null && plan.forVersion !== view.spec.version;
    return {
      ...view,
      presets: this.presets(),
      prices: priceSource(),
      // Each piece of the build with its price and whether it fits the cap
      buildPrices: { maxFe: this.maxFe, rows: buildPrices(view.spec, this.catalog(), this.maxFe) },
      knownPrices: priceState(),
      busy: this.busy,
      upgrades: plan.upgrades ? { ...plan.upgrades, stale } : null,
      path: plan.path ? { ...plan.path, stale } : null,
      saves: this.saves(),
    };
  }

  // The build and its plan (upgrade list, path, and the crafts its rows refer to) in MongoDB
  persist(id) {
    const spec = this.specs.get(id);
    if (!spec) return;
    const plan = this.plans.get(id) ?? {};
    this.store.saveSettings(`sample:${id}`, { sampleSpec: spec, plan: plan.path || plan.upgrades ? plan : null });
  }

  // Every edit is saved at once; the version tells a plan made for an earlier build apart
  save(spec) {
    const prev = this.specs.get(spec.id);
    const next = { ...spec, version: (prev?.version ?? spec.version ?? 0) + 1, updatedAt: Date.now() };
    this.specs.set(next.id, next);
    this.cached.delete(next.id);
    this.persist(next.id);
    const view = this.view(next.id);
    this.emit('sample', this.page());
    return view;
  }

  setPlan(id, patch) {
    const spec = this.specs.get(id);
    this.plans.set(id, { ...(this.plans.get(id) ?? {}), ...patch, forVersion: spec?.version ?? null });
    this.persist(id);
  }

  // ---- kept builds ----

  // Keep the open build (with its plan) as a new named one, and open that
  saveAs(name) {
    const from = this.specs.get(this.currentId);
    if (!from) return { error: 'No sample build open' };
    const label = String(name ?? '').trim() || `${from.name ?? 'Build'} (copy)`;
    const id = slugOf(label, new Set(this.specs.keys()));
    this.plans.set(id, structuredClone(this.plans.get(this.currentId) ?? {}));
    this.currentId = id;
    this.store.saveSettings('sampleCurrent', { currentId: id });
    this.save({ ...structuredClone(from), id, name: label, version: 0 });
    // The copied plan was made for the build it was copied with
    const plan = this.plans.get(id);
    if (plan?.path || plan?.upgrades) this.setPlan(id, {});
    return this.page();
  }

  open(id) {
    if (!this.specs.has(id)) return { error: `No saved build "${id}"` };
    this.currentId = id;
    this.store.saveSettings('sampleCurrent', { currentId: id });
    const page = this.page();
    this.emit('sample', page);
    return page;
  }

  remove(id) {
    if (!this.specs.has(id)) return { error: `No saved build "${id}"` };
    if (this.specs.size === 1) return { error: "That's the only build; keep at least one" };
    this.specs.delete(id);
    this.plans.delete(id);
    this.cached.delete(id);
    this.store.deleteSettings?.(`sample:${id}`);
    if (this.currentId === id) this.currentId = this.saves()[0].id;
    this.store.saveSettings('sampleCurrent', { currentId: this.currentId });
    const page = this.page();
    this.emit('sample', page);
    return page;
  }

  // ---- long tasks ----

  // One long task at a time (ranking a minute or two, a path a few minutes), with progress events
  async task(name, fn) {
    if (this.busy) return { error: `Busy: ${this.busy}` };
    this.busy = name;
    this.emit('sampleProgress', { task: name, done: 0, total: 1 });
    try {
      return await fn((done, total) => this.emit('sampleProgress', { task: name, done, total }));
    } finally {
      this.busy = null;
      this.emit('sampleProgress', null);
    }
  }

  // craft: the limits rares are crafted under (CRAFT_LIMITS: 'T2' = item level 82-85 with Flame Sand,
  // 'any' = every tier and Ultimate affixes)
  async rankUpgrades({ troveOnly = false, craft = ['T2', 'any'], maxFe = this.maxFe } = {}) {
    const id = this.currentId;
    const spec = this.specs.get(id);
    if (!spec) return { error: 'No sample build' };
    return this.task('Ranking upgrades', async (onProgress) => {
      const { crafts, ...result } = await rankUpgrades(spec, this.gd, this.catalog(), { troveOnly, craft, maxFe, onProgress });
      const upgrades = { ...result, troveOnly, craft, maxFe, at: Date.now() };
      this.setPlan(id, { upgrades, crafts });
      this.emit('sample', this.page());
      return upgrades;
    });
  }

  // Up to 1B, rares are crafted at T2 (cheap, Flame Sand); past it any tier
  async findPath({ target, troveOnly = false, craft, maxFe = this.maxFe } = {}) {
    const id = this.currentId;
    const spec = this.specs.get(id);
    if (!spec) return { error: 'No sample build' };
    if (!(Number(target) > 0)) return { error: 'target must be a DPS number' };
    const limits = craft ?? (Number(target) <= 1e9 ? ['T2'] : ['T2', 'any']);
    return this.task(`Cheapest path to ${target}`, async (onProgress) => {
      const result = await pathToTarget(spec, this.gd, this.catalog(), { target: Number(target), troveOnly, craft: limits, maxFe, onProgress });
      const path = { ...result, troveOnly, at: Date.now() };
      this.setPlan(id, { path });
      this.emit('sample', this.page());
      return path;
    });
  }

  // The plan's path applied: its end build becomes the open build
  applyPath() {
    const path = this.plans.get(this.currentId)?.path;
    if (!path?.spec) return { error: 'No path to apply' };
    return this.save({ ...path.spec, id: this.currentId, name: this.specs.get(this.currentId)?.name ?? path.spec.name });
  }

  // Apply one change from the plan's upgrade list (by its label)
  applyUpgrade(label) {
    const spec = this.specs.get(this.currentId);
    if (!spec) return { error: 'No sample build' };
    const next = structuredClone(spec);
    if (!applyCandidate(next, this.gd, this.catalog(), label, this.plans.get(this.currentId)?.crafts ?? {})) return { error: `"${label}" isn't a change this build can take any more` };
    return this.save(next);
  }

  // ---- edits ----

  update(patch) {
    const spec = this.specs.get(this.currentId) ?? PRESETS.trove.build(this.currentId);
    return this.save({ ...mergeSpec(spec, patch), id: this.currentId });
  }

  // Replace part of the spec wholesale (a whole gear slot, the skill list, the talent trees, slates)
  replace(key, value) {
    const spec = this.specs.get(this.currentId) ?? PRESETS.trove.build(this.currentId);
    return this.save({ ...spec, [key]: value, id: this.currentId });
  }

  // A preset (or a copy of the logged character) loaded into the open build, keeping its name
  applyPreset(key) {
    const id = this.currentId;
    if (key === 'live') {
      const live = this.log.character();
      if (!live) return { error: 'No character is loaded from the log right now: log in, or pick one under the character list' };
      return this.save({ ...specFromCharacter(live, { id }), id });
    }
    const preset = PRESETS[key];
    if (!preset) return { error: `No preset "${key}"` };
    return this.save({ ...preset.build(id), id });
  }

  // The logged character's slates copied into the open build
  copyLiveSlates() {
    const live = this.log.character();
    if (!live?.slates?.length) return { error: 'No logged character with slates right now' };
    const slates = live.slates.map((s) => ({ name: s.name, icon: s.icon ?? null, talents: s.talents.filter((t) => t.text).map((t) => ({ id: t.id ?? null, text: t.text, effectPct: t.effectPct ?? 0 })) }));
    return this.replace('slates', slates);
  }

  // Talent points trimmed (or added) to what the spec's level has, keeping the points worth the most
  // DPS (talentFit.js)
  async fitTalents({ points } = {}) {
    const view = this.view();
    if (!view) return { error: 'No sample build' };
    const { spec, character } = view;
    return this.task('Fitting talents', async (onProgress) => {
      const result = await fitTalents(character, this.gd, {
        points: Number(points) > 0 ? Number(points) : talentPointsAt(spec.level ?? 85),
        scenario: character.calc.scenario?.values ?? {},
        build: { hero: spec.hero ?? undefined, pactspirits: spec.pactspirits ?? [] },
        onProgress,
      });
      if (result.error) return result;
      this.save({ ...spec, talents: result.talents });
      return result.summary;
    });
  }
}
