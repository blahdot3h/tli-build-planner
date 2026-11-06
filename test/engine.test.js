import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as tob from '../server/engine/tob.bundle.js';
import { buildSaveData, ELIXIR_SYNC, rewriteLine, runEngine, traitModel } from '../server/engine/bridge.js';
import { SAGE_HERO } from '../server/sim/sage.js';
import { heroNote, heroNoteNames } from '../server/sim/heroNotes.js';

test('per-level and chance-based lines are rewritten into lines the engine reads', () => {
  const ctx = { level: 90 };
  assert.equal(rewriteLine('+1% Fire Damage for every 1 level(s)', ctx), '+90% Fire Damage');
  assert.equal(rewriteLine('+5 Max Life per 1 levels', ctx), '+450 Max Life');
  assert.equal(rewriteLine('33% chance to gain +3 Shadows when using the Shadow Strike skill', ctx), '+1 Shadow Quantity');
  assert.equal(rewriteLine('+35 Max Life', ctx), '+35 Max Life');
  assert.deepEqual(tob.parseMod('+90% Fire Damage'), [{ type: 'DmgPct', value: 90, dmgModType: 'fire', addn: false }]);
});

test('talent lines worded "while Dual Wielding" and "against Ignited enemies" parse', () => {
  assert.deepEqual(tob.parseMod('+27% Attack Damage while Dual Wielding'), [
    { type: 'DmgPct', value: 27, dmgModType: 'attack', addn: false, cond: 'is_dual_wielding' },
  ]);
  assert.deepEqual(tob.parseMod('+18% Attack Speed while Dual Wielding'), [{ type: 'AspdPct', value: 18, addn: false, cond: 'is_dual_wielding' }]);
  assert.deepEqual(tob.parseMod('+6% Fire Penetration against Ignited enemies'), [
    { type: 'ResPenPct', value: 6, penType: 'fire', cond: 'enemy_is_ignited' },
  ]);
});

test('Frost Terra build lines parse: Subtle Impact, Escalating Affliction, Frostbite Effect, pactspirit stacks', () => {
  assert.deepEqual(tob.parseMod('+30% additional Damage Over Time while Blur is active'), [
    { type: 'DmgPct', value: 30, dmgModType: 'damage_over_time', addn: true, cond: 'has_blur' },
  ]);
  assert.deepEqual(
    tob.parseMod('Changes the effect of each point of Affliction to: +0.1% - +3% additional Damage Over Time taken. Refreshes every 1s and is affected by Lucky Damage bonuses'),
    [{ type: 'AfflictionPointRollPct', min: 0.1, max: 3 }],
  );
  assert.deepEqual(tob.parseMod('+20% Frostbite Effect'), [{ type: 'FrostbiteEffPct', value: 20 }]);
  // Dreamweaver and Fire Swordsman, at max stacks
  assert.deepEqual(tob.parseMod('1.2% Elemental Resistance Penetration when hitting an enemy with Elemental Damage, stacking up to 4 times'), [
    { type: 'ResPenPct', value: 4.8, penType: 'elemental' },
  ]);
  assert.deepEqual(tob.parseMod('+14% Reaping Duration for each Reap dealt, stacking up to 4 times.'), [{ type: 'ReapDurationPct', value: 56 }]);
  assert.deepEqual(tob.parseMod('Reaps 1 s of Damage Over Time when inflicting an Ailment. The effect has a 6 s cooldown against the same target'), [
    { type: 'Reap', duration: 1, cooldown: 6 },
  ]);
});

test('aura levels grow from their level-1 to level-20 values', () => {
  const values = (name, key) => tob.PassiveSkills.find((s) => s.name === name).levelValues[key];
  assert.equal(values('Precise: Deep Pain', 'dotDmgPct')[0], 21);
  assert.equal(values('Precise: Deep Pain', 'dotDmgPct')[19], 40);
  assert.equal(values('Precise: Deep Pain', 'dotDmgPct')[20], 41);
  assert.equal(values('Frigid Domain', 'coldDmgPct')[19], 35);
  assert.equal(values('Spell Amplification', 'spellDmgPct')[0], 16);
});

