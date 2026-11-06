// In-game DPS for Spell Burst builds (a spell main skill with Max Spell Burst, e.g. CoffeeBingTest's
// Fire Burst). The engine gives one cast's hit (H), the extra damage for casts made by Spell Burst
// (B), Max Spell Burst (M), the charge speed and the cast speed. This plays a dummy fight out on the
// game's 30 Hz clock for what changes over time: the charge filling and bursting; Bing #2's Whimsy
// and Ingenuity Essence (Whimsy Signal, Mind Domain's field, Flash of Brilliance, Ingenuity
// Overload); and the buffs Activation Medium: Spell Burst casts by itself, up and down with their
// cooldowns.
//
// Rules nobody has measured yet are switches (SPELL_SIM_DEFAULTS and the combat toggles), each
// with what it rests on. tlidb is the game text; "TLI Builder" is github.com/Tyrayla/TLIBuilder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tob from '../engine/tob.bundle.js';
import { runEngine } from '../engine/bridge.js';
import { bingTraitLevel, FLASH_CHANCE, FLASH_INTERVAL, MIND_DOMAIN_CAP, MULTI_COUPLING_CAP, MULTI_COUPLING_DURATION } from './bing.js';
import { averageFights, FIGHT_SEEDS, rng, summarize } from './summary.js';
import { mainContext, rotatingTurns } from '../engine/bridge.js';

export const SPELL_SIM_DEFAULTS = {
  duration: 60, // an Ingenuity Overload comes every several seconds, so a longer fight than usual
  // TLI Builder (backend/engine/tick.py, confirmed by its owner): the game counts Spell Burst
  // charge on a 30 Hz clock, so a bar fills in a whole number of ticks
  tickRate: 30,
  // Both engines: one full bar takes 2 s at +0% Spell Burst Charge Speed
  baseChargeSeconds: 2,
  // 'bar': the bar fills in 2 s / F whatever Max Spell Burst is (stacksPerBar null), so a bigger
  // bar fires more casts per second: CoffeeBingBong's 3-4 minute dummy runs (2026-11-03) gave
  // x1.23 for Max Spell Burst 5 -> 6 (948B -> 1,166B) with nothing else changed, as a fixed bar
  // predicts (7/6 casts, plus Ingenuity Overload's 3 x M). A number here makes the bar fill stack
  // by stack instead, each in (2 s / F) / stacksPerBar (an earlier reading of a Max Spell Burst 4
  // run, since outweighed by the long runs). 'stack': every stack takes the whole 2 s / F (an idea
  // in TLI Builder's notes, SPELLBURST-04), which makes bursts M times rarer. Combat toggle.
  chargeModel: 'bar',
  stacksPerBar: null,
  // tlidb's Spell Burst: "the next Spell Skill used will activate Spell Burst, which will consume
  // all stacks charged and automatically use the Spell Skill the same number of times": the
  // activating cast plus M automatic ones (TLI Builder counts M + 1). Combat toggle.
  countActivatingCast: true,
  // Whether the activating cast also gets the "cast by Spell Burst" bonuses (unknown in both
  // engines; TLI Builder SPELLBURST-01 #1). Combat toggle.
  activatingCastBoosted: false,
  // Casting the skill by hand between bursts. An auto-trigger build (Solid River) can stand still;
  // TLI Builder counts no hand casts then. Combat toggle.
  handCasting: false,
  // Activation Medium: Spell Burst ("Triggers the supported skill when activating Spell Burst.
  // Interval: 0.1s") recasts a buff only once the buff's own cooldown is over. Unverified.
  amRespectsCooldown: true,
  // The player's rule (2026-10-13): count every buff at 100% uptime (Activation Medium buffs,
  // Whimsy Signal, Mind Domain's stacks) rather than timing them. Combat toggle "Buffs always up".
  buffsAlwaysUp: true,
  // Whether Spell Burst's automatic casts count toward "Every 2 time(s) this skill is cast,
  // generates a Thunderbolt" (unknown; if not, casting by hand is what keeps Thunderbolts coming)
  autoCastsMakeThunderbolts: true,
  // How Reverberation and Aftershock add Thunderbolts: 'afterVanish' (once the first ones vanish, new
  // ones go only to Reverberation's 10) or 'overflow' (the capped ones keep refilling, extras go to
  // Reverberation's 10, Aftershock's replacements sit outside the cap)
  // 'overflow' is the default: it puts CoffeeBingTest's four dummy runs (with/without
  // Reverberation, by hand / Solid River only) at 87-105% of their averages; 'afterVanish' at 61-68%.
  thunderboltRule: 'overflow',
  // Thunderbolts up on average as the player counts them (0 = use the model above)
  thunderboltsUp: 0,
  thunderboltsAtOverload: 0,
  overloadBoltSeconds: 3, // assumed: how long the count stays up after an Overload
  whimsyPerSec: 20, // tlidb Creative Genius: "Restores 20 Whimsy Essence per second"
  // tlidb Whimsy Explosion: "consuming 100 Whimsy Essence while restoring 25 Ingenuity Essence"; the
  // player watched his gauge jump 50 a time with Genius Idea Generator's +100% Whimsy Effect on
  // (2026-11-03), so that line doubles it. Combat toggle.
  ingenuityPerExplosion: 50,
  flashGivesIngenuity: true, // assumed: Flash of Brilliance's free explosions restore Ingenuity too
  overflowInterval: 1, // tlidb Inspiration Overflow: its Whimsy restore has "Interval: 1s"
  signalSeconds: 5, // tlidb Whimsy Signal: "+20% additional Spell Damage taken for 5s"
  whimsySeconds: 10, // tlidb Whimsy: "+5% additional Spell Damage (multiplies) for 10s"
  whimsyEvery: 0.5, // tlidb Mind Domain: "Gains 1 stack of Whimsy for every 0.5s staying in the energy field"
  fieldSeconds: 5, // assumed: how long Mind Domain's energy field stays (tlidb doesn't say)
  // Inspiration Overflow restores 80 Ingenuity on entering a stage; a dummy test usually starts
  // later, so the fight starts empty
  startIngenuity: 0,
};

