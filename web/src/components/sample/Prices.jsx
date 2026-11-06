import { useState } from 'react';
import Panel from '../Panel.jsx';
import { fmtDateTime } from '../../format.js';

const fe = (p) => (p?.fe == null ? '' : `${p.fe < 1 ? p.fe.toFixed(2) : Math.round(p.fe * 10) / 10} FE`);

function PriceInput({ name, onSet }) {
  const [text, setText] = useState('');
  const commit = () => {
    if (text.trim() === '') return;
    onSet(name, Number(text));
    setText('');
  };
  return <input className="num" type="number" min="0" placeholder="FE" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

// Each piece of the build with its price: yours, an Exchange price check from the log, or TITrack.
// With a cap, what's over it (or has no price and isn't taken as cheap) is marked.
export default function Prices({ page, onSet, onMaxFe }) {
  const { buildPrices, knownPrices } = page;
  const [cap, setCap] = useState(buildPrices.maxFe ?? '');
  const [name, setName] = useState('');
  const over = buildPrices.rows.filter((r) => !r.ok);
  const checked = Object.entries(knownPrices.learned ?? {}).sort((a, b) => b[1].at - a[1].at);
  const yours = Object.entries(knownPrices.user ?? {});
  return (
    <Panel title="Prices" right={buildPrices.maxFe ? `cap ${buildPrices.maxFe} FE per item` : 'no cap'}>
      <div className="pick-row">
        <span>Max FE per item</span>
        <input className="num" type="number" min="0" placeholder="none" value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => onMaxFe(cap === '' ? null : Number(cap))} onKeyDown={(e) => e.key === 'Enter' && onMaxFe(cap === '' ? null : Number(cap))} />
        <span className="muted small">"Rank upgrades" and "Cheapest path" keep to it.</span>
      </div>
      {buildPrices.maxFe && over.length > 0 && <p className="note-warn">Over the cap or unpriced: {over.map((r) => r.name).join(', ')}</p>}
      <p className="muted small">
        Best source first: your price, then an Exchange price check you did in game (read from the log: the 10th-percentile listing, like TITrack), then TITrack's
        newest season. Legendary gear only gets a price from the first two, so price-check what you're after in the Exchange, or type it here. Without a price,
        Treasure Trove-level legendaries, T2 crafts and common gems count as cheap; the rest count as over the cap.
      </p>
      <table className="stats sample-prices">
        <tbody>
          {buildPrices.rows.map((r, i) => (
            <tr key={`${r.where}-${r.name}-${i}`} className={r.ok ? '' : 'over'}>
              <td className="muted small">{r.where}</td>
              <td>{r.name}</td>
              <td>
                {fe(r.price)} <span className="muted small">{r.price?.source ?? r.assumed ?? r.why ?? ''}</span>
              </td>
              <td>
                <PriceInput name={r.name} onSet={onSet} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pick-row">
        <input className="sample-price-name" placeholder="Any item, e.g. Solid River" value={name} onChange={(e) => setName(e.target.value)} />
        {name && <PriceInput name={name} onSet={(n, v) => (onSet(n, v), setName(''))} />}
      </div>
      {yours.length > 0 && (
        <>
          <h3 className="sub-h">Your prices</h3>
          <ul className="gaps">
            {yours.map(([n, p]) => (
              <li key={n}>
                {n}: {fe(p)}{' '}
                <button className="link" onClick={() => onSet(n, null)}>
                  forget
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {checked.length > 0 && (
        <>
          <h3 className="sub-h">Exchange price checks from the log</h3>
          <ul className="gaps">
            {checked.slice(0, 30).map(([n, p]) => (
              <li key={n}>
                {n}: {fe(p)} <span className="muted small">(lowest {fe({ fe: p.lowest })}, {p.listings} listings, {fmtDateTime(p.at)})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
