// Scent Weaver Sage's Elixir skills (Dews, Tonics, Distillates) as engine buff skills. The engine has
// no model for them; tlidb's cards give each one's level-1 text ("Simple": "+36% Affliction Effect and
// +36% Damage Over Time") and level-20 text ("Details", one line per effect). Every one checked
// (Agony Dew, Thirst Dew, Swiftness Dew, Prism Butterfly and Fire Lizard Distillate, Life Tonic's
// table) grows by the same amount per level, so a level's value is read off that straight line and
// the line is parsed by the engine's own stat parser. The engine then scales the buff by Elixir
// Skill Effect like any buff skill (vendor .../calcs/offense.ts, buff type "elixir").
const NUMBER = /[-+]?\d+(?:\.\d+)?/g;
const MAX_LEVEL = 20;
// Lines on every card that aren't effects
const SKIP = /^(casts? (this|the) skill|lasts? (for )?\d|defeating enemies|this skill's restoration effect)/i;
// Effects the engine has no stat for (left out, listed by name in the report)
const UNCOUNTED = /^(has blur|damage triggers lucky|the ignite inflicted|inflicts all infiltration|adds \d+(\.\d+)?% of max life to energy shield|\d+(\.\d+)?% ill omen cumulative|energy shield charge started|restores? \d)/i;

const round1 = (n) => Math.round(n * 10) / 10;

// Numbers in the card's level-1 sentence, in order (after "Elixir Effect:" / "restoration:")
function simpleNumbers(simple) {
  const sentence = (simple ?? []).find((s) => /elixir effect|gains restoration/i.test(s)) ?? '';
  const effects = sentence.replace(/^.*?(elixir effect|gains restoration):?/i, '').replace(/\blasts?\b.*$/i, '');
  return (effects.match(NUMBER) ?? []).map(Number);
}

// The level-20 effect lines with their numbers, and the level-1 value of each number when the card's
// level-1 sentence lists the same count of numbers (else the level-20 value at every level)
export function elixirLevels(card) {
  const lines = (card.details ?? []).filter((d) => d && !SKIP.test(d) && !UNCOUNTED.test(d));
  const maxNums = lines.flatMap((l) => (l.match(NUMBER) ?? []).map(Number));
  const minNums = simpleNumbers(card.simple);
  const paired = minNums.length === maxNums.length && maxNums.length > 0;
  let k = 0;
  return lines.map((text) => {
    const nums = (text.match(NUMBER) ?? []).map((n) => {
      const max = Number(n);
      const min = paired ? minNums[k] : max;
      k++;
      return { min, max };
    });
    return { text, nums };
  });
}

// The effect line at a skill level, its numbers moved along the level-1 -> level-20 line (past 20 it
// keeps climbing, as gems do)
export function elixirLineAt(entry, level) {
  let i = 0;
  return entry.text.replace(NUMBER, (match) => {
    const { min, max } = entry.nums[i++] ?? {};
    if (min == null) return match;
    const value = round1(min + ((max - min) * (level - 1)) / (MAX_LEVEL - 1));
    const sign = match.startsWith('+') && value >= 0 ? '+' : '';
    return `${sign}${value}`;
  });
}

// Registers every Elixir skill of skillData with the engine: as an active skill if it lacks one, and
// with a buff factory for its parsed effect lines. Returns what was registered and which lines the
// engine couldn't read (shown as not counted).
export function registerElixirSkills(tob, skillData) {
  const registered = [];
  const unparsed = {};
  const table = {};
  for (const card of Object.values(skillData)) {
    if (card.type !== 'Active' || !(card.tags ?? []).includes('Elixir')) continue;
    if (!tob.ActiveSkills.some((s) => s.name === card.name)) {
      tob.ActiveSkills.push({ type: 'Active', name: card.name, tags: card.tags, description: [...(card.simple ?? [])], kinds: [] });
    }
    const entries = elixirLevels(card);
    const bad = entries.filter((e) => tob.parseMod(elixirLineAt(e, MAX_LEVEL)) === undefined).map((e) => e.text);
    if (bad.length) unparsed[card.name] = bad;
    const good = entries.filter((e) => !bad.includes(e.text));
    table[card.name] = (level) => good.flatMap((e) => tob.parseMod(elixirLineAt(e, level)) ?? []);
    registered.push(card.name);
  }
  tob.registerGeneratedBuffSkills(table);
  return { registered, unparsed };
}

// The slotted Elixir skills' card text, for the combat toggles' defaults (Blur, Infiltration...).
// "Inflicts all Infiltration Effects" is spelt out per element so each toggle sees its own.
export function elixirText(character, skillData) {
  const names = new Set(Object.values(skillData).filter((c) => (c.tags ?? []).includes('Elixir')).map((c) => c.name));
  const cards = (character.skills?.active ?? []).map((g) => g.skill?.name).filter((n) => n && names.has(n));
  return cards
    .flatMap((name) => Object.values(skillData).find((c) => c.name === name)?.details ?? [])
    .map((d) => (/inflicts all infiltration effects/i.test(d) ? 'Inflicts Cold Infiltration\nInflicts Fire Infiltration\nInflicts Lightning Infiltration' : d))
    .join('\n');
}
