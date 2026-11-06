import Panel from '../Panel.jsx';
import Icon from '../Icon.jsx';

const ACTIVE_SLOTS = 5;
const PASSIVE_SLOTS = 4;
const isSpecial = (name) => /\((Noble|Magnificent)\)$/.test(name ?? '');
const fmtPrice = (p) => (p ? `${p.fe} FE` : '');

function SupportPicker({ value, skillName, catalog, prices, onChange }) {
  const special = catalog.skills.special.filter((s) => s.target === skillName);
  const info = special.find((s) => s.name === value?.name);
  const icon = value?.name ? (info ?? catalog.skills.supports.find((s) => s.name === value.name))?.icon : null;
  return (
    <span className="pick-pair">
      {value?.name && <Icon src={icon} name={value.name} width={22} />}
      <select value={value?.name ?? ''} onChange={(e) => onChange(e.target.value ? (isSpecial(e.target.value) ? { name: e.target.value, rank: 1, tier: 2, roll: 0.5 } : { name: e.target.value, level: 20 }) : null)}>
        <option value="">Empty</option>
        {special.length > 0 && (
          <optgroup label={`${skillName}'s own (Noble / Magnificent)`}>
            {special.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name.replace(`${skillName}: `, '')}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Supports">
          {catalog.skills.supports.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {s.season === 'SS14' ? ' (SS14)' : ''}
            </option>
          ))}
        </optgroup>
      </select>
      {value?.name && !isSpecial(value.name) && (
        <input className="num" type="number" min="1" max="40" value={value.level ?? 20} title="Gem level" onChange={(e) => onChange({ ...value, level: Number(e.target.value) || 20 })} />
      )}
      {value?.name && isSpecial(value.name) && (
        <>
          <select className="pick-small" value={value.rank ?? 1} title="Rank (adds +5% additional damage per rank above 1)" onChange={(e) => onChange({ ...value, rank: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                Rank {r}
              </option>
            ))}
          </select>
          <select
            className="pick-small"
            value={value.tier ?? 2}
            title={info?.tiers?.find((t) => t.tier === (value.tier ?? 2))?.line ?? ''}
            onChange={(e) => onChange({ ...value, tier: Number(e.target.value) })}
          >
            {(info?.tiers?.length ? info.tiers : [{ tier: 0 }, { tier: 1 }, { tier: 2 }]).map((t) => (
              <option key={t.tier} value={t.tier}>
                T{t.tier}
              </option>
            ))}
          </select>
        </>
      )}
      {value?.name && prices[value.name] && <span className="muted small">{fmtPrice(prices[value.name])}</span>}
    </span>
  );
}

function SkillSlot({ group, kind, index, catalog, prices, onChange }) {
  const list = kind === 'active' ? catalog.skills.actives : catalog.skills.passives;
  const supports = Array.from({ length: 5 }, (_, i) => group?.supports?.[i] ?? null);
  const set = (patch) => onChange({ ...(group ?? { level: 20, supports: [] }), ...patch });
  const icon = group?.name ? list.find((s) => s.name === group.name)?.icon : null;
  return (
    <div className="sample-skill">
      <div className="pick-row">
        <span className="pick-level">{kind === 'active' ? `Active ${index + 1}` : `Passive ${index + 1}`}</span>
        {group?.name && <Icon src={icon} name={group.name} width={28} />}
        <select value={group?.name ?? ''} onChange={(e) => (e.target.value ? set({ name: e.target.value }) : onChange(null))}>
          <option value="">Empty</option>
          {list.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {kind === 'active' && !s.model ? ' (no damage model)' : ''}
            </option>
          ))}
        </select>
        {group?.name && <input className="num" type="number" min="1" max="40" value={group.level ?? 20} title="Gem level" onChange={(e) => set({ level: Number(e.target.value) || 20 })} />}
        {group?.name && prices[group.name] && <span className="muted small">{fmtPrice(prices[group.name])}</span>}
      </div>
      {group?.name && (
        <div className="sample-supports">
          {supports.map((s, i) => (
            <SupportPicker
              key={i}
              value={s}
              skillName={group.name}
              catalog={catalog}
              prices={prices}
              onChange={(v) => {
                const next = [...supports];
                next[i] = v;
                set({ supports: next.map((x) => x ?? null) });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SkillEditor({ spec, catalog, prices, onSkills }) {
  const active = Array.from({ length: ACTIVE_SLOTS }, (_, i) => spec.skills?.active?.[i] ?? null);
  const passive = Array.from({ length: PASSIVE_SLOTS }, (_, i) => spec.skills?.passive?.[i] ?? null);
  const save = (kind, i, v) => {
    const next = { active: [...active], passive: [...passive] };
    next[kind][i] = v;
    onSkills(next);
  };
  return (
    <Panel title="Skills" right="Active 1 is the main skill">
      <p className="muted small">
        Supports in their slots, as in game: a skill's Magnificent support goes in support slot 3, its Noble one in slot 5. Prices are TITrack's (end of the
        season shown), where it has them.
      </p>
      {active.map((g, i) => (
        <SkillSlot key={`a${i}`} group={g} kind="active" index={i} catalog={catalog} prices={prices} onChange={(v) => save('active', i, v)} />
      ))}
      {passive.map((g, i) => (
        <SkillSlot key={`p${i}`} group={g} kind="passive" index={i} catalog={catalog} prices={prices} onChange={(v) => save('passive', i, v)} />
      ))}
    </Panel>
  );
}
