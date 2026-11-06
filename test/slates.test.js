// The Divinity slate board: shapes and turns, who touches whom, what Sparks copies, what-if layouts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../server/gamedata/index.js';
import { applyLayout, BOARD_CELLS, copiedTalents, layoutProblems, neighbours, onBoard, placedCells, rotateCells, slateCells } from '../server/game/slates.js';

const gd = loadGameData(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'gamedata'));

// CoffeeBingBong's board on 2026-11-02, as the log and his screenshot had it
const talent = (id, name, text) => ({ id, name, text, effectPct: 0 });
const slate = (id, position, shapeId, direction, name, talents) => ({ id, position, col: Math.floor(position / 10), row: position % 10, shapeId, direction, name, cells: slateCells(gd, shapeId, direction), talents });
const board = () => [
  slate('gow', 35, 1023, 1, "God of War's Divinity", [talent(43060300, 'Legendary Medium Talent', '+25% chance to Mark'), talent(40070100, 'Legendary Medium Talent', '+1 Physical Skill Level')]),
  slate('fallen', 14, 2020, null, 'Fallen Starlight', [talent(20060300, 'Micro Talent', '1.25% Life Regain'), talent(31070100, 'Legendary Medium Talent', '+8% additional Hit Damage for skills cast by Spell Burst')]),
  slate('corner33', 33, 2030, 1, 'A Corner of Divinity', [talent(34070400, 'Legendary Medium Talent', '+100% chance to gain a stack of Focus Blessing'), talent(30050200, 'Legendary Medium Talent', '+20% Spell Burst Charge Speed')]),
  slate('nether', 23, null, null, "Nether King's Divinity", [talent(90000204, 'Ultimate Nether King Talent Node', 'Immune to Paralysis and Slow'), talent(92100004, 'Ultimate Nether King Talent Node', '0.14% additional Spell Damage for every 1% Life sealed')]),
  slate('pedigree', 54, 2090, 1, 'Pedigree of Gods', [talent(22060200, 'Medium Talent', '+18% Attack Damage while Dual Wielding'), talent(21001100, 'Gale', '60% of the Projectile Speed bonus is also applied')]),
  slate('corner32', 32, 2030, 3, 'A Corner of Divinity', [talent(64040400, 'Legendary Medium Talent', 'Gains 1 stack of Tenacity Blessing'), talent(53060300, 'Legendary Medium Talent', '+20% chance to gain Blur')]),
  slate('corner42', 42, 2030, null, 'A Corner of Divinity', [talent(30050200, 'Legendary Medium Talent', '+20% Spell Burst Charge Speed'), talent(40070500, 'Legendary Medium Talent', '+8% additional Physical Damage while having Fervor')]),
  slate('sparks', 24, 2012, null, 'When Sparks Set the Prairie Ablaze', []),
];

test('the board is the 24-cell diamond and every slate of the logged board sits on it without overlaps', () => {
  assert.equal(BOARD_CELLS.length, 24);
  assert.ok(onBoard(1, 3) && onBoard(3, 1) && onBoard(6, 4));
  assert.ok(!onBoard(1, 1) && !onBoard(6, 5) && !onBoard(7, 3));
  const slates = board();
  assert.deepEqual(layoutProblems(slates), []);
  assert.equal(slates.flatMap(placedCells).length, 24, 'his eight slates fill the board');
});

test('shapes turn clockwise about the spot, and the game directions match the screenshot', () => {
  assert.deepEqual(rotateCells([[-1, 0]], 1), [[0, 1]]); // up becomes right
  assert.deepEqual(rotateCells([[-1, 0]], 4), [[-1, 0]]);
  // A Corner of Divinity: spot + up + right at direction 0; at 33 turned once it covers 33, 43 and 34
  assert.deepEqual(new Set(placedCells(board()[2]).map(String)), new Set([[3, 3], [3, 4], [4, 3]].map(String)));
  // Fallen Starlight at 14: its spot and the cell above
  assert.deepEqual(new Set(placedCells(board()[1]).map(String)), new Set([[4, 1], [3, 1]].map(String)));
  assert.equal(slateCells(gd, 999999, 0), null, 'an unknown shape is unknown');
  assert.deepEqual(slateCells(gd, null, 2), [[0, 0]], "the Nether King's slate is one cell");
});

test("Sparks copies the last line of each slate it touches, as the game's own copy list had it", () => {
  const slates = board();
  const sparks = slates.find((s) => s.id === 'sparks');
  assert.deepEqual(new Set(neighbours(sparks, slates).map((s) => s.id)), new Set(['nether', 'fallen', 'gow', 'corner33']));
  const copies = copiedTalents(slates);
  assert.deepEqual(new Set(copies.map((t) => t.id)), new Set([92100004, 31070100, 40070100, 30050200]));
  assert.ok(copies.every((t) => t.forSlate === 'sparks'));
  // Core talents (Gale) are never copied: Pedigree isn't adjacent here anyway, so move Sparks next to it
  const moved = applyLayout(slates, { sparks: { position: 25 } }, gd);
  const next = copiedTalents(moved);
  assert.ok(!next.some((t) => t.name === 'Gale'));
});

test('applyLayout moves and turns a slate and layoutProblems catches overlaps and the board edge', () => {
  const slates = board();
  const turned = applyLayout(slates, { corner42: { direction: 1 } }, gd);
  const corner = turned.find((s) => s.id === 'corner42');
  assert.equal(corner.direction, 1);
  assert.ok(corner.moved);
  // Turned once at 42 it wants 42, 52 and 43: 43 is the Corner at 33's cell
  assert.ok(layoutProblems(turned).some((p) => /overlaps/.test(p)));
  const off = applyLayout(slates, { fallen: { position: 11 } }, gd);
  assert.ok(layoutProblems(off).some((p) => /off the board/.test(p)));
  assert.equal(applyLayout(slates, {}, gd), slates, 'no layout, no change');
});
