// In-game DPS simulation. The engine (server/engine) answers "how much damage per second in this
// combat state"; this module plays a fight out in small time steps to decide what the state is at
// each moment: when the skill is cast, how many Terra Charges each cast consumes, Gash stacks,
// debuffs ramping up on the enemy, blessings, and reaping on its cooldown.
//
// Supported main skills: Terra skills (Frost Terra), spells with Spell Burst (server/sim/spell.js)
// and attack skills (server/sim/attack.js). Anything else reports supported: false.
import { runEngine, findActiveSkill } from '../engine/bridge.js';
import { simulateAttack } from './attack.js';
import { selenaModel } from './selena.js';
import { simulateSpell } from './spell.js';
import { averageFights, FIGHT_SEEDS, rng, summarize } from './summary.js';

// Base values the game data doesn't spell out, with where each comes from
export const SIM_DEFAULTS = {
  duration: 30, // seconds of fighting a single target dummy
  dt: 0.05,
  terraDuration: 6, // tlidb Frost Terra (SS13): "Frost Terra lasts for 6s"
  // Frost Terra casts instantly; only its cooldown limits recasting (CoffeeTerra's player recasts
  // every 0.35-0.4 s). tlidb lists "Cast Speed 1 s", which isn't what happens in game.
  castTime: 0,
  cooldown: 0.5, // tlidb Frost Terra: Cooldown 0.5 s, shortened by Cooldown Recovery Speed
  terraChargeBonusPct: 26, // tlidb Frost Terra: +26% additional damage per Terra Charge consumed
  terraChargeMax: 1, // CoffeeTerra's Damage tab: Max Terra Charge Stacks 2, with Ground Divide's +1
  // Seconds per Terra Charge at +0% restoration speed: 0.5 s for every Terra skill, measured in game
  // by TLI Builder (docs/verification/terra-charge-system.md)
  terraChargeRestore: 0.5,
  // The Terra applies a fresh 2 s DoT instance every second and the instances stack, so a standing
  // Terra keeps about 2 going (TLI Builder, docs/verification/frost-terra.md). pulseOnCast: a newly
  // cast Terra applies its first instance at once, so recasting faster than once a second keeps more
  // instances going. Off: recasts keep the 1 s beat. CoffeeTerra's golem test (375 ms recasts) fits
  // only with it off; on, the simulation comes out about 3x too high.
  terraPulse: 1,
  pulseOnCast: false,
  startWithFullCharges: true,
  gashMaxStacks: 8, // tlidb Gash: +8% additional Terra damage (multiplies), -12% charge recovery, 8 stacks, 1.5 s
  gashDmgPct: 8,
  gashRecoveryPct: -12,
  gashDuration: 1.5,
  tormentDuration: 4, // tlidb Torment: lasts 4 s, up to 3 stacks
  blessingDuration: 10, // tlidb Focus Blessing: "The base duration of Focus Blessing is 10s"
  focusInterval: 0.1, // Prophet talent: Focus Blessing on damaging a Frostbitten enemy, interval 0.1 s
  // How much one reap can take: 'dot' = only the DoT status's own duration (2 s for Frost Terra),
  // the engine's rule for DoT in general; 'terra' = whatever the Terra (and the DoT lingering after
  // it) still has to deal. CoffeeTerra's golem test fits 'dot'; 'terra' comes out 2-3x too high.
  reapCap: 'dot',
  // Ill Omen (tlidb, current season): an Ominous-cursed enemy gains a stack each time the DoT and
  // Reaping damage it takes reaches 5% of its Max Life (Elite; 8% non-Elite); at 10 stacks an Elite
  // takes True Damage equal to 20% of its Max Life. Cumulative Efficiency (max 100%) speeds up the
  // stacking. TLI Builder found in game that this True Damage counts toward the next stacks
  // (docs/verification/ill-omen.md), without measuring how much; CoffeeTerra's golem test fits best
  // without it, so it's a combat toggle (illOmenSelfFeed), off by default. The dummy is taken as an Elite.
  illOmenStackPct: 5,
  illOmenMaxStacks: 10,
  illOmenTrueDmgPct: 20,
  illOmenSelfFeed: false,
};

