// Affix tiers: from the craft table's ranges, or from the id's last two digits
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../server/gamedata/index.js';
import { affixTier, tierFromId, tierFromTable } from '../server/game/tiers.js';

const gd = loadGameData(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'gamedata'));

test('tierFromId reads a crafted line or memory line tier off its id, and nothing else', () => {
  assert.equal(tierFromId(130320001), '1'); // +3 Spell Skill Level on a wand
  assert.equal(tierFromId(140320900), '0'); // Adds 87 - 107 Physical Damage to Spells
  assert.equal(tierFromId(402152603), '3'); // a memory line
  assert.equal(tierFromId(51425111), null); // a legendary's line
  assert.equal(tierFromId(600011), null); // a base stat
});

test("tierFromTable finds the tier whose ranges the rolled text falls in (CoffeeBingBong's wands)", () => {
  assert.equal(tierFromTable(gd, 'Wand', 'prefix', '+3 Spell Skill Level'), '1');
  assert.equal(tierFromTable(gd, 'Wand', 'prefix', '+5 Spell Skill Level'), '0+');
  assert.equal(tierFromTable(gd, 'Wand', 'prefix', 'Adds 87 - 107 Physical Damage to Spells'), '0');
  assert.equal(tierFromTable(gd, 'Wand', 'suffix', '+136 Spell Critical Strike Rating'), '0');
  assert.equal(tierFromTable(gd, 'Wand', 'suffix', '+26% Cast Speed\n+26% Minion Cast Speed'), '1');
  assert.equal(tierFromTable(gd, 'Wand', 'suffix', '+40% Spell Burst Charge Speed'), '1');
  assert.equal(tierFromTable(gd, 'Wand', 'suffix', '+3 Spell Skill Level'), null, 'a prefix text is no suffix');
  assert.equal(tierFromTable(gd, 'Wand', 'prefix', 'Something the table never lists'), null);
  assert.equal(tierFromTable(gd, 'No such type', 'prefix', '+3 Spell Skill Level'), null);
});

test('affixTier: crafted prefixes and suffixes and memory lines only; legendary lines have none', () => {
  const wand = { type: 'Wand', legendary: false };
  assert.equal(affixTier(gd, wand, { id: 140320900, kind: 'prefix', text: 'Adds 87 - 107 Physical Damage to Spells' }), '0');
  assert.equal(affixTier(gd, wand, { id: 110320101, kind: 'suffix', text: '+26% Cast Speed\n+26% Minion Cast Speed' }), '1');
  // The id decides (the table's adjacent tiers share boundary values); without one the table does
  assert.equal(affixTier(gd, wand, { id: 116320602, kind: 'suffix', text: 'A line with wording the table lacks' }), '2');
  assert.equal(affixTier(gd, wand, { id: 108320304, kind: 'suffix', text: '+11% Erosion Resistance' }), '4');
  assert.equal(affixTier(gd, wand, { id: null, kind: 'prefix', text: '+3 Spell Skill Level' }), '1');
  // T0+ looks like T0 in the id; the table tells
  assert.equal(affixTier(gd, wand, { id: 130320000, kind: 'prefix', text: '+5 Spell Skill Level' }), '0+');
  assert.equal(affixTier(gd, wand, { id: 130320000, kind: 'prefix', text: '+4 Spell Skill Level' }), '0');
  assert.equal(affixTier(gd, wand, { id: 520020, kind: 'implicit', text: '+40% Spell Damage' }), null);
  assert.equal(affixTier(gd, { type: 'Helmet', legendary: true }, { id: 51425111, kind: 'prefix', text: '+307 gear Energy Shield' }), null);
  assert.equal(affixTier(gd, { type: 'Memory', legendary: false }, { id: 402152603, kind: 'implicit', text: '+21% damage' }), '3');
  assert.equal(affixTier(gd, { type: 'Memory', legendary: false }, { id: 403103501, kind: 'base', text: '+110 Intelligence' }), null);
});
