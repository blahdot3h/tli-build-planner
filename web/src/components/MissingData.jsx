import { useState } from 'react';
import Panel from './Panel.jsx';
import { shotFor } from './Overlay.jsx';

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtWhen = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const putChoices = (values) => fetch('/api/choices', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });

// Where the character's data comes from and how to refresh it: what the log gives by itself (and
// reloads by itself; "Rescan the log" re-reads the whole file), and what has to be read off
// screenshots, each with when it was read, a capture button, and "changed in game" to forget what
// was read so it's asked for again. Below that, what's missing right now, and the latest screenshots.
export default function MissingData({ needs = [], captures = [], sources = null }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = async (label, fn) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const capture = (label) =>
    run(label, async () => {
      // In the desktop app the capture goes through it, so the overlay hides for the screenshot
      if (window.overlayApp) await window.overlayApp.capture(label, 'button');
      else {
        const res = await post('/api/capture', { label });
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      }
    });
  const rescan = () =>
    run('rescan', async () => {
      const res = await post('/api/rescan');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  const forget = (key) => run(`forget:${key}`, () => putChoices({ [key]: null }));
  if (!needs.length && !captures.length && !sources) return null;
  return (
    <Panel title="Character data" right={needs.length ? `${needs.length} to show in game` : 'nothing missing'}>
      {sources && (
        <>
          <div className="sources-head">
            <strong>From the game log</strong>
            <span className="muted small">reloads by itself as you play; the whole file again:</span>
            <button className="link" onClick={rescan} disabled={!!busy}>
              {busy === 'rescan' ? 'Rescanning…' : 'Rescan the log'}
            </button>
          </div>
          <ul className="sources">
            {sources.log.map((s) => (
              <li key={s.key} className={s.ok === false ? 'warn' : ''}>
                <span>{s.label}</span>
                <span className="muted small">{s.status}</span>
              </li>
            ))}
          </ul>
          <div className="sources-head">
            <strong>From screenshots</strong>
            <span className="muted small">read into the build by hand (ask Claude once a screenshot is taken); when something changed in game, capture it again</span>
          </div>
          <ul className="sources">
            {sources.shots.map((s) => (
              <li key={s.key} className={!s.have ? 'warn' : ''}>
                <span>
                  {s.label}
                  <div className="muted small">{s.how}</div>
                </span>
                <span className="small">
                  {s.have ? (s.readAt ? `read ${fmtWhen(s.readAt)}` : 'read') : s.missing ? `${s.missing} missing` : 'not read yet'}
                </span>
                <span className="sources-actions">
                  <button disabled={!!busy} onClick={() => capture(s.capture)} title={`Take a screenshot now, labelled "${s.capture}"`}>
                    {busy === s.capture ? 'Capturing…' : 'Capture'}
                  </button>
                  {s.forget && s.have && (
                    <button className="link" disabled={!!busy} onClick={() => forget(s.key)} title="Forget what was read, so it is asked for again">
                      changed in game
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {needs.length > 0 && (
        <>
          <div className="sources-head">
            <strong>Missing right now</strong>
          </div>
          <ul className="needs">
            {needs.map((n) => (
              <li key={n.key}>
                <div>
                  <strong>{n.what}</strong>
                  <div className="muted small">{n.how}</div>
                  {shotFor(n, captures) && (
                    <div className="small good">Screenshot taken {fmtTime(shotFor(n, captures).takenAt)}: waiting to be read into the build (ask Claude).</div>
                  )}
                </div>
                <button disabled={!!busy} onClick={() => capture(n.label)}>
                  {busy === n.label ? 'Capturing…' : 'Capture'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="pick-row">
        <button disabled={!!busy} onClick={() => capture('Game screen')}>
          {busy === 'Game screen' ? 'Capturing…' : 'Capture game screen'}
        </button>
        <span className="muted small">Screenshots of your main monitor, saved in data/captures for reading into the build.</span>
      </div>
      {error && <p className="note-warn">{error}</p>}
      {captures.length > 0 && (
        <div className="captures">
          {captures.slice(0, 12).map((c) => (
            <a key={c.file} href={`/api/captures/file/${encodeURIComponent(c.file)}`} target="_blank" rel="noreferrer" title={`${c.label} (${c.reason === 'auto' ? 'taken automatically' : 'captured'} ${fmtTime(c.takenAt)})`}>
              <img src={`/api/captures/file/${encodeURIComponent(c.file)}`} alt={c.label} loading="lazy" />
              <span className="small">{c.label}</span>
            </a>
          ))}
        </div>
      )}
    </Panel>
  );
}