test('the engine now implements the passives and curse this build relies on', () => {
  const slot = (name) => ({ 1: { enabled: true, skillName: name, supportSkills: {} } });
  const unimplemented = (page, name) =>
    tob.collectUnimplementedItems({
      skillPage: { activeSkills: {}, passiveSkills: {}, [page]: slot(name) },
      heroPage: { traits: {} },
    });
  for (const name of ['Charged Flames', 'Flame Focus', 'Acuteness Focus']) assert.deepEqual(unimplemented('passiveSkills', name), [], name);
  assert.deepEqual(unimplemented('activeSkills', 'Scorch'), []);
  assert.deepEqual(unimplemented('passiveSkills', 'Swiftness'), [{ name: 'Swiftness', type: 'Passive Skill' }]);
});

test("CoffeeBingTest's glove and talent lines parse: Grasp of Truth, Penetrating, SS13 Magister wording", () => {
  assert.equal(rewriteLine('+ 20% Spell Elemental Damage', { level: 90 }), '+20% Spell Elemental Damage');
  assert.deepEqual(tob.parseMod('+20% Spell Elemental Damage'), [{ type: 'ElementalSpellDmgPct', value: 20, addn: false }]);
  assert.deepEqual(tob.parseMod('+13% Elemental Resistance for enemies within 12m'), [
    { type: 'EnemyRes', value: 13, resType: 'elemental', cond: 'enemy_within_12m' },
  ]);
  assert.deepEqual(tob.parseMod('Upon inflicting damage, +8% additional Elemental Damage for each type of Infiltration Effect the enemy has'), [
    { type: 'DmgPct', value: 8, dmgModType: 'elemental', addn: true, per: { stackable: 'num_infiltration_types' } },
  ]);
  assert.deepEqual(tob.parseMod('Gains 1 stack(s) of Focus Blessing when consuming Spell Burst or generating Tangle'), [{ type: 'GeneratesFocusBlessing' }]);
});

test("talent nodes whose current text differs from the engine's older data go in as their current text", () => {
  const character = {
    player: { level: 90 },
    equipment: [],
    memories: [],
    slates: [],
    pactspirits: [],
    skills: { active: [], passive: [] },
    talentTrees: [
      {
        name: 'Magister',
        cores: [],
        nodes: [
          { x: 1, y: 1, points: 3, text: '+9% Spell Damage' }, // the same in the engine
          { x: 1, y: 7, points: 1, text: '+8% additional Hit Damage for skills cast by Spell Burst' }, // engine: "+1 Max Spell Burst"
        ],
      },
      { name: 'Goddess of Deception', cores: [], nodes: [{ x: 4, y: 4, points: 3, text: '+6% Ill Omen Cumulative Efficiency' }] }, // engine: +3%
    ],
  };
  const { saveData } = buildSaveData(character);
  assert.deepEqual(saveData.talentPage.talentTrees.tree1.allocatedNodes, [{ x: 0, y: 0, points: 3 }]);
  assert.deepEqual(saveData.talentPage.talentTrees.tree2.allocatedNodes, []);
  const lines = saveData.configurationPage.customAffixLines;
  assert.ok(lines.includes('+8% additional Hit Damage for skills cast by Spell Burst'));
  assert.ok(lines.includes('+18% Ill Omen Cumulative Efficiency'), 'three points add up');
});

