// Fit a sample build's talents to a number of points: take off the point that costs the least DPS,
// or add the one that gains the most, one at a time, keeping every tree's rules (column gates,
// prerequisites, core talent unlocks; talents.js). DPS is the in-game simulation's at full uptime.
import { problems, treeLayout } from '../calc/talents.js';
import { simulate } from '../sim/index.js';

const spot = (x, y) => `${x}:${y}`;
const MAX_STEPS = 60;

export async function fitTalents(character, gd, { points, scenario, build, onProgress } = {}) {
  const layouts = character.talentTrees.map((t) => treeLayout(t, gd));
  if (layouts.some((l) => !l)) return { error: 'A tree has no layout from tlidb' };
  let alloc = character.talentTrees.map((t) => new Map(t.nodes.filter((n) => n.points).map((n) => [spot(n.x, n.y), n.points])));
  const known = layouts.map((l, i) => problems(l, alloc[i]));
  const total = (a) => a.reduce((s, m) => s + [...m.values()].reduce((x, v) => x + v, 0), 0);
  const withPoints = (a) => ({
    ...character,
    talentTrees: character.talentTrees.map((t, i) => {
      const nodes = t.nodes.map((n) => ({ ...n, points: a[i].get(spot(n.x, n.y)) ?? 0 }));
      return { ...t, nodes, points: nodes.reduce((s, n) => s + n.points, 0) };
    }),
  });
  const cache = new Map();
  const dpsOf = async (a) => {
    const k = a.map((m) => [...m].sort().join(',')).join('|');
    if (!cache.has(k)) {
      const s = simulate(withPoints(a), scenario, { ...build, steady: true });
      cache.set(k, s.supported ? s.avgDps : null);
      if (cache.size % 10 === 0) await new Promise((r) => setImmediate(r));
    }
    return cache.get(k);
  };
  const change = (a, i, n, d) => {
    const next = a.map((m) => new Map(m));
    const p = (next[i].get(spot(n.x, n.y)) ?? 0) + d;
    if (p > 0) next[i].set(spot(n.x, n.y), p);
    else next[i].delete(spot(n.x, n.y));
    return next;
  };
  const valid = (a, i) => [...problems(layouts[i], a[i])].every((p) => known[i].has(p));

  const start = total(alloc);
  const startDps = await dpsOf(alloc);
  if (startDps == null) return { error: "The simulation doesn't cover this build's main skill" };
  let dps = startDps;
  const steps = [];
  for (let step = 0; step < MAX_STEPS && total(alloc) !== points; step++) {
    const removing = total(alloc) > points;
    let best = null;
    for (const [i, layout] of layouts.entries()) {
      for (const n of layout.nodes) {
        const p = alloc[i].get(spot(n.x, n.y)) ?? 0;
        if (removing ? p === 0 : p >= n.maxPoints) continue;
        const next = change(alloc, i, n, removing ? -1 : 1);
        if (!valid(next, i)) continue;
        const d = await dpsOf(next);
        if (d == null) continue;
        if (!best || (removing ? d > best.dps : d > best.dps)) best = { next, dps: d, tree: layout.name, node: n, removing };
      }
    }
    if (!best) break;
    alloc = best.next;
    steps.push({ tree: best.tree, x: best.node.x, y: best.node.y, text: best.node.text, change: best.removing ? -1 : 1, dpsPct: (best.dps / dps - 1) * 100 });
    dps = best.dps;
    onProgress?.(step + 1, Math.abs(start - points));
  }
  const talents = character.talentTrees.map((t, i) => ({
    tree: t.name,
    points: Object.fromEntries(t.nodes.filter((n) => alloc[i].get(spot(n.x, n.y))).map((n) => [n.id, alloc[i].get(spot(n.x, n.y))])),
    cores: t.cores.map((c) => c.name),
    ...(t.prism ? { prism: t.prism } : {}),
  }));
  return { talents, summary: { from: start, to: total(alloc), dpsPct: (dps / startDps - 1) * 100, steps } };
}
