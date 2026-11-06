import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import { ItemIcon } from './Icon.jsx';
import Delta, { nowAndBase } from './Delta.jsx';
import { LegendaryPicker, RarePicker } from './sample/GearEditor.jsx';
import { baseName, fmtCompact, fmtValues, rarityLabel } from '../format.js';

const FLASH_MS = 8000;

const saveChoices = (values) =>
  fetch('/api/choices', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });

// The sample builds' catalog (slots, legendaries with their lines, craft pools), fetched once
let catalogPromise = null;
const loadCatalog = () => (catalogPromise ??= fetch('/api/sample/catalog').then((r) => r.json()));

// What-if for one gear slot: keep what's logged, leave the slot empty, put a legendary there (tlidb's
// lines at a roll, its random options, corroded) or build a rare from a base type line by line. The
// spec is a sample build's gear entry (choices.gearSwaps[slot]); the engine recomputes at once.
function GearWhatIf({ slot, label, value, swapped, catalog, onChange, onClose }) {
  const slotInfo = catalog.slots.find((s) => s.slot === slot);
  const mode = !swapped ? 'logged' : value === null ? 'empty' : value?.legendary !== undefined ? 'legendary' : value?.rare ? 'rare' : 'logged';
  const legendaries = catalog.legendaries.filter((l) => l.slots.includes(slot));
  return (
    <div className="gear-whatif">
      <div className="pick-row small">
        <strong>What-if for {label}</strong>
        <select
          className="pick-small"
          value={mode}
          onChange={(e) => {
            const m = e.target.value;
            onChange(m === 'logged' ? undefined : m === 'empty' ? null : m === 'legendary' ? { legendary: '', roll: 0.5 } : { rare: { type: slotInfo.types[0], lines: [] } });
          }}
        >
          <option value="logged">As logged</option>
          <option value="empty">Empty slot</option>
          <option value="legendary">A legendary</option>
          <option value="rare">A crafted rare</option>
        </select>
        <button className="link" onClick={onClose}>
          close
        </button>
      </div>
      {mode === 'legendary' && <LegendaryPicker slot={slot} value={value} legendaries={legendaries} onChange={onChange} />}
      {mode === 'rare' && <RarePicker key={`${slot}-${value.rare?.type}`} slotInfo={slotInfo} value={value} pools={catalog.craft} onChange={onChange} />}
    </div>
  );
}

export default function Equipment({ equipment: logged, now, calc }) {
  const equipment = calc?.used?.equipment ?? logged;
  const swaps = calc?.choices?.gearSwaps ?? {};
  const swapCount = Object.keys(swaps).length;
  const [open, setOpen] = useState(null); // the slot whose what-if editor is open
  const [catalog, setCatalog] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open == null || catalog) return;
    loadCatalog().then(setCatalog).catch(() => setCatalog({ slots: [], legendaries: [], craft: {} }));
  }, [open, catalog]);
  // value: a gear spec, null for an empty slot, undefined to go back to what's logged
  const setSwap = async (slot, value) => {
    setBusy(true);
    try {
      const next = { ...swaps };
      if (value === undefined) delete next[slot];
      else next[slot] = value;
      await saveChoices({ gearSwaps: next });
    } finally {
      setBusy(false);
    }
  };
  const filled = equipment.filter((e) => e.item).length;
  const { now: dpsNow, base } = nowAndBase(calc);
  return (
    <Panel
      title="Equipped gear"
      right={
        <span className="panel-actions">
          {swapCount > 0 && (
            <button className="link" onClick={() => setSwap(null, undefined) && saveChoices({ gearSwaps: {} })} disabled={busy}>
              gear back to logged
            </button>
          )}
          <span>{`${filled}/${equipment.length} slots`}</span>
        </span>
      }
    >
      {swapCount > 0 && base > 0 && dpsNow != null && (
        <p className="muted small">
          <b>
            {swapCount} slot{swapCount > 1 ? 's' : ''} changed in the what-if: {fmtCompact(dpsNow)} average vs {fmtCompact(base)} as logged, <Delta value={dpsNow} base={base} />.
          </b>{' '}
          Nothing changes in game.
        </p>
      )}
      <div className={`gear-grid ${busy ? 'busy' : ''}`}>
        {equipment.map((e) => {
          const key = String(e.slot);
          const isSwapped = key in swaps;
          return (
            <div key={e.slot} className={`slot ${e.changedAt && now - e.changedAt < FLASH_MS ? 'flash' : ''} ${isSwapped ? 'whatif' : ''}`}>
              <div className="slot-head">
                <span className="slot-label">{e.label}</span>
                <span className="slot-num">
                  {isSwapped && <span className="tag">what-if</span>}
                  <button className="link" onClick={() => setOpen(open === e.slot ? null : e.slot)} title="Try another item here: a legendary, a crafted rare, or nothing">
                    {open === e.slot ? 'close' : isSwapped ? 'change' : 'what-if'}
                  </button>
                  slot {e.slot}
                </span>
              </div>
              {open === e.slot &&
                (catalog ? (
                  <GearWhatIf slot={e.slot} label={e.label} value={swaps[key]} swapped={isSwapped} catalog={catalog} onChange={(v) => setSwap(e.slot, v)} onClose={() => setOpen(null)} />
                ) : (
                  <div className="muted small">Loading the item catalog…</div>
                ))}
              {e.item ? <ItemBody item={e.item} /> : <div className="empty">{isSwapped ? 'Empty in the what-if' : 'Empty'}</div>}
              {isSwapped && e.was && <div className="muted small">Logged here: {e.was}</div>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function itemTitle(item) {
  if (item.uniqueName) return item.uniqueName;
  if (item.uniqueId) return `Legendary #${item.uniqueId}`;
  return baseName(item.name, item.baseId);
}

export function ItemBody({ item }) {
  return (
    <div className="item">
      <div className="item-head">
        <ItemIcon item={item} />
        <div>
          <div className={`item-title ${item.rarity === 100 ? 'legendary' : ''}`}>{itemTitle(item)}</div>
          <div className="item-meta">
            {item.type && <span>{item.type}</span>}
            {item.level != null && <span>iLvl {item.level}</span>}
            {rarityLabel(item.rarity) && <span>{rarityLabel(item.rarity)}</span>}
            {item.forge?.map((f) => (
              <span key={f} className="tag">
                {f.replace(/_/g, ' ').toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      </div>
      {item.detailsKnown ? (
        <AffixList affixes={item.affixes} />
      ) : (
        <div className="empty">Details not in the log yet. Relog to capture them.</div>
      )}
    </div>
  );
}

export function AffixList({ affixes }) {
  if (!affixes?.length) return null;
  return (
    <ul className="affixes">
      {affixes.map((a, i) => (
        <li key={`${a.id}-${i}`} className={`affix k-${a.kind}${a.tier != null ? ` tier tier-${String(a.tier).replace('+', 'plus')}` : ''}`}>
          <span className="affix-kind">{a.kind}</span>
          {a.text ? (
            <span className="affix-text" title={a.tier != null ? `Tier ${a.tier}` : undefined}>
              {a.tier != null && <span className="affix-tier">T{a.tier}</span>}
              {a.text}
            </span>
          ) : (
            <>
              <code className="affix-id">#{a.id}</code>
              {a.values.length > 0 && <span className="affix-vals">{fmtValues(a.values)}</span>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
