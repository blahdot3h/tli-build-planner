import { useState } from 'react';
import Panel from '../Panel.jsx';
import { TreeGrid } from '../TalentTrees.jsx';

const TREES = 4;

function TreeEditor({ index, tree, character, layout, catalog, onTree }) {
  const info = catalog.trees.find((t) => t.name === tree?.tree);
  const logged = character.talentTrees.find((t) => t.name === tree?.tree);
  const cores = tree?.cores ?? [];
  const setPoints = (node, delta) => {
    const points = { ...(tree.points ?? {}) };
    const next = Math.max(0, Math.min(node.maxPoints, (points[node.id] ?? 0) + delta));
    if (next) points[node.id] = next;
    else delete points[node.id];
    onTree({ ...tree, points });
  };
  return (
    <div className="tree">
      <div className="tree-head">
        {info?.image && <img className="tree-portrait" src={info.image} alt="" />}
        <select value={tree?.tree ?? ''} onChange={(e) => onTree(e.target.value ? { tree: e.target.value, points: {}, cores: [] } : null)}>
          <option value="">Tree {index + 1}: none</option>
          {catalog.trees.map((t) => (
            <option key={t.slug} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        <span>{logged?.points ?? 0} pts</span>
      </div>
      {info && (
        <div className="tree-cores">
          {info.cores.map((c) => (
            <label key={c.id} className={`tree-core ${cores.includes(c.name) ? 'on' : ''}`} title={`${c.text ?? ''}\nUnlocks at ${c.unlockPoints} points`}>
              <input
                type="checkbox"
                checked={cores.includes(c.name)}
                onChange={(e) => onTree({ ...tree, cores: e.target.checked ? [...cores, c.name] : cores.filter((n) => n !== c.name) })}
              />
              {c.icon && <img src={c.icon} alt="" />}
              {c.name} <small>({c.unlockPoints})</small>
            </label>
          ))}
        </div>
      )}
      {logged && layout && <TreeGrid tree={logged} layout={layout} treeIndex={index} onNode={setPoints} />}
    </div>
  );
}

export default function TalentEditor({ spec, character, catalog, talentPoints, onTalents, onFit, busy }) {
  const [points, setPoints] = useState('');
  const trees = Array.from({ length: TREES }, (_, i) => spec.talents?.[i] ?? null);
  const layouts = character.calc.talentLayouts ?? [];
  // character.talentTrees keeps only the trees that exist, in spec order
  const layoutFor = (tree) => layouts[character.talentTrees.findIndex((t) => t.name === tree?.tree)] ?? null;
  const save = (i, value) => {
    const next = [...trees];
    next[i] = value;
    onTalents(next.filter(Boolean));
  };
  const over = talentPoints.allocated > talentPoints.available;
  return (
    <Panel title="Talents" right={`${talentPoints.allocated} of about ${talentPoints.available} points at level ${spec.level}`}>
      <div className="pick-row">
        <button onClick={() => onTalents(catalog.recommendedTalents)} disabled={busy}>
          Recommended Bing 2 trees
        </button>
        <input className="num" type="number" min="1" max="140" placeholder={String(talentPoints.available)} value={points} onChange={(e) => setPoints(e.target.value)} />
        <button onClick={() => onFit(points ? Number(points) : null)} disabled={busy}>
          Fit to {points || talentPoints.available} points
        </button>
      </div>
      <p className={over ? 'note-warn' : 'muted small'}>
        {over ? `${talentPoints.allocated - talentPoints.available} more points than a level ${spec.level} character has (about level + 15). ` : ''}
        The recommended trees are CoffeeBingTest's (Goddess of Knowledge, Magister, Assassin, Ranger: 106 points at level 91). Fitting takes off the points worth
        the least DPS, or adds the ones worth the most, keeping each tree's rules. Click a node to add a point, right-click to take one off.
      </p>
      <div className="trees">
        {trees.map((t, i) => (
          <TreeEditor key={i} index={i} tree={t} character={character} layout={layoutFor(t)} catalog={catalog} onTree={(v) => save(i, v)} />
        ))}
      </div>
    </Panel>
  );
}
