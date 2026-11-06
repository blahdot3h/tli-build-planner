// Trees the log cut off at 30 entries filled in from the screenshot-read ones, and Pact board Fates
// from screenshots not double-counted with the log's
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../server/gamedata/index.js';
import { calculate, fillCutTrees, pactBoardExtras } from '../server/calc/index.js';
import { legendaryCatalog } from '../server/sample/catalog.js';
import { sampleCharacter } from '../server/sample/build.js';
import { PRESETS } from '../server/sample/presets.js';

const gd = loadGameData(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'gamedata'));

// CoffeeBingBong's Magister tree as the log listed it on 2026-11-03 (13 nodes; the two highest ids
// were past the cut) and as read off the talent screen on 2026-10-31 (15 nodes)
const loggedNodes = [
  [31010500, 3], [31020500, 3], [31030300, 3], [31040300, 1], [31040400, 3], [31050100, 3], [31050300, 3],
  [31050400, 1], [31050500, 3], [31060100, 3], [31060300, 1], [31060500, 1], [31070100, 1],
];
const handPoints = Object.fromEntries([...loggedNodes, [31070400, 1], [31070500, 1]]);
const prism = { x: 4, y: 6, name: 'Ethereal Prism: Phantasmagoria', affixes: [{ kind: 'implicit', id: 1204200001, text: '+75% to the effects of Random Affixes on this Prism' }, { kind: 'prefix', id: 1224310091, text: null }] };
const logged = (over = {}) => ({
  id: 31,
  name: 'Magister',
  points: loggedNodes.reduce((s, [, p]) => s + p, 0),
  nodes: loggedNodes.map(([id, points]) => ({ id, name: gd.get('talents', String(id))?.name ?? 'node', points })),
  cores: [],
  prism,
  truncated: true,
  ...over,
});

test('fillCutTrees adds the screenshot nodes past the cut, names the prism line and keeps the logged part', () => {
  const choices = { talents: [{ tree: 'Magister', points: handPoints, cores: ['Play Safe'], prism: { affixes: [{ id: 1224310091, text: 'When activating 2 Legendary Medium Talent within the area, +1 to Max Spell Burst' }] } }], talentsAt: Date.UTC(2026, 9, 31) };
  const { trees, notes, uncovered, filled } = fillCutTrees([logged()], choices, gd);
  assert.equal(filled, true);
  assert.deepEqual(uncovered, []);
  const [t] = trees;
  assert.equal(t.nodes.filter((n) => n.points > 0).length, 15);
  assert.equal(t.points, 31);
  assert.deepEqual(t.nodes.slice(-2).map((n) => n.id), [31070400, 31070500]);
  assert.equal(t.cores.length, 1, 'cores the log lacked come from the screenshot');
  assert.match(t.prism.affixes[1].text, /Max Spell Burst/);
  assert.equal(t.prism.affixes[0].text, prism.affixes[0].text);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /2 nodes past the cut/);
});

test('fillCutTrees leaves a whole tree alone and reports a cut tree no screenshot covers', () => {
  const whole = logged({ truncated: false });
  const choices = { talents: [{ tree: 'Magister', points: handPoints, cores: [] }] };
  const same = fillCutTrees([whole], choices, gd);
  assert.equal(same.filled, false);
  assert.equal(same.trees[0], whole);
  const none = fillCutTrees([logged()], {}, gd);
  assert.equal(none.filled, false);
  assert.deepEqual(none.uncovered, ['Magister']);
  // The screenshot shows nothing past the cut: the logged tree stands, with a note saying so
  const nothing = fillCutTrees([logged({ prism: null })], { talents: [{ tree: 'Magister', points: Object.fromEntries(loggedNodes), cores: [] }] }, gd);
  assert.equal(nothing.filled, false);
  assert.match(nothing.notes[0], /nothing past the cut/);
});

