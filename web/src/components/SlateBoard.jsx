import { useRef, useState } from 'react';
import Panel from './Panel.jsx';
import Icon from './Icon.jsx';
import { fmtCompact, nameOr, rarityLabel } from '../format.js';

// The Divinity slate board (Talent → Statue of The New God) as the game lays it out: the 24-cell
// diamond, each slate across its cells (its spot from the log, its shape and turn from
// data/gamedata/slateShapes.local.json), drawn with its art. Slates can be dragged to another spot
// and turned (a what-if kept as choices.slateLayout: the planner recomputes what each slate copies
// off the slates it touches, and the DPS; nothing changes in game). Under the board, each slate's
// lines in the game's slot colours with their Effect bonus, the lines copied off neighbours, a
// what-if switch per slate and "What each slate adds".
const ROWS = 6;
const COLS = 6;
const BOARD_COLS = [[3, 4], [2, 5], [1, 6], [1, 6], [2, 5], [3, 4]];
const onBoard = (row, col) => row >= 1 && row <= ROWS && col >= BOARD_COLS[row - 1][0] && col <= BOARD_COLS[row - 1][1];
const spotOf = (row, col) => col * 10 + row; // the log's Index: column then row
const cellsOf = (s) => (s.cells?.length ? s.cells : [[0, 0]]);
const keyOf = (r, c) => `${r},${c}`;

const put = (url, body) =>
  fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// A line's colour when the log gave no slot colour: by its type, as the game's slots run
const typeColor = (name = '') => (/Legendary Medium/i.test(name) ? 'Orange' : /Nether King/i.test(name) ? 'Red' : /^Medium/i.test(name) ? 'Purple' : /Micro/i.test(name) ? 'Blue' : 'Plain');
// Each slate's fill under its art, close to the game's
const FILLS = [
  [/Nether King/i, '#1f2c66'],
  [/Sparks/i, '#d98fb0'],
  [/God of War/i, '#8e1a2b'],
  [/Corner of Divinity/i, '#c9961a'],
  [/Fallen Starlight/i, '#d9821a'],
  [/Pedigree/i, '#b9923a'],
  [/Goddess of Knowledge/i, '#2b63c4'],
  [/Goddess of Hunting/i, '#2f8f52'],
  [/God of Might/i, '#a63d26'],
  [/Goddess of Deception/i, '#6f37ad'],
  [/God of Machines/i, '#6f7784'],
];
const fillOf = (name, i) => FILLS.find(([re]) => re.test(name ?? ''))?.[1] ?? `hsl(${(i * 53 + 20) % 360} 55% 40%)`;

function Line({ t }) {
  const color = t.color ?? typeColor(t.name);
  return (
    <li className={`sb-line sl-${color}`} title={[t.name, t.tree].filter(Boolean).join(' · ') || `#${t.id}`}>
      {t.icon && <Icon src={t.icon} name={t.name} width={20} />}
      <span>{t.text ?? nameOr(t.name, t.id)}</span>
      {t.effectPct > 0 && <span className="sb-effect">+{t.effectPct}% effect</span>}
    </li>
  );
}

