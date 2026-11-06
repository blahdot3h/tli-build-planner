import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../server/gamedata/index.js';
import { describeItem } from '../server/game/character.js';
import { dedupLines, extractDurations, normalizeFractions } from '../scripts/import-tlidb.js';

// The imported tables (scripts/import-tlidb.js over data/tlidb-cache); expected values are the
// SS13 cards and tables in the cached tlidb pages
const GAMEDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'gamedata');
const table = (name) => JSON.parse(fs.readFileSync(path.join(GAMEDATA, `${name}.json`), 'utf8'));
const skills = table('skills');
const skillData = table('skillData');
const skillNamed = (name) => Object.values(skillData).find((s) => s.name === name);
const row = (t, level) => t.rows.find((r) => r[0] === level);

function tempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tli-gamedata-'));
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));
  return dir;
}

test('hand-added <kind>.local.json entries merge into the imported table', () => {
  const dir = tempDir({
    'talents.json': { 1: { name: 'Imported' }, 2: { name: 'Old' } },
    'talents.local.json': { _comment: 'notes', 2: { name: 'Hand-added' }, 3: { name: 'New' } },
  });
  const gd = loadGameData(dir);
  assert.equal(gd.name('talents', 1), 'Imported');
  assert.equal(gd.name('talents', 2), 'Hand-added');
  assert.equal(gd.name('talents', 3), 'New');
  assert.equal(gd.get('talents', '_comment'), null);
});

test('a local entry only replaces the fields it lists', () => {
  const dir = tempDir({
    'uniques.json': { 7: { name: 'Wand', icon: 'wand.webp', lines: ['最近'] } },
    'uniques.local.json': { 7: { lines: ['+2% damage'] } },
  });
  assert.deepEqual(loadGameData(dir).get('uniques', 7), { name: 'Wand', icon: 'wand.webp', lines: ['+2% damage'] });
});

test('On the Sublime reads in English (tlidb still shows its last line in Chinese)', () => {
  const sublime = loadGameData(GAMEDATA).get('uniques', 111413);
  assert.equal(sublime.name, 'On the Sublime');
  const text = [...sublime.lines, ...sublime.corroded].join('\n');
  // No Chinese characters (CJK ideographs)
  assert.doesNotMatch(text, /[㐀-鿿]/);
  assert.match(text, /^\+2% additional Spell Projectile Damage for each Spell Projectile created recently, up to 10 stacks$/m);
});

test("tlidb's pictures: a legendary shows its own art, a crafted item its base's, a slate its shape", () => {
  const gd = loadGameData(GAMEDATA);
  const uniques = table('uniques');
  const crafted = describeItem('100_abc', { Level: 86, RareValue: 4 }, gd);
  assert.match(crafted.icon, /Icon_Equip_Weapon_Claw_Norm_001_112\.webp$/);
  // Phantom (a legendary necklace) over its base's generic art
  const phantom = describeItem(`${uniques[113222].baseId}_abc`, { Level: 86, RareValue: 100, UniqueItmId: 113222 }, gd);
  assert.match(phantom.icon, /Icon_Equip_Amulet_Epic_204_112\.webp$/);
  assert.match(gd.icon('skills', 7001), /Icon_Skill_Leapslam_128\.webp$/);
  // One page, one picture per slate shape
  assert.match(gd.icon('slates', 260001), /UI_TalantNG_Z1_0_Icon_Agi_112\.webp$/);
  assert.match(gd.icon('slates', 260002), /UI_TalantNG_Z2_0_Icon_Agi_112\.webp$/);
  // By name: hero traits from their hero's page, pactspirits (no ids on tlidb)
  assert.match(gd.iconByName('heroTraits', 'Seething Silhouette'), /HeroTraits\/Rehan\/YeManRen1\.webp$/);
  assert.match(gd.heroPortrait('Seething Silhouette'), /UI_Portrait_Rehan_02_128\.webp$/);
  assert.match(gd.iconByName('pactspirits', 'Awooawoo - Violet'), /UI_Pet_R_AWuAWu2_01_116\.webp$/);
  // Skills whose picture tlidb hasn't uploaded yet (only the game's asset path) have none
  assert.equal(gd.icon('skills', 7347), null);
});

