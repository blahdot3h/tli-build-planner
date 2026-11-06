import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import { fmtCompact, fmtDuration, fmtInt, fmtPct, fmtTime, parseDps } from '../format.js';

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

function Reading({ test }) {
  const [text, setText] = useState(test.reading ? fmtCompact(test.reading) : '');
  const [error, setError] = useState(null);
  useEffect(() => setText(test.reading ? fmtCompact(test.reading) : ''), [test.reading]);

  async function commit() {
    const value = text.trim() ? parseDps(text) : null;
    if (text.trim() && value == null) return setError('Try a number like 110M or 1.2B');
    setError(null);
    if (value === test.reading) return;
    await fetch(`/api/dummy/${test.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reading: value }),
    });
  }
  return (
    <div className="measured">
      <label>
        <span>Dummy's best 5 s DPS</span>
        <input value={text} placeholder="e.g. 110M" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      </label>
      {error && <span className="note-warn">{error}</span>}
    </div>
  );
}

// The dummy shows its best 5 s DPS, so that's what the simulation is compared on
function Estimates({ test, calc }) {
  if (!test.reading) return null;
  const sim = calc.sim?.supported ? calc.sim : null;
  const rows = [
    ['Simulation, best 5 s', sim?.peak5s ?? null],
    ['Simulation, average', sim?.avgDps ?? null],
    ['Formula', calc.dps?.combat?.total ?? null],
    ["Game's sheet DPS then", test.gameDps],
  ].filter(([, v]) => v != null);
  return (
    <div className="compares">
      {rows.map(([label, v]) => (
        <div className="compare-row" key={label}>
          <span className="compare-item">{label}</span>
          <span className="compare-dps" title={fmtInt(v)}>
            {fmtCompact(v)} <span className="muted">({fmtPct(v, test.reading)})</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function DummyTest({ test, calc }) {
  const open = test.end == null;
  const windowSeconds = ((test.end ?? Date.now()) - test.start) / 1000;
  return (
    <div className="dummy-test">
      <div className="dummy-head">
        <strong>{clock(test.start)}</strong>
        <span className="muted small">{open ? 'dummy window open now' : `window open ${fmtDuration(windowSeconds)}`}</span>
      </div>
      <div className="small">
        {test.attackingSeconds > 0 ? (
          <>
            Attacking for {fmtDuration(test.attackingSeconds)}:{' '}
            {test.bursts.map((b, i) => (
              <span key={b.start}>
                {i > 0 && ', '}
                {clock(b.start)}–{clock(b.end)} ({fmtDuration(b.seconds)})
              </span>
            ))}
          </>
        ) : (
          <span className="muted">No attacks logged in this session</span>
        )}
      </div>
      {test.def && (
        <div className="muted small">
          DEF {fmtInt(test.def.min)}
          {test.def.max !== test.def.min && ` – ${fmtInt(test.def.max)} with combat buffs`}
          {test.gameDps != null && ` · game's sheet DPS ${fmtInt(test.gameDps)}`}
        </div>
      )}
      <Reading test={test} />
      <Estimates test={test} calc={calc} />
      {test.gearChanged && <p className="note-warn">Your gear has changed since this test, so the estimates above use different gear.</p>}
    </div>
  );
}

function Comparisons({ gameStats }) {
  const list = gameStats?.comparisons ?? [];
  if (!list.length) return null;
  return (
    <>
      <h3 className="sub-h">Item compares the game logged</h3>
      <div className="compares">
        {list.slice(0, 6).map((c) => {
          const change = c.dps ? c.dps.with / c.dps.now - 1 : null;
          return (
            <div className="compare-row" key={`${c.baseId}:${c.goldId}:${c.slot}`} title={`Logged at ${fmtTime(c.at)}`}>
              <span className="compare-item">
                {c.itemName ?? `Item #${c.baseId}`}
                {c.slotLabel && <span className="muted"> → {c.slotLabel}</span>}
              </span>
              <span className="compare-dps">
                {c.dps ? `${fmtCompact(c.dps.now)} → ${fmtCompact(c.dps.with)}` : '—'}
                {change != null && <span className={change >= 0 ? 'up' : 'down'}> {change >= 0 ? '+' : ''}{(100 * change).toFixed(0)}%</span>}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function DummyTests({ tests, gameStats, calc }) {
  return (
    <Panel title="Dummy tests" right="from the log">
      {tests.length ? (
        tests.map((t) => <DummyTest key={t.id} test={t} calc={calc} />)
      ) : (
        <p className="muted small">No hideout dummy sessions for this character in the current log.</p>
      )}
      <p className="muted small">
        The log shows when the dummy window is open and when you're attacking, but not the dummy's DPS. Type in its best 5 s
        figure to compare it with the planner's estimates.
      </p>
      <Comparisons gameStats={gameStats} />
    </Panel>
  );
}