test("Sage: Elixir, Omni-Elixir Notes and Scent Bottle lines parse; her traits have engine mods", () => {
  assert.deepEqual(tob.parseMod('+46% Elixir Skill Effect'), [{ type: 'ElixirEffPct', value: 46, addn: false }]);
  assert.deepEqual(tob.parseMod('+12% additional Elixir Skill Effect'), [{ type: 'ElixirEffPct', value: 12, addn: true }]);
  assert.deepEqual(tob.parseMod('+13% additional damage for you and your Minions for every Elixir Skill cast recently. Stacks up to 5 time(s)'), [
    { type: 'DmgPct', value: 13, dmgModType: 'global', addn: true, per: { stackable: 'elixir_casts_recently', limit: 5 } },
  ]);
  assert.deepEqual(tob.parseMod('+12% damage while an Elixir Skill is active'), [{ type: 'DmgPct', value: 12, dmgModType: 'global', addn: false, cond: 'elixir_active' }]);
  assert.deepEqual(tob.parseMod('+14% additional damage taken by enemies'), [{ type: 'DmgPct', value: 14, dmgModType: 'global', addn: true, isEnemyDebuff: true }]);
  assert.deepEqual(tob.parseMod('+10% additional damage when you or your Minions land a Critical Strike'), [
    { type: 'DmgPct', value: 10, dmgModType: 'global', addn: true, cond: 'has_crit_recently' },
  ]);
  assert.deepEqual(tob.parseMod('+1.4% additional damage for you and your Minions for every 400 Max Energy Shield, up to +56%'), [
    { type: 'DmgPct', value: 1.4, dmgModType: 'global', addn: true, per: { stackable: 'energy_shield', amt: 400, valueLimit: 56 } },
  ]);
  assert.deepEqual(tob.parseMod('23.5% Elemental Resistance Penetration for Spell Skills'), [{ type: 'ResPenPct', value: 23.5, penType: 'elemental' }]);
  for (const name of ['Licorice Note', 'Pungent Stimulant Salt', 'Elixir of Immortality', 'Scent of Ambition', 'Everlasting Nectar', 'Licorice Tincture Blend']) {
    assert.ok(tob.isHeroTraitImplemented(name), name);
  }
  const mods = (name, level) => tob.getHeroTraitMods(name, level).map(({ src, ...m }) => m);
  // tlidb's SS14 values: Artificial Moon only at level 5; Scent of Ambition +18/21/24/27/30%
  assert.deepEqual(mods('Licorice Note', 4), []);
  assert.deepEqual(mods('Licorice Note', 5), [{ type: 'ElixirEffPct', value: 12, addn: true }]);
  assert.deepEqual(mods('Scent of Ambition', 3), [
    { type: 'ElixirEffPct', value: 24, addn: true },
    { type: 'ElixirEffDurationPct', value: -30, addn: true },
  ]);
  assert.deepEqual(mods('Everlasting Nectar', 4), [{ type: 'ElixirEffFromLifeManaPct', value: 160, valueLimit: 60 }]);
  assert.deepEqual(mods('Pungent Stimulant Salt', 3), [{ type: 'ElixirEffShareToPrepared', value: 260, empowerLimit: 100, curseLimit: 70 }]);
  // Elixir of Immortality: +2.5% per 5% Temporary Life, Temporary Life capped at 40% of base Max Life, bonus capped at +20%
  assert.deepEqual(mods('Elixir of Immortality', 4), [
    { type: 'DmgPct', dmgModType: 'global', addn: true, value: 2.5, per: { stackable: 'temporary_life_pct', amt: 5, limit: 8, valueLimit: 20 } },
  ]);
  // Every Elixir skill on tlidb is a buff skill now, Thirst Dew and Agony Dew among the ones the engine's own data lacked
  for (const name of ['Thirst Dew', 'Agony Dew', 'Prism Butterfly Distillate', 'Tortoise Shell Distillate']) assert.ok(ELIXIR_SYNC.registered.includes(name), name);
  const slot = (name) => ({ 1: { enabled: true, skillName: name, supportSkills: {} } });
  assert.deepEqual(tob.collectUnimplementedItems({ skillPage: { activeSkills: slot('Thirst Dew'), passiveSkills: {} }, heroPage: { traits: {} } }), []);
});

