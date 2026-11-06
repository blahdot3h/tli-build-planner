// Damage shapes for active skills without a hand-written model in the engine, read from tlidb's
// current-season skill cards (data/gamedata/skillData.json, written by scripts/import-tlidb.js).
// Each card is sorted into a shape the engine already computes (a spell hit or a weapon attack),
// with per-level numbers, or refused with the reason. A shape that would be wrong is worse than a
// refusal, so anything the card says the skill does beyond one hit per cast is either refused or
// listed as not counted (coverage "partial"). The approach follows TLI Builder's per-skill
// resolvers and refusal policy (github.com/Tyrayla/TLIBuilder, MIT, Copyright (c) 2026 Tyrayla).

const ELEMENTS = '(Physical|Cold|Fire|Lightning|Erosion)';
// "Deals 607-1128 SpellFire Damage." (tlidb runs "Spell" and the element together for some skills)
const SPELL_HIT = new RegExp(`^Deals (\\d+(?:\\.\\d+)?)-(\\d+(?:\\.\\d+)?) Spell\\s*${ELEMENTS} Damage\\.?$`, 'i');
const ATTACK_HIT = /^Deals (\d+(?:\.\d+)?)% Weapon Attack Damage\.?$/i;
const ANY_DAMAGE = /^Deals .*Damage/i;

// The share of its level-20 damage a flat-range spell deals at levels 1-19: the median of the 23
// spells whose tlidb cards have a level table (they agree within about 2%)
export const SPELL_LEVEL_CURVE = [
  0.0138, 0.015, 0.0198, 0.0274, 0.0351, 0.0428, 0.0493, 0.0615, 0.0797, 0.0967, 0.1247, 0.1456, 0.1767, 0.2078, 0.2462, 0.346, 0.4077, 0.5614,
  0.8382,
];

