import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../server/sim/summary.js';
import { rehanModel } from '../server/sim/rehan.js';
import { rehanFight, ATTACK_SIM_DEFAULTS } from '../server/sim/attack.js';
import { selenaModel, SELENA_HERO } from '../server/sim/selena.js';
import { inferHero } from '../server/engine/bridge.js';
import { SAGE_HERO, sageIngredientLines, sageNotes } from '../server/sim/sage.js';
import { spellFight, SPELL_SIM_DEFAULTS } from '../server/sim/spell.js';

const SEETHING = 'Berserker Rehan: Seething Silhouette (#2)';
const attackParams = { castsPerSec: 2, damagePerCast: 1000, incAspdPct: 100 };

// bins are damage per 0.1 s
const bins = (perSecond, seconds) => new Float64Array(seconds * 10).fill(perSecond / 10);

test('steady damage: average, steady state and peaks all match', () => {
  const s = summarize(bins(1000, 30), 30);
  assert.equal(Math.round(s.avgDps), 1000);
  assert.equal(Math.round(s.steadyDps), 1000);
  assert.equal(Math.round(s.peak1s), 1000);
  assert.equal(Math.round(s.peak5s), 1000);
  assert.equal(s.rampSeconds, 1);
  assert.equal(s.timeline.length, 60);
});

test('ramp-up and a burst are reported separately from the average', () => {
  const b = bins(1000, 30);
  for (let i = 0; i < 30; i++) b[i] = 0; // nothing for the first 3 s
  for (let i = 100; i < 110; i++) b[i] = 500; // a 1 s burst worth 5000 DPS at 10 s
  const s = summarize(b, 30);
  assert.equal(s.rampSeconds, 3.9); // the trailing 1 s window first reaches 90% at 3.9 s
  assert.equal(Math.round(s.peak1s), 5000);
  assert.equal(Math.round(s.steadyDps), 1000);
  assert.ok(s.avgDps < s.steadyDps * 1.2 && s.avgDps > s.steadyDps);
});

test("Seething Silhouette with Fury's Onslaught and Growing Anger stays in Berserk with the spirit out", () => {
  const traits = { level1: 'Seething Silhouette', level45: "Fury's Onslaught", level60: 'Growing Anger', level75: 'Rage Infusion' };
  const m = rehanModel({ name: SEETHING, traits }, []);
  assert.equal(m.berserkAddnPct, 32); // level 3 when the engine reports no levels
  const s = rehanFight({ ...ATTACK_SIM_DEFAULTS, fullBuffs: false, spiritDamagePct: 100 }, m, attackParams);
  // 14 Rage per cast (+40% from Rage Infusion): the 8th cast reaches 100, a little under 3.5 s in
  assert.ok(s.berserkAt > 3 && s.berserkAt <= 3.5, `berserk at ${s.berserkAt}`);
  assert.ok(s.berserkUptime > 0.85, `uptime ${s.berserkUptime}`);
  assert.ok(s.spiritCasts > 0 && s.breakdown.spirit > 0);
  assert.ok(s.steadyDps > 2 * attackParams.castsPerSec * attackParams.damagePerCast);
  // By default the spirit only feeds Rage (calibrated on golem runs)
  const calibrated = rehanFight({ ...ATTACK_SIM_DEFAULTS, fullBuffs: false }, m, attackParams);
  assert.ok(calibrated.spiritCasts > 0 && calibrated.breakdown.spirit === 0);
});

test('with every buff up the fight starts in Berserk at max Rage Infusion and stays there', () => {
  const traits = { level1: 'Seething Silhouette', level45: "Fury's Onslaught", level60: 'Growing Anger', level75: 'Rage Infusion' };
  const m = rehanModel({ name: SEETHING, traits, levels: { 'Rage Infusion': 1 } }, []);
  const s = rehanFight(ATTACK_SIM_DEFAULTS, m, attackParams);
  assert.equal(s.berserkAt, 0);
  assert.ok(s.berserkUptime > 0.99, `uptime ${s.berserkUptime}`);
  assert.ok(Math.abs(s.avgInfusionStacks - 4) < 1e-6, `stacks ${s.avgInfusionStacks}`); // Lv 1: 4 stacks
  assert.equal(s.rampSeconds, 1); // already at full damage in the first second
});

test('Seething Silhouette alone drops out of Berserk as Rage drains', () => {
  const m = rehanModel({ name: SEETHING, traits: { level1: 'Seething Silhouette' } }, []);
  const s = rehanFight({ ...ATTACK_SIM_DEFAULTS, fullBuffs: false }, m, attackParams);
  assert.equal(s.spiritCasts, 0);
  assert.ok(s.berserkUptime > 0.2 && s.berserkUptime < 0.6, `uptime ${s.berserkUptime}`);
});

