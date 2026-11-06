import { Router } from 'express';
import { HERO_CATALOG, LEGENDARY_PACTSPIRITS } from './engine/bridge.js';

export function apiRouter(service, samples, farm = null, cloud = null) {
  const api = Router();

  // The public market (server/cloud): prices other players saw, and sharing your own sightings
  if (cloud) {
    api.get('/cloud', (req, res) => res.json(cloud.status()));
    // { share: true | false }: send Exchange price checks and typed prices to the market
    api.put('/cloud/share', (req, res) => res.json(cloud.setShare(!!req.body?.share)));
    api.post('/cloud/refresh', async (req, res) => {
      await cloud.refresh({ force: true });
      res.json(cloud.status());
    });
    api.post('/cloud/flush', async (req, res) => res.json(await cloud.flush()));
    // The market's price for an equipped item (by its instance id) or any item description
    api.post('/cloud/price', (req, res) => {
      const item = req.body?.itemId ? service.itemById(String(req.body.itemId)) : req.body?.item;
      if (!item) return res.status(404).json({ error: 'No such item' });
      res.json({ price: cloud.priceFor(item) });
    });
    // { itemId | item, fe }: a price you saw for this item, shared when sharing is on
    api.post('/cloud/observe', (req, res) => {
      const item = req.body?.itemId ? service.itemById(String(req.body.itemId)) : req.body?.item;
      if (!item) return res.status(404).json({ error: 'No such item' });
      const obs = cloud.observeItem(item, req.body?.fe, { source: 'manual' });
      if (!obs) return res.status(400).json({ error: 'fe must be a positive number' });
      res.json({ observation: obs, queued: cloud.status().queued, share: cloud.status().share });
    });
    // { notes? }: share the build on screen (its gear by signature, hero, main skill, DPS)
    api.post('/cloud/builds/share', async (req, res) => {
      try {
        res.json(await cloud.shareBuild(service.character(), { notes: req.body?.notes ?? null }));
      } catch (err) {
        res.status(409).json({ error: err.message });
      }
    });
  }

  // Farming: drops, map runs and FE/hour from the log, valued with ETor's market (server/farm)
  if (farm) {
    api.get('/farm', (req, res) => res.json(farm.view()));
    api.post('/farm/session', (req, res) => res.json(farm.newSession()));
    // { applyTax?, manual?: { "<baseId>": fe | null }, excluded?: { "<baseId>": true | false } }
    api.put('/farm/settings', (req, res) => res.json(farm.setSettings(req.body ?? {})));
    // An unidentified gear drop: { stackId, uniqueId, yes: true | false } answers "was it this
    // legendary?"; { stackId, what: "<uniqueId>" | "rare" | null } marks it outright
    api.put('/farm/identify', (req, res) => {
      const { stackId, uniqueId, yes, what } = req.body ?? {};
      try {
        res.json(uniqueId != null ? farm.answer(stackId, uniqueId, !!yes) : farm.setIdentified(stackId, what ?? null));
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });
    api.post('/farm/prices/refresh', async (req, res) => res.json(await farm.refreshPrices()));
  }

  // Sample builds (server/sample): a plan geared and specced by hand, not read from the log
  const sampleReply = (res, result) => (result?.error ? res.status(409).json(result) : res.json(result));
  api.get('/sample', (req, res) => res.json(samples.page()));
  api.get('/sample/catalog', (req, res) => res.json(samples.catalog()));
  // One item type's craftable affixes, tier by tier ({ part, tier, text, lv, weight, library })
  api.get('/sample/craft/:type', (req, res) => res.json(samples.craftTiers(req.params.type)));
  // Kept builds: list, "Save as" (a named copy of the open build and its plan, then opened), open,
  // delete; and the logged character's slates copied into the open build
  api.get('/sample/saves', (req, res) => res.json(samples.saves()));
  api.post('/sample/save', (req, res) => sampleReply(res, samples.saveAs(req.body?.name)));
  api.post('/sample/open', (req, res) => sampleReply(res, samples.open(req.body?.id)));
  api.delete('/sample/saves/:id', (req, res) => sampleReply(res, samples.remove(req.params.id)));
  api.post('/sample/slates/copy-live', (req, res) => {
    const result = samples.copyLiveSlates();
    sampleReply(res, result?.error ? result : samples.page());
  });
  // { name, fe }: a price you know (fe null forgets it); { maxFe }: the price cap per item shown
  api.put('/sample/prices', (req, res) => res.json(samples.setPrice(req.body?.name, req.body?.fe ?? null)));
  api.put('/sample/maxfe', (req, res) => res.json(samples.setMaxFe(req.body?.maxFe ?? null)));
  // Merge a patch into the build ({ level: 85 }, { gear: { 3: {...} } }, { scenario: {...} }); null deletes
  api.put('/sample', (req, res) => {
    samples.update(req.body ?? {});
    res.json(samples.page());
  });
  // Replace one part wholesale: gear, skills, talents, pactspirits, hero, extraLines
  api.put('/sample/:key', (req, res) => {
    const allowed = ['gear', 'skills', 'talents', 'pactspirits', 'hero', 'extraLines', 'scenario', 'name', 'level', 'slates'];
    if (!allowed.includes(req.params.key)) return res.status(400).json({ error: `Can't replace ${req.params.key}` });
    samples.replace(req.params.key, req.body?.value ?? null);
    res.json(samples.page());
  });
  api.post('/sample/preset', (req, res) => {
    const result = samples.applyPreset(req.body?.preset);
    sampleReply(res, result?.error ? result : samples.page());
  });
  api.post('/sample/fit', async (req, res) => sampleReply(res, await samples.fitTalents(req.body ?? {})));
  api.post('/sample/upgrades', async (req, res) => sampleReply(res, await samples.rankUpgrades(req.body ?? {})));
  api.post('/sample/upgrades/apply', (req, res) => {
    const result = samples.applyUpgrade(req.body?.label);
    sampleReply(res, result?.error ? result : samples.page());
  });
  api.post('/sample/path', async (req, res) => sampleReply(res, await samples.findPath(req.body ?? {})));
  api.post('/sample/path/apply', (req, res) => {
    const result = samples.applyPath();
    sampleReply(res, result?.error ? result : samples.page());
  });

  api.get('/status', (req, res) => res.json(service.status()));
  api.post('/check', (req, res) => res.json(service.check()));
  api.post('/rescan', (req, res) => {
    service.rescan();
    res.json(service.status());
  });
  api.get('/character', (req, res) => res.json(service.character()));
  // Options for the hero / trait / pactspirit pickers, with tlidb's pictures matched by name
  api.get('/catalog', (req, res) => {
    const { gd } = service;
    const traits = (list) => list.map((t) => ({ ...t, icon: gd.iconByName('heroTraits', t.name) }));
    res.json({
      heroes: HERO_CATALOG.map((h) => ({
        ...h,
        portrait: gd.heroPortrait(h.levels[1]?.[0]?.name),
        levels: Object.fromEntries(Object.entries(h.levels).map(([level, list]) => [level, traits(list)])),
      })),
      pactspirits: LEGENDARY_PACTSPIRITS.map((p) => ({ ...p, icon: gd.iconByName('pactspirits', p.name) })),
    });
  });
  // { playerId, snapshotId }: a character (null follows whoever is logged in), optionally one of its
  // snapshots; a character not in this log loads from its newest snapshot
  api.put('/select', async (req, res) => {
    const character = await service.select(req.body?.playerId ?? null, req.body?.snapshotId ?? null);
    if (!character) return res.status(404).json({ error: 'No snapshot of that character' });
    res.json({ playerId: character.player.playerId, name: character.player.name, view: character.view });
  });
  // The viewed character's snapshots (or ?playerId=), newest first
  api.get('/snapshots', async (req, res) => res.json(await service.snapshots(req.query.playerId ?? null)));
  // { label }: save what's shown, with its toggles and picks
  api.post('/snapshots', async (req, res) => {
    try {
      const result = await service.saveBuild(req.body?.label);
      if (result.error) return res.status(409).json(result);
      res.json(result);
    } catch (err) {
      res.status(503).json({ error: err.message });
    }
  });
  // What each skill or slate adds to the DPS: the figure without each one
  // Every support tried in one support slot: { kind: 'active' | 'passive', slot, index } -> the DPS with each
  api.post('/skills/supports/compare', (req, res) => {
    const result = service.compareSupports(req.body ?? {});
    if (result.error) return res.status(409).json(result);
    res.json(result);
  });
  // A slate moved or turned on the board: { id, position, direction } or { reset: true }
  api.put('/slates/layout', (req, res) => {
    const result = service.setSlateLayout(req.body ?? {});
    if (result.error) return res.status(result.problems ? 400 : 409).json(result);
    res.json(result);
  });
  for (const kind of ['skills', 'slates']) {
    api.post(`/${kind}/contributions`, (req, res) => {
      const result = service.contributions(kind);
      if (result.error) return res.status(409).json(result);
      res.json(result);
    });
  }
  api.put('/choices', (req, res) => {
    const character = service.setChoices(req.body ?? {});
    if (!character) return res.status(409).json({ error: 'No character loaded yet' });
    res.json(character.calc.choices);
  });
  // { reading: DPS the dummy showed, or null to clear } for a dummy session (id = its start time)
  api.put('/dummy/:start', (req, res) => {
    const reading = req.body?.reading;
    if (reading != null && !(Number.isFinite(reading) && reading > 0)) return res.status(400).json({ error: 'reading must be a positive number' });
    const character = service.setDummyReading(req.params.start, reading ?? null);
    if (!character) return res.status(409).json({ error: 'No character loaded yet' });
    res.json(character.dummyTests);
  });
  api.get('/pactspirits/optimize', (req, res) => res.json(service.lastOptimizerResult()));
  api.post('/pactspirits/optimize', async (req, res) => res.json(await service.optimizePactspirits()));
  api.get('/talents/optimize', (req, res) => res.json(service.lastTalentResult()));
  api.post('/talents/optimize', async (req, res) => res.json(await service.optimizeTalents()));
  api.put('/scenario', (req, res) => {
    const character = service.setScenario(req.body ?? {});
    if (!character) return res.status(409).json({ error: 'No character loaded yet' });
    res.json(character.calc);
  });
  api.get('/feed', (req, res) => res.json(service.feed()));
  api.get('/history', async (req, res) => res.json(await service.history()));

  // Server-sent events: full state on connect, then live updates
  // Screenshots of the game: taken as pages the log names come up, or with the capture button
  // ({ label }: what's on screen, e.g. a need from calc.needs)
  api.get('/captures', (req, res) => res.json(service.capturesList()));
  api.post('/capture', async (req, res) => {
    try {
      res.json(await service.capture(String(req.body?.label ?? 'Game screen').slice(0, 80), req.body?.reason === 'auto' ? 'auto' : 'button'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  api.get('/captures/file/:name', (req, res) => {
    const file = service.captures?.file(req.params.name);
    if (!file) return res.status(404).end();
    res.sendFile(file);
  });
  api.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event) => (data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const listeners = {
      status: send('status'),
      character: send('character'),
      feedEntry: send('feedEntry'),
      optimizerProgress: send('optimizerProgress'),
      optimizerResult: send('optimizerResult'),
      talentProgress: send('talentProgress'),
      talentResult: send('talentResult'),
      captures: send('captures'),
    };
    // The overlay app (/api/stream?client=overlay) takes the automatic screenshots
    const overlay = req.query.client === 'overlay';
    if (overlay) {
      service.overlayClients += 1;
      listeners.captureRequest = send('captureRequest');
    }
    listeners.status(service.status());
    listeners.character(service.character());
    send('feed')(service.feed());
    send('optimizerResult')(service.lastOptimizerResult());
    send('talentResult')(service.lastTalentResult());
    send('captures')(service.capturesList());
    for (const [event, fn] of Object.entries(listeners)) service.on(event, fn);
    // Sample build changes and long-task progress
    const sampleListeners = { sample: send('sample'), sampleProgress: send('sampleProgress') };
    for (const [event, fn] of Object.entries(sampleListeners)) samples.on(event, fn);
    // The farming tracker's view, whenever a drop, run or price changes
    const farmListener = send('farm');
    if (farm) {
      farmListener(farm.view());
      farm.on('farm', farmListener);
    }
    const cloudListener = send('cloud');
    if (cloud) {
      cloudListener(cloud.status());
      cloud.on('cloud', cloudListener);
    }
    req.on('close', () => {
      if (overlay) service.overlayClients -= 1;
      for (const [event, fn] of Object.entries(listeners)) service.off(event, fn);
      for (const [event, fn] of Object.entries(sampleListeners)) samples.off(event, fn);
      farm?.off('farm', farmListener);
      cloud?.off('cloud', cloudListener);
    });
  });

  return api;
}