test('a skill switched off (choices.disabledSkills) leaves the engine without it and reports the all-on figures', () => {
  const legendaries = legendaryCatalog(gd);
  const spec = PRESETS.mid.build('m');
  const character = sampleCharacter(spec, gd, legendaries);
  const choices = { hero: spec.hero, pactspirits: spec.pactspirits };
  const allOn = calculate(character, gd, spec.scenario, choices);
  const passive = character.skills.passive.find((g) => g.skill);
  const key = `passive:${passive.slot}`;
  const off = calculate(character, gd, spec.scenario, { ...choices, disabledSkills: [key] });
  assert.equal(off.engine.ok, true);
  assert.deepEqual(off.choices.disabledSkills, [key]);
  assert.ok(off.sim.avgDps < allOn.sim.avgDps, `${passive.skill.name} off should lower the DPS: ${off.sim.avgDps} vs ${allOn.sim.avgDps}`);
  assert.ok(Math.abs(off.whatIf.allOn.avgDps / allOn.sim.avgDps - 1) < 1e-9);
  assert.equal(allOn.whatIf, null);
  // Switching off the main skill itself leaves no damage model, not a crash
  const noMain = calculate(character, gd, spec.scenario, { ...choices, disabledSkills: ['active:1'] });
  assert.ok(noMain.engine.ok === false || noMain.mainSkill !== allOn.mainSkill || (noMain.sim?.avgDps ?? 0) < allOn.sim.avgDps);
});

test('a slate taken off the board (choices.disabledSlates) lowers the DPS and reports the all-on figures', () => {
  const legendaries = legendaryCatalog(gd);
  const spec = PRESETS.mid.build('m3');
  // Two slates with lines the main skill (Splitting Lightning Bolt) feels, with ids as the log gives them
  spec.slates = [
    { name: "Goddess of Knowledge's Divinity", talents: [{ text: '+1 Lightning Skill Level', effectPct: 0 }] },
    { name: "Goddess of Knowledge's Divinity", talents: [{ text: '+15% Spell Critical Strike Rating', effectPct: 0 }] },
  ];
  const built = sampleCharacter(spec, gd, legendaries);
  const character = { ...built, slates: built.slates.map((s, i) => ({ ...s, id: `slate-${i}` })) };
  assert.equal(character.slates.length, 2);
  const choices = { hero: spec.hero, pactspirits: spec.pactspirits };
  const allOn = calculate(character, gd, spec.scenario, choices);
  const off = calculate(character, gd, spec.scenario, { ...choices, disabledSlates: ['slate-0'] });
  assert.deepEqual(off.choices.disabledSlates, ['slate-0']);
  assert.ok(off.sim.avgDps < allOn.sim.avgDps, `${off.sim.avgDps} vs ${allOn.sim.avgDps}`);
  assert.ok(Math.abs(off.whatIf.allOn.avgDps / allOn.sim.avgDps - 1) < 1e-9);
  const none = calculate(character, gd, spec.scenario, { ...choices, disabledSlates: character.slates.map((s) => s.id) });
  assert.ok(none.sim.avgDps < off.sim.avgDps, 'every slate off is lower still');
});

test('a support swapped in a slot (choices.supportSwaps) changes the DPS and reports the as-logged figures', () => {
  const legendaries = legendaryCatalog(gd);
  const spec = PRESETS.mid.build('m4');
  const character = sampleCharacter(spec, gd, legendaries);
  const choices = { hero: spec.hero, pactspirits: spec.pactspirits };
  const base = calculate(character, gd, spec.scenario, choices);
  const main = character.skills.active[0];
  assert.ok(main.supports.length >= 1, 'the main skill has supports');
  const key = `active:${main.slot}:0`;
  // Its first support replaced by one that does nothing for it
  const swapped = calculate(character, gd, spec.scenario, { ...choices, supportSwaps: { [key]: { name: 'Added Cold Damage' } } });
  assert.equal(swapped.engine.ok, true);
  assert.equal(swapped.used.skills.active[0].supports[0].name, 'Added Cold Damage');
  assert.equal(swapped.used.skills.active[0].supports[0].was, main.supports[0].name);
  assert.ok(swapped.sim.avgDps !== base.sim.avgDps);
  assert.ok(Math.abs(swapped.whatIf.allOn.avgDps / base.sim.avgDps - 1) < 1e-9);
  // Removed altogether
  const removed = calculate(character, gd, spec.scenario, { ...choices, supportSwaps: { [key]: null } });
  assert.equal(removed.used.skills.active[0].supports.length, main.supports.length - 1);
  assert.ok(removed.sim.avgDps < base.sim.avgDps, 'a damage support gone lowers the DPS');
});

