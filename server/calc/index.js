// Stats and DPS for a character, computed by the vendored Torchlight of Building engine
// (server/engine). Two runs: "sheet" uses only always-on effects; "combat" adds the situational
// toggles below, which the log can't tell us (is the enemy Frostbitten, Afflicted, Cursed...).
import { BARRIER_BURST_DEFAULTS, barrierBurstModel, elixirTextFor, heroText, inferHero, inferPactspirits, mainActiveSkill, pactspiritText, runEngine, sageText } from '../engine/bridge.js';
import { simulate } from '../sim/index.js';
import { bingTraitLevel, MIND_DOMAIN_CAP } from '../sim/bing.js';
import { talentLayouts } from './talents.js';
import { legendaryItem, rareItem, sampleTree, supportEntry, typeIcon } from '../sample/build.js';
import { legendaryCatalog } from '../sample/catalog.js';
import { applyLayout, copiedTalents } from '../game/slates.js';

// The legendary catalog (every unique with its lines), built once per game data set
const LEGENDARIES = new WeakMap();
function legendariesOf(gd) {
  if (!LEGENDARIES.has(gd)) LEGENDARIES.set(gd, legendaryCatalog(gd));
  return LEGENDARIES.get(gd);
}
import { ailmentTypes, crowdControlTypes, enemyIntimidated, followerEffects } from './follower.js';
import { skillTip } from './skillTips.js';

// The hideout training dummy at each level: resistance to every element and erosion, and armor as
// the share of physical damage it stops. The engine takes armor as a value: armor / (0.9 x armor +
// 30000) is that share. Armor shares are TLI Builder's (github.com/Tyrayla/TLIBuilder,
// docs/verification/training-dummy.md); the resistances are fitted to CoffeeBingBong's cold-spell
// runs at 43% / 25% penetration (2026-11-03): Lv75 and Lv60 gained +23% / +42% over Lv85 and Lv40
// +37%, which TLI Builder's 10/15/20/30 can't give (it predicts +11% / +17% / +18%).
const armorFor = (share) => Math.round((30000 * share) / (1 - 0.9 * share));
const DUMMY_LEVELS = { 40: { res: 0, armor: 0.2 }, 60: { res: 10, armor: 0.3 }, 75: { res: 20, armor: 0.4 }, 85: { res: 40, armor: 0.5 } };
export const DUMMY_PRESETS = Object.fromEntries(
  Object.entries(DUMMY_LEVELS).map(([level, d]) => [level, { enemyElementalRes: d.res, enemyErosionRes: d.res, enemyArmor: armorFor(d.armor) }]),
);
const DUMMY = { res: DUMMY_PRESETS[85].enemyElementalRes, armor: DUMMY_PRESETS[85].enemyArmor };