export default function SlateBoard({ slates: logged = [], calc }) {
  const slates = calc?.used?.slates ?? logged;
  const layout = calc?.choices?.slateLayout ?? {};
  const moved = Object.keys(layout).length > 0;
  const disabled = calc?.choices?.disabledSlates ?? [];
  const off = new Set(disabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [shares, setShares] = useState(null);
  const [picked, setPicked] = useState(null);
  const [drag, setDrag] = useState(null); // { id, dr, dc }: the slate in hand and the cell of it grabbed
  const [target, setTarget] = useState(null); // the board cell under the pointer while dragging
  const boardRef = useRef(null);
  const pointer = useRef(null);
  if (!slates.length) return null;

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const putLayout = (body) =>
    act(async () => {
      const res = await put('/api/slates/layout', body);
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Not possible');
      else setShares(null);
    });
  const toggle = (id, turnOn) =>
    act(async () => {
      await put('/api/choices', { disabledSlates: turnOn ? disabled.filter((k) => k !== id) : [...disabled, id] });
      setShares(null);
    });
  const compute = () =>
    act(async () => {
      const res = await fetch('/api/slates/contributions', { method: 'POST' });
      const body = await res.json();
      if (res.ok) setShares(new Map(body.rows.map((r) => [r.key, r])));
    });
  const turn = (s, delta) => putLayout({ id: s.id, direction: ((((s.direction ?? 0) + delta) % 4) + 4) % 4 });
  const move = (s, row, col) => putLayout({ id: s.id, position: spotOf(row, col) });

  // Where every slate's cells are, for the drop preview
  const occupied = new Map();
  for (const s of slates) for (const [dr, dc] of cellsOf(s)) occupied.set(keyOf((s.row ?? 1) + dr, (s.col ?? 1) + dc), s.id);
  const dragged = drag ? slates.find((s) => s.id === drag.id) : null;
  const preview = dragged && target ? cellsOf(dragged).map(([dr, dc]) => [target.row - drag.dr + dr, target.col - drag.dc + dc]) : [];
  const previewOk = preview.length > 0 && preview.every(([r, c]) => onBoard(r, c) && (occupied.get(keyOf(r, c)) ?? dragged.id) === dragged.id);

  const cellAt = (e) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * COLS) + 1;
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS) + 1;
    return row >= 1 && row <= ROWS && col >= 1 && col <= COLS ? { row, col } : null;
  };
  const onDown = (s, dr, dc) => (e) => {
    if (e.button !== 0) return;
    pointer.current = { x: e.clientX, y: e.clientY, moved: false };
    setDrag({ id: s.id, dr, dc });
    setTarget(null);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag) return;
    if (pointer.current && Math.hypot(e.clientX - pointer.current.x, e.clientY - pointer.current.y) > 6) pointer.current.moved = true;
    setTarget(cellAt(e));
  };
  const onUp = () => {
    if (!drag) return;
    const s = dragged;
    const wasDrag = pointer.current?.moved;
    setDrag(null);
    setTarget(null);
    if (!wasDrag) setPicked(picked === s.id ? null : s.id);
    else if (previewOk) {
      const [row, col] = [target.row - drag.dr, target.col - drag.dc];
      if (row !== s.row || col !== s.col) move(s, row, col);
    } else if (preview.length) setError("That spot doesn't fit: off the board or on another slate");
  };
  const onKey = (e) => {
    const s = slates.find((x) => x.id === picked);
    if (!s) return;
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (step) {
      e.preventDefault();
      move(s, s.row + step[0], s.col + step[1]);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      turn(s, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') setPicked(null);
  };

  const ordered = [...slates].sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0));
  const shapeless = slates.filter((s) => s.shapeId != null && !s.cells).length;
  const now = calc?.sim?.supported ? calc.sim.avgDps : calc?.dps?.combat?.total;
  const allOn = calc?.whatIf?.allOn;
  const base = allOn ? (allOn.avgDps ?? allOn.combat) : null;
  const all = shares?.get('all');
  const shareText = (r) => (r.off ? 'off' : r.share == null ? '' : `${r.share >= 0 ? '−' : '+'}${Math.abs(r.share * 100).toFixed(Math.abs(r.share * 100) < 10 ? 1 : 0)}% without`);

  return (
    <Panel
      title="Divinity slates"
      className="slate-board"
      right={
        calc?.engine?.ok ? (
          <button className="link" onClick={compute} disabled={busy}>
            {busy ? 'Working…' : shares ? 'Recompute what each slate adds' : 'What each slate adds'}
          </button>
        ) : (
          `${slates.length} placed`
        )
      }
    >
      <p className="muted small">
        {slates.length} slates, {slates.reduce((n, s) => n + s.talents.length, 0)} lines. Drag a slate to another spot, click it and press R to turn it (Shift+R the
        other way) or use the arrow keys; untick one to leave it off. All of it is a what-if: nothing changes in game.
        {(off.size > 0 || moved) && base > 0 && now != null && (
          <>
            {' '}
            <b className="note-warn">
              {moved ? 'Board changed' : `${off.size} off`}
              {moved && off.size > 0 ? `, ${off.size} off` : ''}: {fmtCompact(now)} average, {fmtCompact(base)} as in game ({now < base ? '−' : '+'}
              {Math.abs((1 - now / base) * 100).toFixed(1)}%).
            </b>
          </>
        )}
        {all && !all.off && (
          <>
            {' '}
            <b>All slates together: {shareText(all)}</b> ({fmtCompact(all.without)} average with none).
          </>
        )}
      </p>
      <div className="sb-actions">
        {moved && (
          <button onClick={() => putLayout({ reset: true })} disabled={busy}>
            Put the board back as in game
          </button>
        )}
        {picked && slates.some((s) => s.id === picked) && (
          <>
            <button onClick={() => turn(slates.find((s) => s.id === picked), 1)} disabled={busy} title="Turn clockwise (R)">
              ↻ Turn
            </button>
            <button onClick={() => turn(slates.find((s) => s.id === picked), -1)} disabled={busy} title="Turn the other way (Shift+R)">
              ↺ Turn
            </button>
          </>
        )}
        {error && <span className="note-warn small">{error}</span>}
      </div>
      <div
        ref={boardRef}
        className={`sb-board ${busy ? 'busy' : ''} ${drag ? 'dragging' : ''}`}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          setDrag(null);
          setTarget(null);
        }}
      >
        {Array.from({ length: ROWS * COLS }, (_, i) => {
          const row = Math.floor(i / COLS) + 1;
          const col = (i % COLS) + 1;
          const inPreview = preview.some(([r, c]) => r === row && c === col);
          return (
            <div
              key={`c${i}`}
              className={`sb-cell ${onBoard(row, col) ? '' : 'outside'} ${inPreview ? (previewOk ? 'ok' : 'bad') : ''}`}
              style={{ gridRow: row, gridColumn: col }}
            />
          );
        })}
        {ordered.map((s, i) => {
          const cells = cellsOf(s);
          const has = (dr, dc) => cells.some(([r, c]) => r === dr && c === dc);
          const rMin = Math.min(...cells.map(([r]) => r));
          const rMax = Math.max(...cells.map(([r]) => r));
          const cMin = Math.min(...cells.map(([, c]) => c));
          const cMax = Math.max(...cells.map(([, c]) => c));
          const spanR = rMax - rMin + 1;
          const spanC = cMax - cMin + 1;
          const tiles = cells.map(([dr, dc], k) => {
            // Borders only on the slate's outside edges; without a picture of it, its art stretched over its shape
            const edges = [has(dr - 1, dc) ? '' : 't', has(dr, dc + 1) ? '' : 'r', has(dr + 1, dc) ? '' : 'b', has(dr, dc - 1) ? '' : 'l'];
            const art =
              !s.sprite && s.icon
                ? {
                    backgroundImage: `url(${s.icon})`,
                    backgroundSize: `${spanC * 100}% ${spanR * 100}%`,
                    backgroundPosition: `${spanC > 1 ? ((dc - cMin) / (spanC - 1)) * 100 : 0}% ${spanR > 1 ? ((dr - rMin) / (spanR - 1)) * 100 : 0}%`,
                  }
                : {};
            return (
              <div
                key={`${s.id}-${k}`}
                className={`sb-tile ${s.sprite ? 'art' : ''} ${off.has(s.id) ? 'off' : ''} ${picked === s.id ? 'picked' : ''} ${drag?.id === s.id ? 'in-hand' : ''} ${s.moved ? 'moved' : ''} ${edges
                  .filter(Boolean)
                  .map((e) => `e-${e}`)
                  .join(' ')}`}
                style={{ gridRow: (s.row ?? 1) + dr, gridColumn: (s.col ?? 1) + dc, '--tile': fillOf(s.name, i), ...art }}
                title={`${s.name ?? 'Slate'} · spot ${s.position}${s.direction ? ` · turned ${s.direction}` : ''}${s.cells ? '' : ' · shape not read yet'}`}
                onPointerDown={onDown(s, dr, dc)}
              >
                {k === 0 && !s.sprite && <small>{(s.name ?? 'Slate').replace(/'s Divinity$/, '')}</small>}
              </div>
            );
          });
          // The slate as the game draws it: its picture, cut out of a screenshot, over its cells
          const sprite = s.sprite ? (
            <img
              key={`${s.id}-art`}
              className={`sb-sprite ${off.has(s.id) ? 'off' : ''} ${drag?.id === s.id ? 'in-hand' : ''}`}
              src={s.sprite}
              alt=""
              draggable={false}
              style={{ gridRow: `${(s.row ?? 1) + rMin} / ${(s.row ?? 1) + rMax + 1}`, gridColumn: `${(s.col ?? 1) + cMin} / ${(s.col ?? 1) + cMax + 1}` }}
            />
          ) : null;
          return [sprite, ...tiles];
        })}
      </div>
      {shapeless > 0 && (
        <p className="muted small">
          {shapeless} slate{shapeless > 1 ? 's have shapes' : ' has a shape'} the planner hasn't seen yet, drawn on {shapeless > 1 ? 'their spots' : 'its spot'} alone:
          open Talent → Statue of The New God once so the board is screenshotted.
        </p>
      )}
      <div className={`sb-list ${busy ? 'busy' : ''}`}>
        {ordered.map((s) => {
          const share = shares?.get(s.id);
          return (
            <div key={s.id} className={`sb-slate ${off.has(s.id) ? 'off' : ''} ${picked === s.id ? 'picked' : ''}`} onClick={() => setPicked(s.id)}>
              <div className="sb-slate-head">
                <input
                  type="checkbox"
                  className="skill-switch"
                  checked={!off.has(s.id)}
                  title={off.has(s.id) ? 'Taken off in the what-if: tick to count it again' : 'What-if: untick to see the DPS without this slate'}
                  onChange={() => toggle(s.id, off.has(s.id))}
                  onClick={(e) => e.stopPropagation()}
                />
                {s.icon && <Icon src={s.icon} name={s.name} width={22} height={31} />}
                <strong>{nameOr(s.name, s.baseId)}</strong>
                <span className="muted">
                  spot {s.position}
                  {s.moved ? ' (moved)' : ''}
                  {s.level != null ? ` · Lv ${s.level}` : ''}
                  {rarityLabel(s.rarity) ? ` · ${rarityLabel(s.rarity)}` : ''}
                  {s.enhanced ? ` · enhanced ×${s.enhanced}` : ''}
                </span>
                {share && (
                  <span className={`sb-share ${share.off ? 'muted' : ''}`} title={share.off ? 'Taken off' : `Without ${s.name}: ${fmtCompact(share.without)} average`}>
                    {shareText(share)}
                  </span>
                )}
              </div>
              <ul className="sb-lines">
                {s.talents.map((t, i) => (
                  <Line key={`${t.id}-${i}`} t={t} />
                ))}
              </ul>
              {s.copies?.length > 0 && (
                <ul className="sb-lines sb-copied">
                  {s.copies.map((t, i) => (
                    <li key={`${t.id}-${i}`} className={`sb-line sl-${t.color ?? typeColor(t.name)}`} title={`Copied off ${t.copiedFrom}`}>
                      {t.icon && <Icon src={t.icon} name={t.name} width={20} />}
                      <span>{t.text ?? nameOr(t.name, t.id)}</span>
                      <span className="sb-effect">copied off {t.copiedFrom}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