test('the same support socketed and granted by gear counts once, at the higher level', () => {
  const legendaries = legendaryCatalog(gd);
  const spec = Object.values(PRESETS)
    .map((p, i) => p.build(`p${i}`))
    .find((s) => Object.values(s.gear ?? {}).some((g) => g.legendary === 'Shattered Moonlight'));
  assert.ok(spec, 'a preset wears Shattered Moonlight (Main Skill is supported by Lv. 16 Psychic Burst)');
  const character = sampleCharacter(spec, gd, legendaries);
  const choices = { hero: spec.hero, pactspirits: spec.pactspirits };
  const main = character.skills.active[0];
  const key = `active:${main.slot}:${Math.min(4, main.supports.length)}`;
  const figure = (swaps) => calculate(character, gd, spec.scenario, { ...choices, supportSwaps: swaps }).sim.avgDps;
  const none = figure({ [key]: null });
  const low = figure({ [key]: { name: 'Psychic Burst', level: 10 } });
  const high = figure({ [key]: { name: 'Psychic Burst', level: 20 } });
  assert.ok(Math.abs(low / none - 1) < 1e-9, `a Lv 10 gem under the gear's Lv 16 adds nothing: ${low} vs ${none}`);
  // One copy at Lv 20 instead of the gear's Lv 16: at most the level difference, never a second copy
  // (stacked, a second Psychic Burst was worth +8% on this build)
  assert.ok(high >= none && high < none * 1.03, `a Lv 20 gem counts once in place of the gear's Lv 16: ${high} vs ${none}`);
  const twice = figure({ [key]: { name: 'Psychic Burst', level: 16 } });
  assert.ok(Math.abs(twice / none - 1) < 1e-9, 'the same level twice is the same as once');
});

test('a skill switched off stays in the shown skills even with a support swapped elsewhere', () => {
  const legendaries = legendaryCatalog(gd);
  const spec = PRESETS.mid.build('m5');
  const character = sampleCharacter(spec, gd, legendaries);
  const choices = { hero: spec.hero, pactspirits: spec.pactspirits };
  const passive = character.skills.passive.find((g) => g.skill);
  const main = character.skills.active[0];
  const calc = calculate(character, gd, spec.scenario, { ...choices, disabledSkills: [`passive:${passive.slot}`], supportSwaps: { [`active:${main.slot}:0`]: { name: 'Added Cold Damage' } } });
  const shown = calc.used.skills.passive.find((g) => g.slot === passive.slot);
  assert.equal(shown.skill?.name, passive.skill.name, 'the switched-off skill is still shown, for its checkbox');
  assert.ok(calc.sim.avgDps < calc.whatIf.allOn.avgDps);
});