// Trait levels follow the memory in each slot: 1, +1 at memory level 30, +1 at 50, + "+N to Hero
// Trait Level", up to 5; the base trait stays at 1
const memory = (slot, memoryLevel, ...lines) => ({ slot, memoryLevel, item: { affixes: lines.map((text) => ({ text })) } });

test('hero and traits are inferred from the log ids', () => {
  const traits = [320012, 320022, 320032].map((id) => ({ id, slot: null }));
  assert.deepEqual(inferHero({ heroId: 310, heroPurchaseId: 1002 }, traits, [memory(1, 20), memory(2, 50, '+2 to Hero Trait Level'), memory(3, 30)]), {
    name: SEETHING,
    traits: { level1: 'Seething Silhouette', level45: "Fury's Onslaught", level60: 'Growing Anger', level75: 'Rage Infusion' },
    levels: { 'Seething Silhouette': 1, "Fury's Onslaught": 1, 'Growing Anger': 5, 'Rage Infusion': 2 },
  });
  // Tree heroes: nodes named through the hero trait table; levels from each node's memory slot.
  // CoffeeTerra: memories at 30, 30 and 40 with +2 -> LV.2, LV.2, LV.4 as the game shows
  const nodes = [
    { id: 1710001, slot: null, name: 'Dance of the Deep' },
    { id: 1710031, slot: 1, name: 'The Paradise I Curse' },
    { id: 1710011, slot: 2, name: "Dreambreaker's Gyre" },
    { id: 1710032, slot: 3, name: 'The Cycle I Resist' },
  ];
  const memories = [memory(1, 30, '+18% Affliction Effect'), memory(2, 30), memory(3, 40, '+22% damage', '+2 to Hero Trait Level')];
  assert.deepEqual(inferHero({ heroId: 1700, heroPurchaseId: 17002 }, nodes, memories), {
    name: SELENA_HERO,
    traits: { level1: 'Dance of the Deep', level45: 'The Paradise I Curse', level45b: "Dreambreaker's Gyre", level60: 'The Cycle I Resist' },
    levels: { 'Dance of the Deep': 1, 'The Paradise I Curse': 2, "Dreambreaker's Gyre": 2, 'The Cycle I Resist': 4 },
  });
  // A node the table can't name: no guess
  assert.equal(inferHero({ heroId: 1700, heroPurchaseId: 17002 }, [{ id: 1, slot: 1, name: null }]), null);
  // Bing #2 picks twice per level: tiers 4-6 are the second row (CoffeeBingTest's ids)
  const bing = [820011, 820041, 820021, 820053, 820032, 820061].map((id) => ({ id, slot: null }));
  assert.deepEqual(inferHero({ heroId: 810, heroPurchaseId: 4002 }, bing, memories), {
    name: 'Escapist Bing: Creative Genius (#2)',
    traits: {
      level1: 'Creative Genius',
      level45: 'Inspiration Overflow',
      level45b: 'Super Sonic Protocol',
      level60: 'Mind Domain',
      level60b: 'Auto-Ingenuity Program',
      level75: 'Flash of Brilliance',
      level75b: 'Multi-Coupling Equation',
    },
    levels: {
      'Creative Genius': 1,
      'Inspiration Overflow': 2,
      'Super Sonic Protocol': 2,
      'Mind Domain': 2,
      'Auto-Ingenuity Program': 2,
      'Flash of Brilliance': 4,
      'Multi-Coupling Equation': 4,
    },
  });
  // Any hero whose trait ids the table names: the names decide (Carino #2, CoffeeMetaRino's hero)
  const carino = [
    { id: 610011, slot: null, name: 'Evil Ouroboros' },
    { id: 610021, slot: null, name: 'Shadow Magazine' },
    { id: 610032, slot: null, name: 'Born in the Breeze' },
  ];
  assert.deepEqual(inferHero({ heroId: 600, heroPurchaseId: 2002 }, carino, []), {
    name: 'Divineshot Carino: Lethal Flash (#2)',
    traits: { level1: 'Lethal Flash', level45: 'Evil Ouroboros', level60: 'Shadow Magazine', level75: 'Born in the Breeze' },
    levels: { 'Lethal Flash': 1, 'Evil Ouroboros': 1, 'Shadow Magazine': 1, 'Born in the Breeze': 1 },
  });
  // Sage #1 (CoffeeSage#9020's ids): one pick per level from Licorice Note's rows; the base trait stays at 1
  const sage = [1800031, 1800011, 1800022].map((id) => ({ id, slot: null }));
  assert.deepEqual(inferHero({ heroId: 1800, heroPurchaseId: 18001 }, sage, memories), {
    name: SAGE_HERO,
    traits: { level1: 'Licorice Note', level45: 'Pungent Stimulant Salt', level60: 'Scent of Ambition', level75: 'Everlasting Nectar' },
    levels: { 'Licorice Note': 1, 'Pungent Stimulant Salt': 2, 'Scent of Ambition': 2, 'Everlasting Nectar': 4 },
  });
});