test("Sage: an Elixir skill's buff reaches the main skill and grows with Elixir Skill Effect and Everlasting Nectar", () => {
  const character = {
    player: { level: 100 },
    equipment: [],
    memories: [],
    slates: [],
    pactspirits: [],
    talentTrees: [],
    skills: {
      active: [
        { skill: { name: 'Chromatic Shot', level: 20 }, supports: [] },
        { skill: { name: 'Thirst Dew', level: 20 }, supports: [] },
      ],
      passive: [],
    },
  };
  const hero = { name: SAGE_HERO, traits: { level1: 'Licorice Note' } };
  const dps = (c, h = hero) => {
    const run = runEngine(c, {}, { hero: h, pactspirits: [] });
    assert.ok(run.ok, run.error);
    return run.results.skills['Chromatic Shot'].totalDps;
  };
  const base = dps(character);
  const noDew = dps({ ...character, skills: { active: [character.skills.active[0]], passive: [] } });
  assert.ok(base > noDew * 1.1, `Thirst Dew (+130% Critical Strike Rating, +55% Hit Damage) adds damage: ${base} vs ${noDew}`);
  // "+100% Elixir Skill Effect" doubles the buff
  const boosted = dps({ ...character, extraLines: [{ source: 'test', text: '+100% Elixir Skill Effect' }] });
  assert.ok(boosted > base * 1.05, `Elixir Skill Effect scales the buff: ${boosted} vs ${base}`);
  // Everlasting Nectar at level 1: 100% of the +50% Max Life bonus, capped at +30% Elixir Skill Effect
  const withLife = { ...character, extraLines: [{ source: 'test', text: '+50% Max Life' }] };
  const plain = dps(withLife);
  const nectar = dps(withLife, { ...hero, traits: { ...hero.traits, level75: 'Everlasting Nectar' } });
  assert.ok(nectar > plain * 1.02 && nectar < boosted, `Everlasting Nectar adds a capped share: ${plain} < ${nectar} < ${boosted}`);
  // Pungent Stimulant Salt with a Curse slotted runs without error
  const curse = { ...character, skills: { active: [...character.skills.active, { skill: { name: 'Timid', level: 20 }, supports: [] }], passive: [] } };
  dps(curse, { ...hero, traits: { ...hero.traits, level45: 'Pungent Stimulant Salt' } });
});

test('every hero trait is modelled (engine or simulation) or says what it leaves out', () => {
  const names = new Set(tob.HeroTraits.map((t) => t.name));
  for (const t of tob.HeroTraits) assert.ok(traitModel(t.name) || heroNote(t.name), `${t.hero}: ${t.name}`);
  for (const name of heroNoteNames()) assert.ok(names.has(name), `note for an unknown trait: ${name}`);
  // tlidb's current trees: Thea #1 has 9 traits, Youga #3 exists, Moto's names are English
  assert.equal(tob.HeroTraits.filter((t) => t.hero === 'Oracle Thea: Wisdom of The Gods (#1)').length, 9);
  assert.equal(tob.HeroTraits.filter((t) => t.hero === 'Spacetime Witness Youga: The Ultimate One (#3)').length, 11);
  assert.ok(names.has('Self-Reconstruct') && names.has('Radiation Field') && names.has('World Within'));
});

