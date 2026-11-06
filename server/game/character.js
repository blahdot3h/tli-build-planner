import { asList, isTruncated } from '../log/treeParser.js';
import { PAGE, baseIdOf } from './state.js';
import { affixTier } from './tiers.js';
import { colOf, rowOf, slateCells, spriteFor } from './slates.js';

// Equipped gear slots (PageId -1). Weapons were confirmed by swapping them in game (removing the
// main hand shifts the off hand into slot 2); the rest match the item types equipped in them.
const GEAR_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SLOT_LABELS = {
  1: 'Helmet',
  2: 'Main hand',
  3: 'Off hand',
  4: 'Chest',
  5: 'Necklace',
  6: 'Ring 1',
  7: 'Ring 2',
  8: 'Belt',
  9: 'Gloves',
  10: 'Boots',
};

// Display name for an item instance: legendary name, else base item name
export function itemName(id, catalog, gd) {
  const unique = catalog.get(id)?.UniqueItmId;
  return (unique && gd.name('uniques', unique)) || gd.name('items', baseIdOf(id)) || null;
}

// Skill page (PageId -6) layout, inferred from the slot ids in the log: active skills sit in
// slots 1-5 with supports at slot*100+1..5; passive skills sit in 1001/1007/1013/1019 with
// supports in the next five slots.
const ACTIVE_SKILL_SLOTS = [1, 2, 3, 4, 5];
const PASSIVE_SKILL_SLOTS = [1001, 1007, 1013, 1019];
const SUPPORTS_PER_SKILL = 5;

// Item fields that hold affix lists ({ Id, DynArgs } entries), in display order. Unknown
// fields with the same shape are still shown, under their raw field name.
const AFFIX_KINDS = {
  BaseAttrAffix: 'base',
  FixedBaseAffix: 'implicit',
  BaseAffix: 'implicit',
  Prefix: 'prefix',
  Suffix: 'suffix',
  EnchantAffixs: 'enchant',
  AwakenAffix: 'awakened',
};
const KIND_ORDER = Object.values(AFFIX_KINDS);
const kindRank = (kind) => (KIND_ORDER.includes(kind) ? KIND_ORDER.indexOf(kind) : KIND_ORDER.length);

// item: { type, legendary } for the tier a crafted line has (server/game/tiers.js); none for gems
function describeAffixes(raw, gd, item = null) {
  const affixes = [];
  for (const [field, value] of Object.entries(raw)) {
    const list = asList(value);
    if (!list.length || !list.every((a) => a && typeof a === 'object' && typeof a.Id === 'number')) continue;
    const kind = AFFIX_KINDS[field] ?? field;
    for (const a of list) {
      const values = asList(a.DynArgs);
      const affix = { kind, id: a.Id, values, text: gd.affixText(a.Id, values) };
      const tier = item ? affixTier(gd, item, affix) : null;
      affixes.push(tier != null ? { ...affix, tier } : affix);
    }
  }
  return affixes.sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
}

// name is the node type ("Micro Talent", or a core talent's name); text is its effect
function describeTalent(id, gd) {
  const t = gd.get('talents', id);
  return { id, name: t?.name ?? null, tree: t?.tree ?? null, text: t?.text ?? null, icon: t?.icon ?? null };
}

// A legendary's own art; any other item (a crafted rare, a slate, a memory) shows its base's art
const itemIcon = (uniqueId, baseId, gd) => (uniqueId && gd.icon('uniques', uniqueId)) || gd.icon('items', baseId);

// Talent node ids are <tree><column><row>00 (52010300: tree 52, column 1, row 3), matching the
// log's positions, which are { x: row, y: column }, 1-based
export function talentPosition(id) {
  const s = String(id);
  return { x: Number(s.slice(-4, -2)), y: Number(s.slice(-6, -4)) };
}