// Defaults: a toggle starts on when the build's own text mentions it
export const SCENARIO_FIELDS = [
  { key: 'enemyFrostbittenEnabled', label: 'Enemy is Frostbitten', hint: /frostbite/i },
  { key: 'enemyHasAffliction', label: 'Enemy has Affliction', hint: /affliction/i },
  { key: 'targetEnemyIsCursed', label: 'Enemy is Cursed', hint: /\bcurse/i },
  // Mark (-20% Evasion, +10% additional Critical Strike Damage taken): on when the build marks on hit or crit
  { key: 'targetEnemyMarked', label: 'Enemy is Marked', hint: /\bmark the enemy|inflicts? mark\b|chance to mark\b/i },
  // Frozen once its Frostbite Rating passes 100: on when the build's Max Frostbite Rating does
  { key: 'targetEnemyIsFrozen', label: 'Enemy is Frozen', frozenFromSheet: true },
  { key: 'targetEnemyHasColdInfiltration', label: 'Enemy has Cold Infiltration', hint: /cold infiltration/i, needsFrozen: /cold infiltration when dealing damage to frozen/i },
  { key: 'targetEnemyHasFrail', label: 'Enemy has Frail', hint: /\bfrail\b/i },
  { key: 'enemyParalyzed', label: 'Enemy is Paralyzed', hint: /paraly[sz]/i },
  // Numbed: up to 10 stacks, each +5% additional Lightning Damage taken (scaled by Numbed Effect)
  { key: 'enemyNumbed', label: 'Enemy is Numbed', hint: /\bnumbed\b/i },
  // How many stacks: a Thunder Spike setup keeps 10, early gear far fewer (stacks depend on hit
  // damage against the enemy's life)
  { key: 'enemyNumbedStacks', label: 'Numbed stacks on the enemy (1-10)', number: { max: 10, fixed: 10 } },
  // When another skill keeps the enemy Numbed (a triggered Thunder Spike), its Numbed Effect from its
  // in-game panel; 0 = the main skill's own
  { key: 'enemyNumbedEffectPct', label: 'Numbed Effect on the enemy % (0 = main skill)', number: { max: 1000, fixed: 0 } },
  // Dirty Tricks, Ailment Termination: every Ailment type (Wilt, Trauma too); blank = the elemental
  // ailments the toggles above put on the enemy
  { key: 'numAilmentTypes', label: 'Ailment types on the enemy (blank = from the toggles)', number: { max: 8, auto: true } },
  // Wings of Light: crowd control types on an Intimidated enemy; blank = from the build and follower
  { key: 'numCrowdControlTypes', label: 'Crowd control types on the enemy (blank = from the build)', number: { max: 8, auto: true } },
  { key: 'targetEnemyIsElite', label: 'Target is Elite / Boss', hint: /elite|boss/i },
  // Melee builds hit from close range (pactspirits like Azure Gunslinger and Red Umbrella care)
  { key: 'targetEnemyIsNearby', label: 'Target is nearby', hint: /nearby/i, melee: true },
  { key: 'targetEnemyIsIgnited', label: 'Enemy is Ignited', hint: /\bignite/i },
  { key: 'enemyHasTrauma', label: 'Enemy has Trauma', hint: /\btrauma\b/i },
  { key: 'targetEnemyHasFireInfiltration', label: 'Enemy has Fire Infiltration', hint: /fire infiltration/i },
  // e.g. a slate's "Inflicts Lightning Infiltration on Critical Strike" (+13% Lightning Damage taken)
  { key: 'targetEnemyHasLightningInfiltration', label: 'Enemy has Lightning Infiltration', hint: /lightning infiltration/i },
  { key: 'hasUsedMobilitySkillRecently', label: 'Used a Mobility skill recently', hint: /mobility skill/i },
  { key: 'hasMovedRecently', label: 'Moved recently (5 m+)', hint: /moved more than|movement made recently/i },
  // Kitty Express grants it at max Feline Stimulant stacks; the engine misses that on its own
  { key: 'hasAttackAggression', label: 'Attack Aggression active', hint: /attack aggression/i },
  { key: 'hasFocusBlessing', label: 'Focus Blessing active', hint: /focus blessing/i },
  { key: 'hasAgilityBlessing', label: 'Agility Blessing active', hint: /agility blessing/i },
  { key: 'hasTenacityBlessing', label: 'Tenacity Blessing active', hint: /tenacity blessing/i },
  { key: 'hasBlur', label: 'Blur active', hint: /\bblur\b/i },
  { key: 'hasFullMana', label: 'At Full Mana', hint: /full mana/i, defaultOn: false },
  // Buffs that need a Critical Strike landed recently (Sage's Razor Leaf ingredient)
  { key: 'hasCritRecently', label: 'Landed a Critical Strike recently', hint: /critical strike recently|land a critical strike/i },
  // Scent Weaver Sage: Omni-Elixir Notes' stacks, one per Elixir skill cast recently (auto-cast
  // elixirs keep them full)
  { key: 'elixirCastsRecently', label: 'Elixir Skills cast recently (Omni-Elixir Notes stacks)', hint: /elixir skill cast recently/i, number: { max: 5, on: 5 } },
  // Elixir of Immortality: Temporary Life held, as % of base Max Life; blank = the trait's cap
  { key: 'temporaryLifePct', label: 'Temporary Life % of base Max Life (blank = at the cap)', number: { max: 50, auto: true } },
  // Necklace of Firebird's Barrier Burst: its tooltip ratio of Barrier dealt as damage, and how
  // often you're hit while shielded (each hit triggers it and removes the Barrier)
  { key: 'barrierBurstPct', label: 'Barrier Burst: % of Barrier dealt (from its tooltip)', number: { max: 1000, fixed: BARRIER_BURST_DEFAULTS.barrierBurstPct } },
  { key: 'barrierBurstPerSec', label: 'Barrier Burst triggers per second (hits taken while shielded)', number: { max: 20, fixed: BARRIER_BURST_DEFAULTS.barrierBurstPerSec } },
  // Hero resources, at their full values unless said otherwise (the player's rule: buffs always up)
  { key: 'rage', label: 'Rage held (Rehan, 0-100)', number: { max: 100, fixed: 100 } },
  { key: 'heatUpStacks', label: 'Heat Up stacks (Carino: Zealot of War)', number: { max: 40, fixed: 6 } },
  { key: 'specialAmmoPct', label: 'Shots spending Special Ammo % (Carino: Ranger of Glory)', number: { max: 100, fixed: 30 } },
  { key: 'purgatorySeconds', label: 'Seconds Purgatory has been up (Gemma: Flame of Pleasure)', number: { max: 10, fixed: 5 } },
  { key: 'murderousIntent', label: 'Murderous Intent held (Rosa: High Court Chariot)', number: { max: 100, fixed: 50 } },
  { key: 'command', label: 'Command held (Moto)', number: { max: 100, fixed: 25 } },
  { key: 'nourishment', label: 'Nourishment stacks on your Spirit Magi (Iris: Growing Breeze, 0-10)', number: { max: 10, fixed: 5 } },
  { key: 'inDivineRealm', label: 'Standing in the Divine Realm (Thea: Incarnation)', hint: /divine realm/i },
  { key: 'loudSong', label: 'Loud Song form (Selena: Sing with the Tide; off = Bard)', hint: /loud song/i, defaultOn: false },
  // Bing #2: Whimsy Explosion keeps Whimsy Signal on the enemy (the simulation times it)
  { key: 'targetEnemyHasWhimsySignal', label: 'Enemy has Whimsy Signal', hint: /whimsy signal/i },
  // Bing #2 Mind Domain: Whimsy stacks from standing in its energy field (0 = standing elsewhere)
  // Simulation: the Ingenuity Essence a Whimsy Explosion restores (tlidb says 25; the player watched his
  // gauge jump 50 a time with Genius Idea Generator's +100% Whimsy Effect on, 2026-11-03, so that
  // line doubles it; without such a line this should be 25)
  { key: 'ingenuityPerExplosion', label: 'Ingenuity Essence a Whimsy Explosion restores', number: { max: 100, fixed: 50 } },
  { key: 'whimsyStacks', label: "Whimsy stacks (standing in Mind Domain's field)", number: { max: 8 }, mindDomain: true },
  // Grasp of Truth's drawback: "+X% Elemental Resistance for enemies within 12m"
  { key: 'targetEnemyWithin12m', label: 'Target within 12 m', hint: /within 12 ?m\b/i },
  // Spell Aggression stacks (Burning Touch): main spell casts in the last 4 s, up to 10
  { key: 'numMainSpellSkillsCastRecently', label: 'Main spell casts recently (Spell Aggression)', hint: /main spell skill cast recently/i, number: { max: 10, on: 10 } },
  // Simulation, Spell Burst rules nobody has measured (server/sim/spell.js)
  { key: 'spellBurstPerStack', label: 'Spell Burst charges per stack (not per bar)', hint: /spell burst/i, defaultOn: false },
  { key: 'burstCountsActivatingCast', label: 'Burst includes the activating cast (M + 1 casts)', hint: /spell burst/i },
  { key: 'burstActivatingCastBoosted', label: 'Activating cast gets the Spell Burst bonuses', hint: /spell burst/i, defaultOn: false },
  { key: 'handCasting', label: 'Also casting the skill by hand', hint: /spell burst/i, defaultOn: false },
  // Simulation: every buff at 100% uptime (the player's rule) instead of timed with its cooldown
  { key: 'buffsAlwaysUp', label: 'Buffs always up (100% uptime)', hint: /spell burst/i },
  // Simulation: Lightning Beam's Thunderbolts repeat each of your casts (fits CoffeeBingTest's dummy
  // runs: 163B without Reverberation, 260B with it)
  { key: 'thunderboltsRepeatCasts', label: 'Thunderbolts repeat your casts', hint: /lightning beam/i },
  // The Thunderbolts the player sees up on average (CoffeeBingTest: 9-13 with Ingenuity Overload,
  // about 11); 0 = the simulation's own count
  // Multi-Coupling Equation counts "Empower or Defensive skills affecting you": the build's own
  // Activation Medium skills, plus any effects from allies and auras set here (0: the player says
  // equipping Ice Bond is what gives him the +1 Max Spell Burst, 2026-11-03)
  { key: 'otherEmpowerSkills', label: 'Empower/Defensive effects on you from allies or auras (Multi-Coupling)', number: { max: 6, fixed: 0 } },
  { key: 'thunderboltsUp', label: 'Thunderbolts up (0 = modelled)', number: { max: 30, fixed: 0 } },
  { key: 'thunderboltsAtOverload', label: 'Thunderbolts up just after an Ingenuity Overload (0 = same)', number: { max: 30, fixed: 0 } },
  // Extra Effect bonus on every slate line, on top of the per-talent bonuses the log gives
  { key: 'slateEffectPct', label: 'Extra Divinity slate effect %', number: { max: 500, fixed: 0 } },
  // Ill Omen's True Damage (simulation); a training dummy is taken as an Elite
  { key: 'illOmen', label: 'Ill Omen procs (Elite target)', hint: /ominous|ill omen/i },
  // Simulation: whether Ill Omen's own burst counts toward its next stacks (TLI Builder saw it in
  // game; CoffeeTerra's golem test fits better without it)
  { key: 'illOmenSelfFeed', label: "Ill Omen's burst feeds its next stacks", hint: /ominous|ill omen/i, defaultOn: false },
  // Simulation: a reap can take what the Terra still has to deal, not just its 2 s DoT (off: the
  // golem test fits the 2 s limit)
  { key: 'reapWholeTerra', label: "Reaps take the Terra's remaining time", hint: /\bterra\b/i, defaultOn: false },
  // Simulation: how often you actually recast the main skill; 0 = as often as its cooldown allows
  { key: 'recastMs', label: 'Recast every (ms, 0 = cooldown)', number: { max: 10000, fixed: 0 } },
  { key: 'tormentStacks', label: 'Torment stacks', hint: /torment/i, number: { max: 3, on: 3 } },
  // Sealed Life caps current Life, so a build that seals most of it stays at Low Life (under 35%)
  { key: 'currentLifePct', label: 'Current Life % (Low Life under 35)', number: { max: 100 }, fromSheet: true },
  // The hideout training dummy: picking its level sets the three fields below (DUMMY_PRESETS)
  { key: 'dummyLevel', label: 'Training dummy level (40/60/75/85)', number: { max: 85, fixed: 85 } },
  { key: 'enemyElementalRes', label: 'Enemy elemental resistance %', number: { max: 100, fixed: DUMMY.res } },
  { key: 'enemyErosionRes', label: 'Enemy erosion resistance %', number: { max: 100, fixed: DUMMY.res } },
  // 27273 = 50% less physical damage (30% less elemental/erosion hits; DoT ignores armor); 0 for none
  { key: 'enemyArmor', label: 'Enemy armor', number: { max: 100000, fixed: DUMMY.armor } },
  // TLI Builder's rule had armor cutting non-physical hits at 60% of its physical cut; the level 85
  // dummy measured no cut at all on a cold spell build (2026-11-02), so off unless switched on
  { key: 'armorHitsNonPhysical', label: 'Enemy armor also cuts non-physical hits (60%)', hint: /./, defaultOn: false },
  // Effect supports on Empower skills: Well-Fought Battle stacks per cast in a row and the charges an
  // Empower skill is used with for Mass Effect. At full (3 and 2) an Activation-Medium-cast Ice Bond
  // matched the dummy within 2% over 6-minute runs (2026-11-02/03); one-minute runs read lower
  // because the stacks take time to build, so these are the full values, the player's rule.
  // Effect supports on Empower skills: Well-Fought Battle stacks per cast in a row and the charges an
  // Empower skill is used with for Mass Effect. CoffeeBingBong's 3-6 minute dummy runs (2026-11-03)
  // put an Activation-Medium-cast Ice Bond at x1.36 over a state with the same Max Spell Burst:
  // Euphoria 26% x 1.4, i.e. Mass Effect's +1 charge (2 x 20%) and no Well-Fought Battle stacks
  { key: 'empowerCastStacks', label: 'Empower skill casts in a row (Well-Fought Battle stacks)', number: { max: 3, fixed: 0 } },
  { key: 'empowerChargesOnUse', label: 'Charges an Empower skill is used with (Mass Effect)', number: { max: 3, fixed: 2 } },
];

