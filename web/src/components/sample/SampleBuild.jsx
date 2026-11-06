import { useEffect, useState } from 'react';
import Panel from '../Panel.jsx';
import DpsPanel from '../DpsPanel.jsx';
import StatsPanel from '../StatsPanel.jsx';
import GearEditor from './GearEditor.jsx';
import SkillEditor from './SkillEditor.jsx';
import TalentEditor from './TalentEditor.jsx';
import SampleHero from './SampleHero.jsx';
import Upgrades from './Upgrades.jsx';
import Prices from './Prices.jsx';
import SlateEditor from './SlateEditor.jsx';
import { fmtCompact } from '../../format.js';
import * as api from './api.js';

// The kept builds: open one, keep the open one under a new name (with its plan), or delete one
function KeptBuilds({ page, onOpen, onSaveAs, onDelete, busy }) {
  const [name, setName] = useState('');
  const saves = page.saves ?? [];
  const open = saves.find((s) => s.open);
  return (
    <div className="pick-row sample-saves">
      <span>Build</span>
      <select value={open?.id ?? ''} disabled={busy} onChange={(e) => onOpen(e.target.value)}>
        {saves.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.avgDps ? ` · ${fmtCompact(s.avgDps)}` : ''}
            {s.hasPlan ? ' · has a plan' : ''}
          </option>
        ))}
      </select>
      <input className="sample-price-name" placeholder="Name for a copy, e.g. 50 FE plan" value={name} onChange={(e) => setName(e.target.value)} />
      <button
        disabled={busy}
        onClick={() => {
          onSaveAs(name);
          setName('');
        }}
      >
        Save as…
      </button>
      <button disabled={busy || saves.length < 2} onClick={() => open && window.confirm(`Delete "${open.name}" for good?`) && onDelete(open.id)}>
        Delete
      </button>
    </div>
  );
}

