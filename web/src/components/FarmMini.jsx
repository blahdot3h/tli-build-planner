import { useEffect, useRef, useState } from 'react';
import { FE, STATUS_TEXT, farmCall, fmtClock, fmtFe, liveFarm } from './FarmPanel.jsx';
import { useNow } from '../useLiveData.js';

// The farming overlay the way YiHuo ETor draws it: a small translucent box with six rows, labels on
// the left and the figures right-aligned in orange, icons top right (settings, the planner window,
// the pin) and a chevron that pops a second box open under it with this map's loot (the last map's,
// between maps), scrollable past LOOT_ROWS rows. The boxes fill their window, the text scales with
// the window's width, and the app grows the window when the loot box opens. Pinned, every click goes
// through to the game except on the icons, the settings, the chevron and the loot box.
//   farm: the server's view; app: window.overlayApp or null; clickThrough: the window's state;
//   hotkeys: { clickThrough, mini }; onLayout('full'), onClickThrough(on), onHide()
const LOOT_ROWS = 10;
const ASKS_SHOWN = 3; // unidentified drops asked about in the box at once (the rest wait in the planner)
// The box's look, from its ⚙: opacity of the whole box, how dark its background is, text size
const LOOK_DEFAULTS = { opacity: 1, background: 0.62, scale: 1 };
const LOOK_KEY = 'overlay-mini-look';
const loadLook = () => {
  try {
    return { ...LOOK_DEFAULTS, ...JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}') };
  } catch {
    return { ...LOOK_DEFAULTS };
  }
};
// The keys held down, spelt the way Electron names accelerators (CommandOrControl+Alt+P); null for a
// modifier on its own or a plain key: a hotkey needs a modifier, unless it is a function key. Goes by
// the physical key (e.code) so Shift+1 is "Shift+1", not "!".
const PLAIN_KEYS = new Set(['Space', 'Tab', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace', 'Enter']);
export function toAccelerator(e) {
  const code = e.code ?? '';
  let m;
  const key = (m = /^Key([A-Z])$/.exec(code))
    ? m[1]
    : (m = /^Digit(\d)$/.exec(code))
      ? m[1]
      : /^F\d{1,2}$/.test(code)
        ? code
        : (m = /^Arrow(Up|Down|Left|Right)$/.exec(code))
          ? m[1]
          : PLAIN_KEYS.has(code)
            ? code
            : null;
  if (!key) return null;
  const mods = [e.ctrlKey && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  if (!mods.length && !/^F\d/.test(key)) return null;
  return [...mods, key].join('+');
}

export default function FarmMini({ farm: pushed, app, clickThrough = false, hotkeys, onLayout, onClickThrough, onHide }) {
  const now = useNow();
  const farm = liveFarm(pushed, now);
  const [drops, setDrops] = useState(false);
  const [settings, setSettings] = useState(false);
  const [look, setLookState] = useState(loadLook);
  const setLook = (patch) => {
    const next = { ...look, ...patch };
    setLookState(next);
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify(next));
    } catch {
      // Not remembered, that's all
    }
  };
  // Rebinding the pin hotkey from the settings: null, 'listening' (the field has the keyboard), or
  // why the last attempt failed
  const [binding, setBinding] = useState(null);
  const listen = (on) => {
    setBinding(on ? 'listening' : null);
    app?.focusable(!!on);
  };
  const bindKey = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return listen(false);
    const acc = toAccelerator(e);
    if (!acc) return; // a modifier on its own, or a key that can't be a hotkey: keep listening
    const res = await app.setHotkey('clickThrough', acc);
    app.focusable(false);
    setBinding(res?.ok ? null : (res?.reason ?? 'not available'));
  };
  const wrap = useRef(null);
  const icons = useRef(null);
  const panel = useRef(null);
  const chevron = useRef(null);
  const lootBox = useRef(null);
  const asksBox = useRef(null);
  // "Was it <the legendary that sells>?" for gear dropped unidentified
  const asks = (pushed?.unknown ?? []).slice(0, ASKS_SHOWN);
  const [answering, setAnswering] = useState(null);
  const answer = async (stackId, uniqueId, yes) => {
    setAnswering(stackId);
    try {
      await farmCall('PUT', '/api/farm/identify', { stackId, uniqueId, yes });
    } catch {
      // The next push shows it still asking
    } finally {
      setAnswering(null);
    }
  };

  // Tell the app how tall the boxes are whenever that changes (the wrapper fills the window, so
  // it's the boxes inside that are measured)
  useEffect(() => {
    if (!app || !wrap.current) return undefined;
    const fit = () => {
      const boxes = [...wrap.current.children];
      if (!boxes.length) return;
      const top = boxes[0].getBoundingClientRect().top;
      const bottom = boxes[boxes.length - 1].getBoundingClientRect().bottom;
      app.fit(wrap.current.offsetWidth + 12, Math.ceil(bottom - top) + 12);
    };
    fit();
    const ro = new ResizeObserver(fit);
    for (const box of wrap.current.children) ro.observe(box);
    return () => ro.disconnect();
  }, [app, drops, settings]);

  // Pinned, the window ignores the mouse except over these: the app watches the cursor against
  // their rectangles (and the page says so too, where mouse moves get through)
  const grab = { onMouseEnter: () => clickThrough && app?.hover(true), onMouseLeave: () => app?.hover(false) };
  useEffect(() => {
    if (!app) return undefined;
    const report = () => {
      const zones = [icons.current, panel.current, chevron.current, lootBox.current, asksBox.current].filter(Boolean).map((el) => {
        const r = el.getBoundingClientRect();
        // A little margin so the pointer can't slip off between two icons
        return { x: r.left - 4, y: r.top - 4, width: r.width + 8, height: r.height + 8 };
      });
      app.grabZones(zones);
    };
    report();
    const ro = new ResizeObserver(report);
    for (const box of wrap.current?.children ?? []) ro.observe(box);
    window.addEventListener('resize', report);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [app, settings, drops, clickThrough, asks.length]);

  const key = (name) => (hotkeys?.[name] ? hotkeys[name].replace('CommandOrControl', 'Ctrl') : null);
  const current = farm?.current;
  const session = farm?.session;
  const status = !farm ? 'Connecting…' : `${STATUS_TEXT[farm.status]}${current ? ` · ${current.mapName}` : ''}`;
  // This map's drops, or the last map's once it's over
  const shown = current ?? farm?.lastRun ?? null;
  const loot = shown?.loot ?? [];
  const lootTitle = !shown ? 'No map yet' : current ? `This map's loot · ${fmtFe(shown.lootValue)} ${FE}` : `Last map: ${shown.mapName} · ${fmtClock(shown.activeMs)} · ${fmtFe(shown.profit, { sign: true })} ${FE}`;

  return (
    <div className={`ov-mini-wrap ${clickThrough ? 'locked' : ''}`} ref={wrap} style={{ opacity: look.opacity, '--mini-bg': look.background, '--mini-scale': look.scale }}>
      <div className="ov ov-mini">
        <header className="ov-mini-head">
          <strong>TLI Farm</strong>
          <span className="ov-mini-actions" ref={icons} {...grab}>
            <button className={`ov-mini-btn ${settings ? 'on' : ''}`} title="Settings: opacity, background, text size" onClick={() => setSettings(!settings)}>
              ⚙
            </button>
            {app && (
              <button className="ov-mini-btn" title="Open the planner window (Farming tab: runs, prices, your own prices)" onClick={() => app.openPlanner()}>
                ⛶
              </button>
            )}
            {app ? (
              <button className={`ov-mini-btn pin ${clickThrough ? 'on' : ''}`} title={clickThrough ? `Pinned: clicks go to the game. ${key('clickThrough') ?? 'The hotkey'} unpins.` : `Pin: let every click through to the game${key('clickThrough') ? ` (${key('clickThrough')})` : ''}`} onClick={() => onClickThrough?.(!clickThrough)}>
                📌
              </button>
            ) : (
              <button className="ov-mini-btn" title="Hide" onClick={() => onHide?.()}>
                ✕
              </button>
            )}
          </span>
        </header>
        {settings && (
          <div className="ov-mini-settings" ref={panel} {...grab}>
            <label>
              <span>Opacity</span>
              <input type="range" min="20" max="100" value={Math.round(look.opacity * 100)} onChange={(e) => setLook({ opacity: e.target.value / 100 })} />
              <span className="ov-mini-setting-value">{Math.round(look.opacity * 100)}%</span>
            </label>
            <label>
              <span>Background</span>
              <input type="range" min="0" max="100" value={Math.round(look.background * 100)} onChange={(e) => setLook({ background: e.target.value / 100 })} />
              <span className="ov-mini-setting-value">{Math.round(look.background * 100)}%</span>
            </label>
            <label>
              <span>Text size</span>
              <input type="range" min="60" max="220" value={Math.round(look.scale * 100)} onChange={(e) => setLook({ scale: e.target.value / 100 })} />
              <span className="ov-mini-setting-value">{Math.round(look.scale * 100)}%</span>
            </label>
            {app && (
              <div className="ov-mini-settings-row ov-mini-hotkey">
                <span>Pin key</span>
                {binding === 'listening' ? (
                  <input className="ov-mini-hotkey-input" autoFocus readOnly value="press the keys… (Esc cancels)" onKeyDown={bindKey} onBlur={() => listen(false)} />
                ) : (
                  <>
                    <b>{key('clickThrough') ?? 'none'}</b>
                    <button onClick={() => listen(true)} title="Press a new key combination for pinning and unpinning: Ctrl, Alt or Shift with a key, or a function key">
                      Change
                    </button>
                    {binding && <span className="ov-mini-hotkey-taken">{binding}</span>}
                  </>
                )}
              </div>
            )}
            <div className="ov-mini-settings-row">
              <button onClick={() => setLook(LOOK_DEFAULTS)}>Reset</button>
              <button onClick={() => onLayout?.('full')} title={`Prices, your own prices, the Exchange cut, new session${key('mini') ? ` (${key('mini')})` : ''}`}>
                Full overlay
              </button>
              {app && (
                <button onClick={() => app.openPlanner()} title="The planner window's Farming tab">
                  Planner
                </button>
              )}
            </div>
          </div>
        )}
        <div className="ov-mini-rows">
          <MiniRow label="Status">{status}</MiniRow>
          <MiniRow label="Current Efficiency">{current ? `${fmtFe(current.fePerMin, { sign: true })} ${FE}/min` : '—'}</MiniRow>
          <MiniRow label="Current Profit/Loot/Cost">
            {current ? (
              <>
                {fmtFe(current.profit, { sign: true })} {FE}
                <span className="ov-mini-sep">/</span>
                <span className="ov-mini-loot">{fmtFe(current.lootValue)}</span>
                <span className="ov-mini-sep">/</span>
                <span className="ov-mini-cost">-{fmtFe(current.costValue)}</span>
              </>
            ) : (
              '—'
            )}
          </MiniRow>
          <MiniRow label="Total Efficiency" className="key">
            {session?.activeMs > 0 ? `${fmtFe(session.fePerHour, { sign: true })} ${FE}/Hour` : '—'}
          </MiniRow>
          <MiniRow label="Total Earnings">{session ? `${fmtFe(session.profit, { sign: true })} ${FE}` : '—'}</MiniRow>
          <MiniRow label="In-Map Duration">{fmtClock(current?.activeMs ?? 0)}</MiniRow>
        </div>
        {asks.length > 0 && (
          <div className="ov-mini-asks" ref={asksBox} {...grab}>
            {asks.map((u) => (
              <div className="ov-mini-ask" key={u.stackId} title={`Dropped unidentified in ${u.mapName}: the log only knows the base. Worth ${fmtFe(u.ask.price)} FE if it is ${u.ask.name}.`}>
                <span className="ov-mini-ask-q">
                  <b>?</b> {u.name}: <b>{u.ask.name}</b> {fmtFe(u.ask.price)} {FE}?
                </span>
                <span className="ov-mini-ask-btns">
                  <button className="ov-mini-btn yes" disabled={answering === u.stackId} onClick={() => answer(u.stackId, u.ask.id, true)}>
                    Yes
                  </button>
                  <button className="ov-mini-btn" disabled={answering === u.stackId} onClick={() => answer(u.stackId, u.ask.id, false)}>
                    No
                  </button>
                </span>
              </div>
            ))}
            {(pushed?.unknown?.length ?? 0) > ASKS_SHOWN && <div className="ov-mini-more-drops">+{pushed.unknown.length - ASKS_SHOWN} more to mark</div>}
          </div>
        )}
        {/* The chevron stays where it is: the loot box pops open under this one */}
        <button className="ov-mini-more" ref={chevron} {...grab} onClick={() => setDrops(!drops)} title={drops ? 'Close the loot box' : current ? "This map's loot" : "The last map's loot"}>
          {drops ? '︿' : '﹀'}
        </button>
        {clickThrough && <div className="ov-mini-lock">pinned: clicks go to the game · the icons and the chevron still work{key('clickThrough') ? ` · ${key('clickThrough')} unpins` : ''}</div>}
      </div>

      {drops && (
        <div className="ov ov-mini ov-mini-lootbox" ref={lootBox} {...grab}>
          <div className="ov-mini-lootbox-head">
            <span className="ov-mini-drops-title">{lootTitle}</span>
            <button className="ov-mini-btn" title="Close" onClick={() => setDrops(false)}>
              ✕
            </button>
          </div>
          {loot.length ? (
            <ul className="ov-mini-lootlist" style={{ '--loot-rows': LOOT_ROWS }}>
              {loot.map((d) => (
                <li key={d.baseId}>
                  <span className={d.category === 'legendary' ? 'legendary' : d.isFe ? 'fe' : ''}>
                    {d.name}
                    {d.qty !== 1 && ` ×${d.qty.toLocaleString()}`}
                  </span>
                  <span className="ov-mini-value">
                    {fmtFe(d.value)} {FE}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ov-mini-more-drops">{shown ? 'Nothing picked up yet' : 'Open a map and its loot shows here'}</div>
          )}
          {loot.length > LOOT_ROWS && <div className="ov-mini-more-drops">{loot.length} items · scroll for the rest</div>}
        </div>
      )}
    </div>
  );
}

// className "key": the figure that matters most, set bigger and bolder
function MiniRow({ label, children, className = '' }) {
  return (
    <div className={`ov-mini-row ${className}`}>
      <span className="ov-mini-label">{label}:</span>
      <span className="ov-mini-value">{children}</span>
    </div>
  );
}
