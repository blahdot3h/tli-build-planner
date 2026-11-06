import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import Icon, { ItemIcon } from './Icon.jsx';
import { AffixList } from './Equipment.jsx';
import Delta from './Delta.jsx';
import { baseName, fmtCompact, nameOr, rarityLabel } from '../format.js';

const saveChoices = (values) =>
  fetch('/api/choices', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });

function SkillChip({ skill, main }) {
  return (
    <span className={`chip with-icon ${main ? 'main' : ''} ${skill.activating ? 'on' : ''}`} title={skill.tip ?? skill.name ?? skill.id}>
      <Icon src={skill.icon} name={skill.name} width={main ? 28 : 22} />
      {nameOr(skill.name, skill.baseId)}
      {skill.level != null && <small>Lv {skill.level}</small>}
    </span>
  );
}

// One support slot's what-if: a list of every support that fits the skill to pick from (the DPS
// recomputes at once), and "Compare every support here" for the DPS with each one in a table
function SupportCompare({ panel, swaps, onSwap, onClose, calc }) {
  const [list, setList] = useState(null);
  const [result, setResult] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  const { key } = panel;
  const swap = swaps[key];
  useEffect(() => {
    let gone = false;
    setList(null);
    setResult(null);
    setState('loading');
    setError(null);
    fetch('/api/skills/supports/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...panel, listOnly: true }) })
      .then(async (res) => {
        const body = await res.json();
        if (gone) return;
        if (!res.ok) setError(body.error ?? 'Not available');
        else setList(body);
        setState('idle');
      })
      .catch((err) => !gone && setError(err.message));
    return () => {
      gone = true;
    };
  }, [key]);
  const compare = async () => {
    setState('comparing');
    setError(null);
    try {
      const res = await fetch('/api/skills/supports/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(panel) });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? 'Not available');
      else setResult(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setState('idle');
    }
  };
  const now = calc?.sim?.supported ? calc.sim.avgDps : calc?.dps?.combat?.total;
  const asLogged = calc?.whatIf?.allOn ? (calc.whatIf.allOn.avgDps ?? calc.whatIf.allOn.combat) : null;
  const chosen = key in swaps ? (swap?.name ?? '') : (list?.logged ?? '');
  return (
    <div className="support-compare" onClick={(e) => e.stopPropagation()}>
      <div className="support-compare-head">
        <strong>
          {list?.skill ?? panel.kind} · support {panel.index + 1}
        </strong>
        <span className="muted small">logged: {list?.logged ?? 'empty'}</span>
        <select value={chosen} disabled={!list || state === 'comparing'} onChange={(e) => onSwap(key, e.target.value ? { name: e.target.value } : null)}>
          <option value="">(none)</option>
          {(list?.candidates ?? []).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
              {c.special ? ' ★' : ''}
            </option>
          ))}
        </select>
        {key in swaps && (
          <button className="link" onClick={() => onSwap(key, undefined)}>
            back to logged
          </button>
        )}
        <button onClick={compare} disabled={!list || state === 'comparing'}>
          {state === 'comparing' ? `Comparing ${list?.candidates?.length ?? ''} supports…` : 'Compare every support here'}
        </button>
        <button className="link" onClick={onClose}>
          close
        </button>
        {key in swaps && asLogged > 0 && now != null && (
          <span>
            Build now {fmtCompact(now)} vs {fmtCompact(asLogged)} as logged: <Delta value={now} base={asLogged} />
          </span>
        )}
        {error && <span className="note-warn small">{error}</span>}
      </div>
      {result && (
        <table>
          <thead>
            <tr>
              <th>Support in this slot</th>
              <th className="num">Average DPS</th>
              <th className="num">Change</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.name ?? '(none)'} className={r.name === result.logged ? 'current' : ''}>
                <td>
                  <span className="with-icon">
                    {r.icon && <Icon src={r.icon} name={r.name} width={18} />}
                    {r.name ?? '(none)'}
                    {r.special ? ' ★' : ''}
                    {r.name === result.logged ? ' (logged)' : ''}
                  </span>
                </td>
                <td className="num">{fmtCompact(r.dps)}</td>
                <td className="num">
                  <Delta value={r.dps} base={result.base} />
                </td>
                <td>
                  {r.name !== result.logged && (
                    <button className="link" onClick={() => onSwap(key, r.name ? { name: r.name } : null)}>
                      use
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// kind: 'active' | 'passive'; off: the keys ("active:1") switched off in the what-if; shares: what
// each skill adds, once computed ({ key -> { without, share, off } }); swaps: the support slots
// swapped in the what-if; panel: the support slot whose comparison is open
function SkillGroups({ title, kind, groups, off, onToggle, shares, swaps, panel, onOpen, onSwap, onClose, calc }) {
  return (
    <div className="skill-col">
      <h3>{title}</h3>
      {groups.map((g) => {
        const key = `${kind}:${g.slot}`;
        const isOff = off.has(key);
        const share = shares?.get(key);
        const open = panel?.kind === kind && panel?.slot === g.slot;
        return (
          <div className={`skill-row ${isOff ? 'off' : ''}`} key={g.slot}>
            {g.skill && (
              <input
                type="checkbox"
                className="skill-switch"
                checked={!isOff}
                title={isOff ? 'Switched off in the what-if: tick to count it again' : 'What-if: untick to see the DPS without this skill (your build in game is unchanged)'}
                onChange={() => onToggle(key, isOff)}
              />
            )}
            {g.skill ? <SkillChip skill={g.skill} main /> : <span className="chip empty-chip">Empty</span>}
            {g.skill && (
              <div className="supports">
                {g.supports.map((s, i) => (
                  <span key={`${s.id ?? s.name}-${i}`} className={`chip with-icon pick ${s.swapped ? 'swapped' : ''}`} title={`${s.swapped ? `What-if: ${s.was ?? 'empty'} swapped for ${s.name}. ` : ''}Click to try another support here`} onClick={() => onOpen({ kind, slot: g.slot, index: i, key: `${kind}:${g.slot}:${i}` })}>
                    <Icon src={s.icon} name={s.name} width={22} />
                    {nameOr(s.name, s.baseId)}
                    {s.level != null && !s.swapped && <small>Lv {s.level}</small>}
                    {s.swapped && <small>what-if</small>}
                  </span>
                ))}
                {g.supports.length < 5 && (
                  <span className="chip add-support" title="What-if: try a support in this empty slot" onClick={() => onOpen({ kind, slot: g.slot, index: g.supports.length, key: `${kind}:${g.slot}:${g.supports.length}` })}>
                    + support
                  </span>
                )}
              </div>
            )}
            {share && (
              <span className={`skill-share ${share.off ? 'muted' : ''}`} title={share.off ? 'Switched off' : `Without ${g.skill.name}: ${fmtCompact(share.without)} average`}>
                {share.off ? 'off' : share.share == null ? '' : `${share.share >= 0 ? '−' : '+'}${Math.abs(share.share * 100).toFixed(share.share * 100 < 10 ? 1 : 0)}% without`}
              </span>
            )}
            {open && <SupportCompare panel={panel} swaps={swaps} onSwap={onSwap} onClose={onClose} calc={calc} />}
          </div>
        );
      })}
    </div>
  );
}

// What-if: any skill can be switched off (choices.disabledSkills) and the DPS is recomputed without
// it; "What each skill adds" computes the figure without each one in turn; any support slot can be
// given another support (choices.supportSwaps) or compared across every support that fits
export function Skills({ skills, calc }) {
  const shown = calc?.used?.skills ?? skills;
  const disabled = calc?.choices?.disabledSkills ?? [];
  const swaps = calc?.choices?.supportSwaps ?? {};
  const off = new Set(disabled);
  const [busy, setBusy] = useState(false);
  const [shares, setShares] = useState(null);
  const [panel, setPanel] = useState(null);
  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      setShares(null);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (key, turnOn) => act(() => saveChoices({ disabledSkills: turnOn ? disabled.filter((k) => k !== key) : [...disabled, key] }));
  // value: { name } to swap in, null for none, undefined to go back to what's logged
  const swapSupport = (key, value) =>
    act(() => {
      const next = { ...swaps };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return saveChoices({ supportSwaps: next });
    });
  const compute = () =>
    act(async () => {
      const res = await fetch('/api/skills/contributions', { method: 'POST' });
      const body = await res.json();
      if (res.ok) setShares(new Map(body.rows.map((r) => [r.key, r])));
    });
  const now = calc?.sim?.supported ? calc.sim.avgDps : calc?.dps?.combat?.total;
  const allOn = calc?.whatIf?.allOn;
  const base = allOn ? (allOn.avgDps ?? allOn.combat) : null;
  const swapCount = Object.keys(swaps).length;
  const groupProps = { off, onToggle: toggle, shares, swaps, panel, onOpen: setPanel, onSwap: swapSupport, onClose: () => setPanel(null), calc };
  return (
    <Panel
      title="Skills"
      right={
        calc?.engine?.ok ? (
          <span className="panel-actions">
            {swapCount > 0 && (
              <button className="link" onClick={() => act(() => saveChoices({ supportSwaps: {} }))} disabled={busy}>
                supports back to logged
              </button>
            )}
            <button className="link" onClick={compute} disabled={busy}>
              {busy ? 'Working…' : shares ? 'Recompute what each skill adds' : 'What each skill adds'}
            </button>
          </span>
        ) : (
          'main skill → supports'
        )
      }
    >
      <p className="muted small">
        Untick a skill to see the DPS without it; click a support to try another one there, or compare every support that fits. All of it is a what-if: nothing
        changes in game.
        {(off.size > 0 || swapCount > 0) && base > 0 && now != null && (
          <>
            {' '}
            <b>
              {[off.size > 0 ? `${off.size} off` : null, swapCount > 0 ? `${swapCount} support${swapCount > 1 ? 's' : ''} swapped` : null].filter(Boolean).join(', ')}:{' '}
              {fmtCompact(now)} average vs {fmtCompact(base)} as logged, <Delta value={now} base={base} />.
            </b>
          </>
        )}
      </p>
      <div className={`skills ${busy ? 'busy' : ''}`}>
        <SkillGroups title="Active" kind="active" groups={shown.active} {...groupProps} />
        <SkillGroups title="Passive" kind="passive" groups={shown.passive} {...groupProps} />
      </div>
    </Panel>
  );
}

// hero: the picked or inferred hero ({ name, traits: { slot: name }, levels: { name: level } }), whose
// trait names the log doesn't have
export function HeroPanel({ traits, memories, hero }) {
  const named = hero?.traits ? Object.values(hero.traits).filter(Boolean) : [];
  return (
    <Panel title="Hero traits & memories" right={hero?.name ?? null}>
      <div className="chips">
        {named.length ? (
          named.map((name) => (
            <span key={name} className="chip on">
              {name}
              {hero.levels?.[name] != null && <small>Lv {hero.levels[name]}</small>}
            </span>
          ))
        ) : traits.length ? (
          traits.map((t) => (
            <span key={t.id} className="chip on with-icon">
              <Icon src={t.icon} name={t.name} width={28} />
              {nameOr(t.name, t.id)}
              {t.slot != null && <small>slot {t.slot}</small>}
            </span>
          ))
        ) : (
          <span className="muted">No traits in the login data</span>
        )}
      </div>
      {memories.map((m) => (
        <div className="memory" key={m.slot}>
          <div className="memory-head">
            <span className="with-icon">
              <ItemIcon item={m.item} width={28} />
              Memory {m.slot}
            </span>
            <span className="muted">
              {baseName(m.item.name, m.item.baseId)} · Lv {m.item.level}
              {m.state ? ` · ${m.state}` : ''}
            </span>
          </div>
          <AffixList affixes={m.item.affixes} />
        </div>
      ))}
    </Panel>
  );
}

export function Slates({ slates }) {
  if (!slates.length) return null;
  return (
    <Panel title="Slates" right={`${slates.length} placed`}>
      {slates.map((s) => (
        <div className="slate" key={s.id}>
          <div className="memory-head">
            <span className="with-icon">
              <ItemIcon item={s} width={28} />
              {baseName(s.name, s.baseId)}
            </span>
            <span className="muted">
              Lv {s.level}
              {rarityLabel(s.rarity) ? ` · ${rarityLabel(s.rarity)}` : ''}
            </span>
          </div>
          <div className="chips">
            {s.talents.map((t, i) => (
              <span key={`${t.id}-${i}`} className="chip with-icon" title={[t.name, t.tree].filter(Boolean).join(' · ') || `#${t.id}`}>
                {t.icon && <Icon src={t.icon} name={t.name} width={22} />}
                {t.text ?? nameOr(t.name, t.id)}
                {t.effectPct > 0 && <small className="muted"> +{t.effectPct}%</small>}
              </span>
            ))}
          </div>
        </div>
      ))}
    </Panel>
  );
}

export function Pactspirits({ pactspirits }) {
  if (!pactspirits.length) return null;
  return (
    <Panel title="Pactspirits">
      <div className="chips">
        {pactspirits.map((p) => (
          <span key={`${p.area}-${p.id}`} className="chip with-icon">
            {p.icon && <Icon src={p.icon} name={p.name} width={20} height={33} className="pet" />}
            {nameOr(p.name, p.id)}
            {p.stars != null && <small>{'★'.repeat(p.stars)}</small>}
          </span>
        ))}
      </div>
    </Panel>
  );
}
