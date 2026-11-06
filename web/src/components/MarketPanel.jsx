import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import { fmtFe } from './FarmPanel.jsx';
import { ago } from '../format.js';

// The public market (server/cloud): what other planner users saw gear go for, by roll; sharing
// your own sightings (Exchange price checks from the log, prices you type here) is opt-in; a build
// is shared only by the button. The FE in your bag (from the farm tracker) is shown so the upgrade
// ranking can be read against it.
async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The server said ${res.status}`);
  return data;
}

function ItemPrice({ item, share, onObserved }) {
  const [price, setPrice] = useState(undefined);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(null);
  useEffect(() => {
    let live = true;
    call('POST', '/api/cloud/price', { itemId: item.id })
      .then((r) => live && setPrice(r.price))
      .catch(() => live && setPrice(null));
    return () => {
      live = false;
    };
  }, [item.id]);
  const commit = async () => {
    const fe = Number(text);
    if (!(fe > 0)) return;
    try {
      const r = await call('POST', '/api/cloud/observe', { itemId: item.id, fe });
      setSent(r.share ? 'shared' : 'kept (sharing is off)');
      setText('');
      onObserved?.();
    } catch (err) {
      setSent(err.message);
    }
  };
  return (
    <li className="market-row">
      <span className="market-name">{item.uniqueName ?? item.name ?? `#${item.baseId}`}</span>
      <span className="market-price">
        {price === undefined ? <span className="muted">…</span> : price ? <span title={`${price.source}; typical ${fmtFe(price.median)} FE, last seen ${ago(price.lastSeen, Date.now())}`}>{fmtFe(price.fe)} FE{price.exact ? ' (this roll)' : ''}</span> : <span className="muted">no sightings</span>}
      </span>
      <span className="market-observe">
        <input className="num" type="number" min="0" placeholder="saw it for… FE" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} title={share ? 'A price you saw this item (this roll) listed for; sent to the market' : 'A price you saw this item listed for; turn sharing on to send it'} />
        {sent && <span className="muted small"> {sent}</span>}
      </span>
    </li>
  );
}

export default function MarketPanel({ cloud, farm, equipment }) {
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(null);
  const [error, setError] = useState(null);
  if (!cloud) return null;
  const items = (equipment ?? []).map((e) => e.item).filter((it) => it?.detailsKnown);
  const toggle = async (on) => {
    setBusy(true);
    try {
      await call('PUT', '/api/cloud/share', { share: on });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const shareBuild = async () => {
    setBusy(true);
    setError(null);
    try {
      setShared(await call('POST', '/api/cloud/builds/share'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const right = cloud.enabled ? (cloud.fetchedAt ? `${cloud.families} items priced · ${ago(cloud.fetchedAt, Date.now())}` : 'no prices downloaded yet') : 'not configured';
  return (
    <Panel title="Market" right={right}>
      {!cloud.enabled && <p className="muted small">No market URL is set (TLI_CLOUD_URL in .env, see cloud/README.md). Prices other players saw, and sharing yours, need one.</p>}
      <div className="market-head">
        <label className="small" title="When on, Exchange price checks the log shows and prices you type here go to the public market under a random id; never your name, character or inventory">
          <input type="checkbox" checked={!!cloud.share} disabled={busy || !cloud.enabled} onChange={(e) => toggle(e.target.checked)} /> Share what I see (anonymous)
        </label>
        <span className="muted small">
          {farm?.wallet != null ? (
            <>
              {fmtFe(farm.wallet)} FE in your bag ·{' '}
              <button className="link" onClick={() => call('PUT', '/api/sample/maxfe', { maxFe: farm.wallet }).catch(() => {})} title="Rank the sample build's upgrades against what you have: sets its price cap per item to your FE">
                rank upgrades I can afford
              </button>
            </>
          ) : (
            'open your bag once for your FE'
          )}
          {cloud.queued ? ` · ${cloud.queued} sightings queued` : ''}
          {cloud.sent ? ` · ${cloud.sent} sent` : ''}
        </span>
      </div>
      {cloud.error && <p className="note-warn small">{cloud.error}</p>}
      {error && <p className="note-warn small">{error}</p>}
      {items.length > 0 && (
        <ul className="market-list">
          {items.map((it) => (
            <ItemPrice key={it.id} item={it} share={cloud.share} />
          ))}
        </ul>
      )}
      <div className="market-actions">
        <button onClick={shareBuild} disabled={busy || !cloud.enabled} title="Send this build (gear by roll signature, hero, main skill, simulated DPS; no name or id) to the public build list">
          Share this build
        </button>
        <button className="link" onClick={() => call('POST', '/api/cloud/refresh').catch(() => {})} disabled={busy || !cloud.enabled}>
          refresh prices
        </button>
        {shared && (
          <span className="small">
            Shared as <code>{shared.id}</code>
          </span>
        )}
      </div>
    </Panel>
  );
}
