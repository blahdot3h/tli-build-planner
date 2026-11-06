import { useState } from 'react';
import Panel from './Panel.jsx';
import { fmtCompact, fmtInt, fmtTime } from '../format.js';

const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

function NodeName({ node, points }) {
  return (
    <span className="tadv-node" title={node.text ?? ''}>
      {node.icon && <img src={node.icon} alt="" />}
      <span>
        <span className="muted">{node.tree} · </span>
        {String(node.text ?? '').split('\n')[0]}
        <span className="muted"> ({points ?? node.points}/{node.maxPoints})</span>
      </span>
    </span>
  );
}

// Runs the talent advisor (server/calc/talents.js) and lists what it found; the same findings are
// marked on the trees in the Talents panel.
export default function TalentAdvisor({ advice }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const { result, progress } = advice;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/talents/optimize', { method: 'POST' });
      const body = await res.json();
      if (body?.error) setError(body.error);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const busy = running || progress != null;
  return (
    <Panel title="Talent advisor" right={result?.at ? `checked ${fmtTime(result.at)}` : null}>
      <p className="muted small">
        Scores talent points with the in-game simulation, every buff up. It shows what one more point is worth in each node you
        could take now, and how to move points between damage nodes for more DPS. Defensive and utility points are never moved.
      </p>
      <div className="opt-run">
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? 'Testing talent points…' : result ? 'Run again' : 'Find better talent points'}
        </button>
        {progress && <span className="muted small">{fmtInt(progress.done)} simulations</span>}
      </div>
      {progress && (
        <div className="bar">
          <div style={{ width: `${Math.min(100, (100 * progress.done) / Math.max(1, progress.total))}%` }} />
        </div>
      )}
      {error && <p className="note-warn">{error}</p>}
      {result?.error && <p className="note-warn">{result.error}</p>}

      {result && !result.error && (
        <>
          <div className="muted small opt-base">
            Now: <strong>{fmtCompact(result.base)}</strong> (every buff up) · {fmtInt(result.evaluated)} simulations in {(result.ms / 1000).toFixed(1)} s
          </div>

          <h3 className="sub-h">Your next point</h3>
          <table className="stats tadv-table">
            <tbody>
              {result.nextPoint.slice(0, 8).map((n, i) => (
                <tr key={`${n.treeIndex}:${n.x}:${n.y}`} className={i === 0 ? 'best' : ''}>
                  <td>
                    <NodeName node={n} />
                  </td>
                  <td className="num">{pct(n.gainPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.plan.length > 1 && (
            <>
              <h3 className="sub-h">Next {result.plan.length} levels, in order</h3>
              <ol className="tadv-plan">
                {result.plan.map((n, i) => (
                  <li key={i}>
                    <NodeName node={n} points={n.points} />
                    <span className="num">{pct(n.totalPct)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          <h3 className="sub-h">Better allocation, same points</h3>
          {result.improved.steps.length ? (
            <>
              <p className="small">
                <strong>{pct(result.improved.gainPct)}</strong> DPS ({fmtCompact(result.improved.dps)}) by moving {result.improved.steps.length} point
                {result.improved.steps.length > 1 ? 's' : ''}:
              </p>
              <table className="stats tadv-table">
                <tbody>
                  {result.improved.changes.map((c) => (
                    <tr key={`${c.treeIndex}:${c.x}:${c.y}`}>
                      <td>
                        <NodeName node={c} />
                      </td>
                      <td className={`num ${c.after > c.points ? 'good' : 'bad'}`}>
                        {c.points} → {c.after}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted small">No swap between damage nodes adds DPS: your points are already where they do the most.</p>
          )}
          {result.notes?.length > 0 && (
            <ul className="assumptions">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
