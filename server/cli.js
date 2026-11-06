// Prints what the planner reads from the log, without the web UI or MongoDB.
//   node server/cli.js [path\to\UE_game.log]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGameManual, findLogPath } from './log/locator.js';
import { LogTailer } from './log/tailer.js';
import { LineParser } from './log/lineParser.js';
import { GameState } from './game/state.js';
import { buildCharacter } from './game/character.js';
import { loadGameData } from './gamedata/index.js';

const logPath = process.argv[2] || findLogPath();
if (!logPath) {
  console.error('Torchlight Infinite log not found. Pass the path to UE_game.log.');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gd = loadGameData(path.join(root, 'data', 'gamedata'), { manualFile: findGameManual(logPath) });
const state = new GameState();
const parser = new LineParser((ev) => state.apply(ev));
const tailer = new LogTailer(logPath);
tailer.on('lines', (lines) => parser.feed(lines));
tailer.poll();
parser.flush();

const st = parser.stats;
console.log(`${logPath}\n${st.lines} lines, ${st.gameLines} game lines, ${st.dumps} dumps, ${state.catalog.size} items with details`);

const c = buildCharacter(state, gd);
if (!c) {
  console.log('No character login in this log yet.');
  process.exit(0);
}
const p = c.player;
console.log(`\n${p.name}  level ${p.level}  hero #${p.heroId}  season ${p.seasonId}  recorded max DPS ${c.recorded.historyMaxDps}`);

console.log('\nEquipped:');
for (const { slot, label, item } of c.equipment) {
  if (!item) {
    console.log(`  ${String(slot).padStart(2)} ${label.padEnd(10)} (empty)`);
    continue;
  }
  const detail = item.detailsKnown
    ? `iLvl ${item.level}, rarity ${item.rarity}${item.uniqueId ? `, legendary #${item.uniqueId}` : ''}, ${item.affixes.length} affixes`
    : 'details not captured';
  console.log(`  ${String(slot).padStart(2)} ${label.padEnd(10)} base #${item.baseId}  ${detail}`);
}

console.log('\nTalent trees:', c.talentTrees.map((t) => `#${t.id} (${t.points} pts${t.truncated ? ', truncated' : ''})`).join(', '));
console.log('Hero traits:', c.heroTraits.map((t) => `#${t.id}`).join(', '));
console.log('Active skills:', c.skills.active.map((g) => (g.skill ? `#${g.skill.baseId}+${g.supports.length}` : '-')).join(', '));

const fmt = (ms) => new Date(ms).toLocaleTimeString();
console.log('\nFeed:');
for (const e of state.feed) {
  const what = e.kind === 'login' ? `${e.name} logged in (${e.items} items with details)` : `slot ${e.slot ?? '-'} ${e.itemId ?? ''}${e.movedFrom ? ` (moved from slot ${e.movedFrom})` : ''}`;
  console.log(`  ${fmt(e.at)}  ${e.kind.padEnd(7)} ${what}`);
}
if (c.gaps.length) console.log('\nGaps:\n  ' + c.gaps.join('\n  '));
