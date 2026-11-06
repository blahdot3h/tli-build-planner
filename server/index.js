import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openStore, describeStore } from './db/index.js';
import { GAMEDATA_DIR, writableDir } from './paths.js';
import { LogService } from './logService.js';
import { loadGameData } from './gamedata/index.js';
import { findGameManual } from './log/locator.js';
import { apiRouter } from './api.js';
import { SampleService } from './sample/service.js';
import { FarmService } from './farm/service.js';
import { Captures } from './capture.js';
import { CloudClient } from './cloud/client.js';
import { setCloudPrices } from './sample/prices.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prod = process.argv.includes('--prod');
const port = Number(process.env.PORT) || 4317;
const host = process.env.HOST || '127.0.0.1';

// SQLite in data/planner.sqlite unless MONGODB is set (server/db); TLI_DATA_DIR moves what's written
const store = await openStore();
console.log(describeStore(store));

const gamedata = loadGameData(GAMEDATA_DIR, { manualFile: findGameManual() });
// Screenshots of the game for what the log never records (server/capture.js)
const captures = new Captures(writableDir('captures'));
const service = new LogService({ store, gamedata, captures });
// Sample builds start first: they learn prices from the Exchange price checks the log replays
const samples = new SampleService({ store, gamedata, logService: service });
await samples.start();
// Drops, map runs and FE/hour (server/farm), valued with ETor's market; it too replays the log
const farm = new FarmService({ store, gamedata, logService: service });
await farm.start();
// The public market (server/cloud): legendary prices by roll, shared builds; sharing is opt-in
const cloud = new CloudClient({ store, gamedata });
await cloud.start();
setCloudPrices((name) => cloud.priceByName(name));
service.on('exchangePrice', (ev) => cloud.observeExchange(ev));
farm.on('farm', (view) => view.player?.seasonId && cloud.setSeason(view.player.seasonId));
await service.start();
cloud.refresh().catch(() => {});
setInterval(() => cloud.refresh().catch(() => {}), 10 * 60_000).unref();
const status = service.status();
console.log(status.logPath ? `Reading ${status.logPath} (${status.lines} lines so far)` : 'Torchlight Infinite log not found yet');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api', apiRouter(service, samples, farm, cloud));

const server = http.createServer(app);

if (prod) {
  const dist = path.join(root, 'web', 'dist');
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(root, 'vite.config.js'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(port, host, () => {
  console.log(`TLI Build Planner: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});
