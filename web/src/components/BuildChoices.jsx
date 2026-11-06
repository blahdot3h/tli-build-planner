import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import Icon from './Icon.jsx';

const TRAIT_SLOTS = [
  { level: 1, slots: ['level1'] },
  { level: 45, slots: ['level45', 'level45b'] },
  { level: 60, slots: ['level60', 'level60b'] },
  { level: 75, slots: ['level75', 'level75b'] },
];

async function save(values) {
  await fetch('/api/choices', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
}

const clampLevel = (level) => Math.min(5, Math.max(1, level ?? 1));

function IngredientPick({ label, options, value, onPick, traitLevel }) {
  const chosen = options.find((o) => o.name === value);
  return (
    <div className="pick-row">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onPick(e.target.value || undefined)}>
        <option value="">Not set</option>
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name} ({o.kind}
            {o.modelled ? '' : ', not counted'})
          </option>
        ))}
      </select>
      {chosen && <small className="muted">{chosen.texts[clampLevel(traitLevel) - 1]}</small>}
    </div>
  );
}

// Scent Weaver Sage's Scent Bottles: the log never lists the ingredients, so they're picked here.
// hero.ingredients: { basic: [name, name], functional: name, special: name }
function Ingredients({ hero, catalog, onChange }) {
  const picked = new Set(Object.values(hero.traits ?? {}).filter(Boolean));
  const ing = hero.ingredients ?? {};
  const level = (name) => hero.levels?.[name] ?? 1;
  const set = (patch) => onChange({ ...ing, ...patch });
  const basic = ing.basic ?? [];
  const setBasic = (i, name) => {
    const next = [...basic];
    next[i] = name;
    set({ basic: next.filter(Boolean) });
  };
  const salt = picked.has('Pungent Stimulant Salt');
  const blend = picked.has('Licorice Tincture Blend');
  return (
    <>
      <h3 className="sub-h">Scent Bottle ingredients</h3>
      <p className="muted small">
        Not in the log. The Basic Scent Bottle is skill slot 2: 2 ingredients, read at the Licorice Note trait level (set it above)
        {salt ? ', plus 1 Functional ingredient from Pungent Stimulant Salt' : ''}
        {blend ? '. The Special Scent Bottle (Licorice Tincture Blend) is skill slot 3: 1 ingredient' : ''}.
      </p>
      {[0, 1].map((i) => (
        <IngredientPick
          key={i}
          label={`Basic ${i + 1}`}
          options={catalog.basic.filter((o) => o.name === basic[i] || !basic.includes(o.name))}
          value={basic[i]}
          traitLevel={level('Licorice Note')}
          onPick={(name) => setBasic(i, name)}
        />
      ))}
      {salt && <IngredientPick label="Functional" options={catalog.functional} value={ing.functional} traitLevel={level('Pungent Stimulant Salt')} onPick={(name) => set({ functional: name })} />}
      {blend && <IngredientPick label="Special" options={catalog.special} value={ing.special} traitLevel={level('Licorice Tincture Blend')} onPick={(name) => set({ special: name })} />}
    </>
  );
}