// Older heroes list chosen traits in pointOverView.activeId; newer ones use a node tree
function heroTraits(hero, gd) {
  const nodes = asList(hero.treeActivatedNodes);
  const traits = nodes.length
    ? nodes.map((n) => ({ id: n.node_id, slot: n.matched_slot ?? null }))
    : asList(hero.pointOverView?.activeId).map((id) => ({ id, slot: null }));
  return traits.map((t) => {
    const name = gd.name('heroTraits', t.id);
    return { ...t, name, icon: gd.iconByName('heroTraits', name) };
  });
}

export const gearKey = (pages) =>
  [...(pages.get(PAGE.EQUIPPED) ?? new Map())].map(([slot, e]) => `${slot}:${e.id}`).sort().join('|');

// Seconds spent hitting the dummy, grouped into bursts split by pauses longer than this
const BURST_GAP_S = 3;

export function describeDummyTest(test) {
  const seconds = [...test.attacking].sort((a, b) => a - b);
  const bursts = [];
  for (const s of seconds) {
    const b = bursts.at(-1);
    if (b && s - b.last <= BURST_GAP_S) b.last = s;
    else bursts.push({ first: s, last: s });
  }
  const defs = test.defs.map((d) => d.value);
  return {
    id: String(test.start),
    start: test.start,
    end: test.end,
    attackingSeconds: seconds.length,
    bursts: bursts.map((b) => ({ start: b.first * 1000, end: (b.last + 1) * 1000, seconds: b.last - b.first + 1 })),
    def: defs.length ? { first: defs[0], min: Math.min(...defs), max: Math.max(...defs) } : null,
    gameDps: test.gameDps,
    gear: test.gear,
  };
}

// What the game itself reports: its DPS/DEF figures from item compares, and dummy sessions
export function describeTelemetry(state, gd) {
  const stats = state.gameStats ?? { dps: null, def: null, comparisons: new Map() };
  const comparisons = [...stats.comparisons.values()].reverse().map((c) => ({
    ...c,
    slotLabel: SLOT_LABELS[c.slot] ?? null,
    itemName: (c.goldId && gd.name('uniques', c.goldId)) || gd.name('items', c.baseId) || null,
  }));
  const gear = gearKey(state.pages);
  const dummyTests = (state.dummyTests ?? [])
    .map(describeDummyTest)
    .map(({ gear: testGear, ...t }) => ({ ...t, gearChanged: testGear !== gear }))
    .reverse();
  // current: logged with the gear worn now (a figure from before a gear swap is out of date)
  const figure = (f) => (f ? { value: f.value, at: f.at, current: f.gear === gear } : null);
  // The attribute panel's rows: your own (current while the gear is unchanged) and the last other
  // player's you looked at
  const panel = stats.panel ? { at: stats.panel.at, level: stats.panel.level, current: stats.panel.gear === gear, rows: stats.panel.rows } : null;
  const viewedPanel = stats.viewedPanel ? { at: stats.viewedPanel.at, level: stats.viewedPanel.level, playerId: stats.viewedPanel.playerId, rows: stats.viewedPanel.rows } : null;
  return { gameStats: { dps: figure(stats.dps), def: figure(stats.def), comparisons, panel, viewedPanel }, dummyTests };
}

export function describeItem(id, raw, gd) {
  const baseId = baseIdOf(id);
  const base = gd.get('items', baseId);
  const item = { id, baseId, name: base?.name ?? null, type: base?.type ?? null, icon: base?.icon ?? null };
  if (!raw) return { ...item, detailsKnown: false };
  return {
    ...item,
    detailsKnown: true,
    level: raw.Level ?? null,
    rarity: raw.RareValue ?? null,
    uniqueId: raw.UniqueItmId || null,
    uniqueName: raw.UniqueItmId ? gd.name('uniques', raw.UniqueItmId) : null,
    icon: itemIcon(raw.UniqueItmId, baseId, gd),
    forge: asList(raw.Status),
    affixes: describeAffixes(raw, gd, { type: base?.type ?? null, legendary: !!raw.UniqueItmId }),
  };
}

