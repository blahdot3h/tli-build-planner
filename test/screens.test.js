import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineParser } from '../server/log/lineParser.js';
import { characterNeeds } from '../server/calc/index.js';
import { specialSupportRolledText } from '../server/engine/ss14-supports.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillData = JSON.parse(fs.readFileSync(path.join(root, 'data', 'gamedata', 'skillData.json'), 'utf8'));

test('the log names the game page in front, each talent tree shown and button clicks', () => {
  const events = [];
  const parser = new LineParser((ev) => events.push(ev));
  parser.feed([
    '[2026.10.31-21.56.35:482][674]TLLua: Display: [Game] PageStack@ CurRunView = 87502_TalentCtrl',
    '[2026.10.31-21.56.35:699][674]TLShipping: Display: [Game] TabTalentItem@:UpdateView 2 31 2',
    '[2026.10.31-21.58.01:100][674]TLShipping: Display: [Game] TabTalentItem@:UpdateView 1 63 13',
    '[2026.10.31-22.10.02:000][674]TLLua: Display: [Game] PageStack@ CurRunView = 93844_S16MercenaryMainCtrl',
    '[2026.10.31-22.10.05:000][674]TLGame: Display: [Game] UIButton@ normal-click IconTlBtn',
  ]);
  parser.flush();
  const ui = events.filter((e) => ['uiPage', 'talentTab', 'uiClick'].includes(e.type));
  assert.deepEqual(
    ui.map(({ time, ...e }) => e),
    [
      { type: 'uiPage', page: 'Talent' },
      { type: 'talentTab', slot: 2, tree: 31, own: true },
      // a tree offered when picking one, not one of the character's
      { type: 'talentTab', slot: 1, tree: 63, own: false },
      { type: 'uiPage', page: 'S16MercenaryMain' },
      { type: 'uiClick', button: 'IconTlBtn' },
    ],
  );
});

test("an SS14 Noble/Magnificent roll the log has only as a value gets its card's line", () => {
  assert.equal(specialSupportRolledText(skillData, 'Psionic Missile: Shockwave (Magnificent)', 27), '+27% additional damage for the supported skill');
  assert.equal(specialSupportRolledText(skillData, 'Psionic Missile: Emission (Noble)', -22.6), '-22.6% additional damage for the supported skill');
  assert.equal(specialSupportRolledText(skillData, 'Psionic Missile: Emission (Noble)', null), null);
});

test('what the log is missing comes with how to show it in game', () => {
  const character = { skills: { active: [], passive: [] }, equipment: [], talentTrees: [], memories: [], slates: [], pactspirits: [], destinies: [] };
  const unmapped = [
    'Illusory Chimera: affix #52444911 has no text',
    "Ethereal Prism: Phantasmagoria on Magister: line #1224308011 isn't named yet, so it isn't counted",
  ];
  const keys = (needs) => needs.map((n) => n.key);
  assert.deepEqual(keys(characterNeeds(character, {}, unmapped, {}, false)), ['talents', 'prism', 'item:Illusory Chimera', 'follower']);
  // trees entered by hand and the follower known: only what still has no text
  assert.deepEqual(keys(characterNeeds(character, { talents: [{ tree: 'Magister' }], follower: { name: 'Witch Rat' } }, unmapped, {}, false)), ['prism', 'item:Illusory Chimera']);
  // damage that scales with ailment types asks for the enemy's debuffs until their count is set or
  // the follower (whose skills put most of them on) is known
  const dirty = ['Support Ailment Termination: "The supported skill deals 8.7% additional damage for every type of Ailment on enemy (multiplies)" is not counted'];
  assert.ok(keys(characterNeeds(character, {}, dirty, {}, true)).includes('debuffs'));
  assert.ok(!keys(characterNeeds(character, {}, dirty, { numAilmentTypes: 5 }, true)).includes('debuffs'));
  assert.ok(!keys(characterNeeds(character, { follower: { name: 'Witch Rat' } }, dirty, {}, true)).includes('debuffs'));
  // crowd control types (Wings of Light) only come from the enemy's debuff bar
  const wings = ['Wings of Light: "Intimidated gains an additional base effect: +29% additional Spell and Ailment Damage taken for each type of crowd control effect the target is under" is not counted'];
  assert.ok(keys(characterNeeds(character, { follower: { name: 'Witch Rat' } }, wings, {}, true)).includes('debuffs'));
});
