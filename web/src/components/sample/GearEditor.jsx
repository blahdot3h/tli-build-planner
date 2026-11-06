import { useEffect, useState } from 'react';
import Panel from '../Panel.jsx';
import { AffixList } from '../Equipment.jsx';
import Icon, { ItemIcon } from '../Icon.jsx';

// A tlidb line with its (min–max) ranges at a roll: 0 the low end, 1 the high end
const RANGE = /\((-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)\)/g;
const decimals = (s) => (String(s).split('.')[1] ?? '').length;
export const rollLine = (text, roll) =>
  String(text).replace(RANGE, (m, a, b) => {
    const d = Math.max(decimals(a), decimals(b));
    const v = Number(a) + (Number(b) - Number(a)) * roll;
    return String(Math.round(v * 10 ** d) / 10 ** d);
  });

const ROLLS = [
  [0, 'low rolls'],
  [0.5, 'average rolls'],
  [1, 'top rolls'],
];

export function LegendaryPicker({ slot, value, legendaries, onChange }) {
  const legend = legendaries.find((l) => l.name === value.legendary);
  const trove = legendaries.filter((l) => l.trove);
  const other = legendaries.filter((l) => !l.trove);
  const set = (patch) => onChange({ ...value, ...patch });
  const option = (l) => (
    <option key={l.name} value={l.name}>
      {l.name} (drop lv {l.dropLevel ?? '?'})
    </option>
  );
  return (
    <>
      <select value={value.legendary ?? ''} onChange={(e) => onChange({ legendary: e.target.value, roll: value.roll ?? 0.5 })}>
        <option value="">Pick a legendary…</option>
        <optgroup label="Treasure Trove can drop these (drop level 54 or less)">{trove.map(option)}</optgroup>
        <optgroup label="Other legendaries">{other.map(option)}</optgroup>
      </select>
      {legend && (
        <div className="pick-row small">
          <Icon src={legend.icon} name={legend.name} width={20} height={28} />
          <select className="pick-small" value={value.roll ?? 0.5} onChange={(e) => set({ roll: Number(e.target.value) })}>
            {ROLLS.map(([r, label]) => (
              <option key={r} value={r}>
                {label}
              </option>
            ))}
          </select>
          {legend.corroded?.length > 0 && (
            <label className="check-inline">
              <input type="checkbox" checked={!!value.corroded} onChange={(e) => set({ corroded: e.target.checked })} /> corroded
            </label>
          )}
          {legend.trove && <span className="tag good">Treasure Trove</span>}
        </div>
      )}
      {legend &&
        Object.entries(legend.random ?? {})
          .filter(([k]) => k.endsWith('(corroded)') === !!value.corroded)
          .map(([k, options]) => {
            const key = k.replace(/ \(corroded\)$/, '');
            return (
              <select key={k} value={value.random?.[key] ?? ''} onChange={(e) => set({ random: { ...value.random, [key]: e.target.value || undefined } })}>
                <option value="">{key}: none picked</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            );
          })}
    </>
  );
}

// Craft tiers: "0+" is the best, then 0, 1, 2 ... 7; T2 is what item level 82-85 gear rolls (Flame Sand)
const TIER_LIMITS = [
  ['2', 'up to T2 (ilvl 82-85)'],
  ['1', 'up to T1 (ilvl 86+)'],
  ['0+', 'any tier'],
];
const tierRank = (t) => (t === '0+' ? -1 : Number(t));