function describeSkill(entry, catalog, gd, activating) {
  if (!entry) return null;
  const raw = catalog.get(entry.id);
  const baseId = baseIdOf(entry.id);
  // Noble and Magnificent supports carry a rolled line ("+28% additional damage for the supported
  // skill"); their Level is the support's rank, 1-5
  const affixes = raw ? describeAffixes(raw, gd) : [];
  return {
    id: entry.id,
    baseId,
    name: gd.name('skills', baseId),
    icon: gd.icon('skills', baseId),
    level: raw?.Level ?? null,
    skillItemLevel: raw?.SkillItemLevel ?? null,
    activating: activating.has(entry.id) || null,
    ...(affixes.length ? { affixes } : {}),
  };
}

function skillGroups(slots, supportSlot, page, catalog, gd, activating) {
  return slots.map((slot) => ({
    slot,
    skill: describeSkill(page.get(slot), catalog, gd, activating),
    supports: Array.from({ length: SUPPORTS_PER_SKILL }, (_, i) =>
      describeSkill(page.get(supportSlot(slot, i + 1)), catalog, gd, activating),
    ).filter(Boolean),
  }));
}

// The character as the UI shows it, built from the last login dump plus live bag changes.
export function buildCharacter(state, gd) {
  const tree = state.login?.tree;
  if (!tree) return null;
  const p = tree.player ?? {};

  const equippedPage = state.pages.get(PAGE.EQUIPPED) ?? new Map();
  const equipment = GEAR_SLOTS.map((slot) => {
    const entry = equippedPage.get(slot);
    const item = entry ? describeItem(entry.id, state.catalog.get(entry.id), gd) : null;
    return {
      slot,
      label: SLOT_LABELS[slot],
      item,
      changedAt: state.slotChangedAt.get(slot) ?? null,
    };
  });

  const skillPage = state.pages.get(PAGE.SKILLS) ?? new Map();
  const activating = new Set(
    asList(tree.skillLayout?.slots)
      .filter((s) => s.value?.status === 'Activating')
      .map((s) => s.value.skillId),
  );
  const skills = {
    active: skillGroups(ACTIVE_SKILL_SLOTS, (s, i) => s * 100 + i, skillPage, state.catalog, gd, activating),
    passive: skillGroups(PASSIVE_SKILL_SLOTS, (s, i) => s + i, skillPage, state.catalog, gd, activating),
  };

  // Every node of each tree with its grid position; points is 0 for unallocated nodes. The tree's
  // name comes from its nodes: talent ids are in the game data, tree ids aren't. Core talents
  // picked in a tree are listed separately (bonusGeniusInfo), not as nodes.
  const talentTrees = asList(tree.geniusInfos?.info).map((t) => {
    const nodes = asList(t.geniusList).map((n) => ({
      ...describeTalent(n.geniusId, gd),
      points: n.point ?? 0,
      x: n.position?.x ?? null,
      y: n.position?.y ?? null,
    }));
    const cores = asList(t.bonusGeniusInfo)
      .map((b) => b.value?.geniusId)
      .filter(Boolean)
      .map((id) => describeTalent(id, gd));
    // An Ethereal Prism sits on one node's spot (prismInfo.geniusId is that node's id) and changes
    // the nodes around it (prismEffectPositions); the spot can't take points
    const prismAt = t.prismInfo?.geniusId ? talentPosition(t.prismInfo.geniusId) : null;
    // The prism item: its base line ("+75% to the effects of Random Affixes on this Prism") and
    // random lines ("All Legendary Medium Talent within the area also gain: ...")
    const prismItem = t.prismInfo?.item ? describeItem(t.prismInfo.item.Id, t.prismInfo.item, gd) : null;
    return {
      id: t.geniusCareerId,
      name: nodes.find((n) => n.tree)?.tree ?? cores.find((c) => c.tree)?.tree ?? null,
      points: nodes.reduce((sum, n) => sum + n.points, 0),
      nodes,
      cores,
      prism: prismAt && {
        ...prismAt,
        area: asList(t.prismEffectPositions).map((p) => ({ x: p.x, y: p.y })),
        name: prismItem?.name ?? null,
        icon: prismItem?.icon ?? null,
        affixes: prismItem?.affixes ?? [],
      },
      truncated: isTruncated(t.geniusList),
    };
  });

  const slateTalents = new Map(asList(tree.talentBlockInfluence).map((e) => [e.key, asList(e.value?.EffectTalentIds)]));
  // Each slate talent's Effect bonus from the board (Nether King's Divinity reaching it):
  // DevilLineBoostTalentIds[i] gets DevilLineBoostInfluence[i] percent, plus any TalentIdInfluence
  const slateBoosts = new Map(
    asList(tree.talentBlockInfluence).map((e) => {
      const v = e.value ?? {};
      const boost = new Map();
      const devilIds = asList(v.DevilLineBoostTalentIds);
      const devil = asList(v.DevilLineBoostInfluence);
      devilIds.forEach((id, i) => boost.set(id, (boost.get(id) ?? 0) + Number(devil[i] ?? 0)));
      const influence = asList(v.TalentIdInfluence);
      asList(v.EffectTalentIds).forEach((id, i) => boost.set(id, (boost.get(id) ?? 0) + Number(influence[i] ?? 0)));
      return [e.key, boost];
    }),
  );
  // Lines a slate copies off its neighbours (When Sparks Set the Prairie Ablaze, Space Rift…): the
  // influence table's TalentIdCopy, by slate
  const slateCopies = new Map(asList(tree.talentBlockInfluence).map((e) => [e.key, asList(e.value?.TalentIdCopy)]));
  // The board (Talent → Statue of The New God): Index is the slate's spot, two digits, COLUMN then
  // row (23 = column 2, row 3; checked against a screenshot of CoffeeBingBong's board 2026-11-02);
  // ShapeId is the slate's current shape (shapes can be adjusted) and Direction its turn; the
  // shape's cells come from data/gamedata/slateShapes.local.json, read off screenshots of the
  // board. The Nether King's slate (no ShapeId) is one cell. Each line's slot colour is the game's
  // (Orange, Purple, Blue, Red).
  const slates = asList(tree.bag?.dressingTalentBlocks).map((b) => {
    const item = b.Item ?? {};
    const slotColor = new Map(Object.values(item.talentSlotList ?? {}).map((s) => [s.talentId, s.color]));
    return {
      position: b.Index,
      col: colOf(b.Index),
      row: rowOf(b.Index),
      id: item.Id,
      baseId: item.BaseId,
      uniqueId: item.UniqueItmId || null,
      name: (item.UniqueItmId && gd.name('uniques', item.UniqueItmId)) || gd.name('items', item.BaseId),
      icon: itemIcon(item.UniqueItmId, item.BaseId, gd),
      level: item.Level ?? null,
      rarity: item.RareValue ?? null,
      shapeId: item.ShapeId ?? null,
      direction: item.Direction ?? null,
      cells: slateCells(gd, item.ShapeId ?? null, item.Direction),
      sprite: spriteFor(gd, { uniqueId: item.UniqueItmId || null, baseId: item.BaseId, shapeId: item.ShapeId ?? null }, item.Direction),
      enhanced: item.EnhancedTimes ?? null,
      talents: (slateTalents.get(item.Id) ?? asList(item.BaseTalentList)).map((id) => ({
        ...describeTalent(id, gd),
        effectPct: slateBoosts.get(item.Id)?.get(id) ?? 0,
        color: slotColor.get(id) ?? null,
      })),
      copies: (slateCopies.get(item.Id) ?? []).map((id) => describeTalent(id, gd)),
    };
  });

  const hero = tree.heroCharacterv3OverView ?? {};
  // memoryLevel (ReminiscenceLevel) is the memory's own level, which sets its trait's level
  const memories = asList(hero.reminiscenceOverView?.reminiscence).map((r) => ({
    slot: r.index,
    state: r.state ?? null,
    memoryLevel: r.detail?.ReminiscenceLevel ?? null,
    item: describeItem(r.Id, r.detail, gd),
  }));

  const starLevels = new Map(asList(tree.ServantInfos?.servantData).map((s) => [s.servantId, s.starLevel ?? null]));
  const pactspirits = asList(tree.ContractInfosV2?.ContractDatas).map((c) => {
    const name = gd.name('pactspirits', c.servantId);
    return { area: c.areaId, id: c.servantId, name, icon: gd.iconByName('pactspirits', name), stars: starLevels.get(c.servantId) ?? null };
  });

  // Destinies installed on the Pact board's spots ("Micro Fate: Intelligence", +12-15 Intelligence),
  // each with its roll. They're character-wide stats.
  const pointDatas = tree.ContractInfosV2?.pointDatas;
  const destinies = asList(pointDatas)
    .filter((d) => d.tattoInfo)
    .map((d) => ({ point: d.contractPointId ?? null, active: d.isActive !== false, ...describeItem(d.tattoInfo.Id, d.tattoInfo, gd) }));

  const gaps = [
    ...equipment
      .filter((e) => e.item && !e.item.detailsKnown)
      .map((e) => `${e.label}: item details weren't in this session's login data. Relog to capture them.`),
    ...(isTruncated(pointDatas) ? ["Pact board: the game's log cuts lists off at 30 entries, so some installed Destinies may be missing."] : []),
    // A slot whose supports came through but whose skill didn't: the skill page list was cut off
    ...[...skills.active.map((g, i) => ['Active', g, i + 1]), ...skills.passive.map((g, i) => ['Passive', g, i + 1])]
      .filter(([, g]) => !g.skill && g.supports.length)
      .map(([kind, g, n]) => `${kind} skill ${n}: only its supports (${g.supports.map((s) => s.name).join(', ')}) are in the log. Either the slot is empty or the game cut the skill off its 30-entry list; if a skill is there, it's left out of the numbers.`),
    ...talentTrees
      .filter((t) => t.truncated)
      .map((t) => `Talent tree #${t.id}: the game's log cuts lists off at 30 entries, so some allocated nodes may be missing.`),
  ];

  return {
    player: {
      playerId: p.PlayerId,
      name: p.Name ?? null,
      level: state.level ?? p.Level ?? null,
      exp: p.Exp ?? null,
      heroId: p.HeroId ?? null,
      heroName: gd.name('heroes', p.HeroId),
      heroPurchaseId: p.HeroPurchaseId ?? null,
      seasonId: p.SeasonId ?? null,
    },
    loginAt: state.login.time,
    equipment,
    skills,
    heroTraits: heroTraits(hero, gd),
    memories,
    talentTrees,
    slates,
    pactspirits,
    destinies,
    recorded: { historyMaxDps: tree.otherInfo?.HistoryMaxDps ?? null },
    ...describeTelemetry(state, gd),
    gaps,
  };
}