// What can put crowd control on the enemy: the build's text plus the Pact board's lines and what the
// support skills say (a support's "+60% chance to inflict Weaken")
function ccText(character) {
  const supports = [...character.skills.active, ...character.skills.passive].flatMap((g) => g.supports.map((s) => skillTip(s) ?? ''));
  const destinies = (character.destinies ?? []).filter((d) => d.active !== false).flatMap((d) => (d.affixes ?? []).map((a) => a.text ?? ''));
  return [buildText(character), ...supports, ...destinies].join('\n');
}

function buildText(character) {
  const parts = [];
  for (const { item } of character.equipment) for (const a of item?.affixes ?? []) parts.push(a.text ?? '');
  for (const m of character.memories) for (const a of m.item.affixes ?? []) parts.push(a.text ?? '');
  for (const t of character.talentTrees) for (const n of t.nodes) if (n.points) parts.push(n.text ?? '');
  for (const t of character.talentTrees) for (const core of t.cores ?? []) parts.push(core.text ?? '');
  for (const s of character.slates) for (const t of s.talents) parts.push(t.text ?? '');
  for (const g of [...character.skills.active, ...character.skills.passive]) parts.push(g.skill?.name ?? '', ...g.supports.map((s) => s.name ?? ''));
  return parts.join('\n');
}

