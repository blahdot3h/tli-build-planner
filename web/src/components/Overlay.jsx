import { useCallback, useEffect, useState } from 'react';
import { useLiveData, useNow } from '../useLiveData.js';
import { fmtCompact } from '../format.js';
import FarmPanel, { farmBarText } from './FarmPanel.jsx';
import FarmMini from './FarmMini.jsx';

// The desktop app's overlay (window.overlayApp from overlay/preload.cjs); in a plain browser tab the
// same page works with the server taking the screenshots
const app = typeof window !== 'undefined' ? window.overlayApp ?? null : null;
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// A need's newest screenshot, if one was taken: then it's waiting to be read into the build (by
// Claude, from data/captures), not to be captured again. Talent trees and the follower are captured
// under their own labels ("Talent tree: Magister", "Follower (IconTlBtn)").
export function shotFor(need, captures) {
  return (
    captures.find(
      (c) =>
        c.label === need.label ||
        (need.key === 'talents' && c.label.startsWith('Talent tree')) ||
        (need.key === 'follower' && c.label.startsWith('Follower')),
    ) ?? null
  );
}

async function takeScreenshot(label, reason = 'button') {
  if (app) return app.capture(label, reason);
  const res = await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, reason }) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

// Over the game: the DPS, what the log is missing for this character and the screenshot to take
// next, with capture buttons (and a hotkey) that hide the overlay for the moment of the capture
export default function Overlay() {
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hotkeys, setHotkeys] = useState(null);
  // The window's layout: the full panel, a small bar when not in use, or the mini farming box (the
  // app resizes the window to match), and whether the mini box lets clicks through to the game.
  // The app also changes these from its hotkeys, so it tells the page about every change.
  const [layout, setLayoutState] = useState('full');
  const [clickThrough, setClickThrough] = useState(false);
  useEffect(() => {
    if (!app) return undefined;
    const apply = (s) => {
      setLayoutState(s.layout);
      setClickThrough(s.clickThrough);
      if (s.hotkeys) setHotkeys(s.hotkeys);
    };
    app.state().then(apply);
    return app.onState(apply);
  }, []);
  const setLayout = (value) => {
    setLayoutState(value);
    app?.layout(value);
  };
  // Opened the full overlay from the compact box (its ⚙): ✕ goes back there rather than hiding
  const [returnTo, setReturnTo] = useState(null);
  const openFull = () => {
    setReturnTo('mini');
    setLayout('full');
  };
  const close = () => {
    if (returnTo) {
      setReturnTo(null);
      setLayout(returnTo);
    } else app?.hide();
  };
  const collapse = (value) => setLayout(value ? 'bar' : 'full');
  const collapsed = layout === 'bar';
  // Build (DPS and the screenshots still missing) or Farm (drops and FE/hour), remembered per window
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('overlay-mode') ?? 'build';
    } catch {
      return 'build';
    }
  });
  const chooseMode = (m) => {
    setMode(m);
    try {
      localStorage.setItem('overlay-mode', m);
    } catch {
      // Not remembered, that's all
    }
  };
  const now = useNow();
  const capture = useCallback(async (label, reason = 'button') => {
    setBusy(true);
    try {
      const item = await takeScreenshot(label, reason);
      setToast({ ok: true, text: `${reason === 'auto' ? 'Taken' : 'Captured'}: ${item.label}` });
    } catch (err) {
      setToast({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }, []);
  // The server asks for the automatic screenshots (a talent tree or the follower page coming up)
  const onCaptureRequest = useCallback((req) => capture(req.label, 'auto'), [capture]);
  const { character, captures, connected, status, farm } = useLiveData({ overlay: !!app, onCaptureRequest });
  const needs = character?.calc?.needs ?? [];
  // Still to capture, and captured but not read into the build yet
  const toTake = needs.filter((n) => !shotFor(n, captures));
  const waiting = needs.filter((n) => shotFor(n, captures));
  const next = toTake[0] ?? null;

  useEffect(() => {
    app?.hotkeys().then(setHotkeys);
  }, []);
  // The capture hotkey takes the screenshot the overlay is asking for
  useEffect(() => app?.onHotkeyCapture(() => capture(next?.label ?? 'Game screen')), [capture, next?.label]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const sim = character?.calc?.sim;
  if (layout === 'mini') {
    return (
      <FarmMini
        farm={farm}
        app={app}
        clickThrough={clickThrough}
        hotkeys={hotkeys}
        onLayout={(l) => (l === 'full' ? openFull() : setLayout(l))}
        onClickThrough={(on) => {
          setClickThrough(on);
          app?.clickThrough(on);
        }}
        onHide={() => app?.hide()}
      />
    );
  }
  if (collapsed) {
    return (
      <div className="ov ov-bar">
        <span className={`ov-dot ${connected && status?.fileExists ? 'on' : ''}`} />
        {mode === 'farm' ? (
          <b className="ov-bar-fe" title="This map's FE per minute (or the session's FE per hour)">
            {farmBarText(farm, now) ?? 'Farm'}
          </b>
        ) : (
          <b className="ov-bar-dps">{sim?.supported ? fmtCompact(sim.avgDps) : 'TLI'}</b>
        )}
        {next ? (
          <button className="ov-badge" title={`Next: ${next.what}. Press to capture “${next.label}”.`} disabled={busy} onClick={() => capture(next.label)}>
            {busy ? '…' : `📷 ${toTake.length} needed`}
          </button>
        ) : waiting.length > 0 ? (
          <span className="ov-badge muted" title="Screenshots taken: ask Claude to read them into the build">
            ⏳ {waiting.length} to read
          </span>
        ) : (
          <button className="ov-badge" disabled={busy} onClick={() => capture('Game screen')} title="Capture the game screen">
            {busy ? '…' : '📷'}
          </button>
        )}
        <button className="ov-icon" title="Compact economy view" onClick={() => setLayout('mini')}>
          ▣
        </button>
        <button className="ov-icon" title="Expand" onClick={() => collapse(false)}>
          ▢
        </button>
        {toast && <span className={`ov-bar-toast ${toast.ok ? 'ok' : 'bad'}`}>{toast.ok ? '✓' : '!'}</span>}
      </div>
    );
  }
  return (
    <div className="ov">
      <header className="ov-head">
        <div>
          <strong>TLI Planner</strong>
          <span className={`ov-dot ${connected && status?.fileExists ? 'on' : ''}`} title={connected ? 'Reading the game log' : 'Planner server not reachable'} />
          <span className="ov-mode">
            <button className={mode === 'build' ? 'on' : ''} onClick={() => chooseMode('build')} title="DPS and the screenshots the planner still needs">
              Build
            </button>
            <button className={mode === 'farm' ? 'on' : ''} onClick={() => chooseMode('farm')} title="Drops, map runs and FE/hour">
              Farm
            </button>
          </span>
        </div>
        <div className="ov-actions">
          {app && (
            <button className="ov-icon" title="Open the full planner" onClick={() => app.openPlanner()}>
              ⤢
            </button>
          )}
          <button className="ov-icon" title={`Mini farming box: FE/min, profit and drops in a small click-through box${hotkeys?.mini ? ` (${hotkeys.mini.replace('CommandOrControl', 'Ctrl')})` : ''}`} onClick={() => setLayout('mini')}>
            ▣
          </button>
          {app && (
            <button className="ov-icon" title="Minimize to a small bar" onClick={() => collapse(true)}>
              —
            </button>
          )}
          {app && (
            <button className="ov-icon" title={returnTo ? 'Back to the compact economy box' : `Hide to the tray (${hotkeys?.overlay?.replace('CommandOrControl', 'Ctrl') ?? ''} shows it again)`} onClick={close}>
              ✕
            </button>
          )}
        </div>
      </header>

      {mode === 'farm' ? (
        <>
          <button
            className="primary ov-compact"
            onClick={() => {
              setReturnTo(null);
              setLayout('mini');
            }}
            title={`A small ETor-style box with just the figures${hotkeys?.mini ? ` (${hotkeys.mini.replace('CommandOrControl', 'Ctrl')})` : ''}`}>
            Compact economy view
          </button>
          <FarmPanel farm={farm} compact />
        </>
      ) : (
        <>
      {character ? (
        <div className="ov-char">
          <div>
            {character.player.name} <span className="muted">Lv {character.player.level}</span>
          </div>
          <div className="muted small">{character.calc?.mainSkill ?? 'no main skill'}</div>
          {sim?.supported && (
            <div className="ov-dps">
              <span>
                <b>{fmtCompact(sim.avgDps)}</b> avg
              </span>
              <span>
                <b>{fmtCompact(sim.peak5s)}</b> best 5 s
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="muted small">Waiting for a character in the game log…</p>
      )}

      {next ? (
        <section className="ov-next">
          <div className="ov-label">Next screenshot</div>
          <strong>{next.what}</strong>
          <p>{next.how}</p>
          <button className="primary" disabled={busy} onClick={() => capture(next.label)}>
            {busy ? 'Capturing…' : `Capture “${next.label}”`}
            {hotkeys && <span className="ov-key">{hotkeys.capture.replace('CommandOrControl', 'Ctrl')}</span>}
          </button>
        </section>
      ) : (
        character && !waiting.length && <p className="ov-done">Nothing missing: the planner has everything it can read.</p>
      )}

      {toTake.length > 1 && (
        <section>
          <div className="ov-label">Also missing</div>
          <ul className="ov-needs">
            {toTake.slice(1).map((n) => (
              <li key={n.key}>
                <div>
                  <div>{n.what}</div>
                  <div className="muted small">{n.how}</div>
                </div>
                <button disabled={busy} onClick={() => capture(n.label)}>
                  Capture
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section>
          <div className="ov-label">Captured, waiting to be read</div>
          <ul className="ov-needs">
            {waiting.map((n) => (
              <li key={n.key}>
                <div>
                  <div>{n.what}</div>
                  <div className="muted small">Screenshot taken {fmtTime(shotFor(n, captures).takenAt)}. Ask Claude to read your new screenshots and it goes into the build.</div>
                </div>
                <button disabled={busy} onClick={() => capture(n.label)} title="Take it again (e.g. the tooltip was cut off)">
                  Again
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="ov-row">
        <button disabled={busy} onClick={() => capture('Game screen')}>
          Capture screen
        </button>
        <span className="muted small">Taken for you: each talent tree as you switch to it, the follower page and each skill you open.</span>
      </div>

      {captures.length > 0 && (
        <section>
          <div className="ov-label">Recent screenshots ({captures.length})</div>
          <ul className="ov-shots">
            {captures.slice(0, 5).map((c) => (
              <li key={c.file}>
                <span>{c.label}</span>
                <span className="muted small">
                  {c.reason === 'auto' ? 'auto' : 'you'} · {fmtTime(c.takenAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

        </>
      )}

      {toast && <div className={`ov-toast ${toast.ok ? 'ok' : 'bad'}`}>{toast.text}</div>}
    </div>
  );
}
