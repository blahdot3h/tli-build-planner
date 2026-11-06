import fs from 'node:fs';
import path from 'node:path';

const LOG_IN_LIBRARY = path.join(
  'steamapps', 'common', 'Torchlight Infinite', 'UE_game', 'TorchLight', 'Saved', 'Logs', 'UE_game.log',
);

function steamLibraries() {
  const libs = new Set();
  for (const programFiles of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
    if (!programFiles) continue;
    const steam = path.join(programFiles, 'Steam');
    libs.add(steam);
    try {
      const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replaceAll('\\\\', '\\'));
    } catch {
      // Steam isn't installed under this Program Files
    }
  }
  // Fallback for libraries Steam's config doesn't list: common folder names on each drive
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const drive = `${String.fromCharCode(c)}:\\`;
    if (!fs.existsSync(drive)) continue;
    for (const sub of ['SteamLibrary', 'Steam', path.join('Games', 'SteamLibrary')]) libs.add(path.join(drive, sub));
  }
  return [...libs];
}

// The game client's cached help manual (affix names), next to the log under the UE_game folder:
// UE_game/TorchLight/Saved/Logs/UE_game.log -> UE_game/Local/CommonCache/HelpManualV2AffixData
export function findGameManual(logPath = findLogPath()) {
  if (!logPath) return null;
  const file = path.join(path.dirname(logPath), '..', '..', '..', 'Local', 'CommonCache', 'HelpManualV2AffixData');
  return fs.existsSync(file) ? file : null;
}

// TLI_LOG_PATH wins; otherwise the first Steam library that has the game's Logs folder.
// The folder exists once the game has run, even before this session's log is created.
export function findLogPath() {
  if (process.env.TLI_LOG_PATH) return process.env.TLI_LOG_PATH;
  for (const lib of steamLibraries()) {
    const candidate = path.join(lib, LOG_IN_LIBRARY);
    if (fs.existsSync(path.dirname(candidate))) return candidate;
  }
  return null;
}
