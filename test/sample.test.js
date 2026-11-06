import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../server/gamedata/index.js';
import { craftPool, craftTiers, legendaryPage, mergeTables } from '../scripts/import-tlidb.js';
import { bestCraftedRare, budgetCheck } from '../server/sample/upgrades.js';
import { learnExchangePrice, priceOf, setUserPrice } from '../server/sample/prices.js';
import { LineParser } from '../server/log/lineParser.js';
import { SampleService } from '../server/sample/service.js';
import { buildSaveData, rewriteLine, SUPPORT_SYNC } from '../server/engine/bridge.js';
import * as tob from '../server/engine/tob.bundle.js';
import { legendaryCatalog, sampleCatalog } from '../server/sample/catalog.js';
import { rollLine, sampleCharacter } from '../server/sample/build.js';
import { PRESETS, specFromCharacter } from '../server/sample/presets.js';
import { calculate } from '../server/calc/index.js';

const gd = loadGameData(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'gamedata'));

test('rollLine sets each (min–max) range to a roll', () => {
  assert.equal(rollLine('+(20–30)% Cast Speed', 0.5), '+25% Cast Speed');
  assert.equal(rollLine('+(20–30)% Cast Speed', 1), '+30% Cast Speed');
  assert.equal(rollLine('Adds (4–6) - (14–16) Fire Damage to Spells', 0), 'Adds 4 - 14 Fire Damage to Spells');
  assert.equal(rollLine('(-15–-10)% additional Spell Burst Charge Speed', 1), '-10% additional Spell Burst Charge Speed');
  assert.equal(rollLine('+(3.5–3.8)% additional damage', 0.5), '+3.7% additional damage');
});

test("mergeTables keeps what a fresh import no longer has (tlidb dropped modifier ids in SS14)", () => {
  const previous = { 1: { text: 'old one' }, 2: { text: 'kept' }, 9: { name: 'Dawn Break', affixes: ['a', 'b'], lines: ['x'] } };
  const fresh = { 1: { text: 'new one' }, 3: { text: 'added' }, 9: { name: 'Dawn Break', affixes: [], lines: ['y'] } };
  assert.deepEqual(mergeTables(previous, fresh), {
    1: { text: 'new one' },
    2: { text: 'kept' },
    3: { text: 'added' },
    9: { name: 'Dawn Break', affixes: ['a', 'b'], lines: ['y'] },
  });
});

test('legendaryPage reads the current-season card, the corroded lines and the random options', () => {
  const html = `<div class="card ui_item popupItem">
    <div class="item_ver">SS14Season</div>
    <div class="text-center icon"><img src="https://cdn/x.webp" alt="" /></div>
    <h5 class="card-title item_rarity">Test Wand</h5><div><span class="border p-1 mb-1 tag tlborder">Require lv 46</span></div>
    <div data-block="attrs2" class="text-center"><div><span class="text-mod">500</span> Critical Strike Rating</div></div>
    <div class="text-center">Adds <span class="text-mod">7</span> - <span class="text-mod">7</span> Lightning Damage to Spells</div>
    <hr class="my-1"/>
    <div><div class="tierParent"><div class="t1"><span class="tier tier1"></span><span class="text-mod">+(20&ndash;30)</span>% Cast Speed</div><div class="t1">&lt;Random stat affix&gt;</div><div class="t1">-100% Critical Strike Rating<br/>+100% Critical Strike Damage</div></div></div>
  </div>
  <div class="card ui_item"><div class="card-header text-center" data-i18n="hyperlink|name|30001">Corroded</div><div class="card-body"><div><div class="tierParent"><div class="t0"><span class="text-mod">+(35&ndash;45)</span>% Cast Speed</div></div></div></div></div>
  <li>drop level: 46</li>
  <div class="card-header" data-i18n="TextTable_GameFunc|value|Func_Tips_DropSource">Drop Source</div>
    <div class="card-body">
        <li><a href="Drops_everywhere_in_Netherrealm">Drops everywhere in Netherrealm</a><hr class="my-1"/></li>
    </div>
  <h5 class="card-header text-center" style="color: #ffc130">&lt;Random stat affix&gt; </h5>
    <div class="card-body"><div class="tierParent"><div class="t1"><span class="text-mod">+(50&ndash;100)</span> Intelligence</div></div></div>`;
  const p = legendaryPage(html);
  assert.equal(p.season, 'SS14');
  assert.equal(p.reqLevel, 46);
  assert.equal(p.dropLevel, 46);
  assert.deepEqual(p.base, ['500 Critical Strike Rating']);
  assert.deepEqual(p.implicit, ['Adds 7 - 7 Lightning Damage to Spells']);
  assert.deepEqual(p.lines, ['+(20–30)% Cast Speed', '<Random stat affix>', '-100% Critical Strike Rating\n+100% Critical Strike Damage']);
  assert.deepEqual(p.corroded, ['+(35–45)% Cast Speed']);
  assert.deepEqual(p.random['<Random stat affix>'], ['+(50–100) Intelligence']);
  assert.deepEqual(p.dropSources, ['Drops everywhere in Netherrealm']);
});