// Card lines the engine can apply as modifiers
const INTRINSIC = [
  [/^Converts (\d+(?:\.\d+)?)% of the skill's Physical Damage to (Cold|Fire|Lightning|Erosion) Damage\.?$/i, (m) => ({ type: 'ConvertDmgPct', value: Number(m[1]), from: 'physical', to: m[2].toLowerCase() })],
  [/^All of the skill's Physical Damage will be converted to (Cold|Fire|Lightning|Erosion) Damage\.?$/i, (m) => ({ type: 'ConvertDmgPct', value: 100, from: 'physical', to: m[1].toLowerCase() })],
  [/^\+(\d+) Jumps? for this skill\.?$/i, (m) => ({ type: 'Jump', value: Number(m[1]) })],
  // a fold's own line (Hound's Fangs' projectile-quantity bonus for the fangs it fires itself)
  [/^\+(\d+(?:\.\d+)?)% additional damage$/i, (m) => ({ type: 'DmgPct', value: Number(m[1]), dmgModType: 'global', addn: true })],
];
// Lines that change what a cast does beyond one hit: the cast is still counted, these aren't
const EXTRA_DAMAGE =
  /every \d+(?:\.\d+)? ?s\b|interval|automatically|thunderbolt|wave|barrage|shotgun|projectile quantity|fires (?:[2-9]|\d{2,}) projectile|chance to fire|explod|for every \d+ time\(s\)|split|shadow strike|summon/i;
// Tags whose damage comes some other way than one hit per cast
const REFUSED_TAGS = {
  Channeled: 'a channeled skill (its damage builds with channel stacks)',
  Sentry: 'a sentry skill',
  Summon: 'a summon skill (minion damage)',
  Minion: 'a minion skill',
  Combo: 'a combo skill',
  Terra: 'a Terra skill (charges and recasts)',
};

const pct = (s) => Number(String(s ?? '').replace('%', ''));
const range = (s) => {
  const m = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/.exec(String(s ?? ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
};
// 40 levels: the table's rows 1-20, then level 20's value (levels past 20 add the engine's
// above-max-level bonus instead)
const fill40 = (byLevel) => Array.from({ length: 40 }, (_, i) => byLevel(Math.min(20, i + 1)));

export function classifySkill(card) {
  if (!card || card.type !== 'Active') return null;
  const base = { name: card.name, tags: card.tags ?? [], mainStats: card.header?.mainStats ?? [] };
  const refuse = (reason) => ({ ...base, shape: null, coverage: 'refused', reason });
  for (const [tag, reason] of Object.entries(REFUSED_TAGS)) if (base.tags.includes(tag)) return refuse(`${card.name} is ${reason}, which isn't modelled yet`);

  const lines = (card.details ?? []).map((l) => l.trim()).filter(Boolean);
  const damage = lines.filter((l) => ANY_DAMAGE.test(l));
  if (!damage.length) return refuse(`${card.name}'s card has no damage line`);
  // A projectile that forks on hit into secondaries with their own damage line (Moon's Dawn:
  // "Forks into 1-7 Projectile(s) on hit", random per cast, each secondary hitting once, as the
  // player sees it). The two lines fold into one hit: the first hit plus the secondaries that land
  // on a single target, each at the secondary line's share of the primary's base damage and of
  // its Effectiveness of Added Damage. On CoffeeBingBong's Lv85 dummy (2026-11-04) every blade
  // landed: Moon's Dawn did about 1.5x what Psionic Missile does with the same supports, which is
  // the Moonblade's 72% effectiveness plus four half-strength secondaries (216% in all) against
  // Psionic Missile's 155%.
  const FORK_HITS_SHARE = 1;
  const fork = damage.length === 2 && lines.map((l) => /^Forks into (\d+)(?:-(\d+))? Projectile\(s\) on hit\.?$/i.exec(l)).find(Boolean);
  if (fork) {
    const a = SPELL_HIT.exec(damage[0]);
    const b = SPELL_HIT.exec(damage[1]);
    if (a && b && a[3].toLowerCase() === b[3].toLowerCase()) {
      const forks = (Number(fork[1]) + Number(fork[2] ?? fork[1])) / 2;
      const hits = forks * FORK_HITS_SHARE;
      const share = (Number(b[1]) + Number(b[2])) / (Number(a[1]) + Number(a[2]));
      const folded = `Deals ${Math.round(Number(a[1]) + hits * Number(b[1]))}-${Math.round(Number(a[2]) + hits * Number(b[2]))} Spell ${a[3]} Damage`;
      const eff = card.header?.addedDmgEffPct ?? 100;
      const shape = classifySkill({ ...card, header: { ...card.header, addedDmgEffPct: Math.round(eff * (1 + hits * share)) }, details: lines.map((l) => (l === damage[0] ? folded : l === damage[1] ? '' : l)).filter(Boolean), progression: null });
      return shape?.shape ? { ...shape, coverage: 'partial', reason: `One cast counted as the first hit plus ${hits} secondary hits (${forks} forks on average, each landing once at ${Math.round(share * 100)}% of the first hit)${shape.reason ? `. ${shape.reason}` : ''}` } : shape;
    }
  }
  // A skill that builds a charge each cast and fires a bigger hit when the charge is full (Hound's
  // Fangs: Small Fangs, then at 10 Bite Charge a Massive Fang instead). On one target the casts
  // run N small, one big, so a cast averages (N x small + big) / (N + 1), the big hit's share of the
  // flat added damage scaled by its base like the forks above. The card lists the small hit first.
  const charge = damage.length === 2 && lines.map((l) => /^Max \w+ Charge: (\d+) stacks?\.?$/i.exec(l)).find(Boolean);
  if (charge) {
    const a = SPELL_HIT.exec(damage[0]);
    const b = SPELL_HIT.exec(damage[1]);
    if (a && b && a[3].toLowerCase() === b[3].toLowerCase()) {
      const n = Number(charge[1]);
      const share = (Number(b[1]) + Number(b[2])) / (Number(a[1]) + Number(a[2]));
      const avg = (v, w) => (n * Number(v) + Number(w)) / (n + 1);
      const folded = `Deals ${Math.round(avg(a[1], b[1]))}-${Math.round(avg(a[2], b[2]))} Spell ${a[3]} Damage`;
      const eff = card.header?.addedDmgEffPct ?? 100;
      // "+8% additional Damage for every +1 Projectile Quantity of this skill" counts the fangs the
      // skill fires by itself past the first ("fires at up to 3 enemies": +2). CoffeeBingBong's
      // Lv85 dummy (2026-11-04, 5:38): the fold alone came out at 84% of the game, with this +16% at 98%
      const perProj = lines.map((l) => /^\+(\d+(?:\.\d+)?)% additional Damage for every \+1 Projectile Quantity of this skill\.?$/i.exec(l)).find(Boolean);
      const ownProjectiles = Number((/最多 (\d+) 个敌人|up to (\d+) enem/i.exec((card.simple ?? []).join(' ')) ?? []).slice(1).find(Boolean) ?? 1);
      const ownBonus = perProj && ownProjectiles > 1 ? `+${+(Number(perProj[1]) * (ownProjectiles - 1)).toFixed(2)}% additional damage` : null;
      const details = lines.map((l) => (l === damage[0] ? folded : l === damage[1] || (ownBonus && l === perProj[0]) ? '' : l)).filter(Boolean);
      const shape = classifySkill({ ...card, header: { ...card.header, addedDmgEffPct: Math.round((eff * (n + share)) / (n + 1)) }, details: ownBonus ? [...details, ownBonus] : details, progression: null });
      return shape?.shape ? { ...shape, coverage: 'partial', reason: `One cast counted as the average of ${n} small hits and one big hit at ${Math.round(share * 100) / 100}x the small one, on a single target${ownBonus ? `; its own ${ownProjectiles} projectiles count ${ownBonus} through its per-projectile line` : ''}${shape.reason ? `. ${shape.reason}` : ''}` } : shape;
    }
  }
  if (damage.length > 1) return refuse(`${card.name} deals damage in more than one form (${damage.length} damage lines)`);
  if (card.header?.cooldown) return refuse(`${card.name} has a ${card.header.cooldown} s cooldown, which limits its casts in a way that isn't modelled yet`);

  const intrinsic = [];
  const notModelled = [];
  for (const line of lines) {
    if (line === damage[0] || /:$/.test(line)) continue;
    const rule = INTRINSIC.find(([re]) => re.test(line));
    if (rule) intrinsic.push(rule[1](rule[0].exec(line)));
    else notModelled.push(line);
  }
  const extra = notModelled.filter((l) => EXTRA_DAMAGE.test(l));
  const rows = card.progression?.rows ?? [];
  const cols = (card.progression?.columns ?? []).map((c) => String(c).toLowerCase());
  const at = (level) => rows.find((r) => Number(r[0]) === level);
  const col = (name) => cols.indexOf(name);

  const spell = SPELL_HIT.exec(damage[0]);
  if (spell) {
    const lv20 = [Number(spell[1]), Number(spell[2])];
    const table = col('damage') >= 0 && rows.length >= 20;
    const dmgAt = (level) => (table ? range(at(level)?.[col('damage')]) : null) ?? lv20.map((v) => (level >= 20 ? v : Math.round(v * SPELL_LEVEL_CURVE[level - 1])));
    const effCol = col('effectiveness of added damage');
    const eff = (level) => (table && effCol >= 0 ? pct(at(level)?.[effCol]) : null) || card.header?.addedDmgEffPct || 100;
    // Several projectiles a cast that can all hit one enemy (Chromatic Shot: "Projectile Quantity
    // of this skill +2", "can hit the same enemy", "Shotgun Effect falloff coefficient is 70%"):
    // each hit after the first loses the coefficient's share (70%: the second shot does 30%, the
    // third 9%, so three shots are 1.39 hits), on the skill's own base damage and its flat added
    // damage alike. CoffeeBingBong's Lv85 dummy (2026-11-05, Chromatic Shot Lv16 from close range):
    // 2,026B against 2,056B with this reading; 1 + 0.7 + 0.49 would have been 3,239B.
    const ownExtra = Number(lines.map((l) => /^Projectile Quantity of this skill \+(\d+)\.?$/i.exec(l)).find(Boolean)?.[1] ?? 0);
    const sameEnemy = lines.some((l) => /projectiles? (?:shot|fired) by this skill can hit the same enemy|shots fired by this skill can hit the same enemy/i.test(l));
    const falloff = Number(lines.map((l) => /Shotgun Effect falloff coefficient is (\d+(?:\.\d+)?)%/i.exec(l)).find(Boolean)?.[1] ?? 100) / 100;
    const hits = ownExtra > 0 && sameEnemy ? Array.from({ length: ownExtra + 1 }, (_, k) => (1 - falloff) ** k).reduce((a, b) => a + b, 0) : 1;
    const counted = hits > 1 ? [`Projectile Quantity of this skill +${ownExtra}`, 'can hit the same enemy', 'Shotgun Effect falloff'] : [];
    const extraLeft = extra.filter((l) => !counted.some((c) => l.includes(c)));
    return {
      ...base,
      shape: 'spell',
      dmgType: spell[3].toLowerCase(),
      levels: {
        spellDmgMin: fill40((l) => Math.round(dmgAt(l)[0] * hits)),
        spellDmgMax: fill40((l) => Math.round(dmgAt(l)[1] * hits)),
        castTime: Array(40).fill(card.header?.castTime ?? 1),
        addedDmgEffPct: fill40((l) => Math.round(eff(l) * hits)),
      },
      intrinsic,
      notModelled,
      // Without a table, levels below 20 are the shared curve's estimate
      coverage: extraLeft.length || hits > 1 ? 'partial' : table ? 'exact' : 'estimated below level 20',
      reason: [hits > 1 ? `One cast counted as ${ownExtra + 1} projectiles on one enemy at ${Math.round(hits * 100) / 100}x one hit (shotgun falloff ${Math.round(falloff * 100)}%)` : null, extraLeft.length ? `Not counted: ${extraLeft.join(' / ')}` : null].filter(Boolean).join('. ') || null,
    };
  }

  const attack = ATTACK_HIT.exec(damage[0]);
  if (attack) {
    const table = rows.length >= 20;
    const effCol = col('effectiveness of added damage');
    const wad = (level) => (table ? pct(at(level)?.[effCol >= 0 ? effCol : col('damage')]) || range(at(level)?.[col('damage')])?.[0] : null) || Number(attack[1]);
    if (!table) return refuse(`${card.name}'s card has no level table, and attack skills don't follow one shared curve`);
    return {
      ...base,
      shape: 'attack',
      levels: { weaponAtkDmgPct: fill40(wad), addedDmgEffPct: fill40(wad) },
      intrinsic,
      notModelled,
      coverage: extra.length ? 'partial' : 'exact',
      reason: extra.length ? `Not counted: ${extra.join(' / ')}` : null,
    };
  }
  return refuse(`${card.name}'s damage line ("${damage[0]}") isn't a single spell hit or weapon attack`);
}

// Every active skill card, by name: the engine takes the ones with a shape
export function buildSkillShapes(skillData) {
  const shapes = {};
  for (const card of Object.values(skillData ?? {})) {
    const shape = classifySkill(card);
    if (shape) shapes[shape.name] = shape;
  }
  return shapes;
}
