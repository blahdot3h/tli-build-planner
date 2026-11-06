import { fmtCompact } from '../format.js';

// A DPS change against a baseline, green for a gain and red for a loss
export default function Delta({ value, base, pct = true }) {
  if (value == null || !(base > 0)) return null;
  const d = value - base;
  if (Math.abs(d) < base * 1e-6) return <span className="muted">±0</span>;
  const p = (d / base) * 100;
  return (
    <span className={d > 0 ? 'dps-up' : 'dps-down'} title={`${d > 0 ? '+' : '−'}${fmtCompact(Math.abs(d))}`}>
      {d > 0 ? '+' : '−'}
      {fmtCompact(Math.abs(d))}
      {pct && ` (${d > 0 ? '+' : '−'}${Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}%)`}
    </span>
  );
}

// The build's average DPS now and as logged, from a calc with a what-if in it
export function nowAndBase(calc) {
  const now = calc?.sim?.supported ? calc.sim.avgDps : calc?.dps?.combat?.total;
  const allOn = calc?.whatIf?.allOn;
  const base = allOn ? (allOn.avgDps ?? allOn.combat) : null;
  return { now, base };
}