// tlidb's current skill cards (data/gamedata/skillData.json, written by scripts/import-tlidb.js), by
// game id, or by name for a sample build's skills (they have no id)
let skillData = null;
let skillByName = null;
function skillCard(skill) {
  if (skillData === null) {
    try {
      skillData = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/gamedata/skillData.json'), 'utf8'));
    } catch {
      skillData = {};
    }
    skillByName = new Map(Object.values(skillData).map((c) => [c.name, c]));
  }
  return (skill?.baseId != null ? skillData[String(skill.baseId)] : null) ?? skillByName.get(skill?.name) ?? null;
}

// A skill Activation Medium: Spell Burst casts, timed from its tlidb card ("Lasts 6s.", Cooldown
// 10 s). Without a duration (Mana Boil lasts until Mana runs out) it's taken as up for good.
// Terrain of Malice: "CD of the supported skill is changed to 8s". Empower skills count for
// Multi-Coupling Equation.
function buffTiming(group) {
  const card = skillCard(group.skill);
  if (!card?.header?.cooldown) return null;
  return {
    duration: card.durations?.find((d) => d.kind === 'skill')?.seconds ?? Infinity,
    cooldown: group.supports.some((s) => s.name === 'Terrain of Malice') ? 8 : card.header.cooldown,
    empower: (card.tags ?? []).includes('Empower'),
  };
}

