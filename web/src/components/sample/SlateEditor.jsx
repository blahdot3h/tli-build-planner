import { useState } from 'react';
import Panel from '../Panel.jsx';
import { ItemIcon } from '../Icon.jsx';

// Lines with several parts ("+3% Max Life\n+3% Max Energy Shield") read as one row in the search box
const shown = (text) => text.replace(/\n/g, ' / ');

function LineAdder({ lines, onAdd }) {
  const [text, setText] = useState('');
  const commit = () => {
    const line = lines.find((l) => shown(l.text) === text.trim());
    if (!line) return;
    onAdd(line);
    setText('');
  };
  return (
    <div className="pick-row small">
      <input className="sample-price-name" list="slate-lines" placeholder="Add a line: type to search, e.g. Lightning Skill Level" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </div>
  );
}

function Slate({ slate, index, catalog, onChange, onRemove }) {
  const type = catalog.slates.types.find((t) => t.name === slate.name);
  const effect = slate.effectPct ?? 0;
  const setTalents = (talents) => onChange({ ...slate, talents });
  return (
    <div className="slot sample-slot">
      <div className="slot-head">
        <span className="with-icon">
          <ItemIcon item={{ icon: slate.icon ?? type?.icon, name: slate.name, rarity: type?.legendary ? 100 : 4 }} width={28} />
          <select value={slate.name ?? ''} onChange={(e) => onChange({ ...slate, name: e.target.value })}>
            {!type && <option value={slate.name ?? ''}>{slate.name || `Slate ${index + 1}`}</option>}
            {catalog.slates.types.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.legendary ? ' (legendary)' : ''}
              </option>
            ))}
          </select>
        </span>
        <button className="link" onClick={onRemove}>
          remove
        </button>
      </div>
      <div className="pick-row small">
        <span>Effect bonus on every line</span>
        <input
          className="num"
          type="number"
          value={effect}
          title="The board's bonus (Nether King's Divinity reaching it: +70% in SS13, Judgment +40% in SS14)"
          onChange={(e) => {
            const pct = Number(e.target.value) || 0;
            onChange({ ...slate, effectPct: pct, talents: slate.talents.map((t) => ({ ...t, effectPct: pct })) });
          }}
        />
        <span>%</span>
      </div>
      <ul className="affixes">
        {slate.talents.map((t, i) => (
          <li key={`${t.text}-${i}`} className="affix k-prefix">
            <span className="affix-text">{shown(t.text)}</span>
            <input
              className="num small-num"
              type="number"
              value={t.effectPct ?? 0}
              title="This line's Effect bonus %"
              onChange={(e) => setTalents(slate.talents.map((x, k) => (k === i ? { ...x, effectPct: Number(e.target.value) || 0 } : x)))}
            />
            <button className="link" onClick={() => setTalents(slate.talents.filter((_, k) => k !== i))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <LineAdder lines={catalog.slates.lines} onAdd={(line) => setTalents([...slate.talents, { id: line.id, text: line.text, effectPct: effect }])} />
    </div>
  );
}

// Divinity slates on the board: each slate's lines are talent nodes (any tree's, or the Nether
// King's), each with the Effect bonus the board gives it. "(Max Active Divinity: N)" lines count at
// most N times across all slates.
export default function SlateEditor({ spec, catalog, onSlates, onCopyLive }) {
  const slates = spec.slates ?? [];
  const lineCount = slates.reduce((s, x) => s + (x.talents?.length ?? 0), 0);
  return (
    <Panel title="Divinity slates" right={`${slates.length} slates, ${lineCount} lines`}>
      <datalist id="slate-lines">
        {catalog.slates.lines.map((l) => (
          <option key={l.id} value={shown(l.text)}>
            {`${l.type}${l.tree ? ` · ${l.tree}` : ''}`}
          </option>
        ))}
      </datalist>
      <div className="pick-row">
        <button onClick={() => onSlates([...slates, { name: catalog.slates.types[0]?.name ?? 'Slate', effectPct: 0, talents: [] }])}>Add a slate</button>
        <button onClick={onCopyLive}>Copy my logged character's slates</button>
      </div>
      <p className="muted small">
        A slate's lines are talent nodes from the trees (and the Nether King's). Each line counts at its Effect bonus; whole-number lines round (+1 at +70% is
        +2). Lines marked "(Max Active Divinity: 1)" count once across all slates.
      </p>
      <div className="gear-grid">
        {slates.map((s, i) => (
          <Slate
            key={i}
            slate={s}
            index={i}
            catalog={catalog}
            onChange={(next) => onSlates(slates.map((x, k) => (k === i ? next : x)))}
            onRemove={() => onSlates(slates.filter((_, k) => k !== i))}
          />
        ))}
      </div>
    </Panel>
  );
}
