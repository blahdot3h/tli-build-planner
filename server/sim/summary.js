// Fight summary from damage per 0.1 s bin: average, steady state (last 10 s), best 1 s and 5 s
// windows, ramp-up time (trailing 1 s window reaching 90% of steady state) and a 0.5 s timeline.
export function summarize(bins, duration) {
  const total = bins.reduce((s, v) => s + v, 0);
  const bestWindow = (n) => {
    let best = 0;
    let sum = 0;
    for (let i = 0; i < bins.length; i++) {
      sum += bins[i] - (i >= n ? bins[i - n] : 0);
      if (i >= n - 1) best = Math.max(best, sum);
    }
    return best / (n / 10);
  };

  const tail = Math.min(100, bins.length);
  const steadyDps = bins.slice(bins.length - tail).reduce((s, v) => s + v, 0) / (tail / 10);

  let rampSeconds = null;
  let sum = 0;
  for (let i = 0; i < bins.length; i++) {
    sum += bins[i] - (i >= 10 ? bins[i - 10] : 0);
    if (i >= 9 && sum >= steadyDps * 0.9) {
      rampSeconds = (i + 1) / 10;
      break;
    }
  }

  const timeline = [];
  for (let i = 0; i < bins.length; i += 5) timeline.push({ t: i / 10, dps: bins.slice(i, i + 5).reduce((s, v) => s + v, 0) * 2 });

  return { avgDps: total / duration, steadyDps, peak1s: bestWindow(10), peak5s: bestWindow(50), rampSeconds, timeline };
}

// Seeded random numbers, so the same build gives the same result every time
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Fights with random parts (recast timing, crits) are run with these seeds and averaged
export const FIGHT_SEEDS = [1, 2, 3, 4, 5];

// The mean of several fights' numbers (breakdown entries too); the timeline is the first fight's.
// The best 1 s and 5 s windows are the best over all the fights, not their mean: the dummy's
// "Highest DPS in 5s" is the single best window of a whole run (five 60 s fights stand in for a
// 5-minute one)
export function averageFights(fights) {
  const [first] = fights;
  if (fights.length === 1) return first;
  const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;
  const out = { ...first };
  for (const [key, value] of Object.entries(first)) {
    if (typeof value === 'number') {
      const values = fights.map((f) => f[key]).filter((v) => typeof v === 'number');
      out[key] = key === 'casts' || key === 'spiritCasts' ? Math.round(mean(values)) : key === 'peak1s' || key === 'peak5s' ? Math.max(...values) : mean(values);
    }
  }
  const ramps = fights.map((f) => f.rampSeconds).filter((v) => v != null);
  out.rampSeconds = ramps.length ? mean(ramps) : null;
  if (first.breakdown) out.breakdown = Object.fromEntries(Object.keys(first.breakdown).map((k) => [k, mean(fights.map((f) => f.breakdown[k] ?? 0))]));
  return out;
}