test("craftPool reads the Craft page's table row by row", () => {
  const html =
    '<tr><td><span class="text-mod">+(64&ndash;90)</span> Intelligence</td><td>Wand</td><td>Advanced Pre-fix</td></tr>' +
    '<tr><td>Main Skill is supported by<br/>a thing</td><td>Wand</td><td>Base Affix</td><td>extra</td></tr>' +
    '<tr><td>+1 Max Spell Burst<br/>+(6&ndash;8)% additional Hit Damage for skills cast by Spell Burst</td><td>Ring</td><td>Ultimate Suffix</td></tr>';
  assert.deepEqual(craftPool(html), {
    // A row with an extra cell keeps its first three
    Wand: [
      { text: '+(64–90) Intelligence', kind: 'Advanced Pre-fix' },
      { text: 'Main Skill is supported by\na thing', kind: 'Base Affix' },
    ],
    Ring: [{ text: '+1 Max Spell Burst\n+(6–8)% additional Hit Damage for skills cast by Spell Burst', kind: 'Ultimate Suffix' }],
  });
});

test("craftTiers reads a gear type's Craft tab tier by tier, prefixes then suffixes", () => {
  const html = `<div id="WandCraft" class="tab-pane fade"><table><thead><tr><th>Tier<th>Modifier<th>Lv<th>Weight<th>Library
    </thead><tbody>
    <tr data-tier="1"><td>1<td><span class="text-mod">+(77&ndash;108)</span>% Spell Damage<td>86<td>100<td>Basic Affix
      <!--<td><a href="Ultimate_Ember">Ultimate Ember</a>-->
    <tr data-tier="2"><td>2<td><span class="text-mod">+(55&ndash;76)</span>% Spell Damage<td>82<td>200<td>Basic Affix
    </tbody></table><table><thead><tr><th>Tier<th>Modifier<th>Lv<th>Weight<th>Library</thead><tbody>
    <tr data-tier="0+"><td>0+<td><span class="text-mod">+(55&ndash;61)</span>% Cast Speed<br/><span class="text-mod">+(55&ndash;61)</span>% Minion Cast Speed<td>100<td>0<td>Basic Affix
    </tbody></table></div><div id="GearEmpowerment" class="tab-pane fade"><tr data-tier="9"><td>9<td>not this<td>1<td>1<td>X`;
  assert.deepEqual(craftTiers(html, 'Wand'), [
    { part: 'prefix', tier: '1', text: '+(77–108)% Spell Damage', lv: 86, weight: 100, library: 'Basic Affix' },
    { part: 'prefix', tier: '2', text: '+(55–76)% Spell Damage', lv: 82, weight: 200, library: 'Basic Affix' },
    { part: 'suffix', tier: '0+', text: '+(55–61)% Cast Speed\n+(55–61)% Minion Cast Speed', lv: 100, weight: 0, library: 'Basic Affix' },
  ]);
});

