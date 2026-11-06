// Talent advice from the in-game simulation, run at full buff uptime so each candidate costs one
// engine run: what one more point is worth in every node you could take next (and the best next
// few points in order), and swaps that move a point from one damage node to another for more DPS,
// repeated until no swap helps. Nodes whose points don't change damage (defence, utility) are
// never taken from or suggested.
//
// Trees are the current season's: tlidb's node list (data/gamedata/talentTrees.json; node ids
// give column and row) and the lines its tree drawing joins nodes with (links). Trees imported
// before links were read fall back to the engine's prerequisite where its node at that spot is the
// same, else the node to the left for medium and legendary nodes. Rules, from the game's help and
// tlidb:
//   - a node needs as many points in the columns before it as tlidb lists for it (3 per column)
//   - a node joined to one in the column before needs that node full; a prism's spot counts as full
//   - a prism's spot takes no points
//   - a tree keeps the points its picked core talents need (tlidb lists each core's unlock points)
import * as tob from '../engine/tob.bundle.js';
import { talentPosition } from '../game/character.js';
import { simulate } from '../sim/index.js';

const NODE_TYPES = { 'Micro Talent': 'micro', 'Medium Talent': 'medium', 'Legendary Medium Talent': 'legendary' };
const MIN_GAIN = 0.0005; // a node is a damage node when one point changes DPS by more than 0.05%
const SWAPS_CHECKED = 24; // most promising swaps simulated exactly each round
const MAX_ROUNDS = 12;
const PLAN_POINTS = 5;

const spot = (x, y) => `${x}:${y}`;

