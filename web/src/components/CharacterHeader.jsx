import { useCallback, useEffect, useState } from 'react';
import { fmtCompact, fmtDateTime, fmtInt, fmtPct, fmtTime, latestReading, nameOr } from '../format.js';

// The character logged in follows logins (playerId null); any other loads live from this log or
// from its newest snapshot
async function select(playerId, snapshotId = null) {
  await fetch('/api/select', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, snapshotId }),
  });
}

function CharacterSwitch({ characters }) {
  if (!characters?.length) return null;
  const viewed = characters.find((c) => c.viewed);
  const pick = (playerId) => select(characters.find((c) => c.playerId === playerId)?.current ? null : playerId);
  return (
    <select className="char-switch" value={viewed?.playerId ?? ''} onChange={(e) => pick(e.target.value)} title="Load another character">
      {characters.map((c) => (
        <option key={c.playerId} value={c.playerId}>
          {c.name} · Lv {c.level}
          {c.current ? ' (logged in)' : c.inLog ? ` (this session, ${fmtTime(c.lastSeenAt)})` : ` (last seen ${fmtDateTime(c.lastSeenAt)})`}
        </option>
      ))}
    </select>
  );
}

const MAX_CHANGES = 2;

function snapshotLabel(s) {
  const dps = s.avgDps ? ` · ${fmtCompact(s.avgDps)} then` : '';
  if (s.reason === 'saved') return `★ ${s.label ?? 'Saved build'} · ${fmtDateTime(s.takenAt)}${dps}`;
  const changes = s.changes.length > MAX_CHANGES ? [...s.changes.slice(0, MAX_CHANGES), `+${s.changes.length - MAX_CHANGES} more`] : s.changes;
  const what = s.reason === 'login' ? 'login' : changes.join(', ') || 'gear change';
  return `${fmtDateTime(s.takenAt)} · ${what}${dps}`;
}

// The character live from the log, or one of its snapshots (login, gear change, saved build)
function SnapshotSwitch({ character, entry }) {
  const playerId = String(character.player.playerId);
  const { view } = character;
  const [list, setList] = useState([]);
  const load = useCallback(async () => {
    const res = await fetch(`/api/snapshots?playerId=${encodeURIComponent(playerId)}`);
    if (res.ok) setList(await res.json());
  }, [playerId]);
  useEffect(() => {
    load();
  }, [load, view.snapshotId]);

  const pick = (value) => (value === 'live' ? select(entry?.current ? null : playerId) : select(playerId, value));
  return (
    <div className="view-bar">
      <select className="snapshot-switch" value={view.live ? 'live' : view.snapshotId} onChange={(e) => pick(e.target.value)} onFocus={load} title="Snapshots of this character">
        {entry?.inLog && <option value="live">Live from the game log</option>}
        {!view.live && !list.some((s) => s.id === view.snapshotId) && <option value={view.snapshotId}>{fmtDateTime(view.takenAt)}</option>}
        {list.map((s) => (
          <option key={s.id} value={s.id}>
            {snapshotLabel(s)}
          </option>
        ))}
      </select>
      <SaveBuild onSaved={load} />
    </div>
  );
}

