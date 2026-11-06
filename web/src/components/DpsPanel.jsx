import { useState } from 'react';
import Panel from './Panel.jsx';
import Sparkline from './Sparkline.jsx';
import { fmtCompact, fmtInt, fmtPct, fmtTime, latestReading, parseDps } from '../format.js';

function Row({ label, value, unit = '' }) {
  if (value == null) return null;
  return (
    <div className="kv">
      <span>{label}</span>
      <span title={typeof value === 'number' ? fmtInt(value) : ''}>
        {typeof value === 'number' ? fmtCompact(value) : value}
        {unit}
      </span>
    </div>
  );
}

// A reading typed against a logged dummy session wins; without one, it can be typed here
function MeasuredDps({ sim, manual, dummyTests }) {
  const fromTest = latestReading(dummyTests);
  const [text, setText] = useState(manual ? fmtCompact(manual) : '');
  const measured = fromTest?.reading ?? manual;
  async function commit() {
    const value = text.trim() ? parseDps(text) : null;
    if (text.trim() && value == null) return;
    await fetch('/api/choices', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ measuredDps: value }),
    });
  }
  return (
    <div className="measured">
      {fromTest ? (
        <div className="kv">
          <span>Dummy's best 5 s ({fmtTime(fromTest.start)})</span>
          <span title={fmtInt(fromTest.reading)}>{fmtCompact(fromTest.reading)}</span>
        </div>
      ) : (
        <label>
          <span>Dummy's best 5 s DPS</span>
          <input value={text} placeholder="e.g. 110M" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        </label>
      )}
      {measured && sim?.supported && (
        <span className={sim.peak5s / measured < 0.8 ? 'note-warn' : 'muted small'}>
          Simulated best 5 s is {fmtPct(sim.peak5s, measured)} of it
        </span>
      )}
    </div>
  );
}

const MECHANIC_LABELS = {
  gash: 'Gash stacks from consuming Terra Charges',
  tormentOnDot: 'Torment stacks from dealing DoT',
  focusOnReap: 'Focus Blessing when Reaping',
  focusOnFrostbitten: 'Focus Blessing from hitting Frostbitten enemies',
  ominousSkill: 'Ominous curse (Ill Omen)',
};

// Selena's traits as the simulation applies them
function heroTraitNote(sim) {
  const p = sim.params;
  const parts = [];
  if (p.terraAddnMult > 1) parts.push(`+${Math.round((p.terraAddnMult - 1) * 100)}% additional Terra damage`);
  if (p.cursedAddnMult > 1) parts.push(`+${Math.round((p.cursedAddnMult - 1) * 100)}% against the Ominous-cursed target`);
  if (p.crimsonTideMult > 1) parts.push(`Crimson Tide +${Math.round((p.crimsonTideMult - 1) * 100)}% damage taken`);
  if (p.cycleReapPct > 0) parts.push(`recasts reap ${p.cycleReapPct}% of the old Terra's remaining time, Terra +${Math.round(p.critToDurationPct)}% duration from Critical Strike Rating`);
  return parts.join(' · ');
}

function AttackDetails({ sim }) {
  const p = sim.params;
  return (
    <ul className="assumptions">
      <li>
        {p.castsPerSec.toFixed(2)} casts per second before Rage bonuses, {fmtCompact(p.damagePerCast)} damage per cast (crits, shadows and
        both hands averaged, from the formula)
      </li>
      {sim.hero ? (
        <>
          <li>
            {sim.hero.name}: {sim.hero.traits.map((t) => `${t.name} Lv ${t.level}`).join(', ')}
          </li>
          <li>
            Berserk from {sim.berserkAt != null ? `${sim.berserkAt.toFixed(1)} s` : 'never'}, active {Math.round(100 * sim.berserkUptime)}% of the
            fight · Seething Spirit cast {sim.spiritCasts} times · Rage Infusion averaged {(sim.avgInfusionStacks ?? 0).toFixed(1)} stacks
          </li>
          <li>
            {sim.assumptions.fullBuffs
              ? 'Every buff at 100% uptime: Berserk and max Rage Infusion stacks from the start, plus the combat toggles below'
              : 'The fight starts at 0 Rage and ramps up into Berserk'}
          </li>
          <li>
            Seething Spirit: {sim.assumptions.spiritDamagePct ? `hits for ${sim.assumptions.spiritDamagePct}% of your cast` : 'feeds Rage but adds no damage'}{' '}
            (calibrated on golem runs) · "recently" means 4 s
          </li>
        </>
      ) : (
        <li>No hero mechanics are modelled for this build, so attacks land at a steady rate (same as the formula)</li>
      )}
      <li>Single target dummy, standing still, combat toggles below applied.</li>
    </ul>
  );
}