// What the log can't name: hero, traits and equipped pactspirits. Saved per character and used by
// every DPS number.
export default function BuildChoices({ choices, logHeroId, logTraits, logPets }) {
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => r.json())
      .then(setCatalog)
      .catch(() => setCatalog({ heroes: [], pactspirits: [] }));
  }, []);

  if (!catalog) return null;
  const inferred = !choices.hero && choices.heroInferred ? choices.heroInferred : null;
  const hero = choices.hero ?? inferred ?? { name: '', traits: {} };
  const heroData = catalog.heroes.find((h) => h.hero === hero.name);
  // Picked pets, else the ones named from the log's pet ids (what the numbers use)
  const petsInferred = !choices.pactspirits?.length && choices.petsInferred?.length ? choices.petsInferred : null;
  const pets = [0, 1, 2].map((i) => (petsInferred ?? choices.pactspirits ?? [])[i] ?? { name: '', level: 6 });

  const setHero = (name) => save({ hero: name ? { name, traits: { level1: catalog.heroes.find((h) => h.hero === name)?.levels[1]?.[0]?.name } } : null });
  const setTrait = (slot, name) => save({ hero: { ...hero, traits: { ...hero.traits, [slot]: name || undefined } } });
  // Trait levels as the in-game Hero Trait screen shows them (LV.1-5)
  const setLevel = (name, level) => save({ hero: { ...hero, levels: { ...hero.levels, [name]: level } } });
  const setPet = (i, patch) => {
    const next = pets.map((p, k) => (k === i ? { ...p, ...patch } : p)).filter((p) => p.name);
    save({ pactspirits: next });
  };

  return (
    <Panel title="Hero & pactspirits" right="not in the log">
      <p className="muted small">
        The log only stores these as ids (hero #{logHeroId}, traits {logTraits.map((t) => `#${t.id}`).join(', ') || 'none'}), so pick them
        here. Traits marked "not modelled" are kept but add nothing to the numbers yet; "simulation" ones only count in the in-game
        simulation.
      </p>
      {inferred && (
        <p className="note-warn">
          Worked out from those ids, not read directly: {inferred.name}. Pick the right hero and traits if this is wrong.
        </p>
      )}

      <label className="pick">
        <span>Hero</span>
        {heroData && <Icon src={heroData.portrait} name={heroData.hero} width={40} className="portrait" />}
        <select value={hero.name} onChange={(e) => setHero(e.target.value)}>
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
              {slots.slice(0, heroData.levels[level].length > 1 ? 2 : 1).map((slot, i) => (
                <span key={slot} className="pick-pair">
                  {hero.traits?.[slot] && <Icon src={heroData.levels[level].find((t) => t.name === hero.traits[slot])?.icon} name={hero.traits[slot]} width={28} />}
                  <select value={hero.traits?.[slot] ?? ''} onChange={(e) => setTrait(slot, e.target.value)}>
                    <option value="">{i === 0 ? 'None' : 'Second trait (optional)'}</option>
                    {heroData.levels[level].map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                        {t.modelled === 'sim' ? ' (simulation)' : t.modelled ? '' : ' (not modelled)'}
                      </option>
                    ))}
                  </select>
                  {hero.traits?.[slot] && (
                    <select
                      className="pick-small"
                      title="Trait level, as the in-game Hero Trait screen shows it"
                      value={hero.levels?.[hero.traits[slot]] ?? ''}
                      onChange={(e) => setLevel(hero.traits[slot], e.target.value ? Number(e.target.value) : undefined)}
                    >
                      <option value="">Lv ?</option>
                      {[1, 2, 3, 4, 5].map((l) => (
                        <option key={l} value={l}>
                          Lv {l}
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              ))}
            </div>
          ) : null,
        )}

      {heroData?.ingredients && <Ingredients hero={hero} catalog={heroData.ingredients} onChange={(ingredients) => save({ hero: { ...hero, ingredients } })} />}

      <h3 className="sub-h">Pactspirits in the main slots</h3>
      <p className="muted small">From the log: {logPets.map((p) => `#${p.id}`).join(', ') || 'none'}</p>
      {petsInferred && <p className="note-warn">Named from those ids, not picked: change them here if they're wrong.</p>}
      {pets.map((p, i) => (
        <div className="pick-row" key={i}>
          {p.name && <Icon src={catalog.pactspirits.find((x) => x.name === p.name)?.icon} name={p.name} width={20} height={33} className="pet" />}
          <select value={p.name} onChange={(e) => setPet(i, { name: e.target.value })}>
            <option value="">Slot {i + 1}: not set</option>
            {catalog.pactspirits.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name} ({x.type})
              </option>
            ))}
          </select>
          <select className="pick-small" value={p.level} disabled={!p.name} onChange={(e) => setPet(i, { level: Number(e.target.value) })}>
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
