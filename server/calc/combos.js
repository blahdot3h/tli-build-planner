// Exhaustive combination search, used to compare gear-like choices (pactspirit trios) by DPS.

// Every size-k combination of items, in order
export function* combinations(items, k, start = 0, prefix = []) {
  if (prefix.length === k) {
    yield prefix;
    return;
  }
  for (let i = start; i <= items.length - (k - prefix.length); i++) yield* combinations(items, k, i + 1, [...prefix, items[i]]);
}

export function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

// Scores every combination and keeps the best `keep`. Yields to the event loop now and then so a
// long search doesn't stall the server. A null score ranks last.
export async function rankCombos(items, k, score, { keep = 10, yieldEvery = 50, onProgress } = {}) {
  const top = [];
  const total = binomial(items.length, k);
  let evaluated = 0;
  for (const combo of combinations(items, k)) {
    const value = score(combo) ?? -Infinity;
    if (top.length < keep || value > top[top.length - 1].value) {
      top.push({ items: combo, value });
      top.sort((a, b) => b.value - a.value);
      if (top.length > keep) top.pop();
    }
    if (++evaluated % yieldEvery === 0) {
      onProgress?.(evaluated, total);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  onProgress?.(evaluated, total);
  return { top, evaluated };
}
