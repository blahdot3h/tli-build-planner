import Panel from '../Panel.jsx';
import Icon from '../Icon.jsx';

const TRAIT_SLOTS = [
  { level: 1, slots: ['level1'] },
  { level: 45, slots: ['level45', 'level45b'] },
  { level: 60, slots: ['level60', 'level60b'] },
  { level: 75, slots: ['level75', 'level75b'] },
];

// Hero, traits with their levels, and the three battle pactspirits of a sample build
export default function SampleHero({ spec, catalog, onHero, onPets }) {
  const hero = spec.hero ?? { name: '', traits: {}, levels: {} };
  const heroData = catalog.heroes.find((h) => h.hero === hero.name);
  const pets = [0, 1, 2].map((i) => spec.pactspirits?.[i] ?? { name: '', level: 1 });
  const setPet = (i, patch) => onPets(pets.map((p, k) => (k === i ? { ...p, ...patch } : p)).filter((p) => p.name));
  return (
    <Panel title="Hero & pactspirits">
      <label className="pick">
        <span>Hero</span>
        {heroData && <Icon src={heroData.portrait} name={heroData.hero} width={40} className="portrait" />}
        <select value={hero.name} onChange={(e) => onHero(e.target.value ? { name: e.target.value, traits: { level1: catalog.heroes.find((h) => h.hero === e.target.value)?.levels[1]?.[0]?.name }, levels: {} } : null)}>
          <option value="">Not set</option>
          {catalog.heroes.map((h) => (
            <option key={h.hero} value={h.hero}>
              {h.hero}
            </option>
          ))}
        </select>
      </label>
      {heroData &&
        TRAIT_SLOTS.map(({ level, slots }) =>
          heroData.levels[level]?.length ? (
            <div className="pick-row" key={level}>
              <span className="pick-level">Lv {level}</span>
              {slots.slice(0, heroData.levels[level].length > 1 ? 2 : 1).map((slot, i) => {
                const name = hero.traits?.[slot];
                return (
                  <span key={slot} className="pick-pair">
                    {name && <Icon src={heroData.levels[level].find((t) => t.name === name)?.icon} name={name} width={28} />}
                    <select value={name ?? ''} onChange={(e) => onHero({ ...hero, traits: { ...hero.traits, [slot]: e.target.value || undefined } })}>
                      <option value="">{i === 0 ? 'None' : 'Second trait (optional)'}</option>
                      {heroData.levels[level].map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                          {t.modelled === 'sim' ? ' (simulation)' : t.modelled ? '' : ' (not modelled)'}
                        </option>
                      ))}
                    </select>
                    {name && level > 1 && (
                      <select className="pick-small" title="Trait level (memory level 30: 2, 50: 3, plus the memory's +Hero Trait Level)" value={hero.levels?.[name] ?? 1} onChange={(e) => onHero({ ...hero, levels: { ...hero.levels, [name]: Number(e.target.value) } })}>
                        {[1, 2, 3, 4, 5].map((l) => (
                          <option key={l} value={l}>
                            Lv {l}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                );
              })}
            </div>
          ) : null,
        )}
      <h3 className="sub-h">Pactspirits in the main slots</h3>
      {pets.map((p, i) => (
        <div className="pick-row" key={i}>
          {p.name && <Icon src={catalog.pactspirits.find((x) => x.name === p.name)?.icon} name={p.name} width={20} height={33} className="pet" />}
          <select value={p.name} onChange={(e) => setPet(i, { name: e.target.value })}>
            <option value="">Slot {i + 1}: none</option>
            {catalog.pactspirits.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name} ({x.rarity}, {x.type})
              </option>
            ))}
          </select>
          <select className="pick-small" value={p.level ?? 1} disabled={!p.name} onChange={(e) => setPet(i, { level: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6].map((l) => (
              <option key={l} value={l}>
                Lv {l}
              </option>
            ))}
          </select>
        </div>
      ))}
    </Panel>
  );
}