// Thunderbolts, from the main skill's tlidb card (Lightning Beam: "Every 2 time(s) this skill is
// cast, generates a Thunderbolt around the caster that follows the caster and automatically casts
// this skill", "This skill generates up to 3 Thunderbolt(s)", "For every +1 Beam(s), increases this
// skill's Thunderbolt generation upper limit by +1", "The Thunderbolts last for 6s") and its Noble/
// Magnificent supports: Aftershock, "Another thunderbolt will be generated after the thunderbolt
// generated by the supported skill vanishes. The thunderbolt generated by this effect will not
// generate any more thunderbolts"; Reverberation, "Thunderbolts generated after the supported
// skill's initial thunderbolts vanish do not count toward the Base Max Thunderbolt Quantity. This
// effect can only generate up to 10 thunderbolts, and additionally -50% to their Duration".
function thunderboltRules(group) {
  const card = skillCard(group?.skill);
  const text = (card?.details ?? []).join('\n');
  const every = /Every (\d+) time\(s\) this skill is cast, generates a Thunderbolt/i.exec(text);
  if (!every) return null;
  const supports = group.supports.map((s) => s.name ?? '');
  // "+2 additional Beams for the supported Beam Skill" (Scattershot Beam)
  const beams = supports.reduce((sum, name) => {
    const data = tob.SupportSkills.find((s) => s.name === name);
    return sum + Number(/\+(\d+) additional Beams/i.exec(JSON.stringify(data ?? {}))?.[1] ?? 0);
  }, 0);
  return {
    every: Number(every[1]),
    cap: Number(/generates up to (\d+) Thunderbolt/i.exec(text)?.[1] ?? 3) + beams,
    duration: Number(/Thunderbolts last for (\d+(?:\.\d+)?)\s*s/i.exec(text)?.[1] ?? 6),
    aftershock: supports.some((n) => /Aftershock/.test(n)),
    reverb: supports.some((n) => /Reverberation/.test(n)) ? { max: 10, durationMult: 0.5 } : null,
  };
}

const addnFactor = (mods, test) => mods.filter((m) => m.type === 'DmgPct' && m.addn && test(m)).reduce((p, m) => p * (1 + m.value / 100), 1);
const supportValue = (name, level) => tob.SupportSkills.find((s) => s.name === name)?.templates?.[0]?.levelValues?.[Math.min(40, Math.max(1, level)) - 1] ?? 0;

