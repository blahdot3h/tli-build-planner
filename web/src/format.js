export const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString());

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
export const fmtCompact = (n) => (n == null ? '—' : compact.format(n));

export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString() : '—');

// "Oct 13, 11:53 PM": for snapshots, which can be days old
export const fmtDateTime = (ms) =>
  ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export function ago(ms, now) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

// Names come from game data tables; until those exist, show the game's numeric id
export const nameOr = (name, id) => name ?? `#${id}`;

export const baseName = (name, baseId) => name ?? `Base #${baseId}`;

export const fmtValues = (values) => values.map((v) => (Number.isInteger(v) ? v : +v.toFixed(2))).join(' / ');

export const baseIdOf = (itemId) => String(itemId).split('_')[0];

export const rarityLabel = (r) => (r == null ? null : r === 100 ? 'Legendary' : `Rarity ${r}`);

// "110M", "110 mil", "1.2b", "850k", "110000000"
export function parseDps(text) {
  const m = /^\s*([\d.,]+)\s*(k|m|mil|million|b|bil|billion)?\s*$/i.exec(text ?? '');
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  const unit = (m[2] ?? '').toLowerCase();
  const mult = unit.startsWith('b') ? 1e9 : unit.startsWith('m') ? 1e6 : unit === 'k' ? 1e3 : 1;
  return Number.isFinite(n) && n > 0 ? n * mult : null;
}

// 65 -> "1m 05s", 7 -> "7 s"
export const fmtDuration = (seconds) =>
  seconds < 60 ? `${Math.round(seconds)} s` : `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;

export const fmtPct = (part, whole) => {
  const pct = (100 * part) / whole;
  return `${pct.toFixed(pct < 1 ? 2 : pct < 10 ? 1 : 0)}%`;
};

// The latest dummy session with a reading typed in
export const latestReading = (tests) => (tests ?? []).find((t) => t.reading != null) ?? null;