// Ill Omen True Damage per point of DoT and Reaping damage, averaged over full cycles. Each stack
// takes stackPct/(1 + efficiency) of Max Life; a trigger deals truePct. With self-feeding, that
// burst already fills truePct/threshold of the next 10 stacks, so DoT only has to fill the rest.
export function illOmenRatio(o, efficiencyPct) {
  const threshold = o.illOmenStackPct / (1 + Math.min(100, Math.max(0, efficiencyPct)) / 100);
  const fromDot = o.illOmenMaxStacks * threshold - (o.illOmenSelfFeed ? o.illOmenTrueDmgPct : 0);
  // A burst that alone refills every stack would chain without end; cap it at one burst per stack's worth
  return o.illOmenTrueDmgPct / Math.max(fromDot, threshold);
}

export const POLICIES = {
  spam: 'Recast whenever off cooldown',
  maxCharges: 'Recast at max Terra Charges, or as the Terra runs out',
  onExpire: 'Recast only as the Terra runs out',
  keepGash: 'Recast to keep Gash up, or at max charges',
};

const sumMods = (mods, type) => mods.filter((m) => m.type === type && !m.addn).reduce((s, m) => s + (m.value ?? 0), 0);
const moreMult = (mods, type) => mods.filter((m) => m.type === type && m.addn).reduce((p, m) => p * (1 + (m.value ?? 0) / 100), 1);
const effMult = (mods, type) => (1 + sumMods(mods, type) / 100) * moreMult(mods, type);

// What the build's own text says it triggers. Talent node texts are per point.
function detectMechanics(character) {
  const lines = [];
  for (const { item } of character.equipment) for (const a of item?.affixes ?? []) lines.push({ text: a.text ?? '', times: 1 });
  for (const t of character.talentTrees) for (const n of t.nodes) if (n.points) lines.push({ text: n.text ?? '', times: n.points });
  for (const s of character.slates) for (const t of s.talents) lines.push({ text: t.text ?? '', times: 1 });
  const text = lines.map((l) => l.text).join('\n');
  const total = (re) => lines.reduce((sum, l) => sum + [...l.text.matchAll(re)].reduce((s, m) => s + Number(m[1]), 0) * l.times, 0);
  return {
    gash: /gains 1 stack\(s\) of Gash/i.test(text),
    tormentOnDot: /Torment when dealing Damage Over Time/i.test(text),
    focusOnReap: /Focus Blessing when Reaping/i.test(text),
    focusOnFrostbitten: /Focus Blessing upon inflicting damage to a Frostbitten enemy/i.test(text),
    ominousSkill: [...character.skills.active].some((g) => g.skill?.name === 'Ominous'),
    illOmenEfficiencyPct: total(/([+-]?\d+(?:\.\d+)?)% Ill Omen Cumulative Efficiency/gi),
  };
}

const roundToFrame = (cd) => Math.ceil(cd * 30) / 30; // the engine rounds reap cooldowns to 30 fps frames

// Terra support effects the engine doesn't model. Ground Divide (tlidb): +1 max Terra Charge and
// Terra Charge Restoration Speed 55.5% at Lv1, 65.5% at Lv21, 85.5% at Lv41, linear in between.
function terraSupports(mods) {
  const levelOf = (name) => {
    const m = mods.map((x) => new RegExp(`${name} Lv\\.(\\d+)`).exec(x.src ?? '')).find(Boolean);
    return m ? Number(m[1]) : null;
  };
  const gd = levelOf('Ground Divide');
  if (gd == null) return { maxCharges: 0, restorationPct: 0, sources: [] };
  const restorationPct = gd <= 21 ? 55.5 + (gd - 1) * 0.5 : 65.5 + (gd - 21);
  return { maxCharges: 1, restorationPct, sources: [`Ground Divide Lv.${gd}: +1 max Terra Charge, +${restorationPct}% Terra Charge restoration speed`] };
}