export function simulateSpell(character, scenario, { pactspirits, hero, ...overrides } = {}) {
  const o = { ...SPELL_SIM_DEFAULTS, ...overrides };
  for (const [key, field] of [
    ['chargeModel', 'spellBurstPerStack'],
    ['countActivatingCast', 'burstCountsActivatingCast'],
    ['activatingCastBoosted', 'burstActivatingCastBoosted'],
    ['handCasting', 'handCasting'],
    ['buffsAlwaysUp', 'buffsAlwaysUp'],
    ['thunderboltsUp', 'thunderboltsUp'],
    ['thunderboltsAtOverload', 'thunderboltsAtOverload'],
    ['ingenuityPerExplosion', 'ingenuityPerExplosion'],
  ]) {
    if (scenario[field] == null) continue;
    o[key] = key === 'chargeModel' ? (scenario[field] ? 'stack' : 'bar') : key === 'thunderboltsUp' || key === 'thunderboltsAtOverload' || key === 'ingenuityPerExplosion' ? Number(scenario[field]) || 0 : !!scenario[field];
  }

  const heroName = hero?.name ?? '';
  const bing = /Creative Genius/.test(heroName);
  const traitLevel = (name) => bingTraitLevel(hero, name);
  const mindDomain = traitLevel('Mind Domain');
  const fieldCap = mindDomain ? MIND_DOMAIN_CAP[mindDomain - 1] : 0;
  const whimsyCap = scenario.whimsyStacks > 0 ? Math.min(fieldCap, scenario.whimsyStacks) : 0;
  const mcLevel = traitLevel('Multi-Coupling Equation');

  // Everything up: the state the factors below are divided out of
  const full = runEngine(character, { ...scenario, ...(bing ? { targetEnemyHasWhimsySignal: true } : {}), whimsyStacks: whimsyCap }, { pactspirits, hero });
  if (!full.ok) return { supported: false, reason: `The engine couldn't run: ${full.error}` };
  const skill = full.results.skills[full.mainSkill];
  const spell = skill?.spellDpsSummary;
  const burst = skill?.spellBurstDpsSummary;
  if (!spell?.avgDps) return { supported: false, reason: `The engine has no spell damage for ${full.mainSkill ?? 'the main skill'}.` };
  if (!burst) return { supported: false, reason: `${full.mainSkill} has no Spell Burst.` };
  const mods = skill.resolvedMods;

  // One cast (crits, double damage and the rest included), the burst bonus, and the timing numbers
  const H = spell.avgDps / spell.castsPerSec;
  const B = mods.filter((m) => m.type === 'SpellBurstAdditionalDmgPct').reduce((p, m) => p * (1 + m.value / 100), 1);
  // The engine's burst rate is 0.5/s at +0% charge speed; F is the charge speed factor alone
  const F = burst.burstsPerSec / 0.5;
  const handRate = spell.castsPerSec;
  // Solid River (helmet): "When Burst Charge Recovery Speed is at least 240% of the base value,
  // reaching the Max Spell Burst Charge triggers the Main Skill". TLI Builder compares the increased
  // bonuses only (Play Safe copies Cast Speed into them).
  const playSafe = mods.some((m) => m.type === 'PlaySafe');
  const incCharge = mods.filter((m) => (m.type === 'SpellBurstChargeSpeedPct' || (playSafe && m.type === 'CspdPct')) && !m.addn).reduce((s, m) => s + m.value, 0);
  const autoTrigger = /reaching the Max Spell Burst Charge triggers the Main Skill/i.test(character.equipment.map((e) => (e.item?.affixes ?? []).map((a) => a.text).join('\n')).join('\n'));
  const autoActive = autoTrigger && 1 + incCharge / 100 >= 2.4;
  if (!autoActive && !o.handCasting) o.handCasting = true; // without the auto trigger, bursts need casting

  // Factors that come and go during the fight, from the engine's own numbers at full
  const signalF = addnFactor(mods, (m) => m.src === 'Whimsy Signal');
  // "+X% Whimsy Effect" (Genius Idea Generator's +100%) scales the Whimsy stacks' +5% a stack
  const whimsyEff = 1 + mods.filter((m) => m.type === 'WhimsyEffPct').reduce((s, m) => s + m.value, 0) / 100;
  const mindPerStack = 1 + 0.05 * whimsyEff; // Whimsy: +5% additional Spell Damage, multiplying per stack
  if (!(o.ingenuityPerExplosion > 0)) o.ingenuityPerExplosion = 25;
  const buffs = character.skills.active
    .filter((g) => g.skill?.name && g.skill.name !== full.mainSkill && g.supports.some((s) => /^Activation Medium: Spell Burst/.test(s.name ?? '')))
    .map((g) => ({ g, b: buffTiming(g) }))
    .filter(({ b }) => b)
    .map(({ g, b }) => {
      // Support levels as the engine counts them (+Support Skill Level and +All Skills' Levels)
      const bonus = mods.filter((m) => m.type === 'SkillLevel' && ['support', 'all'].includes(m.skillLevelType)).reduce((s, m) => s + m.value, 0);
      const sup = (name) => g.supports.find((s) => s.name === name);
      const level = (s) => (s?.level ?? 20) + bonus;
      const durationPct = (sup('Extended Duration') ? supportValue('Extended Duration', level(sup('Extended Duration'))) : 0) + (b.empower && mcLevel ? MULTI_COUPLING_DURATION[mcLevel - 1] : 0);
      const cdrPct = sup('Cooldown Reduction') ? supportValue('Cooldown Reduction', level(sup('Cooldown Reduction'))) : 0;
      // Activation Medium's own roll, from the log: "+7% additional Cooldown Recovery Speed" or "+9%
      // additional Duration for the supported skill"
      const rolls = g.supports.find((s) => /^Activation Medium: Spell Burst/.test(s.name ?? ''))?.affixes ?? [];
      const roll = (re) => rolls.reduce((p, a) => p * (1 + Number(re.exec(a.text ?? '')?.[1] ?? 0) / 100), 1);
      const amCdr = roll(/([+-]?\d+(?:\.\d+)?)% additional Cooldown Recovery Speed/i);
      const amDuration = roll(/([+-]?\d+(?:\.\d+)?)% additional Duration/i);
      // What the buff adds to the main skill's hit, as the engine lists it ("curse: Timid Lv.18")
      const factor = addnFactor(mods, (m) => (m.src ?? '').includes(`${g.skill.name} Lv.`));
      return {
        name: g.skill.name,
        duration: b.duration * (1 + durationPct / 100) * amDuration,
        cooldown: b.cooldown / ((1 + cdrPct / 100) * amCdr),
        empower: b.empower,
        factor,
      };
    });
  const mcMod = mods.find((m) => m.type === 'MaxSpellBurst' && /Multi-Coupling/.test(m.src ?? ''));
  const mcFull = mcMod?.value ?? 0;
  const mcCap = mcLevel ? MULTI_COUPLING_CAP[mcLevel - 1] : 0;
  const empowersInEngine = buffs.filter((b) => b.empower).length;
  // Empower/Defensive effects on you the engine doesn't see (a follower's buffs, auras): a combat
  // toggle, calibrated on CoffeeBingBong's Info tab (Max Spell Burst 6 with or without Ice Bond)
  const otherEmpowers = Math.max(0, Number(scenario.otherEmpowerSkills) || 0);
  const M = burst.maxSpellBurst;

  // Thunderbolts repeat your casts (assumed; a combat toggle): the rules come from the skill's card
  const thunder = scenario.thunderboltsRepeatCasts === false ? null : thunderboltRules(character.skills.active.find((g) => g.skill?.name === full.mainSkill));

  const overflow = traitLevel('Inspiration Overflow') > 0;
  const flash = traitLevel('Flash of Brilliance');
  const autoOverload = traitLevel('Auto-Ingenuity Program') > 0;
  const whimsyRecovery = 1 + mods.filter((m) => m.type === 'WhimsyEssenceRecoverySpeedPct').reduce((s, m) => s + m.value, 0) / 100;

  // Gear whose buffs take turns (Illusory Chimera): the engine's hit carries their long-run average,
  // the fight plays the turns out so a window with an overlap spikes like the dummy's best 5 s
  const turns = character.equipment.map((e) => (e.item?.affixes ?? []).map((a) => rotatingTurns(a.text, mainContext(character, full.mainSkill))).find(Boolean)).find(Boolean) ?? null;

  const p = {
    H,
    B,
    F,
    M,
    turns,
    handRate,
    autoActive,
    bing,
    signalF,
    mindPerStack,
    whimsyCap,
    buffs,
    mcFull,
    mcCap,
    empowersInEngine,
    otherEmpowers,
    overflow,
    flash: flash ? { chance: FLASH_CHANCE[flash - 1] / 100, interval: FLASH_INTERVAL[flash - 1] } : null,
    overload: bing ? (autoOverload ? 'auto' : 'manual') : 'off',
    whimsyRecovery,
    thunder,
  };
  const fight = averageFights(FIGHT_SEEDS.map((seed) => spellFight(o, p, seed)));
  // (the bar as the fight charges it, with Multi-Coupling's count from every Empower effect up)
  const simM = M - mcFull + Math.min(Math.floor((empowersInEngine + otherEmpowers) / 2), mcCap);
  const ticksPerBar = Math.ceil((o.tickRate * o.baseChargeSeconds * (o.chargeModel === 'stack' ? simM : o.stacksPerBar ? simM / o.stacksPerBar : 1)) / F);

  return {
    supported: true,
    kind: 'spellBurst',
    skill: full.mainSkill,
    policy: 'spellBurst',
    ...fight,
    params: {
      hit: H,
      burstMult: B,
      chargeFactor: F,
      incChargePct: incCharge,
      // As the simulation runs it with every buff up (Multi-Coupling's count included)
      maxSpellBurst: M - mcFull + Math.min(Math.floor((empowersInEngine + otherEmpowers) / 2), mcCap),
      castsPerBurst: M - mcFull + Math.min(Math.floor((empowersInEngine + otherEmpowers) / 2), mcCap) + (o.countActivatingCast ? 1 : 0),
      ticksPerBar,
      secondsPerBurst: ticksPerBar / o.tickRate,
      handRate,
      autoTrigger: autoActive,
      whimsySignal: bing ? signalF : null,
      whimsyCap,
      thunderbolts: thunder,
      buffs: buffs.map(({ name, duration, cooldown, factor }) => ({ name, duration, cooldown, factor })),
    },
    assumptions: o,
    engineStates: 1,
  };
}


