import { useState } from 'react';
import Panel from './Panel.jsx';

const TYPE_LABELS = { micro: 'Micro Talent', medium: 'Medium Talent', legendary: 'Legendary Medium Talent' };
const spot = (x, y) => `${x}:${y}`;

// The talent advisor's findings, keyed by tree index and spot: the next point's DPS gain for the
// best nodes, and the points each node gains or loses in the better allocation
function adviceMarks(advice) {
  const gains = new Map();
  const deltas = new Map();
  if (!advice || advice.error) return { gains, deltas, best: null };
  const top = advice.nextPoint.slice(0, 6);
  for (const n of top) gains.set(`${n.treeIndex}:${spot(n.x, n.y)}`, n.gainPct);
  for (const c of advice.improved?.changes ?? []) deltas.set(`${c.treeIndex}:${spot(c.x, c.y)}`, c.after - c.points);
  const best = top[0] ? `${top[0].treeIndex}:${spot(top[0].x, top[0].y)}` : null;
  return { gains, deltas, best };
}

// The line joining a node to the one it needs full: straight left, or to the row above or below
const linkClass = (n) => {
  const pre = n.prereq;
  if (!pre || pre.y !== n.y - 1) return '';
  return pre.x === n.x ? 'linked' : pre.x < n.x ? 'linked-up' : 'linked-down';
};