test("Sage's Scent Bottle ingredients become stat lines at their trait's level", () => {
  const hero = {
    name: SAGE_HERO,
    traits: { level1: 'Licorice Note', level45: 'Pungent Stimulant Salt', level75: 'Licorice Tincture Blend' },
    levels: { 'Licorice Note': 3, 'Licorice Tincture Blend': 2 },
    ingredients: { basic: ['Razor Leaf', 'Scattered Spore'], functional: 'Husk', special: 'Pixie Tear' },
  };
  assert.deepEqual(sageIngredientLines(hero), [
    { source: 'Scent Bottle: Razor Leaf', text: '+10% additional damage when you or your Minions land a Critical Strike' },
    { source: 'Scent Bottle: Scattered Spore', text: '+14% additional damage taken by enemies' }, // both stacks
    { source: 'Scent Bottle: Pixie Tear', text: '+1.2% additional damage for you and your Minions for every 400 Max Energy Shield, up to +48%' },
  ]);
  assert.ok(sageNotes(hero).some((n) => /Husk: charge restoration only/.test(n)));
  // Without picks the notes ask for them; the Special bottle only counts with Licorice Tincture Blend
  assert.ok(sageNotes({ name: SAGE_HERO, traits: { level1: 'Licorice Note' } }).some((n) => /pick its 2 ingredients/.test(n)));
  assert.deepEqual(sageIngredientLines({ name: SAGE_HERO, traits: { level1: 'Licorice Note' }, ingredients: { special: 'Pixie Tear' } }), []);
  assert.deepEqual(sageIngredientLines({ name: 'Berserker Rehan: Seething Silhouette (#2)', ingredients: { basic: ['Razor Leaf'] } }), []);
});

// A Spell Burst fight with nothing else going on: H per cast, B on burst casts, M stacks
const burstParams = {
  H: 100,
  B: 2,
  F: 2,
  M: 3,
  handRate: 0,
  autoActive: true,
  bing: false,
  signalF: 1,
  mindPerStack: 1.05,
  whimsyCap: 0,
  buffs: [],
  mcFull: 0,
  mcCap: 0,
  empowersInEngine: 0,
  overflow: false,
  flash: null,
  overload: 'off',
  whimsyRecovery: 1,
};

// The bar charges stack by stack (stacksPerBar of them make the 2 s / F bar); with 3 stacks a bar
// the 3-stack fights below take the whole 2 s / F, as their figures assume
const SIM3 = { ...SPELL_SIM_DEFAULTS, stacksPerBar: 3 };

test('Spell Burst: a bar of M stacks fills in M / stacksPerBar x 2 s / F on the 30 Hz clock and bursts M + 1 casts', () => {
  // F = 2: a bar every second, 60 bursts in 60 s, each the activating cast (100) + 3 x 100 x 2
  const bar = spellFight(SIM3, burstParams);
  assert.equal(Math.round(bar.burstsPerSec * 60), 60);
  assert.equal(Math.round(bar.avgDps), 700);
  // By default the bar takes the whole 2 s / F whatever M is, so a bigger bar fires more casts a
  // second (CoffeeBingBong's 3-4 minute dummy runs at Max Spell Burst 5 and 6, 2026-11-03)
  const fixed = spellFight(SPELL_SIM_DEFAULTS, burstParams);
  assert.equal(Math.round(fixed.burstsPerSec * 60), 60);
  assert.equal(Math.round(fixed.avgDps), 700);
  const six = spellFight(SPELL_SIM_DEFAULTS, { ...burstParams, M: 6 });
  assert.equal(Math.round(six.burstsPerSec * 60), 60);
  assert.equal(Math.round(six.avgDps), 1300);
  // Stack-by-stack charging (a number of stacks per bar): a 3-stack bar fills twice as fast as a 6-stack one
  const quick = spellFight({ ...SPELL_SIM_DEFAULTS, stacksPerBar: 6 }, burstParams);
  assert.equal(Math.round(quick.burstsPerSec * 60), 120);
  assert.equal(Math.round(quick.avgDps), 1400);
  // Per-stack charging: every stack takes the 1 s, so a third as many bursts
  assert.equal(Math.round(spellFight({ ...SIM3, chargeModel: 'stack' }, burstParams).avgDps), 233);
  // Only the M automatic casts; or the activating cast boosted too
  assert.equal(Math.round(spellFight({ ...SIM3, countActivatingCast: false }, burstParams).avgDps), 600);
  assert.equal(Math.round(spellFight({ ...SIM3, activatingCastBoosted: true }, burstParams).avgDps), 800);
  // F = 3.666 (CoffeeBingTest): ceil(60 / 3.666) = 17 ticks a bar, not the smooth 16.4; whole bars
  // in the 1800 ticks of a minute
  assert.equal(Math.round(spellFight(SIM3, { ...burstParams, F: 3.666 }).burstsPerSec * 60), Math.floor(1800 / 17));
});