test('a T2 craft (item level 82-85, Flame Sand) only uses tier 2 or worse lines that item level can roll', async () => {
  const catalog = sampleCatalog(gd);
  const spec = PRESETS.trove.build('craft');
  const wand = await bestCraftedRare(spec, gd, catalog, 2, 'T2');
  const tiers = gd.get('craftTiers', 'Wand');
  assert.ok(wand.rare.lines.length >= 3 && wand.rare.lines.length <= 6);
  for (const t of wand.tiers) assert.ok(Number(t.slice(1)) >= 2, t);
  // No Ultimate line (they need item level 100): no +Spell Skill Level, no Spell Burst hit damage
  assert.ok(!wand.rare.lines.some((l) => /Spell Skill Level|cast by Spell Burst/.test(l)), wand.rare.lines.join(' | '));
  assert.ok(tiers.some((r) => r.text === '+3 Spell Skill Level' && r.lv === 100));
});

test('an Exchange price check in the log becomes one exchangePrice event (request and answer paired by SynId)', () => {
  const lines = [
    '[2026.10.14-02.00.56:429][456]TLNetGame: Display: [Game] ----Socket SendMessage STT----XchgSearchPrice----SynId = 747',
    '[2026.10.14-02.00.56:429][456]TLNetGame: Display: [Game] ',
    '+filters+1+key [4]',
    '|       | +refer [330001]',
    '+typ3 [81]',
    '[2026.10.14-02.00.56:429][456]TLNetGame: Display: [Game] ----Socket SendMessage End----',
    '[2026.10.14-02.00.56:714][513]TLNetGame: Display: [Game] ----Socket RecvMessage STT----XchgSearchPrice----SynId = 747',
    '[2026.10.14-02.00.56:714][513]TLNetGame: Display: [Game] ',
    '+errCode',
    '+prices+1+currency [100300]',
    '|      | +unitPrices+1 [0.034]',
    '|      | |          +2 [0.049]',
    '|      | |          +3 [0.05]',
    '[2026.10.14-02.00.57:000][514]TLNetGame: Display: [Game] next',
  ];
  const events = [];
  const parser = new LineParser((ev) => events.push(ev));
  parser.feed(lines);
  const prices = events.filter((e) => e.type === 'exchangePrice');
  assert.equal(prices.length, 1);
  assert.deepEqual([prices[0].refers, prices[0].currency, prices[0].unitPrices], [[330001], 100300, [0.034, 0.049, 0.05]]);
  // Named through TITrack's ids (330001 is Snowpaper Fragment); the 10th-percentile listing is its price
  const learned = learnExchangePrice(prices[0], gd);
  assert.equal(learned.name, 'Snowpaper Fragment');
  assert.equal(learned.fe, 0.034);
  assert.equal(priceOf('Snowpaper Fragment').source, 'Exchange price check');
});

test('a price cap per item: known prices decide, unpriced pieces by kind', () => {
  setUserPrice('Solid River', 4000);
  assert.equal(budgetCheck({ kind: 'gear', item: 'Solid River' }, 50).ok, false);
  assert.equal(budgetCheck({ kind: 'gear', item: 'Some Trove Ring', trove: true }, 50).ok, true);
  assert.equal(budgetCheck({ kind: 'gear', item: 'Some Endgame Ring', trove: false }, 50).ok, false);
  assert.equal(budgetCheck({ kind: 'gear', item: 'crafted T2', craft: 'T2' }, 50).ok, true);
  assert.equal(budgetCheck({ kind: 'gear', item: 'crafted any', craft: 'any' }, 50).ok, false);
  assert.equal(budgetCheck({ kind: 'support', item: 'Psychic Burst' }, 50).ok, true); // TITrack: 30 FE
  assert.equal(budgetCheck({ kind: 'support', item: 'Willpower' }, 50).ok, false); // TITrack: 149 FE
  assert.equal(budgetCheck({ kind: 'support', item: 'Splitting Lightning Bolt: Disintegration (Noble)' }, 50).ok, false);
  assert.equal(budgetCheck({ kind: 'pactspirit', item: 'Dreamweaver' }, 50).ok, false);
  assert.equal(budgetCheck({ kind: 'gear', item: 'Solid River' }, null).ok, true); // no cap
  setUserPrice('Solid River', null);
});