test('a gear slot swapped in the what-if (choices.gearSwaps) replaces the item for the engine and the panel', () => {
  const legendaries = legendaryCatalog(gd);
  const spec = PRESETS.mid.build('m6');
  const character = sampleCharacter(spec, gd, legendaries);
  const choices = { hero: spec.hero, pactspirits: spec.pactspirits };
  const base = calculate(character, gd, spec.scenario, choices);
  const neck = character.equipment.find((e) => e.slot === 5);
  const other = legendaries.find((l) => l.slots.includes(5) && l.name !== neck.item?.uniqueName);
  const swapped = calculate(character, gd, spec.scenario, { ...choices, gearSwaps: { 5: { legendary: other.name, roll: 1 } } });
  const shown = swapped.used.equipment.find((e) => e.slot === 5);
  assert.equal(shown.item.uniqueName, other.name);
  assert.equal(shown.was, neck.item?.uniqueName ?? neck.item?.name ?? null);
  assert.ok(swapped.sim.avgDps !== base.sim.avgDps);
  assert.ok(Math.abs(swapped.whatIf.allOn.avgDps / base.sim.avgDps - 1) < 1e-9);
  const empty = calculate(character, gd, spec.scenario, { ...choices, gearSwaps: { 5: null } });
  assert.equal(empty.used.equipment.find((e) => e.slot === 5).item, null);
  assert.ok(empty.sim.avgDps < base.sim.avgDps, 'no necklace is worse');
  const rare = calculate(character, gd, spec.scenario, { ...choices, gearSwaps: { 5: { rare: { type: 'Necklace', lines: ['+30% Spell Damage'] } } } });
  assert.equal(rare.used.equipment.find((e) => e.slot === 5).item.type, 'Necklace');
  const unknown = calculate(character, gd, spec.scenario, { ...choices, gearSwaps: { 5: { legendary: 'No Such Item' } } });
  assert.equal(unknown.used.equipment.find((e) => e.slot === 5).item?.uniqueName, neck.item?.uniqueName, 'an unknown name keeps the logged item');
});

test('calc.sources says where each part came from and which screenshot-read parts are in', () => {
  const legendaries = legendaryCatalog(gd);
  const spec = PRESETS.mid.build('m7');
  const character = sampleCharacter(spec, gd, legendaries);
  const calc = calculate(character, gd, spec.scenario, { hero: spec.hero, pactspirits: spec.pactspirits, follower: { name: 'x', skills: [] }, followerAt: 1700000000000 });
  assert.ok(calc.sources.log.some((s) => s.key === 'log-trees' && s.status === 'complete'));
  const follower = calc.sources.shots.find((s) => s.key === 'follower');
  assert.equal(follower.have, true);
  assert.equal(follower.readAt, 1700000000000);
  assert.ok(follower.forget && follower.capture === 'Follower');
});

test('the Multi-Coupling toggle for Empower effects from others exists and defaults to none', () => {
  const legendaries = legendaryCatalog(gd);
  const spec = PRESETS.mid.build('m8');
  const calc = calculate(sampleCharacter(spec, gd, legendaries), gd, spec.scenario, { hero: spec.hero, pactspirits: spec.pactspirits });
  assert.ok(calc.scenario.fields.some((f) => f.key === 'otherEmpowerSkills' && f.max === 6));
  // the player's +1 Max Spell Burst comes from equipping Ice Bond (2026-11-03), nothing from others
  assert.equal(calc.scenario.values.otherEmpowerSkills, 0);
});

test('pactBoardExtras skips the spots the log lists itself', () => {
  const destinies = [{ point: 103, name: 'Micro Fate: Critical Strike Rating' }, { point: 207, name: 'Medium Fate: Critical Strike Rating' }];
  const pactBoard = [
    { point: 308, name: 'Medium Fate: Critical Strike Rating', text: '+57% Critical Strike Rating' },
    { point: 103, name: 'Micro Fate: Critical Strike Rating', text: '+26% Critical Strike Rating' },
    { point: null, name: 'Micro Fate: Critical Strike Rating', text: '+26% Critical Strike Rating' },
  ];
  const extra = pactBoardExtras(destinies, pactBoard);
  assert.deepEqual(extra.map((d) => d.point), [308, null]);
  assert.equal(extra[0].affixes[0].text, '+57% Critical Strike Rating');
  assert.equal(extra[0].type, 'Destiny');
});
