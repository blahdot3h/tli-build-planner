// Bundles the vendored Torchlight of Building engine (TypeScript) into one ESM file the Node
// server can import: server/engine/tob.bundle.js. Skips the build when the bundle is newer than
// every source file; pass --force to rebuild anyway.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor', 'torchlight-of-building');
const ENTRY = path.join(ROOT, 'server', 'engine', 'tob-entry.ts');
const OUT = path.join(ROOT, 'server', 'engine', 'tob.bundle.js');

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}

const upToDate =
  !process.argv.includes('--force') &&
  fs.existsSync(OUT) &&
  fs.statSync(OUT).mtimeMs > Math.max(newestMtime(VENDOR), fs.statSync(ENTRY).mtimeMs);

if (!upToDate) {
  const license = fs.readFileSync(path.join(VENDOR, 'LICENSE.txt'), 'utf8');
  await build({
    entryPoints: [ENTRY],
    outfile: OUT,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
    banner: { js: `/*\nBundled from Torchlight of Building (https://github.com/aclinia/torchlight-of-building)\n\n${license}*/` },
  });
  console.log(`Built ${path.relative(ROOT, OUT)}`);
}
