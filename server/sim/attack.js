// In-game DPS for attack skills: the engine gives the damage of one cast and the attack rate; this
// plays a dummy fight out in small steps for what changes over time. For Berserker Rehan -
// Seething Silhouette that's Rage building up, Berserk, the Seething Spirit casting your main
// skill alongside you, and Rage Infusion stacks (server/sim/rehan.js). Other heroes attack at a
// steady rate, so their simulation matches the formula.
import { runEngine } from '../engine/bridge.js';
import { rehanModel } from './rehan.js';
import { averageFights, FIGHT_SEEDS, rng, summarize } from './summary.js';

export const ATTACK_SIM_DEFAULTS = {
  duration: 30, // seconds of fighting a single target dummy
  dt: 0.01,
  recentlySeconds: 4, // assumption: "recently" means the last 4 s
  startRage: 0,
  // Every buff at 100% uptime: the fight starts in Berserk with full Rage and Rage Infusion at max
  // stacks, as in a long fight. false plays out the ramp-up from 0 Rage.
  fullBuffs: true,
  // How hard the Seething Spirit hits, as % of your cast. Calibrated on CoffeeDeadProb's golem runs
  // (Double Thrusts only, with/without Haunt, Fury's Onslaught vs Ritual of Offering): swapping to
  // Ritual (spirit always out, +20% spirit damage) halved the golem's DPS, which only fits if the
  // spirit adds almost nothing the dummy counts. It still generates Rage (Growing Anger).
  spiritDamagePct: 0,
};

export function simulateAttack(character, scenario, { pactspirits, hero, ...overrides } = {}) {
  const o = { ...ATTACK_SIM_DEFAULTS, ...overrides };
  const r = runEngine(character, scenario, { pactspirits, hero });
  if (!r.ok) return { supported: false, reason: `The engine couldn't run: ${r.error}` };
  const skill = r.results.skills[r.mainSkill];
  const a = skill?.attackDpsSummary;
  if (!a?.avgDps) return { supported: false, reason: `The engine has no attack damage for ${r.mainSkill ?? 'the main skill'}.` };

  // Dual wielding alternates weapons. The in-game sheet shows both hands attacking at the main
  // hand's speed (CoffeeDeadProb: 7.91/s each with a 2.04 claw and a 1.5 sword), where the engine
  // gives each hand its own. So casts come at the main-hand speed, each hand's hit half the time;
  // whatever else the engine's average carries (multistrike) is kept as a ratio.
  const hands = [a.mainhand, a.offhand].filter(Boolean);
  const engineRate = hands.reduce((s, h) => s + h.avgHitWithCrit * h.aspd, 0) / hands.length;
  const castsPerSec = a.mainhand?.aspd ?? hands[0].aspd;
  const damagePerCast = (hands.reduce((s, h) => s + h.avgHitWithCrit, 0) / hands.length) * (a.avgDps / engineRate);
  const incAspdPct = skill.resolvedMods.filter((m) => m.type === 'AspdPct' && !m.addn).reduce((s, m) => s + m.value, 0);
  const levels = r.results.heroTraitLevels ?? [];
  const m = rehanModel(hero, levels, { maxLife: r.results.resourcePool?.maxLife ?? 0 });

  // Crits land at random, which is what makes a dummy's best 5 s beat its average (TLI Builder's
  // steady parses: best 5 s 13-17% over the average). The main hand's crit chance and multiplier,
  // rolled per hit; Double Thrusts hits twice per use.
  const mh = a.mainhand;
  const critChance = mh?.critChance?.actual ?? 0;
  const critMult = critChance > 0 && mh.avgHit > 0 ? (mh.avgHitWithCrit / mh.avgHit - (1 - critChance)) / critChance : 1;
  const crits = { chance: critChance, mult: critMult, hits: r.mainSkill === 'Double Thrusts' ? 2 : 1 };

  const p = { castsPerSec, damagePerCast, incAspdPct, crits };
  const fight = averageFights(FIGHT_SEEDS.map((seed) => (m ? rehanFight(o, m, p, seed) : steadyFight(o, p, seed))));
  return {
    supported: true,
    kind: 'attack',
    skill: r.mainSkill,
    policy: 'attack',
    ...fight,
    hero: m ? { name: hero.name, traits: m.traits } : null,
    params: { castsPerSec, damagePerCast, incAspdPct, formulaDps: a.avgDps, critChance, critMult },
    assumptions: o,
  };
}

// One cast's damage with its crits rolled: the average stays damagePerCast
function castRoller(p, seed) {
  const c = p.crits;
  if (!c || c.chance <= 0 || c.mult <= 1 || seed == null) return (base) => base;
  const random = rng(seed);
  const norm = 1 + c.chance * (c.mult - 1);
  return (base) => {
    let sum = 0;
    for (let h = 0; h < c.hits; h++) sum += random() < c.chance ? c.mult : 1;
    return (base * sum) / c.hits / norm;
  };
}