export function simulate(character, scenario, { pactspirits, hero, policy = 'auto', ...overrides } = {}) {
  const o = { ...SIM_DEFAULTS, ...overrides };
  const mainName = character.calc?.mainSkill ?? character.skills.active.map((g) => g.skill?.name).find((n) => findActiveSkill(n));
  const skill = findActiveSkill(mainName);
  if (!skill?.tags?.includes('Terra')) {
    if (skill?.tags?.includes('Attack')) return simulateAttack(character, scenario, { pactspirits, hero });
    if (skill?.tags?.includes('Spell')) return simulateSpell(character, scenario, { pactspirits, hero });
    return { supported: false, reason: `In-game simulation covers Terra, Spell Burst and attack skills so far; ${mainName ?? 'the main skill'} is none of these.` };
  }

  // Engine damage for one combat state, cached: states repeat constantly during a fight
  const cache = new Map();
  const evalState = (s) => {
    const key = `${s.frostbite}|${s.affliction}|${s.torment}|${s.focus}`;
    if (!cache.has(key)) {
      const r = runEngine(
        character,
        {
          ...scenario,
          enemyFrostbittenEnabled: s.frostbite,
          enemyHasAffliction: s.affliction > 0,
          afflictionPts: s.affliction,
          tormentStacks: s.torment,
          hasFocusBlessing: s.focus > 0,
          focusBlessings: s.focus,
        },
        { pactspirits, hero },
      );
      const sk = r.ok ? r.results.skills[r.mainSkill] : undefined;
      cache.set(key, sk?.persistentDpsSummary ? { dot: sk.persistentDpsSummary.total, summary: sk, pool: r.results.resourcePool } : null);
    }
    return cache.get(key);
  };

  // Fully ramped state: read timing modifiers from it
  const full = evalState({ frostbite: !!scenario.enemyFrostbittenEnabled, affliction: scenario.enemyHasAffliction ? 100 : 0, torment: scenario.tormentStacks ?? 0, focus: scenario.hasFocusBlessing ? 99 : 0 });
  if (!full) return { supported: false, reason: `The engine has no persistent damage model for ${mainName}.` };
  const mods = full.summary.resolvedMods;
  const mech = detectMechanics(character);

  const supports = terraSupports(mods);
  const selena = selenaModel(hero);
  const castSpeedMult = effMult(mods, 'CspdPct');
  // Critical Strike Rating bonus that applies to this spell, for The Cycle I Resist
  const critBonusPct = mods
    .filter((m) => m.type === 'CritRatingPct' && !m.addn && [undefined, 'global', 'spell'].includes(m.modType))
    .reduce((s, m) => s + m.value, 0);
  const critToDurationPct = selena?.cycle ? (critBonusPct * selena.cycle.critToDurationPct) / 100 : 0;
  const durationMult = (1 + (sumMods(mods, 'SkillEffDurationPct') + critToDurationPct) / 100) * moreMult(mods, 'SkillEffDurationPct');
  const ominous = !!selena?.ominous || mech.ominousSkill;
  const reapDurationMult = effMult(mods, 'ReapDurationPct');
  const reapCdrMult = effMult(mods, 'ReapCdrPct');
  if (scenario.reapWholeTerra != null) o.reapCap = scenario.reapWholeTerra ? 'terra' : 'dot';
  if (scenario.illOmenSelfFeed != null) o.illOmenSelfFeed = !!scenario.illOmenSelfFeed;
  const params = {
    castTime: o.castTime / castSpeedMult,
    // A recast interval typed in the combat toggles wins over the one worked out from the data
    cooldown: scenario.recastMs > 0 ? scenario.recastMs / 1000 : o.cooldown / effMult(mods, 'CdrPct'),
    cooldownFromData: o.cooldown / effMult(mods, 'CdrPct'),
    terraDuration: o.terraDuration * durationMult,
    dotDuration: full.summary.persistentDpsSummary.duration,
    chargeMax: o.terraChargeMax + sumMods(mods, 'MaxTerraChargeStack') + supports.maxCharges + (selena?.maxChargesBonus ?? 0),
    chargeRecoveryPct: sumMods(mods, 'TerraChargeRecoverySpeedPct') + supports.restorationPct + (selena?.chargeRecoveryPct ?? 0),
    chargeBonusPct: selena?.chargeBonusPct ?? o.terraChargeBonusPct,
    afflictionPerSec: scenario.enemyHasAffliction ? sumMods(mods, 'AfflictionInflictedPerSec') : 0,
    maxFocus: full.pool.maxFocusBlessings,
    // Reaps from gear and pactspirits: their full time (the engine's summary has them already capped)
    reaps: mods.filter((m) => m.type === 'Reap').map((m) => ({ cooldown: roundToFrame(m.cooldown / reapCdrMult), duration: m.duration * reapDurationMult })),
    reapDurationMult,
    // Selena: her own damage multipliers (the engine doesn't know her)
    terraAddnMult: 1 + (selena?.terraAddnPct ?? 0) / 100,
    cursedAddnMult: 1 + (selena?.cursedAddnPct ?? 0) / 100,
    crimsonTideMult: 1 + (selena?.crimsonTidePct ?? 0) / 100,
    cycleReapPct: selena?.cycle?.reapPctOfRemaining ?? 0,
    critToDurationPct,
    // Ill Omen True Damage per point of DoT and Reaping damage, on average over full cycles
    illOmenRatio: ominous && scenario.illOmen !== false ? illOmenRatio(o, mech.illOmenEfficiencyPct) : 0,
  };

  // Recast timing varies a little, and whether Gash lapses depends on it, so each timing strategy
  // is the average of several fights. steady: every buff and debuff at full from the first second
  // (one engine run instead of one per ramp-up state; what the talent advisor compares).
  const stateFor = o.steady ? () => full : evalState;
  const runPolicy = (name) => averageFights(FIGHT_SEEDS.map((seed) => runFight(name, o, params, mech, scenario, stateFor, seed)));
  const results = Object.keys(POLICIES).map(runPolicy);
  const best = policy === 'auto' ? results.reduce((a, b) => (b.avgDps > a.avgDps ? b : a)) : results.find((r) => r.policy === policy) ?? results[0];

  return {
    supported: true,
    kind: 'terra',
    skill: mainName,
    ...best,
    policies: results.map(({ policy: p, avgDps, steadyDps, peak1s }) => ({ policy: p, label: POLICIES[p], avgDps, steadyDps, peak1s })),
    params: { ...params, reaps: params.reaps.length },
    mechanics: mech,
    hero: selena ? { traits: selena.traits } : null,
    supportEffects: supports.sources,
    assumptions: o,
    engineStates: cache.size,
  };
}