// "[Penetrating] When dealing Fire, Lightning, or Cold Damage, inflicts Fire Infiltration, Lightning
// Infiltration, or Cold Infiltration respectively": only the main skill's own elements count
const BY_ELEMENT = /When dealing Fire, Lightning, or Cold Damage, inflicts[^\n]*respectively\.?/gi;

// extraText: more of the build's own words, e.g. what the chosen pactspirits and hero traits do.
// sheet: the engine's always-on run, for fields that follow from the build itself (Life left after
// sealing). hero: the picked or inferred hero, for fields that depend on a trait's level.
export function defaultScenario(character, extraText = '', sheet = null, hero = null) {
  const mainSkill = mainActiveSkill(character);
  const elements = (mainSkill?.tags ?? []).map((t) => t.toLowerCase()).filter((t) => ['fire', 'cold', 'lightning'].includes(t));
  const text = `${buildText(character)}\n${extraText}`.replace(BY_ELEMENT, () => elements.map((e) => `Inflicts ${e} Infiltration`).join('\n'));
  const melee = !!mainSkill?.tags?.includes('Melee');
  const mindDomainLevel = bingTraitLevel(hero, 'Mind Domain');
  const mindDomain = mindDomainLevel ? MIND_DOMAIN_CAP[mindDomainLevel - 1] : 0;
  const sealedLifePct = sheet?.ok ? sheet.results.resourcePool?.sealedResources?.sealedLifePct ?? 0 : 0;
  // Frostbite Rating: 10 + "to Max Frostbite Rating"; above 100 the enemy is Frozen
  const mainMods = sheet?.ok ? sheet.results.skills[sheet.mainSkill]?.resolvedMods ?? [] : [];
  const frozen = 10 + mainMods.filter((m) => m.type === 'MaxFrostbiteRating').reduce((s, m) => s + m.value, 0) > 100;
  return Object.fromEntries(
    SCENARIO_FIELDS.map((f) => {
      if (f.fromSheet) return [f.key, Math.max(1, Math.round(100 - sealedLifePct))];
      if (f.frozenFromSheet) return [f.key, frozen];
      if (f.mindDomain) return [f.key, mindDomain];
      if (f.number?.fixed != null) return [f.key, f.number.fixed];
      if (f.number?.auto) return [f.key, null];
      const on = f.defaultOn !== false && (f.hint.test(text) || (f.melee && melee)) && (!f.needsFrozen || !f.needsFrozen.test(text) || frozen);
      return [f.key, f.number ? (on ? f.number.on : 0) : on];
    }),
  );
}

// Names: how much of the build's ids the game data could name
function nameCoverage(character, gd) {
  const coverage = {};
  const count = (kind, known) => {
    const c = (coverage[kind] ??= { total: 0, known: 0 });
    c.total++;
    if (known) c.known++;
  };
  for (const { item } of character.equipment) for (const a of item?.affixes ?? []) count('affixes', !!a.text);
  for (const m of character.memories) for (const a of m.item.affixes ?? []) count('affixes', !!a.text);
  for (const t of character.talentTrees) for (const n of t.nodes) if (n.points) count('talents', !!gd.get('talents', n.id));
  for (const s of character.slates) for (const t of s.talents) count('talents', !!t.text);
  for (const t of character.heroTraits) count('heroTraits', !!t.name);
  return coverage;
}

function dpsBreakdown(summary) {
  if (!summary) return null;
  return {
    total: summary.totalDps,
    persistent: summary.persistentDpsSummary?.total ?? null,
    persistentDuration: summary.persistentDpsSummary?.duration ?? null,
    reap: summary.totalReapDpsSummary?.totalReapDps ?? null,
    spell: summary.spellDpsSummary?.avgDps ?? null,
    spellBurst: summary.spellBurstDpsSummary?.avgDps ?? null,
    overload: summary.spellBurstDpsSummary?.ingenuityOverload?.avgDps ?? null,
    burstsPerSec: summary.spellBurstDpsSummary?.burstsPerSec ?? null,
    maxSpellBurst: summary.spellBurstDpsSummary?.maxSpellBurst ?? null,
    attack: summary.attackDpsSummary?.avgDps ?? null,
    castsPerSec: summary.spellDpsSummary?.castsPerSec ?? null,
    avgHit: summary.spellDpsSummary?.avgHitWithCrit ?? null,
  };
}