test('kept builds: "Save as" keeps a named copy with its plan, open switches, delete removes', async () => {
  const saved = new Map();
  const store = {
    loadSettings: async () => [],
    saveSettings: (id, v) => saved.set(id, structuredClone(v)),
    deleteSettings: (id) => saved.delete(id),
  };
  const samples = new SampleService({ store, gamedata: gd, logService: { character: () => null, on: () => {} } });
  await samples.start();
  samples.applyPreset('budget50');
  samples.setPlan(samples.currentId, { path: { start: 1, end: 2, reached: true, steps: [] } });
  const copy = samples.saveAs('50 FE plan');
  assert.equal(copy.spec.id, '50-fe-plan');
  assert.equal(copy.spec.name, '50 FE plan');
  assert.equal(copy.path.stale, false); // the copied plan goes with the copied build
  assert.ok(saved.get('sample:50-fe-plan').plan.path);
  assert.equal(saved.get('sampleCurrent').currentId, '50-fe-plan');
  // An edit makes the plan stale, and is saved at once
  samples.update({ level: 85 });
  assert.equal(samples.page().path.stale, true);
  assert.equal(saved.get('sample:50-fe-plan').sampleSpec.level, 85);
  assert.equal(samples.open('bing2').spec.id, 'bing2');
  assert.deepEqual(samples.saves().map((s) => s.id).sort(), ['50-fe-plan', 'bing2']);
  samples.remove('50-fe-plan');
  assert.ok(!saved.has('sample:50-fe-plan'));
  assert.equal(samples.remove('bing2').error, "That's the only build; keep at least one");
});

test("a sample build's slates count: their lines at the board's Effect bonus", () => {
  const legendaries = legendaryCatalog(gd);
  const spec = PRESETS.budget50.build('s');
  const dps = (s) => calculate(sampleCharacter(s, gd, legendaries), gd, s.scenario, { hero: s.hero, pactspirits: s.pactspirits }).sim.avgDps;
  const before = dps(spec);
  spec.slates = [{ name: "Goddess of Knowledge's Divinity", talents: [{ text: '+1 Lightning Skill Level', effectPct: 70 }] }];
  const character = sampleCharacter(spec, gd, legendaries);
  assert.ok(character.slates[0].icon, 'the slate gets its art');
  // +1 at +70% rounds to +2 Lightning Skill Levels
  const { report } = buildSaveData(character, {}, { hero: spec.hero, pactspirits: [] });
  assert.deepEqual(report.lineSources.filter((l) => l.source === 'Slates').map((l) => l.text), ['+2 Lightning Skill Level']);
  assert.ok(dps(spec) > before * 1.1);
});

test("supports run at SS14's numbers, and SS14's new supports are in the engine", () => {
  const pb = tob.SupportSkills.find((s) => s.name === 'Psychic Burst');
  assert.equal(pb.templates[0].levelValues[19], 30);
  assert.ok(SUPPORT_SYNC.levels.some((l) => l.startsWith('Psychic Burst: 35.5 -> 30')));
  // Turmoil: +17% additional damage taken, +10% Turmoil Effect per Spell Burst stack consumed (6) at level 20
  const turmoil = tob.SupportSkills.find((s) => s.name === 'Turmoil Burst');
  assert.equal(turmoil.templates[0].levelValues[19], 27.2);
  assert.ok(tob.NobleSupportSkills.some((s) => s.name === 'Splitting Lightning Bolt: Disintegration (Noble)'));
});