function runFight(policy, o, p, mech, scenario, evalState, seed = 1) {
  const bins = new Float64Array(Math.ceil(o.duration / 0.1));
  const totals = { dot: 0, reap: 0, recastReap: 0, illOmen: 0 };
  // A player doesn't recast on an exact beat: each recast comes 10% early to 10% late around the
  // interval typed in, or up to 20% after the cooldown ends. Without it, a fixed beat lines up
  // with Terra Charge regeneration and lets Gash lapse, or not, by luck of the timing.
  const random = rng(seed);
  const recastGap = () => p.cooldown * (scenario.recastMs > 0 ? 0.9 + random() * 0.2 : 1 + random() * 0.2);

  let charges = o.startWithFullCharges ? p.chargeMax : 0;
  let chargeProgress = 0;
  let castingUntil = null;
  let cooldownUntil = 0;
  let freeAt = 0; // when the last cast landed (exact, between steps)
  let terra = null; // { end, mult, nextPulse }
  let cursed = false; // The Paradise I Curse: Ominous on enemies inside the Main Terra
  let instances = []; // DoT instances on the enemy: { expires, mult }; they stack
  let gash = { stacks: 0, until: 0 };
  let frostbite = false;
  let affliction = 0;
  let torment = { stacks: 0, until: 0 };
  let focus = { stacks: scenario.hasFocusBlessing && !mech.focusOnReap && !mech.focusOnFrostbitten ? p.maxFocus : 0, until: Infinity, nextGain: 0 };
  const reapReady = p.reaps.map(() => 0);
  let casts = 0;
  let consumedTotal = 0;

  const gainFocus = (t) => {
    if (!scenario.hasFocusBlessing) return;
    focus = { ...focus, stacks: Math.min(p.maxFocus, focus.stacks + 1), until: t + o.blessingDuration };
  };

  for (let i = 0; i * o.dt < o.duration; i++) {
    const t = i * o.dt;

    // Terra Charges restore one at a time; Gash slows them
    const gashStacks = t < gash.until ? gash.stacks : 0;
    const recovery = 1 + (p.chargeRecoveryPct + gashStacks * o.gashRecoveryPct) / 100;
    if (charges < p.chargeMax && recovery > 0) {
      chargeProgress += o.dt / (o.terraChargeRestore / recovery);
      while (chargeProgress >= 1 && charges < p.chargeMax) {
        charges++;
        chargeProgress -= 1;
      }
    }

    // Cast lands: the new Terra replaces the old one and consumes every charge. The Cycle I
    // Resist reaps part of what the replaced Terra had left.
    let recastReapSeconds = 0;
    if (castingUntil !== null && t >= castingUntil) {
      freeAt = castingUntil;
      castingUntil = null;
      if (terra && p.cycleReapPct > 0) {
        const left = terra.end - t;
        recastReapSeconds = Math.min((p.cycleReapPct / 100) * left * p.reapDurationMult, o.reapCap === 'dot' ? p.dotDuration : left + p.dotDuration);
      }
      const consumed = charges;
      charges = 0;
      casts++;
      consumedTotal += consumed;
      terra = { end: t + p.terraDuration, mult: 1 + (p.chargeBonusPct * consumed) / 100, nextPulse: o.pulseOnCast || !terra ? t : terra.nextPulse };
      cursed = true;
      if (mech.gash && consumed > 0) gash = { stacks: Math.min(o.gashMaxStacks, gashStacks + consumed), until: t + o.gashDuration };
    }
    if (terra && t >= terra.end) terra = null;

    // Decide whether to start the next cast. The cooldown runs while casting, so a recast can
    // start the moment the last one lands; start times stay exact rather than snapping to steps.
    const start = Math.max(freeAt, cooldownUntil);
    if (castingUntil === null && t >= start) {
      const terraLeft = terra ? terra.end - t : 0;
      const expiring = !terra || terraLeft <= p.castTime;
      const want =
        policy === 'spam' ||
        expiring ||
        (policy === 'maxCharges' && charges >= p.chargeMax) ||
        (policy === 'keepGash' && (charges >= p.chargeMax || (mech.gash && charges >= 1 && gash.until - t <= p.castTime)));
      if (want) {
        // Back-date by at most one step (the cast really started between steps)
        const at = Math.max(start, t - o.dt);
        castingUntil = at + p.castTime;
        cooldownUntil = at + recastGap();
      }
    }

    // Buffs run out whether or not anything is ticking
    if (t >= torment.until) torment = { stacks: 0, until: 0 };
    if (t >= focus.until) focus = { ...focus, stacks: 0 };

    // The Terra applies a DoT instance on its beat; instances stack
    while (terra && t >= terra.nextPulse - 1e-9) {
      instances.push({ expires: terra.nextPulse + p.dotDuration, mult: terra.mult });
      terra.nextPulse += o.terraPulse;
    }
    instances = instances.filter((d) => d.expires > t);
    if (!instances.length) continue;
    const dotMult = instances.reduce((sum, d) => sum + d.mult, 0);

    // Enemy debuffs and blessings ramp while the DoT ticks. A toggle that's on without a source
    // the build text names is treated as always applied.
    if (scenario.enemyFrostbittenEnabled) frostbite = true;
    affliction = p.afflictionPerSec > 0 ? Math.min(100, affliction + p.afflictionPerSec * o.dt) : scenario.enemyHasAffliction ? 100 : 0;
    if (scenario.tormentStacks > 0) {
      torment = mech.tormentOnDot ? { stacks: Math.min(3, torment.stacks + 1), until: t + o.tormentDuration } : { stacks: scenario.tormentStacks, until: Infinity };
    }
    if (mech.focusOnFrostbitten && frostbite && t >= focus.nextGain) {
      gainFocus(t);
      focus.nextGain = t + o.focusInterval;
    }

    const state = evalState({
      frostbite,
      affliction: affliction >= 100 ? 100 : Math.floor(affliction / 10) * 10,
      torment: torment.stacks,
      focus: focus.stacks,
    });
    if (!state) continue;
    const gashMult = (1 + o.gashDmgPct / 100) ** (t < gash.until ? gash.stacks : 0);
    const heroMult = p.terraAddnMult * (cursed ? p.cursedAddnMult : 1) * (terra ? p.crimsonTideMult : 1);
    const dps = state.dot * dotMult * gashMult * heroMult;

    const dot = dps * o.dt;
    // What a reap can take now: the DoT's own time left, or everything the Terra still deals
    const dotLeft = Math.max(...instances.map((d) => d.expires)) - t;
    const reapLimit = o.reapCap === 'dot' || !terra ? dotLeft : terra.end - t + p.dotDuration;
    let reap = 0;
    p.reaps.forEach((r, k) => {
      if (t < reapReady[k]) return;
      reap += dps * Math.min(r.duration, reapLimit);
      reapReady[k] = t + r.cooldown;
      if (mech.focusOnReap) gainFocus(t);
    });
    const recastReap = dps * recastReapSeconds;
    if (recastReap > 0 && mech.focusOnReap) gainFocus(t);
    const illOmen = (dot + reap + recastReap) * p.illOmenRatio;
    totals.dot += dot;
    totals.reap += reap;
    totals.recastReap += recastReap;
    totals.illOmen += illOmen;
    bins[Math.min(bins.length - 1, Math.floor(t / 0.1))] += dot + reap + recastReap + illOmen;
  }

  const breakdown = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / o.duration]));
  return { policy, ...summarize(bins, o.duration), breakdown, casts, avgChargesPerCast: casts ? consumedTotal / casts : 0 };
}