// What a snapshot needs to rebuild the character later exactly as the live view does: the login
// dump, the equipped and skill pages, and the details of the items on them (an item's details can
// change later, e.g. when it's crafted). state is GameState or one of its earlier sessions.
export function snapshotSource(state) {
  if (!state.login) return null;
  const pages = {};
  const items = {};
  for (const page of [PAGE.EQUIPPED, PAGE.SKILLS]) {
    pages[page] = Object.fromEntries(state.pages.get(page) ?? new Map());
    for (const { id } of Object.values(pages[page])) {
      const raw = state.catalog.get(id);
      if (raw) items[id] = raw;
    }
  }
  return { loginTime: state.login.time, tree: state.login.tree, level: state.level ?? null, pages, items };
}

// Equipped gear as gearKey() spells it, for snapshots that didn't keep their pages
const equipmentKey = (equipment) =>
  equipment.filter((e) => e.item).map((e) => `${e.slot}:${e.item.id}`).sort().join('|');

// A character from a stored snapshot, shown with today's code and game data. Snapshots with a
// source are rebuilt from it; older ones only kept the built character, so its names and stat
// text are looked up again from the ids. Returns { character, gear } (gear as gearKey() gives it).
export function restoreCharacter(snapshot, gd, catalog) {
  const { calc: _calc, dummyTests: _tests, view: _view, ...stored } = snapshot.character;
  const s = snapshot.source;
  if (s?.tree) {
    const pages = new Map(
      Object.entries(s.pages).map(([page, slots]) => [Number(page), new Map(Object.entries(slots).map(([slot, e]) => [Number(slot), e]))]),
    );
    const view = {
      login: { time: s.loginTime, tree: s.tree },
      level: s.level,
      pages,
      catalog: { get: (id) => s.items[id] ?? catalog.get(id) },
      slotChangedAt: new Map(),
    };
    const character = buildCharacter(view, gd);
    // The game's figures from when the snapshot was taken
    return { character: { ...character, gameStats: stored.gameStats ?? character.gameStats }, gear: gearKey(pages) };
  }
  const character = refreshCharacter(stored, gd);
  return { character, gear: equipmentKey(character.equipment) };
}

