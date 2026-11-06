// The Divinity slate board (Talent → Statue of The New God): its 24-cell diamond, each slate's cells
// from its shape and turn, which slates touch, and the lines a slate copies off the slates it
// touches. Used for the logged board and for what-if layouts (slates moved or turned in the UI).
//
// Spot: Index = column*10 + row (23 = column 2, row 3). Shapes (data/gamedata/slateShapes.local.json,
// keyed by ShapeId) list the cells at direction 0 as [row offset, column offset] from the spot;
// direction d is d quarter turns clockwise about the spot ([r, c] -> [c, -r]). Read off a
// screenshot of the user's board on 2026-11-02; the game's Direction is null, 1, 2 or 3 (null = 0).

// Row r (1-6) holds these columns
export const BOARD_COLS = [
  [3, 4],
  [2, 5],
  [1, 6],
  [1, 6],
  [2, 5],
  [3, 4],
];
export const BOARD_ROWS = BOARD_COLS.length;
export const onBoard = (row, col) => row >= 1 && row <= BOARD_ROWS && col >= BOARD_COLS[row - 1][0] && col <= BOARD_COLS[row - 1][1];
export const BOARD_CELLS = BOARD_COLS.flatMap(([from, to], i) => Array.from({ length: to - from + 1 }, (_, k) => [i + 1, from + k]));

export const spotOf = (col, row) => col * 10 + row;
export const colOf = (position) => Math.floor(Number(position) / 10) || null;
export const rowOf = (position) => Number(position) % 10 || null;

export function rotateCells(cells, times = 1) {
  let out = cells;
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) out = out.map(([r, c]) => [c, -r]);
  return out;
}

// The cells a shape covers at a direction, relative to its spot; null when the shape isn't known.
// No ShapeId (the Nether King's slate) is one cell.
export function slateCells(gd, shapeId, direction) {
  if (shapeId == null) return [[0, 0]];
  const shape = gd.get('slateShapes', shapeId);
  if (!shape?.cells) return null;
  return rotateCells(shape.cells, Number(direction) || 0);
}

// The picture of a placed slate cut out of a screenshot of the board (data/gamedata/slateSprites.local.json),
// by what it is, its shape and its turn; null when none has been cut yet
export function spriteFor(gd, slate, direction = slate.direction) {
  const key = `${slate.uniqueId || slate.baseId}_${slate.shapeId ?? 'x'}_${Number(direction) || 0}`;
  return gd.get('slateSprites', key)?.file ?? null;
}

// Absolute [row, col] cells of a placed slate (its spot alone while its shape is unknown)
export const placedCells = (s) => (s.cells?.length ? s.cells : [[0, 0]]).map(([dr, dc]) => [(s.row ?? rowOf(s.position)) + dr, (s.col ?? colOf(s.position)) + dc]);

const key = ([r, c]) => `${r},${c}`;

// Slates sharing an edge with s
export function neighbours(s, slates) {
  const mine = new Set(placedCells(s).map(key));
  const touches = (cells) => cells.some(([r, c]) => mine.has(key([r + 1, c])) || mine.has(key([r - 1, c])) || mine.has(key([r, c + 1])) || mine.has(key([r, c - 1])));
  return slates.filter((o) => o !== s && o.id !== s.id && touches(placedCells(o)));
}

// What's wrong with a layout: slates off the board or on top of each other
export function layoutProblems(slates) {
  const problems = [];
  const taken = new Map();
  for (const s of slates) {
    const name = s.name ?? `slate ${s.position}`;
    for (const cell of placedCells(s)) {
      if (!onBoard(cell[0], cell[1])) problems.push(`${name} is off the board at row ${cell[0]}, column ${cell[1]}`);
      const k = key(cell);
      if (taken.has(k)) problems.push(`${name} overlaps ${taken.get(k)} at row ${cell[0]}, column ${cell[1]}`);
      else taken.set(k, name);
    }
  }
  return [...new Set(problems)];
}

// A what-if layout ({ [slate id]: { position, direction } }) applied to the logged slates
export function applyLayout(slates, layout, gd) {
  if (!layout || !Object.keys(layout).length) return slates;
  return slates.map((s) => {
    const l = layout[s.id];
    if (!l) return s;
    const position = l.position ?? s.position;
    const direction = l.direction ?? s.direction;
    return { ...s, position, col: colOf(position), row: rowOf(position), direction, cells: slateCells(gd, s.shapeId, direction) ?? s.cells, sprite: spriteFor(gd, s, direction), moved: true };
  });
}

// When Sparks Set the Prairie Ablaze: "Copies the last Talent on all adjacent slates. Unable to copy
// Core Talents." Adjacent means sharing an edge (checked against the game's own copy list on the
// user's board: four slates touched, four lines copied). The copy keeps the copied slate's Effect
// bonus. Returns each copier's copies: [{ ...talent, copiedFrom, forSlate }]
const COPIES_ADJACENT = /copies the last talent on all adjacent slates/i;
export const isCopier = (s) => /when sparks set the prairie ablaze/i.test(s.name ?? '') || (s.talents ?? []).some((t) => COPIES_ADJACENT.test(t.text ?? ''));
export function copiedTalents(slates) {
  const out = [];
  for (const s of slates) {
    if (!isCopier(s)) continue;
    for (const other of neighbours(s, slates)) {
      const last = [...(other.talents ?? [])].reverse().find((t) => t.text && /talent/i.test(t.name ?? 'Talent'));
      if (last) out.push({ ...last, copiedFrom: other.name ?? `slate ${other.position}`, forSlate: s.id });
    }
  }
  return out;
}
