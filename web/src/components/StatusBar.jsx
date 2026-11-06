import { useState } from 'react';
import { ago, fmtBytes, fmtInt, fmtTime } from '../format.js';

function logState(status, connected, now) {
  if (!connected) return { tone: 'bad', label: 'Server offline', detail: 'Reconnecting…' };
  if (!status) return { tone: 'warn', label: 'Connecting', detail: '' };
  if (!status.logPath) return { tone: 'bad', label: 'Log not found', detail: 'Set TLI_LOG_PATH in .env' };
  if (!status.fileExists) return { tone: 'warn', label: 'Waiting for log', detail: 'Start the game with logging enabled' };
  const read = `${fmtInt(status.lines)} lines read · newest game line ${fmtTime(status.lastGameTime)} (${ago(status.lastGameTime, now)})`;
  return status.gameWriting
    ? { tone: 'good', label: 'Reading log · live', detail: read }
    : { tone: 'warn', label: 'Log idle', detail: `${read} · game isn't writing right now` };
}

export default function StatusBar({ status, connected, now, onRescanned }) {
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const log = logState(status, connected, now);
  const tables = Object.keys(status?.gamedata ?? {}).length;

  async function post(path) {
    const res = await fetch(path, { method: 'POST' });
    return res.json();
  }

  async function runCheck() {
    setBusy(true);
    try {
      setCheck({ ...(await post('/api/check')), at: Date.now() });
    } catch (err) {
      setCheck({ ok: false, message: `Planner server unreachable: ${err.message}`, at: Date.now() });
    } finally {
      setBusy(false);
    }
  }

  async function rescan() {
    setBusy(true);
    try {
      await post('/api/rescan');
      await onRescanned();
      setCheck({ ...(await post('/api/check')), at: Date.now() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          TLI <span>Build Planner</span>
        </div>
        <span className={`pill ${log.tone}`}>
          <span className="dot" />
          {log.label}
        </span>
        <span className="topbar-detail">{log.detail}</span>
        <span className="spacer" />
        <span className={`pill ${status?.db?.ok ? 'good' : 'bad'}`} title={status?.db?.error ?? ''}>
          MongoDB {status?.db?.ok ? status.db.dbName : 'offline'}
        </span>
        <span className={`pill ${tables ? 'good' : 'warn'}`}>Game data: {tables ? `${tables} tables` : 'not loaded'}</span>
        <button className="primary" onClick={runCheck} disabled={busy}>
          {busy ? 'Checking…' : 'Test log connection'}
        </button>
      </header>
      {check && <CheckResult check={check} now={now} busy={busy} onRescan={rescan} onClose={() => setCheck(null)} />}
    </>
  );
}

function CheckResult({ check, now, busy, onRescan, onClose }) {
  return (
    <div className={`check ${check.ok ? 'good' : 'bad'}`}>
      <div className="check-title">
        <strong>{check.ok ? '✓ Log connection confirmed' : '✗ Log connection problem'}</strong>
        <span className="muted">checked {ago(check.at, now)}</span>
      </div>
      <p>{check.message}</p>
      {check.fileExists && (
        <dl className="check-details">
          <dt>File</dt>
          <dd>
            <code>{check.logPath}</code> · {fmtBytes(check.fileSize)}
          </dd>
          <dt>Newest game line</dt>
          <dd>
            {fmtTime(check.lastGameTime)} · <code>{check.lastGameLine}</code>
          </dd>
          <dt>This check</dt>
          <dd>
            {fmtInt(check.newLines)} new lines read ·{' '}
            {check.gameWriting ? 'the game is writing to the log' : "the game hasn't written to the log in the last 30s"}
          </dd>
          <dt>Character</dt>
          <dd>
            {check.character
              ? `${check.character.name}, data from login at ${fmtTime(check.character.loginAt)}`
              : 'no login in this log yet'}
          </dd>
        </dl>
      )}
      <div className="check-actions">
        <button onClick={onRescan} disabled={busy}>
          Re-read log from start
        </button>
        <button onClick={onClose}>Dismiss</button>
      </div>
    </div>
  );
}
