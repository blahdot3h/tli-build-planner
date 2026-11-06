import { useState } from 'react';
import Panel from '../Panel.jsx';
import { fmtCompact } from '../../format.js';

const COST_LABELS = { cheap: 'cheap', moderate: 'moderate', expensive: 'expensive' };
const TARGETS = [
  [1e9, '1B'],
  [1e10, '10B'],
  [1e11, '100B'],
  [1e12, '1T'],
];

function Progress({ progress }) {
  if (!progress) return null;
  const pct = progress.total ? Math.round((100 * progress.done) / progress.total) : 0;
  return (
    <div className="sample-progress">
      <span>{progress.task}…</span>
      <div className="bar">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const priceText = (p) => (p ? `${p.fe} FE${p.contributors <= 1 ? '*' : ''}` : '');

function UpgradeRow({ u, onApply, busy }) {
  return (
    <tr>
      <td className="good">+{u.gainPct.toFixed(u.gainPct < 10 ? 1 : 0)}%</td>
      <td>
        {u.label}
        {u.trove && <span className="tag good">Trove</span>}
        {u.rareLines && (
          <div className="muted small">
            {u.rareLines.join(' · ').replace(/\n/g, ' / ')}
            {u.tiers ? ` (${u.tiers.join(', ')})` : ''}
          </div>
        )}
      </td>
      <td className={`cost-${u.cost}`}>{COST_LABELS[u.cost] ?? ''}</td>
      <td className="muted small">{priceText(u.price)}</td>
      <td>
        <button className="link" disabled={busy} onClick={() => onApply(u.label)}>
          Apply
        </button>
      </td>
    </tr>
  );
}

// Which tiers crafted rares may use: T2 is the best item level 82-85 gear rolls (Flame Sand)
const CRAFT_CHOICES = [
  ['auto', 'Crafts: T2 up to 1B, then any tier'],
  ['T2', 'Crafts: T2 only (ilvl 82-85, Flame Sand)'],
  ['T2,any', 'Crafts: any tier, Ultimate included'],
];
const craftOption = (choice, target) => (choice === 'auto' ? undefined : choice.split(','));

export default function Upgrades({ page, progress, onRank, onPath, onApply, onApplyPath }) {
  const [troveOnly, setTroveOnly] = useState(false);
  const [target, setTarget] = useState(1e9);
  const [craft, setCraft] = useState('auto');
  const busy = !!page.busy || !!progress;
  const ranked = page.upgrades;
  const path = page.path;
  return (
    <Panel title="What to upgrade" right="by simulated DPS">
      <p className="muted small">
        Each change is tried on its own against the build as it is (a minute or two: every slot, gem, support, pactspirit and trait level, plus the best
        rare each slot can be crafted into). The path applies the best change for its rough cost, again and again, until the target. Cost tiers: Treasure
        Trove legendaries and T2 crafted rares (item level 82-85, Flame Sand) are cheap; other legendaries go by drop level, top-tier and Ultimate crafts are
        expensive, gems by TITrack price. No site tracks legendary gear prices, so check the Exchange for those.
      </p>
      <div className="pick-row">
        <button onClick={() => onRank(troveOnly, craft === 'auto' ? ['T2', 'any'] : craftOption(craft))} disabled={busy}>
          Rank upgrades
        </button>
        <label className="check-inline">
          <input type="checkbox" checked={troveOnly} onChange={(e) => setTroveOnly(e.target.checked)} /> Treasure Trove legendaries only
        </label>
      </div>
      <div className="pick-row">
        <select value={craft} onChange={(e) => setCraft(e.target.value)}>
          {CRAFT_CHOICES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="pick-row">
        <select className="pick-small" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
          {TARGETS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button onClick={() => onPath(target, troveOnly, craftOption(craft, target))} disabled={busy}>
          Cheapest path to {TARGETS.find(([v]) => v === target)?.[1]}
        </button>
      </div>
      <Progress progress={progress} />

      {path && (
        <>
          <h3 className="sub-h">
            Path: {fmtCompact(path.start)} → {fmtCompact(path.end)} {path.reached ? '(target reached)' : '(stopped short of the target)'}
            {path.maxFe ? `, ${path.maxFe} FE per item` : ''}
          </h3>
          {path.stale && <p className="note-warn">Found for an earlier version of this build: run it again to plan from the build as it is now.</p>}
          <ol className="sample-path">
            {path.steps.map((s, i) => (
              <li key={i}>
                <span className="num">{fmtCompact(s.dps)}</span> {s.label}
                {s.trove && <span className="tag good">Trove</span>} <span className="muted small">+{s.gainPct.toFixed(0)}%, {s.cost}{s.price ? `, ${priceText(s.price)}` : ''}</span>
                {s.rareLines && <div className="muted small">{s.rareLines.join(' · ').replace(/\n/g, ' / ')}</div>}
              </li>
            ))}
          </ol>
          <button className="primary" disabled={busy || !path.steps.length} onClick={onApplyPath}>
            Apply this path
          </button>
        </>
      )}

      {ranked && (
        <>
          <h3 className="sub-h">
            Best single changes (from {fmtCompact(ranked.base)}, {ranked.evaluated} tried{ranked.troveOnly ? ', Trove legendaries only' : ''}
            {ranked.maxFe ? `, ${ranked.maxFe} FE per item` : ''})
          </h3>
          {ranked.stale && <p className="note-warn">Ranked for an earlier version of this build: rank again to see changes from the build as it is now.</p>}
          <table className="stats sample-upgrades">
            <tbody>
              {ranked.upgrades.map((u) => (
                <UpgradeRow key={u.label} u={u} onApply={onApply} busy={busy} />
              ))}
            </tbody>
          </table>
          <p className="muted small">* only one TITrack contributor saw that price.</p>
        </>
      )}
    </Panel>
  );
}