test("the game's help manual names memory affixes the import doesn't, with the log's roll", () => {
  const dir = tempDir({ 'affixes.json': {} });
  const manual = tempDir({
    HelpManualV2AffixData: {
      a: { AffixsData: [{ AffixId: 402165900, AffixDesc: '+104% Spell Critical Strike Rating' }] },
      b: { AffixsData: { x: { AffixId: 402162300, AffixDesc: '+(14-20)% Max Energy Shield' } } },
    },
  });
  const gd = loadGameData(dir, { manualFile: path.join(manual, 'HelpManualV2AffixData') });
  assert.equal(gd.affixText(402165902, [60]), '+60% Spell Critical Strike Rating');
  assert.equal(gd.affixText(402162301, [16]), '+16% Max Energy Shield');
  assert.equal(gd.affixText(999, [1]), null);
});

test('skill tags come from the current-season card only', () => {
  // Fire Burst's page shows identical SS13 and SS12 cards; the import used to list both cards' tags
  assert.deepEqual(skills[7093].tags, ['Spell', 'Area', 'Fire']);
  assert.deepEqual(skillData[7093].tags, ['Spell', 'Area', 'Fire']);
  // Chromatic Shot changed tags: SS13 is Physical, the SS12 card had Cold, Fire and Lightning
  assert.deepEqual(skills[7007].tags, ['Spell', 'Projectile', 'Area', 'Physical', 'Horizontal']);
  // Module pages repeat both cards in three tabs
  assert.deepEqual(skills[7231].tags, ['Spell', 'Summon', 'Persistent', 'Cold', 'Fire', 'Synthetic Troop']);
  for (const [id, s] of Object.entries(skills)) assert.equal(new Set(s.tags).size, s.tags.length, `${id} ${s.name}`);
});

test('skillData has every skill page, typed by the listing page that lists it', () => {
  assert.deepEqual(Object.keys(skillData), Object.keys(skills));
  const typeOf = (name) => skillNamed(name).type;
  assert.equal(typeOf('Fire Burst'), 'Active');
  assert.equal(typeOf('Psychic Burst'), 'Support');
  assert.equal(typeOf('Weapon Amplification'), 'Passive');
  assert.equal(typeOf('Activation Medium: Spell Burst'), 'Activation Medium');
  assert.equal(typeOf('Fire Burst: Prairie Fire (Noble)'), 'Support (Noble)');
  assert.equal(typeOf('Fire Burst: Heart of Flame (Magnificent)'), 'Support (Magnificent)');
  assert.equal(typeOf('Module: Goblin Priest'), 'Modularization');
  // SS14: tlidb's search index calls Splitting Lightning Bolt a "Tip"; the Active Skill listing has it
  assert.equal(typeOf('Splitting Lightning Bolt'), 'Active');
  assert.equal(typeOf('Splitting Lightning Bolt: Disintegration (Noble)'), 'Support (Noble)');
  assert.equal(typeOf('Tartarus: Splitting Lightning Bolt I'), 'Tartarus');
  for (const s of Object.values(skillData)) {
    assert.ok(s.type, `${s.name} has no type`);
    assert.equal(s.season, 'SS14', s.name);
  }
});

test('Fire Burst: header and Details from its SS13 card, and no Progression table', () => {
  const fb = skillData[7093];
  assert.equal(fb.name, 'Fire Burst');
  assert.equal(fb.header.castTime, 0.8);
  assert.equal(fb.header.addedDmgEffPct, 161);
  assert.deepEqual(fb.header.mainStats, ['Strength', 'Intelligence']);
  assert.equal(fb.header.manaCost, 8);
  assert.equal(fb.header.manaCostIsPct, false);
  assert.equal(fb.header.cooldown, null);
  // tlidb's Details has no space in "SpellFire"; Simple says "Spell Fire Damage"
  assert.deepEqual(fb.details, ['Fire Burst:', 'Deals 607-1128 SpellFire Damage.']);
  assert.equal(fb.progression, null);
});

