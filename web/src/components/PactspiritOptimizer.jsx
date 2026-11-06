import { useState } from 'react';
import Panel from './Panel.jsx';
import { fmtCompact, fmtInt, fmtTime } from '../format.js';

const gainPct = (dps, base) => (base ? `+${((dps / base - 1) * 100).toFixed(0)}%` : '');

export default function PactspiritOptimizer({ optimizer, equipped }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const { result, progress } = optimizer;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/pactspirits/optimize', { method: 'POST' });
      const body = await res.json();
      if (body?.error) setError(body.error);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const busy = running || progress != null;
  const baseSim = result?.baseSim?.avgDps;
  return (
    <Panel title="Best pactspirit trio" right={result ? `checked ${fmtTime(result.at)}` : null}>
      <p className="muted small">
        Tries every legendary pactspirit in the main slots against your build and combat toggles, compares every trio of the
        strongest by formula, then ranks the best {result?.simulated ? result.simulated - 1 : 15} by the in-game simulation.
        Assumes level {result?.level ?? 6} (5 stars) with all ring effects. Pet data is from Torchlight of Building (April 2026),
        so newer pets are missing.
      </p>
      <div className="opt-run">
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? 'Testing combinations…' : result ? 'Run again' : 'Find best trio'}
        </button>
        {progress && (
          <span className="muted small">
            {fmtInt(progress.done)} / {fmtInt(progress.total)} trios
          </span>
        )}
      </div>
      {progress && (
        <div className="bar">
          <div style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
        </div>
      )}
      {error && <p className="note-warn">{error}</p>}
      {result?.error && <p className="note-warn">{result.error}</p>}

      {result && !result.error && (
        <>
          <div className="muted small opt-base">
            Without pactspirits: <strong>{baseSim != null ? fmtCompact(baseSim) : '—'}</strong> in-game (simulated),{' '}
            {fmtCompact(result.base)} formula · {fmtInt(result.evaluated)} engine runs and {result.simulated} simulations in{' '}
            {(result.ms / 1000).toFixed(1)} s
          </div>
          <table className="stats opt-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Trio</th>
                <th>In-game DPS</th>
                <th>Gain</th>
                <th>Formula</th>
              </tr>
            </thead>
            <tbody>
              {result.yours && (
                <tr className="yours">
                  <td>you</td>
                  <td>{result.yours.pets.join(' + ')}</td>
                  <td>{result.yours.sim ? fmtCompact(result.yours.sim.avgDps) : '—'}</td>
                  <td>{result.yours.sim && baseSim ? gainPct(result.yours.sim.avgDps, baseSim) : ''}</td>
                  <td className="muted">{result.yours.dps != null ? fmtCompact(result.yours.dps) : '—'}</td>
                </tr>
              )}
              {result.combos.map((c, i) => (
                <tr key={c.pets.join('+')} className={i === 0 ? 'best' : ''}>
                  <td>{i + 1}</td>
                  <td>{c.pets.join(' + ')}</td>
                  <td title={c.sim ? `best second ${fmtCompact(c.sim.peak1s)}` : ''}>{c.sim ? fmtCompact(c.sim.avgDps) : '—'}</td>
                  <td>{c.sim && baseSim ? gainPct(c.sim.avgDps, baseSim) : gainPct(c.dps, result.base)}</td>
                  <td className="muted" title={fmtInt(c.dps)}>
                    {fmtCompact(c.dps)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="sub-h">Each pet alone (formula)</h3>
          <div className="chips">
            {result.singles
              .filter((s) => s.dps > result.base)
              .slice(0, 15)
              .map((s) => (
                <span key={s.name} className="chip" title={`${s.type} · ${fmtInt(s.dps)} DPS`}>
                  {s.name}
                  <small>{gainPct(s.dps, result.base)}</small>
                </span>
              ))}
          </div>
        </>
      )}
      {equipped.length > 0 && !result?.yours && (
        <p className="muted small opt-current">
          Pick your current trio under "Hero & pactspirits" to see it ranked here (the log only has ids:{' '}
          {equipped.map((p) => `#${p.id}`).join(', ')}).
        </p>
      )}
    </Panel>
  );
}
