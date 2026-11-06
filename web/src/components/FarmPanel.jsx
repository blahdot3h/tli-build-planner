import { useState } from 'react';
import Icon from './Icon.jsx';
import { useNow } from '../useLiveData.js';

// Farming, the way YiHuo ETor's overlay shows it: status, FE per minute in the current map, its
// profit / loot / cost, FE per hour and earnings for the session, in-map time, then the notable drops.
// compact: the in-game overlay (fewer rows, no settings); full: the Farming tab with run history,
// prices and settings. farm = the server's view (/api/farm, SSE 'farm').

export const FE = '🔥';
export const fmtClock = (ms) => {
  const s = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};
const fmtAt = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
// FE amounts: whole numbers past 1000, one decimal past 10, two below
export function fmtFe(n, { sign = false } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const body = abs >= 100_000 ? compact.format(abs) : abs >= 1000 ? Math.round(abs).toLocaleString() : abs >= 10 ? abs.toFixed(1) : abs >= 1 ? abs.toFixed(2) : abs === 0 ? '0' : abs.toFixed(abs < 0.01 ? 4 : 3);
  return `${n < 0 ? '-' : sign && n > 0 ? '+' : ''}${body}`;
}
const tone = (n) => (n == null ? '' : n > 0 ? 'good' : n < 0 ? 'bad' : '');

// One figure for the overlay's minimized bar: this map's FE/min, else the session's FE/hour
export function farmBarText(farm, now) {
  const live = liveFarm(farm, now);
  if (!live) return null;
  if (live.current) return `${fmtFe(live.current.fePerMin, { sign: true })} ${FE}/min`;
  if (live.session.activeMs > 0) return `${fmtFe(live.session.fePerHour, { sign: true })} ${FE}/h`;
  return null;
}

export const STATUS_TEXT = {
  'in-map': 'In map',
  paused: 'Map paused (in town)',
  town: 'In town / hideout',
  waiting: 'Waiting for a map',
  'no-player': 'Waiting for the game log',
};

// Live timers: the server says how long the run had been active at serverTime; while it's running
// the clock keeps going here
export function liveFarm(farm, now) {
  if (!farm) return null;
  const extra = farm.current?.running ? Math.max(0, now - farm.serverTime) : 0;
  const current = farm.current ? { ...farm.current, activeMs: farm.current.activeMs + extra } : null;
  if (current) current.fePerMin = current.activeMs > 0 ? current.profit / (current.activeMs / 60_000) : null;
  const activeMs = farm.session.activeMs + extra;
  const session = { ...farm.session, activeMs, fePerHour: activeMs > 0 ? farm.session.profit / (activeMs / 3_600_000) : null };
  return { ...farm, current, session };
}

export async function farmCall(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}
const call = farmCall;

// Gear the log only knows by its base (an unidentified legendary looks like any rare of that base):
// "was it <the one legendary on this base that sells>?" Yes marks it; no moves on to the next one
// worth asking about, or makes it a rare. d: a drop with { stackId, name, ask: { id, name, price } }
export function UnknownDrop({ d, onAnswer, mapName }) {
  const ask = d.ask;
  const where = mapName ?? d.mapName;
  return (
    <li className="farm-drop unknown" title={`Dropped unidentified${where ? ` in ${where}` : ''}: the log only knows the base.${ask ? ` If it was ${ask.name} it is worth ${fmtFe(ask.price)} FE.` : ''}`}>
      <span className="icon icon-none farm-unknown-icon" aria-hidden="true">
        ?
      </span>
      <span className="farm-drop-name">{d.name.replace(/^\? /, '')}</span>
      {ask && onAnswer && (
        <span className="farm-ask">
          <span className="farm-ask-q">
            {ask.name} ({fmtFe(ask.price)} {FE})?
          </span>
          <button onClick={() => onAnswer(d.stackId, ask.id, true)}>Yes</button>
          <button onClick={() => onAnswer(d.stackId, ask.id, false)}>No</button>
        </span>
      )}
    </li>
  );
}

function Row({ label, children, title }) {
  return (
    <div className="farm-row" title={title}>
      <span className="farm-label">{label}</span>
      <span className="farm-value">{children}</span>
    </div>
  );
}