function steadyFight(o, p, seed) {
  const bins = new Float64Array(Math.ceil(o.duration / 0.1));
  const roll = castRoller(p, seed);
  let casts = 0;
  let total = 0;
  for (let t = 0; t < o.duration; t += 1 / p.castsPerSec) {
    const dmg = roll(p.damagePerCast);
    bins[Math.min(bins.length - 1, Math.floor(t / 0.1))] += dmg;
    total += dmg;
    casts++;
  }
  return { ...summarize(bins, o.duration), breakdown: { player: total / o.duration, spirit: 0 }, casts, spiritCasts: 0, berserkUptime: null, berserkAt: null };
}

export function rehanFight(o, m, p, seed) {
  const bins = new Float64Array(Math.ceil(o.duration / 0.1));
  const add = (t, dmg) => (bins[Math.min(bins.length - 1, Math.floor(t / 0.1))] += dmg);
  const roll = castRoller(p, seed);
  // With every buff up, the fight starts in Berserk (long since past any disarm) and stays there
  let rage = o.fullBuffs ? m.maxRage : o.startRage;
  let berserk = !!o.fullBuffs;
  let berserkSince = o.fullBuffs ? -Infinity : null;
  let berserkAt = o.fullBuffs ? 0 : null;
  let berserkTime = 0;
  let nextCast = 0;
  let spiritUntil = -1;
  let nextSpirit = null;
  let gains = []; // [time, Rage actually gained]
  let playerTotal = 0;
  let spiritTotal = 0;
  let casts = 0;
  let spiritCasts = 0;
  let stackSum = 0;

  const gain = (t, amount) => {
    const got = Math.min(m.maxRage - rage, amount * (1 + m.rageGainedPct / 100));
    if (got <= 0) return;
    rage += got;
    gains.push([t, got]);
  };

  for (let i = 0; i * o.dt < o.duration; i++) {
    const t = i * o.dt;
    gains = gains.filter(([at]) => at > t - o.recentlySeconds);
    const recent = gains.reduce((s, [, g]) => s + g, 0);
    const stacks = !m.infusion ? 0 : o.fullBuffs ? m.infusion.maxStacks : Math.min(m.infusion.maxStacks, Math.floor(recent / m.infusion.perRage));
    stackSum += stacks * o.dt;

    // Rage bonuses use twice the Max Rage while Berserk is active
    const rageForBonus = berserk ? 2 * m.maxRage : rage;
    const speed = (1 + (p.incAspdPct + rageForBonus * m.aspdPerRagePct) / 100) / (1 + p.incAspdPct / 100);
    const shared = (berserk ? 1 + m.berserkAddnPct / 100 : 1) * (1 + (stacks * (m.infusion?.pctPerStack ?? 0)) / 100);

    const disarmed = berserk && m.spirit?.disarms && !(m.infusion && t - berserkSince >= m.infusion.armedAfter);
    if (!disarmed && t >= nextCast) {
      nextCast = t + 1 / (p.castsPerSec * speed);
      casts++;
      const dmg = roll(p.damagePerCast) * shared * (1 + m.playerAddnPct / 100);
      add(t, dmg);
      playerTotal += dmg;
      if (berserk) {
        rage -= m.castCost;
        if (m.spirit?.mode === 'onCast') spiritUntil = t + m.spirit.duration;
      } else gain(t, m.rageOnCast);
    }

    // The spirit attacks as soon as it appears, then at your attack rate (Fury's Onslaught: -30%)
    const spiritOut = m.spirit && (m.spirit.mode === 'always' ? berserk : t < spiritUntil);
    if (!spiritOut) nextSpirit = null;
    else {
      nextSpirit ??= t;
      if (t >= nextSpirit) {
        nextSpirit = t + 1 / (p.castsPerSec * speed * m.spirit.aspdMult);
        spiritCasts++;
        const dmg = roll(p.damagePerCast) * shared * (1 + m.spirit.addnPct / 100) * (o.spiritDamagePct / 100);
        add(t, dmg);
        spiritTotal += dmg;
        if (m.rageOnSpiritCast) gain(t, m.rageOnSpiritCast);
      }
    }

    if (berserk) {
      rage -= m.drainPerSec * o.dt;
      berserkTime += o.dt;
      if (rage <= 0) {
        rage = 0;
        berserk = !!o.fullBuffs;
      }
    } else if (rage >= m.maxRage) {
      berserk = true;
      berserkSince = t;
      berserkAt ??= t;
    }
  }

  return {
    ...summarize(bins, o.duration),
    breakdown: { player: playerTotal / o.duration, spirit: spiritTotal / o.duration },
    casts,
    spiritCasts,
    berserkUptime: berserkTime / o.duration,
    berserkAt,
    avgInfusionStacks: stackSum / o.duration,
  };
}