test('Thunderbolts: one every 2 casts up to the cap, each repeating your casts', () => {
  const thunder = { every: 2, cap: 5, duration: 6, aftershock: false, reverb: null };
  const r = spellFight(SIM3, { ...burstParams, thunder });
  // 4 casts a second spawn one every half second until 5 are up; they last 6 s, then refill at once
  assert.ok(r.avgThunderbolts > 4 && r.avgThunderbolts <= 5);
  // Each cast is repeated by the Thunderbolts up at that moment; ones that run out as a burst starts
  // are replaced partway through it, so the casts see a little fewer than the time average
  const repeats = r.avgDps / 700 - 1;
  assert.ok(repeats > r.avgThunderbolts - 0.5 && repeats <= r.avgThunderbolts);
  // Reverberation: once the first ones vanish, new ones don't count toward the cap (up to 10, half
  // duration), so the count climbs toward 10 (CoffeeBingTest: 260B with it vs 163B without)
  const withReverb = { ...thunder, aftershock: true, reverb: { max: 10, durationMult: 0.5 } };
  // Default reading ('overflow'): the capped 5 keep refilling and Reverberation holds up to 10 more,
  // so casting fast (3 bursts a second, 12 casts) keeps close to 15 up
  const fast = spellFight(SIM3, { ...burstParams, F: 6, thunder: withReverb });
  assert.ok(fast.avgThunderbolts > 12 && fast.avgThunderbolts <= 15);
  // Aftershock alone: its replacements sit outside the cap, so more than the 5
  const aftershock = spellFight(SIM3, { ...burstParams, F: 6, thunder: { ...thunder, aftershock: true } });
  assert.ok(aftershock.avgThunderbolts > 6);
  // The other reading ('afterVanish'): once the first ones vanish only Reverberation's 10 are made
  const afterVanish = spellFight({ ...SIM3, thunderboltRule: 'afterVanish' }, { ...burstParams, F: 6, thunder: withReverb });
  assert.ok(afterVanish.avgThunderbolts > 8.5 && afterVanish.avgThunderbolts <= 10);
});

test('Spell Burst: Activation Medium buffs follow their cooldowns, and a buff that is down costs its factor', () => {
  // Timed: Scorch 5 s on, 8 s cooldown, recast on the first burst after it: up 5 s in every 8
  const scorch = { name: 'Scorch', duration: 5, cooldown: 8, empower: false, factor: 1.5 };
  const timed = { ...SIM3, buffsAlwaysUp: false };
  const r = spellFight(timed, { ...burstParams, buffs: [scorch] });
  assert.ok(Math.abs(r.buffUptime.Scorch - 5 / 8) < 0.03);
  // Damage: 100 with Scorch up, 100 / 1.5 without
  const expected = 700 * (5 / 8 + (3 / 8) / 1.5);
  assert.ok(Math.abs(r.avgDps - expected) / expected < 0.03);
  // The default, as the player asked: every buff at 100% uptime
  const up = spellFight(SIM3, { ...burstParams, buffs: [scorch] });
  assert.ok(Math.abs(up.buffUptime.Scorch - 1) < 1e-9);
  assert.equal(Math.round(up.avgDps), 700);
});

test("Selena's traits scale with their levels", () => {
  const traits = { level1: 'Dance of the Deep', level45: 'The Paradise I Curse', level45b: "Dreambreaker's Gyre", level60: 'The Cycle I Resist' };
  const m = selenaModel({ name: SELENA_HERO, traits, levels: { 'Dance of the Deep': 2, 'The Paradise I Curse': 2, "Dreambreaker's Gyre": 2, 'The Cycle I Resist': 4 } });
  assert.equal(m.terraAddnPct, 5);
  assert.equal(m.chargeBonusPct, null);
  assert.equal(m.cursedAddnPct, 15);
  assert.equal(m.crimsonTidePct, 45);
  assert.deepEqual(m.cycle, { critToDurationPct: 25, reapPctOfRemaining: 9 });
  assert.ok(m.ominous);
  // Artificial Moon at level 5
  assert.equal(selenaModel({ name: SELENA_HERO, traits, levels: { 'Dance of the Deep': 5 } }).chargeBonusPct, 32);
  assert.equal(selenaModel({ name: 'Berserker Rehan: Seething Silhouette (#2)' }), null);
});