test('the new hero traits give their stat lines, and traits that scale each other resolve together', () => {
  const strip = (list) => list.map(({ src, ...m }) => m);
  const mods = (name, level) => strip(tob.getHeroTraitMods(name, level));
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
  assert.deepEqual(mods('Lethal Flash', 5), [
    { type: 'DmgPct', value: 82, dmgModType: 'global', addn: true },
    { type: 'Projectile', value: 2 },
    { type: 'MainSkillSupportedBy', skillName: 'Multiple Projectiles', level: 1 },
  ]);
  assert.deepEqual(mods('Frigid Infusion', 3), [{ type: 'EnemyRes', resType: 'cold', value: -35 }]);
  assert.deepEqual(mods('Ammo Expert', 1), [{ type: 'DmgPct', value: 15, dmgModType: 'global', addn: true, per: { stackable: 'special_ammo_pct', amt: 100 } }]);
  assert.deepEqual(mods('Prophecy of Revelation', 4), []);
  // Moto: Overload's +60% times its effect bonuses (All In +140%, Charge Forward 18% per 5 of 25 Command = +90%)
  const moto = strip(tob.resolveHeroTraitSynergies([...tob.getHeroTraitMods('Order Calling', 1), ...tob.getHeroTraitMods('All In', 5), ...tob.getHeroTraitMods('Charge Forward', 5)], ['Order Calling', 'All In', 'Charge Forward'], { command: 25 }));
  assert.deepEqual(moto, [{ type: 'MinionDmgPct', value: 60 * (1 + 2.3), addn: true }]);
  // Thea #1: Prophecy of Purity doubles God's Boon
  const thea = strip(tob.resolveHeroTraitSynergies([...tob.getHeroTraitMods('Wisdom of The Gods', 5), ...tob.getHeroTraitMods('Prophecy of Purity', 1)], ['Wisdom of The Gods', 'Prophecy of Purity'], {}));
  assert.deepEqual(thea, [
    { type: 'DmgPct', dmgModType: 'global', addn: true, value: 104 },
    { type: 'SkillEffDurationPct', value: -15 },
  ]);
  // Selena #1 in Loud Song: +80% additional Tide Effect scales the Tide's +15% and the level-5 +20% taken
  const tide = strip(tob.resolveHeroTraitSynergies(tob.getHeroTraitMods('Sing with the Tide', 5), ['Sing with the Tide'], { loudSong: true }));
  close(tide[0].value, 27, 'Tide damage');
  close(tide[1].value, 36, 'Tide damage taken');
  assert.equal(tide[1].isEnemyDebuff, true);
  assert.equal(strip(tob.resolveHeroTraitSynergies(tob.getHeroTraitMods('Sing with the Tide', 5), ['Sing with the Tide'], { loudSong: false }))[0].value, 15);
});

test("Youga #1's Spacetime Illusion adds its casts to yours", () => {
  const character = {
    player: { level: 100 },
    equipment: [],
    memories: [],
    slates: [],
    pactspirits: [],
    talentTrees: [],
    skills: { active: [{ skill: { name: 'Chromatic Shot', level: 20 }, supports: [] }], passive: [] },
  };
  const casts = (hero) => {
    const run = runEngine(character, {}, { hero, pactspirits: [] });
    assert.ok(run.ok, run.error);
    return run.results.skills['Chromatic Shot'].spellDpsSummary.castsPerSec;
  };
  const alone = casts({ name: 'Divineshot Carino: Lethal Flash (#2)', traits: { level1: 'Lethal Flash' } });
  const youga = { name: 'Spacetime Witness Youga: Spacetime Illusion (#1)', traits: { level1: 'Spacetime Illusion' } };
  assert.ok(Math.abs(casts(youga) - alone - 1 / 1.5) < 1e-6, `one illusion cast every 1.5 s: ${casts(youga)} vs ${alone}`);
  // Me and Myself: +60% cast frequency
  const faster = casts({ ...youga, traits: { ...youga.traits, level45: 'Me and Myself' } });
  assert.ok(Math.abs(faster - alone - 1.6 / 1.5) < 1e-6, `Me and Myself: ${faster}`);
  // I'm an Illusion: you stop casting, two illusions cast
  const only = casts({ ...youga, traits: { ...youga.traits, level75: "I'm an Illusion" } });
  assert.ok(Math.abs(only - 2 / 1.5) < 1e-6, `I'm an Illusion: ${only}`);
});

test('standing still and elemental-ailment lines parse with their conditions', () => {
  assert.deepEqual(tob.parseMod('+60% damage while standing still'), [{ type: 'DmgPct', value: 60, dmgModType: 'global', addn: false, cond: 'standing_still' }]);
  assert.deepEqual(tob.parseMod('+21% additional Elemental Damage to enemies with Elemental Ailments'), [
    { type: 'DmgPct', value: 21, dmgModType: 'elemental', addn: true, cond: 'enemy_has_elemental_ailment' },
  ]);
});

test('Fire Burst below level 20 follows the level curve of spells with tlidb tables', () => {
  const values = tob.ActiveSkills.find((s) => s.name === 'Fire Burst').levelValues;
  assert.equal(values.spellDmgMin[19], 607);
  assert.equal(values.spellDmgMax[39], 1128);
  assert.equal(values.spellDmgMax[18], 945); // level 19: 83.8% of level 20
  assert.ok(values.spellDmgMax[0] < 20); // level 1: about 1.4%
});