const pct = (x) => `${Math.round(x * 100)}%`;

// Spell Burst: what the fight played out, and the rules nobody has measured yet
function SpellBurstDetails({ sim }) {
  const p = sim.params;
  const a = sim.assumptions;
  return (
    <ul className="assumptions">
      <li>
        One cast hits for {fmtCompact(p.hit)} with everything up (crits included); casts made by Spell Burst deal ×{p.burstMult.toFixed(2)} (every
        "additional Hit Damage for skills cast by Spell Burst" line multiplied)
      </li>
      <li>
        Spell Burst Charge Speed ×{p.chargeFactor.toFixed(2)} (+{Math.round(p.incChargePct)}% increased, Play Safe's cast speed included): a full bar of{' '}
        {p.maxSpellBurst} every {p.ticksPerBar} ticks of the game's 30 Hz clock ({p.secondsPerBurst.toFixed(2)} s)
        {a.chargeModel === 'stack' ? ', each stack charging on its own' : ''}
      </li>
      <li>
        {p.autoTrigger
          ? 'Solid River triggers each full bar by itself (its Spell Burst Charge Speed is past 240%)'
          : 'Bursts need you to cast: the next cast on a full bar bursts'}
        {' · '}
        {p.castsPerBurst} casts per burst ({a.countActivatingCast ? 'the activating cast plus one per stack' : 'one per stack'}
        {a.activatingCastBoosted ? ', all with the Spell Burst bonuses' : a.countActivatingCast ? ', the activating cast without the Spell Burst bonuses' : ''})
        {a.handCasting && ` · casting by hand ${p.handRate.toFixed(2)} times a second between bursts`}
      </li>
      {p.whimsySignal && (
        <li>
          Bing: Whimsy Signal ×{p.whimsySignal.toFixed(2)} up {pct(sim.signalUptime)} of the fight · {sim.explosionsPerMin.toFixed(0)} Whimsy Explosions and{' '}
          {sim.overloadsPerMin.toFixed(1)} Ingenuity Overloads a minute (Max Spell Burst ×3, charged at once)
          {p.whimsyCap > 0 ? ` · Mind Domain: up to ${p.whimsyCap} Whimsy stacks while you stand in its field (up ${pct(sim.whimsyUptime)})` : ''}
        </li>
      )}
      {p.thunderbolts && (
        <li>
          Thunderbolts: one every {p.thunderbolts.every} casts (Spell Burst's automatic ones included), up to {p.thunderbolts.cap} at a time,{' '}
          {p.thunderbolts.duration} s each
          {p.thunderbolts.aftershock && ", Aftershock adding a replacement outside the cap as each vanishes"}
          {p.thunderbolts.reverb && `, Reverberation holding up to ${p.thunderbolts.reverb.max} more past the cap at half duration`}. Each one is taken to repeat every
          cast you make, Spell Burst casts included. These readings are fitted to CoffeeBingTest's dummy runs (87-105% of their averages), not
          spelled out on tlidb.
        </li>
      )}
      {p.buffs.length > 0 && (
        <li>
          Cast by Activation Medium: Spell Burst on a burst once off cooldown:{' '}
          {p.buffs
            .map((b) => `${b.name} ${b.duration.toFixed(1)} s every ${b.cooldown.toFixed(1)} s, up ${pct(sim.buffUptime[b.name] ?? 0)}${b.factor > 1.001 ? ` (×${b.factor.toFixed(2)} damage)` : ''}`)
            .join(' · ')}
        </li>
      )}
      <li>
        Not measured yet: whether the bar charges as a whole or stack by stack, whether a burst has M or M + 1 casts and which get the bonus, and how long Mind
        Domain's field lasts ({a.fieldSeconds} s assumed). The toggles below switch them; timing 10 bursts on the dummy settles the first. Not counted: the
        Whimsy Explosion's own hit (tlidb gives no number).
      </li>
      <li>Single target dummy, {sim.assumptions.duration} s fight starting with an empty bar and no Essence, combat toggles below applied.</li>
    </ul>
  );
}

function Simulation({ sim }) {
  const [showDetails, setShowDetails] = useState(false);
  if (!sim) return null;
  if (!sim.supported) return <p className="muted small">{sim.reason}</p>;
  const p = sim.params;
  const attack = sim.kind === 'attack';
  if (sim.kind === 'spellBurst') {
    return (
      <>
        <div className="kvs">
          <Row label={`Average over ${sim.assumptions.duration} s`} value={sim.avgDps} />
          <Row label="Best 1 s" value={sim.peak1s} />
          <Row label="Best 5 s" value={sim.peak5s} />
          <Row label="Spell Burst casts" value={sim.breakdown.burst} />
          <Row label="Activating casts" value={sim.breakdown.activating || null} />
          <Row label="Ingenuity Overload" value={sim.breakdown.overload || null} />
          <Row label="Casts by hand" value={sim.breakdown.hand || null} />
          <Row label={`Thunderbolts (about ${(sim.avgThunderbolts ?? 0).toFixed(1)} repeating your casts)`} value={sim.breakdown.thunderbolts || null} />
        </div>
        <Sparkline points={sim.timeline} />
        <p className="muted small">
          {sim.burstsPerSec.toFixed(2)} bursts a second of {p.castsPerBurst} casts
          {sim.overloadsPerMin > 0 && ` · ${sim.overloadsPerMin.toFixed(1)} Ingenuity Overloads a minute`}
        </p>
        <button className="link" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? 'Hide' : 'Show'} assumptions
        </button>
        {showDetails && <SpellBurstDetails sim={sim} />}
      </>
    );
  }
  return (
    <>
      <div className="kvs">
        <Row label={`Average over ${sim.assumptions.duration} s`} value={sim.avgDps} />
        <Row label="Steady state (last 10 s)" value={sim.steadyDps} />
        <Row label="Best 1 s" value={sim.peak1s} />
        <Row label="Best 5 s" value={sim.peak5s} />
        <Row label="Ramp-up to 90%" value={sim.rampSeconds != null ? `${sim.rampSeconds} s` : '—'} />
        <Row label="DoT ticking" value={sim.breakdown.dot} />
        <Row label="Reaping" value={sim.breakdown.reap} />
        <Row label="Reaping on recast" value={sim.breakdown.recastReap ? sim.breakdown.recastReap : null} />
        <Row label="Ill Omen (True Damage)" value={sim.breakdown.illOmen ? sim.breakdown.illOmen : null} />
        <Row label="Your attacks" value={attack ? sim.breakdown.player : null} />
        <Row label="Seething Spirit" value={attack && sim.breakdown.spirit ? sim.breakdown.spirit : null} />
      </div>
      <Sparkline points={sim.timeline} />
      {attack ? (
        <p className="muted small">
          {sim.casts} casts in {sim.assumptions.duration} s
          {sim.hero && sim.berserkAt != null && ` · Berserk after ${sim.berserkAt.toFixed(1)} s`}
        </p>
      ) : (
        <p className="muted small">
          Best timing: <strong>{sim.policies.find((x) => x.policy === sim.policy)?.label}</strong> · {sim.casts} casts,{' '}
          {sim.avgChargesPerCast.toFixed(1)} Terra Charges per cast
        </p>
      )}
      <button className="link" onClick={() => setShowDetails((v) => !v)}>
        {showDetails ? 'Hide' : 'Show'} {attack ? 'assumptions' : 'timing strategies and assumptions'}
      </button>
      {showDetails && attack && <AttackDetails sim={sim} />}
      {showDetails && !attack && (
        <div className="sim-details">
          <table className="stats">
            <thead>
              <tr>
                <th>Timing</th>
                <th>Average</th>
                <th>Best 1 s</th>
              </tr>
            </thead>
            <tbody>
              {sim.policies.map((x) => (
                <tr key={x.policy} className={x.policy === sim.policy ? 'best' : ''}>
                  <td>{x.label}</td>
                  <td>{fmtCompact(x.avgDps)}</td>
                  <td>{fmtCompact(x.peak1s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="assumptions">
            <li>
              {p.castTime > 0 ? `Cast time ${p.castTime.toFixed(2)} s, ` : 'Instant cast, '}
              recast every {p.cooldown.toFixed(2)} s
              {Math.abs(p.cooldown - p.cooldownFromData) > 0.005 && ` (your setting; the cooldown from the data is ${p.cooldownFromData.toFixed(2)} s)`}, Terra lasts{' '}
              {p.terraDuration.toFixed(1)} s, its DoT lingers {p.dotDuration.toFixed(2)} s
            </li>
            <li>
              Terra Charges: max {p.chargeMax}, {sim.assumptions.terraChargeRestore} s each at +0% restoration speed (unverified), +{p.chargeBonusPct}%
              additional damage per charge consumed (tlidb)
            </li>
            <li>
              Affliction inflicted: {fmtInt(p.afflictionPerSec)} per second (max 100) · Max Focus Blessings: {p.maxFocus} · Reaps: {p.reaps}, Reaping Duration ×
              {p.reapDurationMult.toFixed(2)}
              {sim.assumptions.reapCap === 'dot'
                ? `, each reap capped at the DoT's own ${p.dotDuration.toFixed(2)} s`
                : ", a reap can take whatever the Terra still has to deal (plus its DoT's lingering seconds)"}
            </li>
            {sim.hero && <li>Selena: {heroTraitNote(sim)}</li>}
            {p.illOmenRatio > 0 && (
              <li>
                Ill Omen: the target counts as an Elite, so every {sim.assumptions.illOmenMaxStacks} stacks deal {sim.assumptions.illOmenTrueDmgPct}% of its Max
                Life as True Damage. That works out to {Math.round(p.illOmenRatio * 100)}% on top of the DoT and Reaping damage.
              </li>
            )}
            {Object.entries(sim.mechanics)
              .filter(([, on]) => on)
              .map(([k]) => (
                <li key={k}>From your build: {MECHANIC_LABELS[k] ?? k}</li>
              ))}
            <li>Single target dummy, standing next to you inside the Terra, combat toggles below applied.</li>
          </ul>
        </div>
      )}
    </>
  );
}

const saveScenario = (values) =>
  fetch('/api/scenario', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });

// onSet: where a change goes (the logged character's scenario, or a sample build's)
function ScenarioToggles({ scenario, onSet = saveScenario }) {
  const [busy, setBusy] = useState(false);
  async function set(key, value) {
    setBusy(true);
    try {
      await onSet({ [key]: value });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`toggles ${busy ? 'busy' : ''}`}>
      {scenario.fields.map((f) =>
        f.max != null ? (
          <label key={f.key} className="toggle">
            <span>{f.label}</span>
            <input
              type="number"
              min="0"
              max={f.max}
              value={scenario.values[f.key] ?? 0}
              onChange={(e) => set(f.key, Math.max(0, Math.min(f.max, Number(e.target.value) || 0)))}
            />
          </label>
        ) : (
          <label key={f.key} className="toggle">
            <input type="checkbox" checked={!!scenario.values[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
            <span>{f.label}</span>
          </label>
        ),
      )}
    </div>
  );
}

// sample: a planned build (no dummy readings to compare with; toggles go through onScenario)
export default function DpsPanel({ calc, dummyTests = [], sample = false, onScenario }) {
  if (!calc.engine?.ok) {
    return (
      <Panel title="DPS">
        <p className="note-warn">The calculation engine couldn't run: {calc.engine?.error}</p>
        {calc.engine?.issues?.length > 0 && (
          <ul className="gaps">
            {calc.engine.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
      </Panel>
    );
  }
  const c = calc.dps.combat;
  return (
    <Panel title="DPS" right={calc.mainSkill}>
      {calc.whatIf?.allOn && (
        <p className="note-warn">
          What-if in the Gear, Skills or Divinity slates panel (
          {[
            calc.choices.disabledSkills?.length ? `${calc.choices.disabledSkills.length} skill${calc.choices.disabledSkills.length > 1 ? 's' : ''} off` : null,
            Object.keys(calc.choices.supportSwaps ?? {}).length ? `${Object.keys(calc.choices.supportSwaps).length} support${Object.keys(calc.choices.supportSwaps).length > 1 ? 's' : ''} swapped` : null,
            Object.keys(calc.choices.gearSwaps ?? {}).length ? `${Object.keys(calc.choices.gearSwaps).length} gear slot${Object.keys(calc.choices.gearSwaps).length > 1 ? 's' : ''} changed` : null,
            calc.choices.disabledSlates?.length ? `${calc.choices.disabledSlates.length} slate${calc.choices.disabledSlates.length > 1 ? 's' : ''} off` : null,
            Object.keys(calc.choices.slateLayout ?? {}).length ? 'board changed' : null,
          ]
            .filter(Boolean)
            .join(', ')}
          ). As logged: {fmtCompact(calc.whatIf.allOn.avgDps ?? calc.whatIf.allOn.combat)} average
          {calc.whatIf.allOn.peak5s ? `, ${fmtCompact(calc.whatIf.allOn.peak5s)} best 5 s` : ''}; now{' '}
          {fmtCompact(calc.sim?.supported ? calc.sim.avgDps : calc.dps?.combat?.total)}
          {(() => {
            const now = calc.sim?.supported ? calc.sim.avgDps : calc.dps?.combat?.total;
            const base = calc.whatIf.allOn.avgDps ?? calc.whatIf.allOn.combat;
            if (!(base > 0) || now == null) return null;
            const p = (now / base - 1) * 100;
            return (
              <>
                {' '}
                <b className={p >= 0 ? 'dps-up' : 'dps-down'}>
                  ({p >= 0 ? '+' : '−'}
                  {Math.abs(p).toFixed(1)}%)
                </b>
              </>
            );
          })()}
          .
        </p>
      )}
      <h3 className="sub-h first">In-game simulation</h3>
      <Simulation sim={calc.sim} />
      {!sample && <MeasuredDps sim={calc.sim} manual={calc.choices?.measuredDps ?? null} dummyTests={dummyTests} />}

      <h3 className="sub-h">Formula (tooltip-style)</h3>
      {c ? (
        <div className="kvs">
          <Row label="Total" value={c.total} />
          <Row label="Persistent damage per second" value={c.persistent} />
          <Row label="Reaping" value={c.reap} />
          <Row label="Spell hits" value={c.spell} />
          <Row label="Spell Burst" value={c.spellBurst} />
          <Row label="Ingenuity Overload" value={c.overload} />
          <Row label="Attacks" value={c.attack} />
          <Row label="Average hit" value={c.avgHit} />
          <Row label="Sheet (always-on effects only)" value={calc.dps.sheet?.total} />
        </div>
      ) : (
        <p className="muted small">No damage model for {calc.mainSkill ?? 'this skill'} in the engine yet.</p>
      )}
      {calc.dps.otherSkills.length > 0 && (
        <div className="kvs other">
          {calc.dps.otherSkills.map((s) => (
            <Row key={s.name} label={s.name} value={s.total} />
          ))}
        </div>
      )}

      <h3 className="sub-h">Combat toggles</h3>
      <p className="muted small">
        {sample ? 'These start on when the build mentions them.' : "The log can't tell whether these are active, so they start on when your build mentions them."} Both
        numbers above use them.
      </p>
      <ScenarioToggles scenario={calc.scenario} onSet={onScenario} />
      {calc.missing.length > 0 && (
        <>
          <h3 className="sub-h">Not included yet</h3>
          <ul className="gaps">
            {calc.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