const known = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

function refreshCharacter(c, gd) {
  const affixes = (list) => list?.map((a) => ({ ...a, text: gd.affixText(a.id, a.values ?? []) ?? a.text }));
  const item = (it) =>
    it && {
      ...it,
      name: gd.name('items', it.baseId) ?? it.name,
      icon: itemIcon(it.uniqueId, it.baseId, gd),
      ...(it.uniqueId ? { uniqueName: gd.name('uniques', it.uniqueId) ?? it.uniqueName } : {}),
      ...(it.affixes ? { affixes: affixes(it.affixes) } : {}),
    };
  const talent = (t) => ({ ...t, ...known(describeTalent(t.id, gd)) });
  const skill = (s) => s && { ...s, name: gd.name('skills', s.baseId) ?? s.name, icon: gd.icon('skills', s.baseId), ...(s.affixes ? { affixes: affixes(s.affixes) } : {}) };
  const group = (g) => ({ ...g, skill: skill(g.skill), supports: g.supports.map(skill) });
  return {
    ...c,
    player: { ...c.player, heroName: gd.name('heroes', c.player.heroId) ?? c.player.heroName },
    equipment: c.equipment.map((e) => ({ ...e, item: item(e.item), changedAt: null })),
    skills: { active: c.skills.active.map(group), passive: c.skills.passive.map(group) },
    heroTraits: c.heroTraits.map((t) => {
      const name = gd.name('heroTraits', t.id) ?? t.name;
      return { ...t, name, icon: gd.iconByName('heroTraits', name) };
    }),
    memories: c.memories.map((m) => ({ ...m, item: item(m.item) })),
    talentTrees: c.talentTrees.map((t) => {
      const nodes = t.nodes.map(talent);
      const cores = (t.cores ?? []).map(talent);
      return {
        ...t,
        name: nodes.find((n) => n.tree)?.tree ?? cores.find((n) => n.tree)?.tree ?? t.name,
        nodes,
        cores,
        prism: t.prism ? { ...t.prism, icon: gd.iconByName('items', t.prism.name), affixes: affixes(t.prism.affixes ?? []) } : null,
      };
    }),
    // These kept no legendary id: a legendary slate or prism is found by its name
    slates: c.slates.map((s) => ({
      ...s,
      icon: gd.icon('items', s.baseId) ?? gd.iconByName('uniques', s.name),
      talents: s.talents.map((t) => ({ effectPct: 0, ...talent(t) })),
    })),
    pactspirits: c.pactspirits.map((p) => {
      const name = gd.name('pactspirits', p.id) ?? p.name;
      return { ...p, name, icon: gd.iconByName('pactspirits', name) };
    }),
    destinies: (c.destinies ?? []).map(item),
  };
}