function Drop({ d, onPrice, showSource, onAnswer }) {
  if (d.unknown) return <UnknownDrop d={d} onAnswer={onAnswer} />;
  const src = d.price?.source;
  const title = [`${d.name} ×${d.qty.toLocaleString()}`, src === 'none' ? 'No price known' : `${fmtFe(d.unit)} FE each (${src === 'market' ? 'ETor market' : src === 'search' ? 'your Exchange search' : src === 'manual' ? 'your price' : src})`, d.estimated ? 'quantity estimated' : null]
    .filter(Boolean)
    .join('\n');
  return (
    <li className={`farm-drop ${d.isFe ? 'fe' : ''} ${d.category === 'legendary' ? 'legendary' : ''}`} title={title}>
      <Icon src={d.icon} name={d.name} width={22} />
      <span className="farm-drop-name">
        {d.name}
        {d.qty !== 1 && <span className="muted"> ×{d.qty.toLocaleString()}</span>}
      </span>
      {showSource && src === 'none' && <span className="farm-noprice">no price</span>}
      <button className={`farm-drop-value ${onPrice ? 'editable' : ''}`} onClick={onPrice ? () => onPrice(d) : undefined} disabled={!onPrice} title={onPrice ? 'Set your own price for this item' : undefined}>
        {fmtFe(d.value)} {FE}
      </button>
    </li>
  );
}

