// Where the planner reads and writes. The repo's data/ holds the game data (read-only in a packaged
// app) and, by default, everything the planner writes: its SQLite database, screenshots and price
// caches. TLI_DATA_DIR moves the writable part elsewhere (the packaged overlay sets it to the user's
// app-data folder, since an asar archive can't be written).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAMEDATA_DIR = path.join(ROOT, 'data', 'gamedata');

export function dataDir() {
  return process.env.TLI_DATA_DIR ? path.resolve(process.env.TLI_DATA_DIR) : path.join(ROOT, 'data');
}

// A writable subfolder of the data dir, created on first use
export function writableDir(name) {
  const dir = path.join(dataDir(), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The SQLite database file (TLI_DB overrides; ":memory:" keeps nothing)
export function dbFile() {
  return process.env.TLI_DB || path.join(dataDir(), 'planner.sqlite');
}