// choices: what the log can't tell us, picked in the UI: { hero, pactspirits, measuredDps }. Without
// a picked hero, one inferred from the log's ids is used (heroInferred).
// What the log can't give for this character and how to get it from the game screen: shown with a
// capture button (the label names the screenshot), and some screens are captured as they come up
// (server/logService.js onScreen). unmapped: the engine run's list of what it couldn't read.
const AILMENT_SCALING = /for every type of ailment|for each type of (?:elemental )?ailment/i;
const CC_SCALING = /for each type of crowd control/i;
// inferred: what the planner worked out itself ({ cc: crowd control types on the enemy })
export function characterNeeds(character, choices, unmapped = [], values = {}, logTrees = true, inferred = {}) {
  const needs = [];
  if (!logTrees && !choices.talents?.length) {
    needs.push({ key: 'talents', label: 'Talent page', what: 'Your talent trees: this login cut them off in the log', how: 'Open the talent screen and click through every tree. Each one is screenshotted as it shows.' });
  } else if (inferred.cutTrees?.length) {
    const many = inferred.cutTrees.length > 1;
    needs.push({ key: 'talents', label: 'Talent page', what: `Your ${inferred.cutTrees.join(', ')} tree${many ? 's' : ''}: the log cut ${many ? 'them' : 'it'} off at 30 entries, so nodes may be missing`, how: `Open the talent screen and show ${many ? 'those trees' : 'that tree'}. Each one is screenshotted as it shows.` });
  }
  const prism = unmapped.filter((m) => /Prism.*isn't named yet/.test(m));
  if (prism.length) needs.push({ key: 'prism', label: 'Prism tooltip', what: `Your prism's lines (${prism.length} unnamed)`, how: 'On the talent screen, hover the prism so its tooltip shows, then press Capture.' });
  const items = [...new Set(unmapped.map((m) => /^(.+?): affix #\d+ has no text/.exec(m)?.[1]).filter(Boolean))];
  for (const item of items) needs.push({ key: `item:${item}`, label: `Item: ${item}`, what: `${item}: some lines have no text in the game data`, how: `Hover ${item} so its tooltip shows, then press Capture.` });
  // Memory lines the game data has no text for (an awakened line, some implicits): not counted
  for (const m of character.memories ?? []) {
    const unnamed = (m.item?.affixes ?? []).filter((a) => !a.text && a.kind !== 'AwakenInitAffix');
    if (unnamed.length) needs.push({ key: `memory:${m.slot}`, label: `Memory: ${m.item.name}`, what: `${m.item.name}: ${unnamed.length} line(s) with no text (${unnamed.map((a) => a.kind).join(', ')})`, how: `On the hero page, hover ${m.item.name} so its tooltip shows, then press Capture.` });
  }
  // Gems slotted after logging in show up by name only: their levels and Noble/Magnificent rolls come
  // with the next login
  const noLevel = [...(character.skills?.active ?? []), ...(character.skills?.passive ?? [])].flatMap((g) => [g.skill, ...(g.supports ?? [])]).filter((s) => s?.name && s.level == null);
  if (noLevel.length) needs.push({ key: 'relog', label: 'Relog', what: `New gems without a level yet: ${noLevel.map((s) => s.name).join(', ')}`, how: 'Relog: the login writes every gem\'s level and roll to the log (no screenshot needed).' });
  // The log lists at most 30 Pact board points: Fates and Kismets in the rest (a pet's ring spots
  // with no entry) are unknown
  if ((character.gaps ?? []).some((g) => /Pact board/.test(g)) && !choices.pactBoard) {
    needs.push({ key: 'pact', label: 'Pact board', what: 'Your Pact board: the log lists only its first 30 points, so Fates in the rest are missing', how: 'Open the Pact board and show each battle pactspirit\'s area with its Fates. Each is screenshotted as it opens.' });
  }
  if (!choices.follower) needs.push({ key: 'follower', label: 'Follower', what: 'Your follower and its skills (the log never lists them)', how: 'Open the follower page and click each of its skills. Each one is screenshotted as it opens.' });
  // The board's slate shapes aren't in the log or on tlidb: a screenshot of the board teaches them
  const shapeless = (character.slates ?? []).filter((s) => s.shapeId != null && !s.cells);
  if (shapeless.length) needs.push({ key: 'slates', label: 'Divinity slate board', what: `Your slate board as the game draws it: the log gives each slate's spot but not its shape (${shapeless.length} to learn)`, how: 'Open Talent → Statue of The New God. The board is screenshotted as it opens.' });
  // Ailment types come from the toggles and the follower once it's known; crowd control types (Wings
  // of Light) only from the enemy's debuff bar
  const text = `${buildText(character)}\n${unmapped.join('\n')}`;
  const ailmentsUnknown = values.numAilmentTypes == null && !choices.follower && AILMENT_SCALING.test(text);
  if (ailmentsUnknown || (CC_SCALING.test(text) && values.numCrowdControlTypes == null && !inferred.cc?.length)) {
    needs.push({ key: 'debuffs', label: 'Dummy debuffs', what: `Which ${ailmentsUnknown ? 'ailments and ' : ''}crowd control effects the enemy has (damage scales with how many types)`, how: 'Hit the training dummy and press Capture while its debuff icons show.' });
  }
  return needs;
}

// Trees the log has but cut off (it lists at most 30 entries per tree), filled in from the ones read
// off the talent screen (choices.talents, as a sample build spells them). The log lists a tree's
// nodes in id order and drops the tail, so the screenshot's nodes with ids past the last logged one
// are the missing ones; the logged part stands as it is (a re-spec since the screenshot shows there
// first). The prism stays the log's, but its lines the game data can't name take the screenshot's
// text. Returns the trees as they'll be used, notes for the missing list, and the cut trees no
// screenshot covers.
export function fillCutTrees(trees, choices, gd) {
  const hand = choices.talents ?? [];
  const notes = [];
  const uncovered = [];
  let filled = false;
  const out = (trees ?? []).map((t) => {
    if (!t.truncated) return t;
    const i = hand.findIndex((h) => h.tree === t.name);
    const h = i >= 0 ? sampleTree(i, hand[i], gd) : null;
    if (!h) {
      uncovered.push(t.name ?? `#${t.id}`);
      return t;
    }
    const logged = new Set(t.nodes.filter((n) => n.points > 0).map((n) => n.id));
    const last = Math.max(0, ...logged);
    const added = h.nodes.filter((n) => n.points > 0 && n.id > last && !logged.has(n.id));
    const when = choices.talentsAt ? ` read on ${new Date(choices.talentsAt).toLocaleDateString()}` : '';
    let prism = t.prism;
    if (t.prism?.affixes?.length && h.prism?.affixes?.length) {
      const named = (a) => (a.text ? a : { ...a, text: h.prism.affixes.find((x) => x.id === a.id)?.text ?? a.text });
      prism = { ...t.prism, affixes: t.prism.affixes.map(named) };
      if (prism.affixes.some((a, k) => a.text !== t.prism.affixes[k].text)) filled = true;
    }
    notes.push(
      added.length
        ? `Talent tree ${t.name}: the log cut it off; ${added.length} node${added.length > 1 ? 's' : ''} past the cut (${added.map((n) => n.name).join(', ')}) come from the screenshot${when}`
        : `Talent tree ${t.name}: the log cut it off, but the screenshot${when} shows nothing past the cut`,
    );
    if (!added.length && prism === t.prism) return t;
    filled = true;
    return { ...t, nodes: [...t.nodes, ...added], points: (t.points ?? 0) + added.reduce((s, n) => s + n.points, 0), cores: t.cores?.length ? t.cores : h.cores, prism };
  });
  return { trees: out, notes, uncovered, filled };
}

// Pact board Fates read from screenshots that the log doesn't list itself: the log's 30-entry cut
// moves between logins, so a spot it does list is the log's
export function pactBoardExtras(destinies, pactBoard) {
  const logged = new Set((destinies ?? []).map((d) => d.point).filter((p) => p != null));
  return (pactBoard ?? [])
    .filter((d) => d.point == null || !logged.has(d.point))
    .map((d) => ({ point: d.point ?? null, active: true, name: d.name, type: 'Destiny', detailsKnown: true, affixes: [{ kind: 'implicit', id: null, values: [], text: d.text }] }));
}

// What-if with skills switched off: the same calculation with every skill on, for the difference
function whatIfAllOn(character, gd, scenario, choices) {
  const base = calculate(character, gd, scenario, { ...choices, disabledSkills: [], disabledSlates: [], slateLayout: null, supportSwaps: null, gearSwaps: null });
  return { allOn: { avgDps: base.sim?.supported ? base.sim.avgDps : null, peak5s: base.sim?.supported ? base.sim.peak5s : null, combat: base.dps?.combat?.total ?? null, mainSkill: base.mainSkill ?? null } };
}

// Where each part of the character comes from, for the "Character data" panel: what the log gives
// by itself (and reloads by itself), and what has to be read off screenshots, with when it was
// read and how to get it again when it changed in game.
//   cut: fillCutTrees' result; prismUnnamed: prism lines with no text; shapeless: slates with no shape
function dataSources(character, choices, cut, prismUnnamed, shapeless, logTrees) {
  const trees = character.talentTrees ?? [];
  const when = (key) => choices[`${key}At`] ?? null;
  const log = [
    { key: 'log-gear', label: 'Gear, gems and their levels, memories, hero traits, pactspirits, level', status: 'from the login dump, then every equip and unequip as it happens' },
    {
      key: 'log-trees',
      label: 'Talent trees',
      status: !logTrees && choices.talents?.length ? 'this login cut them off; the screenshot-read trees stand in' : !logTrees ? 'this login cut them off' : cut.uncovered.length ? `cut off at 30 entries (${cut.uncovered.join(', ')}): nodes past the cut are missing` : cut.notes.length ? 'cut off at 30 entries, filled from the screenshot-read trees' : 'complete',
      ok: logTrees ? cut.uncovered.length === 0 : !!choices.talents?.length,
    },
    {
      key: 'log-pact',
      label: 'Pact board',
      // Fates from screenshots that the log doesn't list itself carry no affix id
      status: (character.gaps ?? []).some((g) => /Pact board/.test(g))
        ? `first 30 spots only${choices.pactBoard?.length ? `; ${(character.destinies ?? []).filter((d) => d.type === 'Destiny' && d.affixes?.[0]?.id === null).length} Fates past the cut from screenshots` : '; Fates past the cut unknown'}`
        : 'complete',
      ok: !(character.gaps ?? []).some((g) => /Pact board/.test(g)) || !!choices.pactBoard?.length,
    },
    { key: 'log-slates', label: 'Divinity slates: lines, spots and turns', status: `${(character.slates ?? []).length} slates from the login dump` },
  ];
  const shots = [
    { key: 'talents', label: 'Talent trees past the log\'s cut', have: !!choices.talents?.length, readAt: when('talents'), needed: !logTrees || cut.uncovered.length > 0 || trees.some((t) => t.truncated), capture: 'Talent tree', how: 'Open the talent screen and click through every tree; each is screenshotted as it shows.', forget: true },
    { key: 'pactBoard', label: 'Pact board Fates past the log\'s cut', have: !!choices.pactBoard?.length, readAt: when('pactBoard'), needed: (character.gaps ?? []).some((g) => /Pact board/.test(g)), capture: 'Pact board', how: "Open the Pact board and each battle pactspirit's area with its Fates; each is screenshotted as it opens.", forget: true },
    { key: 'follower', label: 'Follower and its skills', have: !!choices.follower, readAt: when('follower'), needed: true, capture: 'Follower', how: 'Open the follower page and click each of its skills.', forget: true },
    { key: 'prism', label: 'Prism random lines', have: prismUnnamed === 0, missing: prismUnnamed, needed: trees.some((t) => t.prism), capture: 'Prism tooltip', how: 'Hover the prism on the talent screen so its tooltip shows. A re-rolled prism shows up here by itself.' },
    { key: 'slates', label: 'Slate shapes, for drawing the board', have: shapeless === 0, missing: shapeless, needed: (character.slates ?? []).length > 0, capture: 'Divinity slate board', how: 'Open Talent → Statue of The New God; it is screenshotted as it opens. A reshaped slate shows up here by itself.' },
    { key: 'extraLines', label: 'Stat lines typed in from screenshots', have: !!choices.extraLines?.length, readAt: when('extraLines'), needed: false, capture: 'Game screen', how: 'Lines the log has no record of (a tooltip, a buff).', forget: true },
  ].filter((s) => s.needed || s.have);
  return { log, shots };
}

export function calculate(character, gd, scenario, choices = {}) {
  const asLogged = character;
  // Supports swapped in the UI (choices.supportSwaps: "<kind>:<slot>:<index>" -> { name, level } or
  // null for "none"): the gem in that support slot is replaced. This is what the Skills panel shows.
  const swaps = choices.supportSwaps ?? {};
  const swapped = Object.keys(swaps).length > 0;
  let shownSkills = character.skills;
  // Rolls read off a gem's tooltip (choices.supportRolls: "<support name>" -> { text, value }): a
  // Noble/Magnificent gem socketed after login has no rolled line in the log until the next login,
  // so the tooltip's line stands in whenever the log has none
  // Gem levels read off a tooltip (choices.skillLevels: "<skill name>" -> level): a gem socketed
  // after login has no level in the log until the next login (the engine would take 20)
  const levels = choices.skillLevels ?? {};
  if (Object.keys(levels).length && shownSkills) {
    const withLevel = (g) => (g.skill?.name && g.skill.level == null && levels[g.skill.name] ? { ...g, skill: { ...g.skill, level: Number(levels[g.skill.name]), levelFromTooltip: true } } : g);
    shownSkills = { ...shownSkills, active: (shownSkills.active ?? []).map(withLevel), passive: (shownSkills.passive ?? []).map(withLevel) };
  }
  const rolls = choices.supportRolls ?? {};
  if (Object.keys(rolls).length && shownSkills) {
    const withRoll = (g) => ({ ...g, supports: g.supports.map((s) => (s?.name && rolls[s.name]?.text && !(s.affixes ?? []).some((a) => a.text) ? { ...s, affixes: [{ kind: 'prefix', id: 0, values: [Number(rolls[s.name].value) || 0], text: rolls[s.name].text, fromTooltip: true }] } : s)) });
    shownSkills = { ...shownSkills, active: (shownSkills.active ?? []).map(withRoll), passive: (shownSkills.passive ?? []).map(withRoll) };
  }
  if (swapped && shownSkills) {
    const apply = (kind) => (g) => {
      let supports = null;
      for (const [key, val] of Object.entries(swaps)) {
        const [k, slot, index] = key.split(':');
        if (k !== kind || Number(slot) !== g.slot || !g.skill) continue;
        supports ??= [...g.supports];
        const i = Number(index);
        // A Noble/Magnificent gem swapped in starts at rank 1 with a middle roll of its tier-1 line
        supports[i] = val?.name ? { ...supportEntry({ name: val.name, level: val.level ?? supports[i]?.level ?? 20, rank: val.rank ?? 1 }, gd), swapped: true, was: g.supports[i]?.name ?? null } : null;
      }
      return supports ? { ...g, supports: supports.filter(Boolean).slice(0, 5) } : g;
    };
    shownSkills = { ...shownSkills, active: (shownSkills.active ?? []).map(apply('active')), passive: (shownSkills.passive ?? []).map(apply('passive')) };
  }
  // What-if: skills switched off in the UI (choices.disabledSkills: "active:<slot>" / "passive:<slot>")
  // leave their slot empty for the engine and the simulation only; the panel keeps showing them, greyed
  const off = new Set(choices.disabledSkills ?? []);
  let engineSkills = shownSkills;
  if (off.size && shownSkills) {
    const blank = (kind) => (g) => (off.has(`${kind}:${g.slot}`) ? { ...g, skill: null, supports: [] } : g);
    engineSkills = { ...shownSkills, active: (shownSkills.active ?? []).map(blank('active')), passive: (shownSkills.passive ?? []).map(blank('passive')) };
  }
  if (engineSkills !== character.skills) character = { ...character, skills: engineSkills };
  // Gear swapped in the UI (choices.gearSwaps: slot -> null for an empty slot, { legendary, roll,
  // random, extra, corroded } or { rare: { type, name, implicit, lines, other } } as a sample build
  // spells its gear): that slot's item is replaced for the engine and shown in the Equipment panel
  const gearSwaps = choices.gearSwaps ?? {};
  const gearChanged = Object.keys(gearSwaps).length > 0;
  let shownEquipment = character.equipment;
  if (gearChanged && character.equipment) {
    const legendaries = legendariesOf(gd);
    shownEquipment = character.equipment.map((e) => {
      if (!(String(e.slot) in gearSwaps)) return e;
      const spec = gearSwaps[e.slot];
      const was = e.item?.uniqueName ?? e.item?.name ?? null;
      let item = null;
      if (spec?.legendary) {
        const legend = legendaries.find((l) => l.name === spec.legendary);
        if (!legend) return e; // a name the catalog doesn't know: the logged item stays
        item = legendaryItem(e.slot, spec, legend);
      } else if (spec?.rare?.type) item = rareItem(e.slot, spec.rare, typeIcon(gd, spec.rare.type), gd);
      return { ...e, item: item ? { ...item, swapped: true, was } : null, swapped: true, was };
    });
    character = { ...character, equipment: shownEquipment };
  }
  // Slates moved or turned on the board in the UI (choices.slateLayout), then slates taken off it
  // (choices.disabledSlates: slate ids). What the board shows: every slate as placed, with the
  // lines each copies off the slates it touches (used.slates)
  const offSlates = new Set(choices.disabledSlates ?? []);
  const layoutChanged = Object.keys(choices.slateLayout ?? {}).length > 0;
  const slatesPlaced = applyLayout(character.slates ?? [], choices.slateLayout, gd);
  const slatesOn = slatesPlaced.filter((s) => !offSlates.has(s.id));
  const slateCopies = copiedTalents(slatesOn);
  const slatesShown = slatesPlaced.map((s) => ({ ...s, copies: slateCopies.filter((t) => t.forSlate === s.id) }));
  if (layoutChanged || offSlates.size) character = { ...character, slates: slatesOn };
  const logTrees = !!character.talentTrees?.length;
  // Some logins have the talent trees cut off ("+geniusInfos+..." in the dump): trees read off the
  // talent screen and saved with the character's choices ({ tree, cores, points, prism }, as a
  // sample build has them) stand in for them
  const talentsByHand = !character.talentTrees?.length && choices.talents?.length;
  if (talentsByHand) character = { ...character, talentTrees: choices.talents.map((t, i) => sampleTree(i, t, gd)).filter(Boolean) };
  // Trees the log has but cut off: the screenshot-read ones fill in what's past the cut
  const cut = talentsByHand ? { trees: character.talentTrees, notes: [], uncovered: [], filled: false } : fillCutTrees(character.talentTrees, choices, gd);
  if (cut.filled) character = { ...character, talentTrees: cut.trees };
  // What the log has no record of but screenshots show, as stat lines: a follower's buffs on you
  // (Tartarus: Tidewell's Double Damage, Swift Shadow Raid's Projectile Speed), by source
  if (choices.extraLines?.length) character = { ...character, extraLines: [...(character.extraLines ?? []), ...choices.extraLines] };
  // Pact board Fates the log cut off (it lists 30 points), read from screenshots: { name, point, text }
  // like the logged ones (point = area x 100 + spot, so they replace that ring spot's own stat)
  if (choices.pactBoard?.length) {
    const extra = pactBoardExtras(character.destinies, choices.pactBoard);
    if (extra.length) character = { ...character, destinies: [...(character.destinies ?? []), ...extra] };
  }
  // A follower entered from screenshots: its buffs on you as stat lines, what it puts on the enemy as
  // the scenario's defaults (server/calc/follower.js)
  const follower = followerEffects(choices.follower);
  if (follower.lines.length) character = { ...character, extraLines: [...(character.extraLines ?? []), ...follower.lines] };
  const heroInferred = choices.hero ? null : inferHero(character.player, character.heroTraits, character.memories);
  const petsInferred = choices.pactspirits?.length ? null : inferPactspirits(character.pactspirits);
  const build = { hero: choices.hero ?? heroInferred ?? undefined, pactspirits: choices.pactspirits?.length ? choices.pactspirits : petsInferred };
  let sheet = runEngine(character, {}, build);
  // Barrier Burst (Necklace of Firebird) takes its hit from this run's Barrier, then runs again
  const burst = barrierBurstModel(sheet, scenario ?? {});
  if (burst) sheet = runEngine(character, {}, build);
  const extraText = `${pactspiritText(build.pactspirits)}\n${heroText(build.hero)}\n${elixirTextFor(character)}\n${sageText(build.hero)}`;
  const values = { ...defaultScenario(character, extraText, sheet, build.hero), ...follower.toggles, ...(scenario ?? {}) };
  // Ailment types on the enemy (Dirty Tricks, Ailment Termination): the number set, else counted
  const enemyAilments = ailmentTypes(values, follower.ailments);
  // Crowd control types (Wings of Light): counted only while the enemy is Intimidated
  const enemyCrowdControl = crowdControlTypes(values, ccText(character), follower.cc);
  const engineValues = {
    ...values,
    armorNonPhysicalPct: values.armorHitsNonPhysical ? 60 : 0,
    skillUseStacks: Number(values.empowerCastStacks) || 0,
    skillChargesOnUse: Number(values.empowerChargesOnUse) || 0,
    numAilmentTypes: values.numAilmentTypes ?? enemyAilments.length,
    numCrowdControlTypes: values.numCrowdControlTypes ?? (enemyIntimidated(ccText(character)) ? enemyCrowdControl.length : 0),
    // Thea #1's Prophecy of Truth: +3% additional damage per allocated Legendary Medium Talent
    legendaryMediumTalents: character.talentTrees.flatMap((t) => t.nodes).filter((n) => n.points > 0 && /^Legendary Medium/i.test(n.name ?? '')).length,
  };
  const combat = runEngine(character, engineValues, build);
  if (burst && combat.ok) combat.unmapped.push(burst.note);
  const fields = SCENARIO_FIELDS.map(({ key, label, number }) => ({ key, label, ...(number ? { max: number.max } : {}) }));

  const chosen = { hero: choices.hero ?? null, heroInferred, pactspirits: choices.pactspirits ?? [], petsInferred, measuredDps: choices.measuredDps ?? null, talentsByHand: !!talentsByHand, disabledSkills: [...off], disabledSlates: [...offSlates], slateLayout: choices.slateLayout ?? null, supportSwaps: choices.supportSwaps ?? null, gearSwaps: choices.gearSwaps ?? null, follower: choices.follower ? { ...choices.follower, skills: follower.skills, lines: follower.lines, ailments: follower.ailments, cc: follower.cc } : null };
  // Each tree's full current layout (every node, icons, prerequisites), for drawing it
  const trees = talentLayouts(character, gd);
  if (!combat.ok) {
    return { engine: { ok: false, error: combat.error, issues: combat.issues ?? [] }, coverage: nameCoverage(character, gd), scenario: { fields, values }, choices: chosen, talentLayouts: trees };
  }

  const main = combat.mainSkill;
  const { defenses: d, resourcePool: p } = combat.results;
  const unparsed = combat.lines.filter((l) => !l.parsed);
  const sim = simulate(character, engineValues, build);
  return {
    engine: { ok: true },
    coverage: nameCoverage(character, gd),
    mainSkill: main,
    sim,
    choices: chosen,
    talentLayouts: trees,
    // The trees entered by hand, or the log's filled in from them, for showing them where the log's would be
    talentTreesByHand: talentsByHand || cut.filled ? character.talentTrees : null,
    // Destinies and stat lines as used: the log's plus what screenshots added (a copy of this
    // character in the sample builds takes these, so it computes the same)
    used: { destinies: character.destinies ?? [], extraLines: character.extraLines ?? [], slates: slatesShown, skills: swapped ? shownSkills : null, equipment: gearChanged ? shownEquipment : null },
    // With skills or slates switched off, slates moved, supports or gear swapped: the figures with everything as logged
    whatIf: off.size || offSlates.size || layoutChanged || swapped || gearChanged ? whatIfAllOn(asLogged, gd, scenario, choices) : null,
    needs: characterNeeds(character, choices, combat.unmapped, values, logTrees, { cc: enemyCrowdControl, cutTrees: cut.uncovered }),
    sources: dataSources(character, choices, cut, combat.unmapped.filter((m) => /Prism.*isn't named yet/.test(m)).length, (character.slates ?? []).filter((s) => s.shapeId != null && !s.cells).length, logTrees),
    enemyAilments,
    enemyCrowdControl,
    heroTraitLevels: combat.results.heroTraitLevels,
    dps: {
      combat: dpsBreakdown(combat.results.skills[main]),
      sheet: dpsBreakdown(sheet.ok ? sheet.results.skills[main] : null),
      otherSkills: Object.entries(combat.results.skills)
        .filter(([name, s]) => name !== main && s.totalDps > 0)
        .map(([name, s]) => ({ name, total: s.totalDps })),
    },
    scenario: { fields, values },
    defenses: {
      life: p.maxLife,
      mana: p.maxMana,
      energyShield: d.energyShield,
      armor: d.armor,
      evasion: d.evasion,
      resistances: { cold: d.coldRes, lightning: d.lightningRes, fire: d.fireRes, erosion: d.erosionRes },
      attackBlockPct: d.attackBlockPct,
      spellBlockPct: d.spellBlockPct,
    },
    attributes: p.stats,
    lines: { total: combat.lines.length, parsed: combat.lines.length - unparsed.length, unparsed },
    missing: [...new Set([...combat.unmapped, ...cut.notes, ...follower.unknown.map((n) => `Follower ${n}: what it does isn't modelled yet`), ...combat.errors])],
  };
}