// onNode(node, delta): clicking a node adds a point, right-clicking takes one off (sample builds).
// Like the game, a node joined to one before it takes points only once that node is full, and a
// full node keeps its points while a node joined after it has any.
export function TreeGrid({ tree, layout, treeIndex, marks = { gains: new Map(), deltas: new Map(), best: null }, show = {}, onNode }) {
  const [blocked, setBlocked] = useState(null);
  const points = new Map(tree.nodes.filter((n) => n.points).map((n) => [spot(n.x, n.y), n.points]));
  const pointsAt = (x, y) => points.get(spot(x, y)) ?? 0;
  const before = (column) => layout.nodes.filter((n) => n.y < column).reduce((s, n) => s + pointsAt(n.x, n.y), 0);
  const gateOf = (column) => Math.min(...layout.nodes.filter((n) => n.y === column).map((n) => n.requiredPoints));
  const prismArea = new Set((layout.prism?.area ?? []).map((p) => spot(p.x, p.y)));
  const columns = Array.from({ length: layout.columns }, (_, i) => i + 1);
  const nodeAt = (x, y) => layout.nodes.find((m) => m.x === x && m.y === y);
  // The prism's spot counts as full
  const isFull = (x, y) => (layout.prism?.x === x && layout.prism?.y === y) || (nodeAt(x, y)?.maxPoints ?? 0) <= pointsAt(x, y);
  const lockedBy = (n) => (n.prereq && !isFull(n.prereq.x, n.prereq.y) ? nodeAt(n.prereq.x, n.prereq.y) : null);
  const heldBy = (n) => layout.nodes.filter((m) => m.prereq?.x === n.x && m.prereq?.y === n.y && pointsAt(m.x, m.y) > 0);

  function change(n, delta) {
    const pre = delta > 0 ? lockedBy(n) : null;
    if (pre) return setBlocked(`Put ${pre.maxPoints}/${pre.maxPoints} into the ${TYPE_LABELS[pre.type]} it's joined to (it has ${pointsAt(pre.x, pre.y)}) before taking this node.`);
    const after = delta < 0 && pointsAt(n.x, n.y) >= n.maxPoints ? heldBy(n) : [];
    if (after.length) return setBlocked(`Take the points out of the ${after.map((m) => TYPE_LABELS[m.type]).join(' and ')} joined after this node first.`);
    setBlocked(null);
    onNode(n, delta);
  }

  return (
    <>
      <div className="tgrid" style={{ gridTemplateColumns: `repeat(${layout.columns}, var(--tcell))` }}>
        {columns.map((c) => {
          const gate = gateOf(c);
          return (
            <div key={`gate-${c}`} className={`tgate ${before(c) >= gate ? 'open' : ''}`} style={{ gridColumn: c, gridRow: 1 }} title={`Needs ${gate} points in the columns before`}>
              {gate}
            </div>
          );
        })}
        {layout.prism && (
          <div className="tprism" style={{ gridColumn: layout.prism.y, gridRow: layout.prism.x + 1 }} title={[layout.prism.name ?? 'Ethereal Prism', ...(layout.prism.affixes ?? []).map((a) => a.text ?? `#${a.id} (no text yet)`)].join('\n')}>
            {layout.prism.icon ? <img src={layout.prism.icon} alt="" /> : '◆'}
          </div>
        )}
        {layout.nodes.map((n) => {
          // The prism takes this node's spot
          if (layout.prism && layout.prism.x === n.x && layout.prism.y === n.y) return null;
          const p = pointsAt(n.x, n.y);
          const k = `${treeIndex}:${spot(n.x, n.y)}`;
          const gain = show.next ? marks.gains.get(k) : undefined;
          const delta = show.swaps ? marks.deltas.get(k) : undefined;
          const link = linkClass(n);
          const locked = lockedBy(n);
          const state = p === 0 ? 'empty' : p >= n.maxPoints ? 'full' : 'partial';
          const classes = ['tnode', `t-${n.type}`, state, link, link && !locked ? 'link-on' : '', onNode && locked && !p ? 'locked' : '', prismArea.has(spot(n.x, n.y)) ? 'in-prism' : '', marks.best === k && show.next ? 'best' : ''];
          return (
            <div
              key={n.id}
              className={[...classes, onNode ? 'editable' : ''].filter(Boolean).join(' ')}
              style={{ gridColumn: n.y, gridRow: n.x + 1 }}
              onClick={onNode ? () => change(n, 1) : undefined}
              onContextMenu={
                onNode
                  ? (e) => {
                      e.preventDefault();
                      change(n, -1);
                    }
                  : undefined
              }
              title={`${TYPE_LABELS[n.type]} · ${p}/${n.maxPoints}${n.text ? `\n${n.text}` : ''}${locked ? `\nNeeds the ${TYPE_LABELS[locked.type]} it's joined to at ${locked.maxPoints}/${locked.maxPoints} first` : ''}${gain != null ? `\nNext point: +${gain.toFixed(2)}% DPS` : ''}${delta ? `\nBetter allocation: ${delta > 0 ? '+' : ''}${delta} point${Math.abs(delta) > 1 ? 's' : ''}` : ''}`}
            >
              {n.icon ? <img src={n.icon} alt="" /> : <span className="tnoicon">{n.type[0].toUpperCase()}</span>}
              {(p > 0 || n.maxPoints > 1) && (
                <span className="tpts">
                  {p}/{n.maxPoints}
                </span>
              )}
              {gain != null && <span className="tgain">+{gain.toFixed(1)}%</span>}
              {delta ? <span className={`tdelta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? `+${delta}` : delta}</span> : null}
            </div>
          );
        })}
      </div>
      {onNode && blocked && <div className="note-warn small">{blocked}</div>}
    </>
  );
}

function TalentTree({ tree, layout, treeIndex, marks, show }) {
  const cores = layout?.cores ?? tree.cores ?? [];
  return (
    <div className="tree">
      <div className="tree-head">
        {layout?.image && <img className="tree-portrait" src={layout.image} alt="" />}
        <strong>{tree.name ?? `Tree #${tree.id}`}</strong>
        <span>{tree.points} pts</span>
      </div>
      {layout ? (
        <TreeGrid tree={tree} layout={layout} treeIndex={treeIndex} marks={marks} show={show} />
      ) : (
        <p className="muted small">No layout for this tree on tlidb, so it can't be drawn.</p>
      )}
      {cores.length > 0 && (
        <div className="tree-cores">
          {cores.map((c) => (
            <span key={c.id} className="tree-core" title={`${c.text ?? ''}${c.unlockPoints ? `\nUnlocks at ${c.unlockPoints} points` : ''}`}>
              {c.icon && <img src={c.icon} alt="" />}
              {c.name ?? `#${c.id}`}
            </span>
          ))}
        </div>
      )}
      {tree.truncated && <div className="note-warn">The log cut this tree off at 30 nodes, so a few allocated nodes may be missing</div>}
    </div>
  );
}

export default function TalentTrees({ trees, layouts, advice }) {
  const [show, setShow] = useState({ next: true, swaps: true });
  const total = trees.reduce((sum, t) => sum + t.points, 0);
  const marks = adviceMarks(advice);
  const hasAdvice = marks.gains.size > 0 || marks.deltas.size > 0;
  return (
    <Panel title="Talents" right={`${total} points`}>
      {hasAdvice && (
        <div className="tlegend small">
          <label>
            <input type="checkbox" checked={show.next} onChange={(e) => setShow((s) => ({ ...s, next: e.target.checked }))} />
            <span className="tgain inline">+%</span> best nodes for your next point
          </label>
          <label>
            <input type="checkbox" checked={show.swaps} onChange={(e) => setShow((s) => ({ ...s, swaps: e.target.checked }))} />
            <span className="tdelta up inline">+n</span>
            <span className="tdelta down inline">−n</span> better allocation (damage nodes only)
          </label>
        </div>
      )}
      <div className="trees">
        {trees.map((t, i) => (
          <TalentTree key={t.id} tree={t} layout={layouts?.[i] ?? null} treeIndex={i} marks={marks} show={show} />
        ))}
      </div>
    </Panel>
  );
}