test('SS14 lines are rewritten to what they come to at steady state', () => {
  const spellProjectile = { mainTags: ['Spell', 'Projectile', 'Lightning'] };
  assert.equal(rewriteLine('+3.6% additional damage for the supported skill for each time it was cast recently, up to 8 time(s)'), '+28.8% additional damage for the supported skill');
  assert.equal(rewriteLine('+26% additional Hit Damage for the supported skill for each remaining fork'), '+52% additional Hit Damage for the supported skill');
  assert.equal(
    rewriteLine('When activating Spell Burst, +40% Spell Critical Strike Rating for every 1 Spell Burst Charge stack consumed. Lasts 10s. Stacks up to 10 times'),
    '+400% Spell Critical Strike Rating',
  );
  assert.equal(rewriteLine('最近每生成 1 个法术投射物，额外 +2% 法术投射物伤害，上限 10 层', spellProjectile), '+20% additional Projectile Damage');
  assert.equal(rewriteLine('+1 Spell Projectile Skill Level', spellProjectile), '+1 Projectile Skill Level');
  assert.equal(rewriteLine('+1 Spell Projectile Skill Level', { mainTags: ['Attack', 'Projectile'] }), '');
  assert.equal(rewriteLine('Damage penetrates 30% Elemental Resistance of Numbed enemies', { config: { enemyNumbed: true } }), 'Damage Penetrates 30% Elemental Resistance');
  assert.equal(rewriteLine('Damage penetrates 30% Elemental Resistance of Numbed enemies', { config: {} }), '');
});

test('"(Max Active Divinity: 1)" (SS14) caps a slate line at one copy, like "(Max Divinity Effect: 1)"', () => {
  const spec = PRESETS.trove.build('t');
  const line = '+20% Numbed Effect (Max Active Divinity: 1)';
  spec.slates = [1, 2].map((position) => ({ position, name: 'Slate', talents: [{ text: line, effectPct: 0 }] }));
  const character = sampleCharacter(spec, gd, legendaryCatalog(gd));
  const { report } = buildSaveData(character, {}, { hero: spec.hero, pactspirits: [] });
  assert.deepEqual(
    report.lineSources.filter((l) => l.source === 'Slates').map((l) => l.text),
    ['+20% Numbed Effect'],
  );
});

test('every Bing 2 preset builds and simulates', () => {
  const legendaries = legendaryCatalog(gd);
  for (const key of Object.keys(PRESETS)) {
    const spec = PRESETS[key].build(key);
    const calc = calculate(sampleCharacter(spec, gd, legendaries), gd, spec.scenario, { hero: spec.hero, pactspirits: spec.pactspirits });
    assert.equal(calc.engine.ok, true, key);
    assert.equal(calc.mainSkill, 'Splitting Lightning Bolt', key);
    assert.ok(calc.sim.supported && calc.sim.avgDps > 0, key);
  }
});

test('a copied build (specFromCharacter) computes the same as the build it was copied from', () => {
  const legendaries = legendaryCatalog(gd);
  const spec = PRESETS.mid.build('m');
  const character = sampleCharacter(spec, gd, legendaries);
  const calc = calculate(character, gd, spec.scenario, { hero: spec.hero, pactspirits: spec.pactspirits });
  const copy = specFromCharacter({ ...character, calc: { ...calc, choices: { ...calc.choices, hero: spec.hero, pactspirits: spec.pactspirits } } });
  const again = calculate(sampleCharacter(copy, gd, legendaries), gd, copy.scenario, { hero: copy.hero, pactspirits: copy.pactspirits });
  assert.ok(Math.abs(again.sim.avgDps / calc.sim.avgDps - 1) < 1e-9, `${again.sim.avgDps} vs ${calc.sim.avgDps}`);
});

test('the catalog lists Treasure Trove legendaries (drop level 54 or less) for each slot', () => {
  const catalog = sampleCatalog(gd);
  const sublime = catalog.legendaries.find((l) => l.name === 'On the Sublime');
  assert.deepEqual([sublime.type, sublime.trove, sublime.slots], ['Wand', true, [2, 3]]);
  assert.equal(catalog.legendaries.find((l) => l.name === 'Law of Greed').trove, false);
  assert.ok(catalog.craft.Ring.some((a) => /^\+1 Max Spell Burst\n/.test(a.text)));
});