export default function FarmPanel({ farm: pushed, compact = false }) {
  const now = useNow();
  const farm = liveFarm(pushed, now);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
  const setPrice = (d) =>
    act(async () => {
      const text = window.prompt(`Your price for ${d.name}, in Flame Elementium each (empty forgets it):`, d.price?.source === 'manual' ? String(d.unit) : '');
      if (text === null) return;
      const fe = text.trim() === '' ? null : Number(text.replace(',', '.'));
      if (fe !== null && !(Number.isFinite(fe) && fe >= 0)) throw new Error('Not a price');
      await call('PUT', '/api/farm/settings', { manual: { [d.baseId]: fe } });
    });

  const answer = (stackId, uniqueId, yes) => act(() => call('PUT', '/api/farm/identify', { stackId, uniqueId, yes }));

  if (!farm) return <p className="muted small">Waiting for the farming tracker…</p>;
  const { current, session, prices } = farm;
  const unknown = farm.unknown ?? [];
  const notable = session.notable.slice(0, compact && !showAll ? 6 : 15);
  const hint = !farm.trusted && farm.status !== 'no-player' ? 'Open your bag once so the tracker learns your stacks; until then only new stacks count.' : null;

  return (
    <div className={`farm ${compact ? 'farm-compact' : ''}`}>
      <div className="farm-rows">
        <Row label="Status">
          <span className={farm.status === 'in-map' ? 'good' : 'muted'}>
            {STATUS_TEXT[farm.status]}
            {current && ` · ${current.mapName}`}
          </span>
        </Row>
        <Row label="Current efficiency" title="Profit of this map per minute in it">
          <b className={tone(current?.fePerMin)}>{current ? `${fmtFe(current.fePerMin, { sign: true })} ${FE}/min` : '—'}</b>
        </Row>
        <Row label="Current profit / loot / cost" title="This map: what dropped (after the Exchange's cut) minus what opening it cost">
          {current ? (
            <>
              <b className={tone(current.profit)}>{fmtFe(current.profit, { sign: true })}</b>
              <span className="muted"> / </span>
              <span className="good">{fmtFe(current.lootValue)}</span>
              <span className="muted"> / </span>
              <span className="bad">{fmtFe(current.costValue)}</span>
            </>
          ) : (
            '—'
          )}
        </Row>
        <Row label="Total efficiency" title="Session profit per hour spent in maps">
          <b className={tone(session.fePerHour)}>{session.activeMs > 0 ? `${fmtFe(session.fePerHour, { sign: true })} ${FE}/hour` : '—'}</b>
        </Row>
        <Row label="Total earnings" title={`${session.runs} map${session.runs === 1 ? '' : 's'} since ${fmtAt(session.start)}: loot ${fmtFe(session.lootValue)} - cost ${fmtFe(session.costValue)}`}>
          <b className={tone(session.profit)}>
            {fmtFe(session.profit, { sign: true })} {FE}
          </b>
          <span className="muted small"> · {session.runs} map{session.runs === 1 ? '' : 's'}</span>
        </Row>
        <Row label="In-map duration" title="Time in this map (town visits don't count)">
          <span className="farm-clock">{current ? fmtClock(current.activeMs) : fmtClock(0)}</span>
          <span className="muted small"> · session {fmtClock(session.activeMs)}</span>
        </Row>
      </div>

      {hint && <p className="farm-hint">{hint}</p>}
      {prices.error && !prices.rows && <p className="farm-hint bad">ETor prices unavailable: {prices.error}</p>}

      {unknown.length > 0 && (
        <section className="farm-unknowns">
          <div className="ov-label">Unidentified drops · was it the one that sells?</div>
          <ul className="farm-drops">
            {unknown.map((u) => (
              <UnknownDrop key={u.stackId} d={u} onAnswer={answer} />
            ))}
          </ul>
        </section>
      )}

      {notable.length > 0 && (
        <section>
          <div className="ov-label">Notable drops this session</div>
          <ul className="farm-drops">
            {notable.map((d) => (
              <Drop key={d.unknown ? d.stackId : d.baseId} d={d} onPrice={compact ? null : setPrice} showSource={!compact} onAnswer={answer} />
            ))}
          </ul>
          {compact && session.notable.length > 6 && (
            <button className="farm-more" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Fewer' : `All ${session.notable.length}`}
            </button>
          )}
        </section>
      )}

      {current && current.loot.length > 0 && !compact && (
        <section>
          <div className="ov-label">This map's drops</div>
          <ul className="farm-drops">
            {current.loot.map((d) => (
              <Drop key={d.unknown ? d.stackId : d.baseId} d={d} onPrice={setPrice} showSource onAnswer={answer} />
            ))}
          </ul>
        </section>
      )}
      {current && current.cost.length > 0 && !compact && (
        <section>
          <div className="ov-label">This map's cost</div>
          <ul className="farm-drops">
            {current.cost.map((d) => (
              <Drop key={d.baseId} d={d} onPrice={setPrice} showSource />
            ))}
          </ul>
        </section>
      )}

      {!compact && (
        <section>
          <div className="ov-label">Maps</div>
          {farm.runs.length ? (
            <table className="farm-runs">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Map</th>
                  <th>Time</th>
                  <th>Loot</th>
                  <th>Cost</th>
                  <th>Profit</th>
                  <th>{FE}/min</th>
                  <th>Best drop</th>
                </tr>
              </thead>
              <tbody>
                {farm.runs.map((r) => (
                  <tr key={`${r.areaId}:${r.start}`} className={r.inSession ? '' : 'muted'}>
                    <td>{fmtAt(r.start)}</td>
                    <td>{r.mapName}</td>
                    <td>{fmtClock(r.activeMs)}</td>
                    <td className="good">{fmtFe(r.lootValue)}</td>
                    <td className="bad">{fmtFe(r.costValue)}</td>
                    <td className={tone(r.profit)}>{fmtFe(r.profit, { sign: true })}</td>
                    <td className={tone(r.fePerMin)}>{fmtFe(r.fePerMin, { sign: true })}</td>
                    <td>{r.topDrop ? `${r.topDrop.name}${r.topDrop.qty > 1 ? ` ×${r.topDrop.qty}` : ''} (${fmtFe(r.topDrop.value)})` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">No maps yet. Open a map in game and its drops show up here.</p>
          )}
        </section>
      )}

      <div className="farm-foot">
        <span className="muted small" title={prices.fetchedAt ? `Updated ${new Date(prices.fetchedAt).toLocaleString()}` : 'Not fetched yet'}>
          Prices: {prices.source}
          {prices.seasonId ? `, season ${prices.seasonId}` : ''}
          {prices.rows ? `, ${prices.rows.toLocaleString()} items` : ''}
          {prices.searches ? ` + ${prices.searches} of your Exchange searches` : ''}
          {prices.applyTax ? ' · 12.5% Exchange cut taken off loot' : ' · no Exchange cut'}
        </span>
        <span className="farm-actions">
          {!compact && (
            <label className="small" title="Take the Exchange's 12.5% sale cut off every drop's value (never off costs)">
              <input type="checkbox" checked={prices.applyTax} disabled={busy} onChange={(e) => act(() => call('PUT', '/api/farm/settings', { applyTax: e.target.checked }))} /> cut
            </label>
          )}
          {!compact && (
            <button disabled={busy} onClick={() => act(() => call('POST', '/api/farm/prices/refresh'))} title="Fetch ETor's prices again (they refresh every 15 minutes anyway)">
              Refresh prices
            </button>
          )}
          <button disabled={busy} onClick={() => act(() => call('POST', '/api/farm/session'))} title="Start the totals over from now">
            New session
          </button>
        </span>
      </div>
      {error && <p className="bad small">{error}</p>}
    </div>
  );
}
