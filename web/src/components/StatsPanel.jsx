import { useState } from 'react';
import Panel from './Panel.jsx';
import { fmtInt } from '../format.js';

const NAME_LABELS = {
  affixes: 'Gear & memory affixes',
  talents: 'Talent & slate nodes',
  heroTraits: 'Hero traits',
};

const RES_LABELS = { cold: 'Cold', lightning: 'Lightning', fire: 'Fire', erosion: 'Erosion' };

function Bar({ part, total }) {
  return (
    <div className="bar">
      <div style={{ width: `${total ? (100 * part) / total : 0}%` }} />
    </div>
  );
}

const fmtAttr = (v) => (Math.abs(v) >= 1000 ? fmtInt(v) : String(Math.round(v * 100) / 100));

// The game's own attribute panel, logged whenever the character screen's attribute tab is open
// (or another player's is viewed): every row with its values (two for main / off hand)
function AttributePanel({ panel, other }) {
  const [open, setOpen] = useState(false);
  if (!panel) return null;
  const when = new Date(panel.at).toLocaleString();
  const title = other ? `Another player's attribute panel (Lv ${panel.level ?? '?'})` : `Your attribute panel from the game${panel.current ? '' : ' (gear has changed since)'}`;
  return (
    <div className="cov">
      <div className="cov-head">
        <span>{title}</span>
        <button className="link" onClick={() => setOpen((v) => !v)}>
          {panel.rows.length} rows · {when} {open ? '· hide' : '· show'}
        </button>
      </div>
      {open && (
        <ul className="unparsed">
          {panel.rows.map((r, i) => (
            <li key={`${r.id}-${i}`}>
              <span className="muted">{r.name}:</span> {r.values.map(fmtAttr).join(' / ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StatsPanel({ calc, gaps, gameStats }) {
  const [showUnparsed, setShowUnparsed] = useState(false);
  const d = calc.defenses;
  const a = calc.attributes;
  return (
    <Panel title="Stat breakdown">
      {d && (
        <div className="stat-grid">
          <div className="stat">
            <span>Life</span>
            <strong>{fmtInt(d.life)}</strong>
          </div>
          <div className="stat">
            <span>Energy Shield</span>
            <strong>{fmtInt(d.energyShield)}</strong>
          </div>
          <div className="stat">
            <span>Mana</span>
            <strong>{fmtInt(d.mana)}</strong>
          </div>
          <div className="stat">
            <span>Armor</span>
            <strong>{fmtInt(d.armor)}</strong>
          </div>
          <div className="stat">
            <span>Evasion</span>
            <strong>{fmtInt(d.evasion)}</strong>
          </div>
          <div className="stat">
            <span>Block (atk / spell)</span>
            <strong>
              {fmtInt(d.attackBlockPct)}% / {fmtInt(d.spellBlockPct)}%
            </strong>
          </div>
          {Object.entries(d.resistances).map(([k, r]) => (
            <div className="stat" key={k}>
              <span>{RES_LABELS[k]} Res</span>
              <strong className={r.actual < r.max ? 'under' : ''} title={`max ${r.max}%, before cap ${r.potential}%`}>
                {fmtInt(r.actual)}%
              </strong>
            </div>
          ))}
          {a && (
            <div className="stat">
              <span>STR / DEX / INT</span>
              <strong>
                {fmtInt(a.str)} / {fmtInt(a.dex)} / {fmtInt(a.int)}
              </strong>
            </div>
          )}
        </div>
      )}

      <div className="coverage">
        {calc.lines && (
          <div className="cov">
            <div className="cov-head">
              <span>Stat lines the engine understands</span>
              <button className="link" onClick={() => setShowUnparsed((v) => !v)}>
                {calc.lines.parsed}/{calc.lines.total} {calc.lines.unparsed.length > 0 && (showUnparsed ? '· hide misses' : '· show misses')}
              </button>
            </div>
            <Bar part={calc.lines.parsed} total={calc.lines.total} />
            {showUnparsed && (
              <ul className="unparsed">
                {calc.lines.unparsed.map((l, i) => (
                  <li key={i}>
                    <span className="muted">{l.source}:</span> {l.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <AttributePanel panel={gameStats?.panel} />
        <AttributePanel panel={gameStats?.viewedPanel} other />
        {Object.entries(calc.coverage ?? {}).map(([kind, c]) => (
          <div className="cov" key={kind}>
            <div className="cov-head">
              <span>{NAME_LABELS[kind] ?? kind} named</span>
              <span className="muted">
                {c.known}/{c.total}
              </span>
            </div>
            <Bar part={c.known} total={c.total} />
          </div>
        ))}
      </div>

      {gaps.length > 0 && (
        <ul className="gaps">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