// Saves what's shown, with the combat toggles and picks; loading it brings those back
function SaveBuild({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const body = await res.json();
      if (!res.ok) return setMessage(body.error ?? 'Saving failed');
      setMessage(`Saved${label.trim() ? ` “${label.trim()}”` : ''}`);
      setOpen(false);
      setLabel('');
      await onSaved();
    } catch (err) {
      setMessage(`Saving failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        <button
          onClick={() => {
            setOpen(true);
            setMessage(null);
          }}
          title="Save this character with its combat toggles and picks"
        >
          Save build…
        </button>
        {message && <span className="muted small">{message}</span>}
      </>
    );
  }
  return (
    <form className="save-build" onSubmit={save}>
      <input autoFocus maxLength={80} placeholder="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <button className="primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}

const REASONS = { login: 'login', 'gear-change': 'gear change', saved: 'saved build' };

function ViewNote({ character, entry }) {
  const { view, loginAt } = character;
  if (view.live) return <div className="muted small">Character data from login at {fmtTime(loginAt)}, plus live gear changes since</div>;
  const what = view.reason === 'saved' ? `saved build${view.label ? ` “${view.label}”` : ''}` : REASONS[view.reason] ?? view.reason;
  return (
    <div className="muted small">
      Snapshot from {fmtDateTime(view.takenAt)} ({what}), recalculated with today's planner and this character's toggles.{' '}
      {entry?.inLog ? 'Pick “Live” to go back to the game.' : 'Not in the current game log.'}
    </div>
  );
}

// The game's own DPS figure: computed whenever you hover an item, written to the log with the
// item compare. HistoryMaxDps in the character data is the highest that figure has been.
function GameSheetCard({ gameStats, recorded }) {
  const dps = gameStats?.dps;
  const peak = recorded.historyMaxDps;
  return (
    <div className="dps-card subtle">
      <div className="dps-k">Game's sheet DPS</div>
      <div className="dps-v" title={dps ? fmtInt(dps.value) : ''}>{dps ? fmtCompact(dps.value) : '—'}</div>
      <div className="dps-note">
        {dps ? `Logged by the game at ${fmtTime(dps.at)} when you compared an item` : 'Hover an item in game and the game logs it'}
        {gameStats?.def && ` · DEF ${fmtInt(gameStats.def.value)}`}
        {peak != null && ` · highest ever ${fmtCompact(peak)}`}
      </div>
    </div>
  );
}

export default function CharacterHeader({ character, characters }) {
  const { player, calc, recorded, gameStats } = character;
  const sim = calc.sim?.supported ? calc.sim : null;
  const combat = calc.dps?.combat?.total;
  const reading = latestReading(character.dummyTests);
  const heroName = calc.choices?.hero?.name ?? calc.choices?.heroInferred?.name ?? player.heroName;
  const entry = characters?.find((c) => c.playerId === String(player.playerId));
  return (
    <section className="char">
      <div className="char-id">
        <div className="char-title">
          <h1>{player.name}</h1>
          <CharacterSwitch characters={characters} />
        </div>
        <div className="char-sub">
          <span>Level {player.level}</span>
          <span>{heroName ?? `Hero ${nameOr(null, player.heroId)}`}</span>
          <span>Season #{player.seasonId}</span>
          {!character.view.live && <span className="pill warn">Snapshot</span>}
        </div>
        <ViewNote character={character} entry={entry} />
        <SnapshotSwitch character={character} entry={entry} />
      </div>
      <div className="dps-cards">
        <div className="dps-card">
          <div className="dps-k">In-game DPS (simulated) · {calc.mainSkill ?? 'no skill'}</div>
          <div className="dps-v" title={sim ? fmtInt(sim.avgDps) : ''}>{sim ? fmtCompact(sim.avgDps) : '—'}</div>
          <div className="dps-note">
            {sim
              ? `Average over a ${sim.assumptions.duration} s dummy fight · best second ${fmtCompact(sim.peak1s)}`
              : (calc.sim?.reason ?? (calc.engine?.ok ? 'No simulation for this skill yet' : `Engine error: ${calc.engine?.error}`))}
          </div>
          {sim && reading && (
            <div className="dps-note">
              Best 5 s {fmtCompact(sim.peak5s)} vs your dummy's {fmtCompact(reading.reading)} ({fmtPct(sim.peak5s, reading.reading)})
            </div>
          )}
        </div>
        <div className="dps-card subtle">
          <div className="dps-k">Formula DPS</div>
          <div className="dps-v" title={combat != null ? fmtInt(combat) : ''}>{combat != null ? fmtCompact(combat) : '—'}</div>
          <div className="dps-note">Tooltip-style: steady state with the combat toggles, no timing</div>
        </div>
        <GameSheetCard gameStats={gameStats} recorded={recorded} />
      </div>
    </section>
  );
}