export function spellFight(o, p, seed = 1) {
  const random = rng(seed);
  const dt = 1 / o.tickRate;
  const bins = new Float64Array(Math.ceil(o.duration / 0.1));
  const totals = { burst: 0, activating: 0, hand: 0, overload: 0, thunderbolts: 0 };
  // Thunderbolts up: the capped ones (Aftershock's replacements count toward the cap unless
  // Reverberation), and Reverberation's own (expiry times)
  const bolts = [];
  const echoes = [];
  const afters = []; // Aftershock replacements outside the cap (the 'overflow' reading)
  let firstVanished = false;
  // The player's count instead of the model: thunderboltsUp normally, thunderboltsAtOverload for a
  // few seconds after each Ingenuity Overload (CoffeeBingTest: 9, and 13 around Overload)
  let lastOverloadAt = -Infinity;
  const countedBolts = (t) => (o.thunderboltsAtOverload > 0 && t - lastOverloadAt < o.overloadBoltSeconds ? o.thunderboltsAtOverload : o.thunderboltsUp);
  let castCount = 0;
  let boltTime = 0;
  const uptime = Object.fromEntries(p.buffs.map((b) => [b.name, 0]));
  let signalTime = 0;
  let whimsyTime = 0;

  let charge = 0; // progress toward a full bar, 0-1
  let handProgress = 0;
  let whimsy = 0;
  let ingenuity = o.startIngenuity;
  let signalUntil = -1;
  let fieldUntil = -1;
  let stacks = 0;
  let stacksUntil = -1;
  let nextStackAt = 0;
  let overflowReadyAt = 0;
  let flashReadyAt = 0;
  let pendingExplosion = false;
  const buffUntil = p.buffs.map(() => (o.buffsAlwaysUp ? Infinity : -1));
  const buffReady = p.buffs.map(() => 0);
  if (o.buffsAlwaysUp) {
    signalUntil = Infinity;
    stacks = p.whimsyCap;
    stacksUntil = Infinity;
  }
  let bursts = 0;
  let overloads = 0;
  let explosions = 0;

  const maxBurst = (t) => {
    const empowers = p.buffs.filter((b, i) => b.empower && t < buffUntil[i]).length + (p.otherEmpowers ?? 0);
    return p.M - p.mcFull + Math.min(Math.floor(empowers / 2), p.mcCap);
  };
  // One cast's hit right now: the full-state hit with whatever is down divided out
  const hitNow = (t) => {
    let h = p.H;
    if (p.bing && t >= signalUntil) h /= p.signalF;
    if (p.whimsyCap > 0) h *= p.mindPerStack ** ((t < stacksUntil ? stacks : 0) - p.whimsyCap);
    p.buffs.forEach((b, i) => {
      if (t >= buffUntil[i]) h /= b.factor;
    });
    if (p.turns) h *= turnsNow(t) / p.turns.average;
    return h;
  };
  // The turn buffs up at t: turn k starts every cycle at k x period and lasts duration (past the
  // next turn's start when Skill Effect Duration stretches it)
  const turnsNow = (t) => {
    const { bonuses, period, duration } = p.turns;
    const cycle = period * bonuses.length;
    let f = 1;
    bonuses.forEach((b, k) => {
      if (!b) return;
      const since = (((t - k * period) % cycle) + cycle) % cycle;
      if (since < duration) f *= 1 + b;
    });
    return f;
  };
  const explode = (t, free) => {
    if (!free) whimsy -= 100;
    if (!free || o.flashGivesIngenuity) ingenuity = Math.min(100, ingenuity + o.ingenuityPerExplosion);
    signalUntil = Math.max(signalUntil, t + o.signalSeconds);
    fieldUntil = t + o.fieldSeconds;
    explosions++;
  };
  // A cast of the main skill: its damage, then what that hit sets off (a Whimsy Explosion once
  // Whimsy is full, whose Whimsy Signal counts from the next hit on; Flash of Brilliance)
  // auto: one of Spell Burst's automatic casts (not the cast that sets the burst off)
  const cast = (t, kind, boosted, auto = false) => {
    const dmg = hitNow(t) * (boosted ? p.B : 1);
    // Thunderbolts up right now: modelled, or the average the player sees (a combat toggle)
    const repeats = !p.thunder ? 0 : o.thunderboltsUp > 0 ? countedBolts(t) : bolts.length + echoes.length + afters.length;
    totals[kind] += dmg;
    totals.thunderbolts += dmg * repeats;
    bins[Math.min(bins.length - 1, Math.floor(t / 0.1))] += dmg * (1 + repeats);
    if (!auto || o.autoCastsMakeThunderbolts) castCount++;
    if (p.thunder && (!auto || o.autoCastsMakeThunderbolts) && castCount % p.thunder.every === 0) {
      if (o.thunderboltRule === 'overflow') {
        // The capped ones refill; with Reverberation, once the first ones have vanished, any made
        // past the cap go outside it (up to 10, half duration)
        if (bolts.length < p.thunder.cap) bolts.push({ until: t + p.thunder.duration, fromAftershock: false });
        else if (p.thunder.reverb && firstVanished && echoes.length < p.thunder.reverb.max) echoes.push(t + p.thunder.duration * p.thunder.reverb.durationMult);
      } else if (p.thunder.reverb && firstVanished) {
        // With Reverberation, every Thunderbolt made once the first ones have vanished goes outside
        // the cap: up to 10 at a time, at half duration
        if (echoes.length < p.thunder.reverb.max) echoes.push(t + p.thunder.duration * p.thunder.reverb.durationMult);
      } else if (bolts.length < p.thunder.cap) bolts.push({ until: t + p.thunder.duration, fromAftershock: false });
    }
    if (p.bing && pendingExplosion) {
      pendingExplosion = false;
      explode(t, false);
    }
    if (p.flash && t >= flashReadyAt && random() < p.flash.chance) {
      flashReadyAt = t + p.flash.interval;
      explode(t, true);
    }
  };
  // Spell Burst: the activating cast, M automatic casts, Activation Medium's buffs and Whimsy
  const burstAt = (t, m, kind) => {
    bursts++;
    p.buffs.forEach((b, i) => {
      if (!o.amRespectsCooldown || t >= buffReady[i]) {
        buffUntil[i] = Math.max(buffUntil[i], t + b.duration);
        buffReady[i] = t + b.cooldown;
      }
    });
    if (p.overflow && t >= overflowReadyAt) {
      overflowReadyAt = t + o.overflowInterval;
      whimsy = Math.min(100, whimsy + 5 + 6 * Math.floor(m / 2));
    }
    if (o.countActivatingCast) cast(t, kind === 'overload' ? 'overload' : 'activating', o.activatingCastBoosted);
    for (let k = 0; k < m; k++) cast(t, kind, true, true);
  };

  for (let i = 0; i * dt < o.duration; i++) {
    const t = i * dt;
    // Thunderbolts run out; Aftershock replaces each original one (once)
    if (p.thunder) {
      for (let k = bolts.length - 1; k >= 0; k--) {
        if (bolts[k].until > t) continue;
        const [gone] = bolts.splice(k, 1);
        firstVanished = true;
        if (!p.thunder.aftershock || gone.fromAftershock) continue;
        if (p.thunder.reverb) {
          if (echoes.length < p.thunder.reverb.max) echoes.push(t + p.thunder.duration * p.thunder.reverb.durationMult);
        } else if (o.thunderboltRule === 'overflow') {
          // Aftershock's replacement doesn't count toward the cap
          afters.push(t + p.thunder.duration);
        } else if (bolts.length < p.thunder.cap) bolts.push({ until: t + p.thunder.duration, fromAftershock: true });
      }
      for (let k = echoes.length - 1; k >= 0; k--) if (echoes[k] <= t) echoes.splice(k, 1);
      for (let k = afters.length - 1; k >= 0; k--) if (afters[k] <= t) afters.splice(k, 1);
      boltTime += (o.thunderboltsUp > 0 ? countedBolts(t) : bolts.length + echoes.length + afters.length) * dt;
    }
    // Charge: a bar per 2 s / F (or per m / stacksPerBar x 2 s / F), or each of m stacks per 2 s / F
    const m = maxBurst(t);
    charge += (p.F / o.baseChargeSeconds) * dt / (o.chargeModel === 'stack' ? m : o.stacksPerBar ? m / o.stacksPerBar : 1);

    // Essence: Whimsy fills; at 100 the next spell hit explodes
    if (p.bing) {
      whimsy = Math.min(100, whimsy + o.whimsyPerSec * p.whimsyRecovery * dt);
      if (whimsy >= 100) pendingExplosion = true;
      if (p.overload !== 'off' && ingenuity >= 100) {
        // Ingenuity Overload: the main skill once, Max Spell Burst +200% and charged to max; the
        // charge built so far goes with it
        ingenuity -= 100;
        overloads++;
        lastOverloadAt = t;
        charge = 0;
        burstAt(t, 3 * m, 'overload');
      }
      // Mind Domain: Whimsy stacks while standing in a field
      if (p.whimsyCap > 0 && t < fieldUntil && t >= nextStackAt) {
        stacks = Math.min(p.whimsyCap, (t < stacksUntil ? stacks : 0) + 1);
        stacksUntil = Math.max(stacksUntil, t + o.whimsySeconds);
        nextStackAt = t + o.whimsyEvery;
      }
    }

    // A full bar bursts: on its own (Solid River) or with the next hand cast. (A tick's worth of
    // slack so 30 steps of 1/30 make a full bar despite rounding.)
    const full = charge >= 1 - 1e-9;
    if (full && p.autoActive) {
      charge = 0;
      burstAt(t, m, 'burst');
    }
    if (o.handCasting) {
      handProgress += p.handRate * dt;
      while (handProgress >= 1 - 1e-9) {
        handProgress -= 1;
        if (charge >= 1 - 1e-9) {
          charge = 0;
          burstAt(t, m, 'burst');
        } else cast(t, 'hand', false);
      }
    }

    p.buffs.forEach((b, k) => {
      if (t < buffUntil[k]) uptime[b.name] += dt;
    });
    if (t < signalUntil) signalTime += dt;
    if (t < stacksUntil) whimsyTime += dt;
  }

  const breakdown = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / o.duration]));
  return {
    ...summarize(bins, o.duration),
    breakdown,
    burstsPerSec: bursts / o.duration,
    overloadsPerMin: (overloads * 60) / o.duration,
    explosionsPerMin: (explosions * 60) / o.duration,
    signalUptime: signalTime / o.duration,
    avgThunderbolts: boltTime / o.duration,
    whimsyUptime: whimsyTime / o.duration,
    buffUptime: Object.fromEntries(Object.entries(uptime).map(([k, v]) => [k, v / o.duration])),
  };
}