export function RarePicker({ slotInfo, value, pools, onChange }) {
  const rare = value.rare ?? { type: slotInfo.types[0], lines: [] };
  const [roll, setRoll] = useState(0.5);
  const [maxTier, setMaxTier] = useState('2');
  const [tiers, setTiers] = useState(null);
  const [text, setText] = useState(rare.lines.join('\n'));
  useEffect(() => {
    let live = true;
    fetch(`/api/sample/craft/${encodeURIComponent(rare.type)}`)
      .then((r) => r.json())
      .then((rows) => live && setTiers(rows))
      .catch(() => live && setTiers([]));
    return () => {
      live = false;
    };
  }, [rare.type]);
  const set = (patch) => onChange({ rare: { ...rare, ...patch } });
  const commit = () => set({ lines: text.split('\n').map((l) => l.trim()).filter(Boolean) });
  const add = (line) => {
    const next = [...text.split('\n').filter((l) => l.trim()), rollLine(line, roll)].join('\n');
    setText(next);
    set({ lines: next.split('\n').filter(Boolean) });
  };
  // Tier by tier when tlidb has the item type's Craft tab, else the Craft page's one range per affix
  const rows = tiers?.length
    ? tiers.filter((r) => tierRank(r.tier) >= tierRank(maxTier)).map((r) => ({ group: `${r.library.replace(' Affix', '')} ${r.part}`, text: r.text, label: `T${r.tier} (ilvl ${r.lv}) ${r.text.replace(/\n/g, ' / ')}` }))
    : (pools[rare.type] ?? []).map((a) => ({ group: a.kind, text: a.text, label: a.text.replace(/\n/g, ' / ') }));
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <>
      <select value={rare.type} onChange={(e) => set({ type: e.target.value })}>
        {slotInfo.types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <textarea rows={5} value={text} placeholder="One stat line per row, e.g. +1 Lightning Skill Level" onChange={(e) => setText(e.target.value)} onBlur={commit} />
      <div className="pick-row small">
        <select value="" onChange={(e) => e.target.value && add(e.target.value)}>
          <option value="">Add a line this item type can roll…</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {rows
                .filter((r) => r.group === g)
                .map((r, i) => (
                  <option key={`${g}-${i}`} value={r.text}>
                    {r.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {tiers?.length > 0 && (
          <select className="pick-small" value={maxTier} onChange={(e) => setMaxTier(e.target.value)} title="Best tier to offer">
            {TIER_LIMITS.map(([t, label]) => (
              <option key={t} value={t}>
                {label}
              </option>
            ))}
          </select>
        )}
        <select className="pick-small" value={roll} onChange={(e) => setRoll(Number(e.target.value))} title="Roll for added lines">
          {ROLLS.map(([r, label]) => (
            <option key={r} value={r}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function SlotEditor({ slotInfo, value, item, catalog, onChange }) {
  const mode = value?.legendary !== undefined ? 'legendary' : value?.rare ? 'rare' : 'empty';
  const legendaries = catalog.legendaries.filter((l) => l.slots.includes(slotInfo.slot));
  return (
    <div className="slot sample-slot">
      <div className="slot-head">
        <span className="slot-label">{slotInfo.label}</span>
        <select
          className="pick-small"
          value={mode}
          onChange={(e) => {
            const m = e.target.value;
            onChange(m === 'empty' ? null : m === 'legendary' ? { legendary: '', roll: 0.5 } : { rare: { type: slotInfo.types[0], lines: [] } });
          }}
        >
          <option value="empty">Empty</option>
          <option value="legendary">Legendary</option>
          <option value="rare">Crafted rare</option>
        </select>
      </div>
      {mode === 'legendary' && <LegendaryPicker slot={slotInfo.slot} value={value} legendaries={legendaries} onChange={onChange} />}
      {mode === 'rare' && <RarePicker key={`${slotInfo.slot}-${value.rare?.type}`} slotInfo={slotInfo} value={value} pools={catalog.craft} onChange={onChange} />}
      {item ? (
        <div className="item-with-icon">
          <ItemIcon item={item} width={40} />
          <AffixList affixes={item.affixes.filter((a) => a.kind !== 'base')} />
        </div>
      ) : (
        <div className="empty">Empty</div>
      )}
    </div>
  );
}

export default function GearEditor({ spec, character, catalog, onGear }) {
  const filled = character.equipment.filter((e) => e.item).length;
  return (
    <Panel title="Gear" right={`${filled}/10 slots`}>
      <p className="muted small">
        Legendaries use tlidb's current-season lines at the rolls you pick. Treasure Troves (the campaign's golden portals, areas up to level 54) can only drop
        legendaries with a drop level of 54 or less; those are listed first.
      </p>
      <div className="gear-grid">
        {catalog.slots.map((s) => (
          <SlotEditor
            key={s.slot}
            slotInfo={s}
            value={spec.gear?.[s.slot] ?? null}
            item={character.equipment.find((e) => e.slot === s.slot)?.item}
            catalog={catalog}
            onChange={(v) => onGear(s.slot, v)}
          />
        ))}
      </div>
    </Panel>
  );
}