function Header({ page, onPreset, onLevel, onName, onOpen, onSaveAs, onDelete, busy }) {
  const { spec, character } = page;
  const sim = character.calc.sim;
  const [preset, setPreset] = useState(page.presets[0]?.key ?? 'trove');
  const chosen = page.presets.find((p) => p.key === preset);
  return (
    <section className="char sample-head">
      <KeptBuilds page={page} onOpen={onOpen} onSaveAs={onSaveAs} onDelete={onDelete} busy={busy} />
      <p className="muted small">
        Every change is saved to the open build as you make it. "Save as…" keeps a copy under a new name, with its upgrade list and path, and opens it. The
        preset below replaces the open build's contents.
      </p>
      <div className="char-title">
        <input className="sample-name" value={spec.name ?? ''} onChange={(e) => onName(e.target.value)} />
        <label className="pick-pair">
          Level <input className="num" type="number" min="1" max="100" value={spec.level ?? 85} onChange={(e) => onLevel(Number(e.target.value) || 85)} />
        </label>
      </div>
      <div className="pick-row">
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {page.presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
          <option value="live">Copy of the character shown under "My character"</option>
        </select>
        <button className="primary" disabled={busy} onClick={() => onPreset(preset)}>
          Load
        </button>
        <span className="muted small">{preset === 'live' ? 'Exact gear, gems, trees, memories, slates and Destinies of the logged character.' : chosen?.description}</span>
      </div>
      <div className="dps-cards">
        <div className="dps-card">
          <div className="dps-k">Simulated, average</div>
          <div className="dps-v">{sim?.supported ? fmtCompact(sim.avgDps) : '—'}</div>
        </div>
        <div className="dps-card">
          <div className="dps-k">Best 5 s</div>
          <div className="dps-v">{sim?.supported ? fmtCompact(sim.peak5s) : '—'}</div>
        </div>
        <div className="dps-card subtle">
          <div className="dps-k">Main skill</div>
          <div className="dps-v">{character.calc.mainSkill ?? '—'}</div>
        </div>
        {page.prices && (
          <div className="dps-card subtle">
            <div className="dps-k">Prices</div>
            <div className="dps-note">TITrack, {page.prices.seasons[0]} (newest season it has)</div>
          </div>
        )}
      </div>
    </section>
  );
}

// A planned build: pick a preset (or copy the logged character), gear it, spec it, see its DPS and
// what to upgrade next. Everything is computed by the same engine and simulation as the logged
// character.
export default function SampleBuild({ pushed, progress }) {
  const [page, setPage] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.getPage().then(setPage).catch((e) => setError(e.message));
    api.getCatalog().then(setCatalog).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (pushed) setPage(pushed);
  }, [pushed]);

  const act = async (fn) => {
    setError(null);
    try {
      const result = await fn();
      if (result?.spec) setPage(result);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!page || !catalog) {
    return (
      <div className="waiting">
        <h1>Sample build</h1>
        <p>{error ?? 'Loading…'}</p>
      </div>
    );
  }
  const { spec, character } = page;
  const prices = catalog.prices ?? {};
  const busy = !!page.busy || !!progress;
  return (
    <>
      <Header
        page={page}
        busy={busy}
        onPreset={(key) => act(() => api.loadPreset(key))}
        onLevel={(level) => act(() => api.patchSample({ level }))}
        onName={(name) => act(() => api.patchSample({ name }))}
        onOpen={(id) => act(() => api.openBuild(id))}
        onSaveAs={(name) => act(() => api.saveBuildAs(name))}
        onDelete={(id) => act(() => api.deleteBuild(id))}
      />
      {error && <p className="note-warn">{error}</p>}
      {/* Keyed by the open build, so the editors' own state starts fresh when another build opens */}
      <div className="layout" key={spec.id}>
        <div className="col-main">
          <GearEditor spec={spec} character={character} catalog={catalog} onGear={(slot, value) => act(() => api.replaceSample('gear', { ...spec.gear, [slot]: value }))} />
          <SkillEditor spec={spec} catalog={catalog} prices={prices} onSkills={(skills) => act(() => api.replaceSample('skills', skills))} />
          <TalentEditor
            spec={spec}
            character={character}
            catalog={catalog}
            talentPoints={page.talentPoints}
            busy={busy}
            onTalents={(talents) => act(() => api.replaceSample('talents', talents))}
            onFit={(points) => act(() => api.fitTalents(points))}
          />
          <SlateEditor spec={spec} catalog={catalog} onSlates={(slates) => act(() => api.replaceSample('slates', slates))} onCopyLive={() => act(() => api.copyLiveSlates())} />
        </div>
        <div className="col-side">
          <Upgrades
            page={page}
            progress={progress}
            onRank={(troveOnly, craft) => act(() => api.rankUpgrades(troveOnly, craft))}
            onPath={(target, troveOnly, craft) => act(() => api.findPath(target, troveOnly, craft))}
            onApply={(label) => act(() => api.applyUpgrade(label))}
            onApplyPath={() => act(() => api.applyPath())}
          />
          <Prices page={page} onSet={(name, fe) => act(() => api.setPrice(name, fe))} onMaxFe={(maxFe) => act(() => api.setMaxFe(maxFe))} />
          <DpsPanel calc={character.calc} sample onScenario={(values) => act(() => api.patchSample({ scenario: values }))} />
          <SampleHero spec={spec} catalog={catalog} onHero={(hero) => act(() => api.replaceSample('hero', hero))} onPets={(pets) => act(() => api.replaceSample('pactspirits', pets))} />
          <StatsPanel calc={character.calc} gaps={[]} />
          <Panel title="Extra stat lines">
            <p className="muted small">Memories, Destinies, slates or anything else, one stat line per row (they count like gear lines).</p>
            <ExtraLines spec={spec} onSave={(lines) => act(() => api.replaceSample('extraLines', lines))} />
          </Panel>
        </div>
      </div>
    </>
  );
}

function ExtraLines({ spec, onSave }) {
  const [text, setText] = useState((spec.extraLines ?? []).map((l) => l.text).join('\n'));
  return (
    <textarea
      rows={6}
      value={text}
      placeholder="+60% Spell Critical Strike Rating"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onSave(text.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ source: 'Extra lines', text: t })))}
    />
  );
}
