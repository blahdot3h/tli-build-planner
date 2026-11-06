import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinations, binomial, rankCombos } from '../server/calc/combos.js';

test('combinations yields every k-subset once, in order', () => {
  assert.deepEqual([...combinations(['a', 'b', 'c', 'd'], 3)], [
    ['a', 'b', 'c'],
    ['a', 'b', 'd'],
    ['a', 'c', 'd'],
    ['b', 'c', 'd'],
  ]);
  assert.equal([...combinations(Array.from({ length: 20 }, (_, i) => i), 3)].length, binomial(20, 3));
});

test('rankCombos finds the best trio, including one the single-pet ranking would miss', async () => {
  // Bonuses multiply like "additional damage"; D and E together unlock an extra 30%
  const bonus = { A: 1.3, B: 1.25, C: 1.2, D: 1.1, E: 1.05 };
  const synergy = (combo) => (combo.includes('D') && combo.includes('E') ? 1.3 : 1);
  const score = (combo) => combo.reduce((p, k) => p * bonus[k], 1) * synergy(combo);

  const { top, evaluated } = await rankCombos(Object.keys(bonus), 3, score, { keep: 3, yieldEvery: 2 });
  assert.equal(evaluated, 10);
  // 1.3 × 1.1 × 1.05 × 1.3 ≈ 1.952 edges out the three best singles, A × B × C = 1.95
  assert.deepEqual(top[0].items, ['A', 'D', 'E']);
  assert.deepEqual(top[1].items, ['A', 'B', 'C']);
  assert.equal(top.length, 3);
});

test('rankCombos ranks failed scores last', async () => {
  const { top } = await rankCombos(['x', 'y', 'z'], 2, (c) => (c.includes('z') ? null : 5), { keep: 3 });
  assert.deepEqual(top[0].items, ['x', 'y']);
  assert.equal(top.at(-1).value, -Infinity);
});
