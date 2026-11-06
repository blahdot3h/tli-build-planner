// Parser for the Lua table dumps Torchlight Infinite writes to UE_game.log, e.g.
//
//   +Suffix+1+Id [110010003]
//   |      | +Version [85]
//   |      | +DynArgs+1 [36.0]
//   |      | |       +2 [-14.0]
//   |      +2+Id [140011303]
//
// The column of each '+' encodes nesting: a '+' aligned with a segment on an earlier
// line is a sibling of that segment. Lines without a "[value]" are empty tables.
// The game truncates long tables after 30 entries with a "+31+..." line, which parses
// to { 31: { '...': {} } } — see isTruncated().

const TREE_LINE = /^[| ]*\+/;

export function isTreeLine(line) {
  return TREE_LINE.test(line);
}

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    // Keep ids that overflow a double (player ids etc.) as strings
    return Number.isSafeInteger(n) || raw.includes('.') ? n : raw;
  }
  return raw;
}

export function parseTree(lines) {
  const root = {};
  const stack = []; // { col, value }: value is the object that segment's children go into

  for (const line of lines) {
    if (!isTreeLine(line)) continue;
    const col = line.indexOf('+');

    let keysPart = line.slice(col);
    let value;
    const valueAt = keysPart.indexOf(' [');
    if (valueAt >= 0) {
      const end = keysPart.lastIndexOf(']');
      value = parseValue(keysPart.slice(valueAt + 2, end > valueAt ? end : undefined));
      keysPart = keysPart.slice(0, valueAt);
    }
    keysPart = keysPart.trimEnd();

    while (stack.length && stack[stack.length - 1].col >= col) stack.pop();
    let parent = stack.length ? stack[stack.length - 1].value : root;

    const keys = keysPart.split('+').slice(1);
    let segCol = col;
    keys.forEach((key, i) => {
      if (i === keys.length - 1 && value !== undefined) {
        parent[key] = value;
      } else {
        if (parent[key] === null || typeof parent[key] !== 'object') parent[key] = {};
        stack.push({ col: segCol, value: parent[key] });
        parent = parent[key];
      }
      segCol += key.length + 1;
    });
  }
  return root;
}

// Lua arrays come through as objects keyed "1", "2", ...: return their values in order.
export function asList(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => a - b)
    .map((k) => obj[k])
    .filter((v) => !(v && typeof v === 'object' && '...' in v));
}

export function isTruncated(obj) {
  return !!obj && typeof obj === 'object' && Object.values(obj).some((v) => v && typeof v === 'object' && '...' in v);
}