test('Chain Lightning Lv20: 73-1393 Spell Lightning at 136% effectiveness', () => {
  const t = skillData[7047].progression;
  assert.deepEqual(t.columns, ['level', 'Effectiveness of added damage', 'damage', 'Descript']);
  assert.deepEqual(t.rows.map((r) => r[0]), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.deepEqual(row(t, 20).slice(1, 3), ['136%', 'Deals 73-1393 Spell Lightning damage']);
  assert.deepEqual(row(t, 1).slice(1, 3), ['136%', 'Deals 1-19 Spell Lightning damage']);
  // Rows past Lv20 leave Eff and damage empty and repeat the Lv20 Details
  assert.deepEqual(row(t, 21).slice(1, 3), ['', '']);
  assert.match(row(t, 40)[3], /^Deals 73-1393 Spell Lightning Damage\.$/m);
});

test('Path of Flames: 932 Persistent Fire Damage per second at Lv20, the same through Lv40', () => {
  const t = skillNamed('Path of Flames').progression;
  assert.deepEqual(t.columns, ['level', 'Descript']);
  for (const level of [20, 21, 40]) assert.match(row(t, level)[1], /^Deals 932 Persistent Fire Damage every second\.$/m);
  assert.match(row(t, 19)[1], /^Deals 772 Persistent Fire Damage every second\.$/m);
  // Simple's "43/2%" reads 21.5%
  assert.ok(skillNamed('Path of Flames').simple.includes('Each channeled stack 21.5% additional damage for this skill.'));
});

test('Psychic Burst (SS14 values): 20.5 at Lv1, 30 at Lv20, 35.25 at Lv40', () => {
  const pb = skillNamed('Psychic Burst');
  assert.equal(pb.header.manaCostMultiplier, 110);
  const t = pb.progression;
  assert.deepEqual(t.columns, ['level', '20.5% additional Hit Damage for the supported skills cast by Spell Burst', 'Descript']);
  assert.deepEqual([1, 15, 19, 20, 40].map((level) => row(t, level)[1]), ['20.5', '27.5', '29.5', '30', '35.25']);
  // SS14 pages show the level-20 line in Details and no hidden per-level anchors
  assert.ok(pb.details.includes('+30% additional Hit Damage for the supported skills cast by Spell Burst'));
  assert.equal(pb.anchors, null);
});

test('Overload: its level table reads 3.05 at Lv1 (SS13 hid it as the anchor 61/20)', () => {
  const ov = skillNamed('Overload');
  assert.ok(ov.details.includes('+4% additional damage for the supported skill for each stack of Focus Blessing, stacking up to 8 time(s)'));
  assert.equal(row(ov.progression, 1)[1], '3.05');
  assert.equal(normalizeFractions('(Lv1:61/20)'), '(Lv1:3.05)');
});

test('a support line with two values has both in its level table', () => {
  const t = skillNamed('Added Cold Damage').progression;
  assert.deepEqual(t.columns.slice(0, 2), ['level', 'Adds 2 - 3 Cold Damage to the supported skill']);
  assert.deepEqual([row(t, 1)[1], row(t, 20)[1]], ['2,3', '83,125']);
});

test('Lightning Beam: tags, header, Details and Lv20 row from its card', () => {
  const lb = skillData[7201];
  assert.equal(lb.name, 'Lightning Beam');
  assert.equal(lb.type, 'Active');
  assert.deepEqual(lb.tags, ['Spell', 'Lightning', 'Area', 'Persistent', 'Beam']);
  assert.deepEqual(lb.header.mainStats, ['Intelligence']);
  assert.equal(lb.header.manaCost, 8);
  assert.equal(lb.header.castTime, 0.65);
  assert.equal(lb.header.addedDmgEffPct, 47);
  assert.equal(lb.details[1], 'Deals 25-480 Spell Lightning Damage');
  assert.ok(lb.details.includes('This skill generates up to 3 Thunderbolt(s)'));
  // The card's closing block restates two lines; each is kept once
  assert.equal(lb.details.filter((l) => l.startsWith('For every +1 Beam(s)')).length, 1);
  assert.deepEqual(row(lb.progression, 20).slice(1, 3), ['47%', 'Deals 25-480 Spell Lightning damage']);
  assert.deepEqual(lb.durations, [{ kind: 'entity', seconds: 6, subject: 'Thunderbolts', maxStacks: null, source: 'The Thunderbolts last for 6s' }]);
});

test('Details keep lines shared by forms and drop closing restatements', () => {
  // Hammer of Ash: Pummel:, Ember Projectile: and Explosion: each deal 369% Weapon Attack Damage
  assert.equal(skillNamed('Hammer of Ash').details.filter((l) => l === 'Deals 369% Weapon Attack Damage.').length, 3);
  // Berserking Blade's last block repeats "This skill +20% Steep Strike chance."
  assert.equal(skillNamed('Berserking Blade').details.filter((l) => l === 'This skill +20% Steep Strike chance.').length, 1);
});

test('Noble supports and Activation Media keep their tier tables', () => {
  const tiers = skillNamed('Fire Burst: Prairie Fire (Noble)').tiers;
  assert.deepEqual(tiers.rows.map((r) => r[0]), [2, 1, 0]);
  assert.match(row(tiers, 0)[1], /^\+\(32–36\)% additional Hit Damage for skills cast by Spell Burst/);
  const am = skillNamed('Activation Medium: Spell Burst').tiers;
  assert.match(row(am, 0)[1], /^The supported skill \+\(20–25\)% additional Cooldown Recovery Speed$/m);
  assert.match(row(am, 3)[1], /^\(-25–-15\)% additional Duration for the supported skill$/m);
});

test('normalizeFractions: two-number fractions only; a word/word list leaves the line alone', () => {
  assert.equal(normalizeFractions('61/20'), '3.05');
  assert.equal(normalizeFractions('Each channeled stack 43/2% additional damage'), 'Each channeled stack 21.5% additional damage');
  assert.equal(normalizeFractions('1/3'), '0.333333');
  assert.equal(normalizeFractions('-14/5%'), '-2.8%');
  assert.equal(normalizeFractions('Fire/Cold 61/20'), 'Fire/Cold 61/20');
  assert.equal(normalizeFractions('grants 1/3/6/100 Charging Progress'), 'grants 1/3/6/100 Charging Progress');
  assert.equal(normalizeFractions('1/0'), '1/0');
});

test('extractDurations sorts timing clauses by kind', () => {
  const kinds = (line) => extractDurations([line]).map((d) => [d.kind, d.seconds]);
  assert.deepEqual(kinds('Lasts 3s.'), [['skill', 3]]);
  assert.deepEqual(kinds('Damage Over Time effect lasts 2s.'), [['entity', 2]]);
  assert.deepEqual(kinds('Triggers the supported skill when activating Spell Burst. Interval: 0.1s'), [['interval', 0.1]]);
  assert.deepEqual(kinds('+2 s duration for Sentries'), [['duration_mod', 2]]);
  assert.deepEqual(kinds('Stacks up to 8 times, lasting for 1.2 s'), [['per_stack', 1.2]]);
  assert.equal(extractDurations(['Stacks up to 8 times, lasting for 1.2 s'])[0].maxStacks, 8);
  assert.deepEqual(kinds('Summons 1 Goblin Priest'), []);
});

test('dedupLines keeps the first of lines equal up to whitespace', () => {
  assert.deepEqual(dedupLines(['+2 Jumps', '+2  Jumps ', 'Lasts 3s', '', 'Lasts 3s']), ['+2 Jumps', 'Lasts 3s']);
});