// One of the character's trees as it is this season. x = row, y = column, both 1-based, like the log.
export function treeLayout(tree, gd) {
  const slug = String(tree.name ?? '').replace(/ /g, '_');
  const current = gd.get('talentTrees', slug);
  if (!current) return null;
  const engine = tob.TalentTrees.find((t) => t.name === slug);
  const nodes = Object.entries(current.nodes).map(([id, n]) => {
    const { x, y } = talentPosition(id);
    return {
      id: Number(id),
      x,
      y,
      type: NODE_TYPES[n.name] ?? 'micro',
      maxPoints: n.maxPoints,
      requiredPoints: n.requiredPoints ?? (y - 1) * 3,
      icon: n.icon,
      text: gd.get('talents', id)?.text ?? null,
    };
  });
  const at = new Map(nodes.map((n) => [spot(n.x, n.y), n]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const linkedFrom = current.links && new Map(current.links.map(([from, to]) => [Number(to), byId.get(Number(from))]));
  for (const n of nodes) {
    if (linkedFrom) {
      const pre = linkedFrom.get(n.id);
      n.prereq = pre ? { x: pre.x, y: pre.y } : null;
      continue;
    }
    const e = engine?.nodes.find((d) => d.position.x === n.y - 1 && d.position.y === n.x - 1);
    if (e && e.nodeType === n.type && e.maxPoints === n.maxPoints) {
      n.prereq = e.prerequisite ? { x: e.prerequisite.y + 1, y: e.prerequisite.x + 1 } : null;
    } else {
      n.prereq = n.type !== 'micro' && at.has(spot(n.x, n.y - 1)) ? { x: n.x, y: n.y - 1 } : null;
    }
  }
  const cores = (tree.cores ?? []).map((c) => ({ ...c, unlockPoints: gd.get('talents', c.id)?.unlockPoints ?? 0 }));
  return {
    slug,
    name: tree.name,
    image: current.image ?? null,
    columns: Math.max(...nodes.map((n) => n.y)),
    rows: Math.max(...nodes.map((n) => n.x)),
    nodes,
    cores,
    prism: tree.prism ?? null,
    minPoints: Math.max(0, ...cores.map((c) => c.unlockPoints)),
  };
}

// Points per spot for each tree, from the log
function allocationOf(character) {
  return character.talentTrees.map((t) => new Map(t.nodes.filter((n) => n.points).map((n) => [spot(n.x, n.y), n.points])));
}

// What's wrong with a tree's points (Map "x:y" -> points), as a set of "spot:problem" strings
export function problems(layout, pts) {
  const found = new Set();
  const total = [...pts.values()].reduce((s, v) => s + v, 0);
  if (total < layout.minPoints) found.add('tree:cores');
  const byColumn = new Map();
  for (const [k, v] of pts) {
    const y = Number(k.split(':')[1]);
    byColumn.set(y, (byColumn.get(y) ?? 0) + v);
  }
  const before = (y) => [...byColumn].filter(([c]) => c < y).reduce((s, [, v]) => s + v, 0);
  const prismAt = (x, y) => layout.prism && layout.prism.x === x && layout.prism.y === y;
  for (const n of layout.nodes) {
    const p = pts.get(spot(n.x, n.y)) ?? 0;
    if (!p) continue;
    const k = spot(n.x, n.y);
    if (p > n.maxPoints) found.add(`${k}:max`);
    if (prismAt(n.x, n.y)) found.add(`${k}:prism`);
    if (before(n.y) < n.requiredPoints) found.add(`${k}:column`);
    if (n.prereq && !prismAt(n.prereq.x, n.prereq.y)) {
      const pre = layout.nodes.find((m) => m.x === n.prereq.x && m.y === n.prereq.y);
      if (pre && (pts.get(spot(pre.x, pre.y)) ?? 0) < pre.maxPoints) found.add(`${k}:prereq`);
    }
  }
  return found;
}

const describe = (layout, treeIndex, n, points) => ({
  tree: layout.name,
  treeIndex,
  x: n.x,
  y: n.y,
  id: n.id,
  type: n.type,
  text: n.text,
  icon: n.icon,
  points,
  maxPoints: n.maxPoints,
});

export function talentLayouts(character, gd) {
  return character.talentTrees.map((t) => treeLayout(t, gd));
}

// options: { scenario, build, onProgress(done, budget) }
export async function optimizeTalents(character, gd, { scenario, build, onProgress } = {}) {
  const started = Date.now();
  const layouts = talentLayouts(character, gd);
  const original = allocationOf(character);
  const knownIssues = layouts.map((l, i) => (l ? problems(l, original[i]) : new Set()));

  // The character with another allocation, for the simulation
  const withPoints = (alloc) => ({
    ...character,
    talentTrees: character.talentTrees.map((t, i) => {
      const layout = layouts[i];
      if (!layout) return t;
      const nodes = layout.nodes.map((n) => ({ id: n.id, name: n.type, tree: layout.name, text: n.text, x: n.x, y: n.y, points: alloc[i].get(spot(n.x, n.y)) ?? 0 }));
      return { ...t, nodes, points: nodes.reduce((s, n) => s + n.points, 0) };
    }),
  });

  let evaluated = 0;
  const budget = 2500;
  const cache = new Map();
  const dpsOf = async (alloc) => {
    const k = alloc.map((m) => [...m].sort().join(',')).join('|');
    if (!cache.has(k)) {
      const s = simulate(withPoints(alloc), scenario, { ...build, steady: true });
      cache.set(k, s.supported ? s.avgDps : null);
      evaluated++;
      if (evaluated % 10 === 0) {
        onProgress?.(evaluated, budget);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    return cache.get(k);
  };

  const copy = (alloc) => alloc.map((m) => new Map(m));
  const change = (alloc, i, n, delta) => {
    const next = copy(alloc);
    const k = spot(n.x, n.y);
    const p = (next[i].get(k) ?? 0) + delta;
    if (p > 0) next[i].set(k, p);
    else next[i].delete(k);
    return next;
  };
  // Valid when it adds no problem the logged tree didn't already have
  const valid = (alloc, trees) => trees.every((i) => [...problems(layouts[i], alloc[i])].every((p) => knownIssues[i].has(p)));
  const pointsAt = (alloc, i, n) => alloc[i].get(spot(n.x, n.y)) ?? 0;
  const eachNode = function* () {
    for (const [i, layout] of layouts.entries()) if (layout) for (const n of layout.nodes) yield [i, layout, n];
  };

  // What one more point (or one fewer) in each node is worth
  async function singles(alloc, base) {
    const adds = [];
    const removes = [];
    for (const [i, layout, n] of eachNode()) {
      const p = pointsAt(alloc, i, n);
      if (p < n.maxPoints) {
        const next = change(alloc, i, n, 1);
        if (valid(next, [i])) {
          const dps = await dpsOf(next);
          if (dps != null) adds.push({ i, layout, n, next, dps, gain: dps / base - 1 });
        }
      }
      if (p > 0) {
        const next = change(alloc, i, n, -1);
        if (valid(next, [i])) {
          const dps = await dpsOf(next);
          if (dps != null) removes.push({ i, layout, n, next, dps, loss: 1 - dps / base });
        }
      }
    }
    return { adds: adds.sort((a, b) => b.gain - a.gain), removes };
  }

  const base = await dpsOf(original);
  if (base == null) return { error: "The simulation doesn't cover this build's main skill, so talents can't be compared." };

  // 1. The next point, and the next few in order
  const first = await singles(original, base);
  const nextPoint = first.adds.map((a) => ({ ...describe(a.layout, a.i, a.n, pointsAt(original, a.i, a.n)), dps: a.dps, gainPct: a.gain * 100 }));
  const plan = [];
  let planAlloc = original;
  let planDps = base;
  for (let k = 0; k < PLAN_POINTS; k++) {
    const { adds } = k === 0 ? first : await singles(planAlloc, planDps);
    const best = adds[0];
    if (!best || best.gain <= MIN_GAIN) break;
    plan.push({ ...describe(best.layout, best.i, best.n, pointsAt(planAlloc, best.i, best.n) + 1), dps: best.dps, gainPct: best.gain * 100, totalPct: (best.dps / base - 1) * 100 });
    planAlloc = best.next;
    planDps = best.dps;
  }

  // 2. Swaps between damage nodes, best first, applied one at a time until none helps
  async function bestSwaps(alloc, cur, pre) {
    const { adds, removes } = pre ?? (await singles(alloc, cur));
    const gains = adds.filter((a) => a.gain > MIN_GAIN);
    const losses = removes.filter((r) => r.loss > MIN_GAIN);
    const pairs = [];
    for (const r of losses) for (const a of gains) {
      if (r.i === a.i && r.n === a.n) continue;
      pairs.push({ r, a, estimate: a.gain - r.loss });
    }
    pairs.sort((p, q) => q.estimate - p.estimate);
    const checked = [];
    for (const { r, a } of pairs.slice(0, SWAPS_CHECKED)) {
      const next = change(change(alloc, r.i, r.n, -1), a.i, a.n, 1);
      if (!valid(next, [...new Set([r.i, a.i])])) continue;
      const dps = await dpsOf(next);
      if (dps != null && dps / cur - 1 > MIN_GAIN) checked.push({ r, a, next, dps, gain: dps / cur - 1 });
    }
    return checked.sort((p, q) => q.gain - p.gain);
  }

  const swapsNow = await bestSwaps(original, base, first);
  const swaps = swapsNow.slice(0, 10).map((s) => ({
    from: describe(s.r.layout, s.r.i, s.r.n, pointsAt(original, s.r.i, s.r.n)),
    to: describe(s.a.layout, s.a.i, s.a.n, pointsAt(original, s.a.i, s.a.n)),
    dps: s.dps,
    gainPct: s.gain * 100,
  }));

  const steps = [];
  let alloc = original;
  let cur = base;
  let round = swapsNow;
  for (let k = 0; k < MAX_ROUNDS && round.length && evaluated < budget; k++) {
    const s = round[0];
    steps.push({
      from: describe(s.r.layout, s.r.i, s.r.n, pointsAt(alloc, s.r.i, s.r.n)),
      to: describe(s.a.layout, s.a.i, s.a.n, pointsAt(alloc, s.a.i, s.a.n)),
      dps: s.dps,
      gainPct: s.gain * 100,
    });
    alloc = s.next;
    cur = s.dps;
    round = await bestSwaps(alloc, cur);
  }

  // Net change per node between the logged allocation and the improved one
  const changes = [];
  for (const [i, layout, n] of eachNode()) {
    const before = pointsAt(original, i, n);
    const after = pointsAt(alloc, i, n);
    if (before !== after) changes.push({ ...describe(layout, i, n, before), after });
  }

  onProgress?.(evaluated, evaluated);
  return {
    base,
    nextPoint,
    plan,
    swaps,
    improved: { steps, changes, dps: cur, gainPct: (cur / base - 1) * 100 },
    damageNodes: { add: first.adds.filter((a) => a.gain > MIN_GAIN).length, remove: first.removes.filter((r) => r.loss > MIN_GAIN).length },
    evaluated,
    ms: Date.now() - started,
    notes: [
      ...layouts.flatMap((l, i) => (l ? [] : [`${character.talentTrees[i].name ?? 'A tree'}: no current layout from tlidb, left as it is`])),
      ...layouts.flatMap((l, i) => (l && knownIssues[i].size ? [`${l.name}: the logged points already break a rule here (${[...knownIssues[i]].join(', ')}); moves aren't held to it`] : [])),
      ...character.talentTrees.filter((t) => t.truncated).map((t) => `${t.name}: the log listed only 30 of its nodes; points in the others count as 0`),
    ],
  };
}
