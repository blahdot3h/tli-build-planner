import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifySkill, SPELL_LEVEL_CURVE } from '../server/engine/skill-shapes.js';
import { SKILL_SHAPES } from '../server/engine/bridge.js';
import * as tob from '../server/engine/tob.bundle.js';

const skillData = JSON.parse(fs.readFileSync(new URL('../data/gamedata/skillData.json', import.meta.url), 'utf8'));
const card = (name) => Object.values(skillData).find((c) => c.name === name);

test('a spell with a level table gets its numbers level by level', () => {
  const s = classifySkill(card('Chain Lightning'));
  assert.equal(s.shape, 'spell');
  assert.equal(s.dmgType, 'lightning');
  assert.equal(s.coverage, 'exact');
  assert.deepEqual([s.levels.spellDmgMin[19], s.levels.spellDmgMax[19], s.levels.addedDmgEffPct[19]], [73, 1393, 136]);
  // Past level 20 the numbers stay; the engine adds +10% additional damage per level itself
  assert.equal(s.levels.spellDmgMax[22], 1393);
  assert.deepEqual(s.intrinsic, [{ type: 'Jump', value: 2 }]);
});

test('a spell without a table uses its level-20 card values and the shared curve below 20', () => {
  const s = classifySkill(card('Fire Burst'));
  assert.equal(s.shape, 'spell');
  assert.equal(s.dmgType, 'fire');
  assert.equal(s.coverage, 'estimated below level 20');
  assert.deepEqual([s.levels.spellDmgMin[19], s.levels.spellDmgMax[39], s.levels.castTime[0], s.levels.addedDmgEffPct[0]], [607, 1128, 0.8, 161]);
  assert.equal(s.levels.spellDmgMax[18], Math.round(1128 * SPELL_LEVEL_CURVE[18]));
});

test('attacks read their weapon damage per level; extra hits are listed as not counted', () => {
  const s = classifySkill(card('Thunder Spike'));
  assert.equal(s.shape, 'attack');
  assert.equal(s.levels.weaponAtkDmgPct[19], 277);
  assert.deepEqual(s.intrinsic, [{ type: 'ConvertDmgPct', value: 100, from: 'physical', to: 'lightning' }]);
  assert.equal(classifySkill(card('Split Shot')).coverage, 'partial');
});

test('skills whose damage comes some other way are refused with the reason', () => {
  assert.match(classifySkill(card('Path of Flames')).reason, /channeled/);
  assert.match(classifySkill(card('Shadow Shot')).reason, /more than one form/);
  assert.match(classifySkill(card('Blizzard')).reason, /cooldown/);
  assert.match(classifySkill(card('Frost Terra')).reason, /Terra/);
  // Lightning Beam: your own casts are counted, its Thunderbolts are not
  const beam = classifySkill(card('Lightning Beam'));
  assert.equal(beam.coverage, 'partial');
  assert.match(beam.reason, /Thunderbolt/);
});

test('the engine computes a skill from its card when it has no hand-written model', () => {
  assert.equal(SKILL_SHAPES['Lightning Beam'].shape, 'spell');
  assert.ok(tob.hasGeneratedActiveSkill('Lightning Beam'));
  // Hand-written models win
  assert.equal(tob.hasGeneratedActiveSkill('Chain Lightning'), false);
  assert.equal(tob.hasGeneratedActiveSkill('Fire Burst'), false);
});
