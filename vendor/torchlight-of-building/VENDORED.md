# Vendored: Torchlight of Building

Source: https://github.com/aclinia/torchlight-of-building, commit `1da3826ab5539536a83378fd4aea20ffb3559f98`
(2026-04-14). MIT licensed, see `LICENSE.txt`.

Only `src/tli` (engine), `src/data` (game data) and `src/lib` (save schemas) are copied, without
tests. `scripts/build-engine.js` bundles them through `server/engine/tob-entry.ts` into
`server/engine/tob.bundle.js`, which `server/engine/bridge.js` feeds with characters read from the
game log.

## Local changes

- **Frost Terra** is calculable: per-level persistent cold damage (tlidb SS13 progression) in
  `src/data/skill/active.ts`, a factory in `src/tli/skills/active-factories.ts`, and an entry in
  the persistent-skill list in `src/tli/calcs/offense.ts`. The +26% additional damage per Terra
  Charge consumed is applied by the simulation (`server/sim/index.js`), not the engine.
- **Double Thrusts** is calculable: per-level weapon attack damage and added damage effectiveness
  (tlidb SS13: 138% at level 1 to 186% at level 20, flat after) in `src/data/skill/active.ts`, and
  a factory in `src/tli/skills/active-factories.ts` that counts the second thrust as +100%
  additional damage. Trauma from the thrusts is not modelled.

- **Added Physical Damage** had only the low end of its range in `src/data/skill/support.ts`
  ("add {value} - 3"); both ends are filled in from tlidb (78 - 130 at level 20). The other
  "Added X Damage" supports still have the same gap.
- **Support parsers** (`src/tli/skills/support-mod-templates.ts`): "Supported skills add X - Y
  <type> damage" and "Adds X% of <type> Damage as <type> Damage to the supported skill" (Physical
  to Fire's extra 25%).
- **Passive skills** with level values and factories: Charged Flames (+16% to +35% additional Fire
  Damage over levels 1-20; levels 21-40 extrapolated at +0.5 per level), Flame Focus and Acuteness
  Focus (their additional Fire / Physical Damage buffs; Focus Pts, Ignite, Trauma and Acute Strike
  are not modelled).
- **Scorch**: curse, +39% additional Fire Damage taken at every level (like Biting Cold).
- **Talent wording** (`src/tli/mod-parser/templates.ts`): "+X% Attack Damage / Attack Speed while
  Dual Wielding" (the parser only knew "when"), and "+X% <type> Penetration against Ignited
  enemies" with a new `enemy_is_ignited` condition and `targetEnemyIsIgnited` configuration flag
  (`src/tli/mod.ts`, `src/tli/core.ts`, `src/lib/schemas/config.schema.ts`,
  `src/tli/calcs/offense.ts`).

- **Core talents** the parser didn't read: True Flame (65% of Affliction's additional Damage
  Over Time bonus also applied to hits while the enemy is Ignited; "Fire Hit Damage" is
  approximated as hit damage) via a new `AfflictionToFireHitPct` mod in `src/tli/mod.ts` and
  `calculateAffliction` in `src/tli/calcs/offense.ts`; Survival Will's "+X% additional Attack
  Damage when not at Low Life" (assumes not at Low Life).

- **Aura and buff levels** (`src/data/skill/passive.ts`, `active.ts`): the data import left many
  level arrays flat, so every level got the level-1 (or level-20) value. These are rebuilt linearly
  from each skill's own level-1 and level-20 descriptions, continued at the same step to level 40:
  Deep Pain, Domain Expansion, Electric Conversion, Energy Fortress, Erosion Amplification,
  Nimbleness, Steadfast, Precise Projectiles, Spell Amplification and their Precise versions,
  Precise: Cruelty / Fearless / Swiftness, and Mana Boil. Frigid Domain and Precise: Frigid Domain
  had no level values at all, so they added nothing; they now have them. Curses stay as they were.
- **Current season (tlidb SS13) values**: Ice Bond's Euphoria is 5 points lower at every level
  (18.5% at level 1, 28.8% at level 22); Pain Amplification is 18.5% at level 1, +0.5 per level.
- **Hero trait levels** (`calculateHeroTraitMods` in `src/tli/calcs/offense.ts`): the rule TLI Builder
  confirmed in game, which is 1, +1 at memory level 30, +1 more at 50, plus "+N to Hero Trait
  Level", capped at 5. The level-1 trait stays at 1. The engine had 3 at memory level 40 and 2 at 20.
- **True Flame** applies to Fire damage only, not to all hits (TLI Builder, confirmed in game).
- **Frostbite** (`pushFrostbite` in `src/tli/calcs/offense.ts`): +1% additional Cold Damage taken
  per Frostbite Rating, as the game's Frostbite text says (the engine had 0.5%), and the rating
  can reach 120 (tlidb), not 100; past 100 the enemy is Frozen.
- **Pain Amplification** works: a support parser for "X% additional Damage Over Time against
  enemies with Max Affliction" (`src/tli/skills/support-mod-templates.ts`).
- **Escalating Affliction** (an Ethereal Prism core talent) is in `src/data/core-talent/core-talents.ts`
  under Psychic, with a parser line and a new `AfflictionPointRollPct` mod: each Affliction point is
  worth the average roll (0.1-3%, or the better of two rolls when damage is Lucky) instead of 1%,
  in `calculateAffliction` (`src/tli/calcs/offense.ts`). Its "90% of Max Damage bonuses also apply
  to Damage Over Time" line is not modelled.
- **More parser lines** (`src/tli/mod-parser/templates.ts`): Subtle Impact's "+X% additional Damage
  Over Time while Blur is active"; "+X% Frostbite Effect"; Dreamweaver's two Elemental Penetration
  stacks and Fire Swordsman's reap on inflicting an ailment plus its two Reaping Duration stacks,
  all at max stacks.
- **Fire Burst** has damage: level values from tlidb SS13 (607-1128 Fire spell damage, 0.8 s cast,
  161% effectiveness, flat from level 20, since tlidb has no table and active skills stop scaling at
  20) and a factory in `src/tli/skills/active-factories.ts`. `calcSpellHit` (`src/tli/calcs/offense.ts`)
  no longer has an allow-list of spells: any skill whose factory gives spell damage is computed.
- **Escapist Bing: Creative Genius (#2), SS13 values** (`src/tli/hero/hero-trait-mods.ts`, tlidb's
  Creative Genius page; traits have six levels there): the base trait's +5/10/15/20% additional Spell
  Damage at levels 2-5; Inspiration Overflow 10-35% and "per 2 stacks" (was 20-40%, per 3);
  Auto-Ingenuity Program and Hyper-Resonance Hypothesis extended to six levels; new factories for
  Mind Domain (+5% additional Spell Damage per Whimsy stack, multiplying, capped 3-8 by level; stacks
  from a new `whimsyStacks` setting) and Multi-Coupling Equation (+1 Max Spell Burst per 2 Empower or
  Defensive skills, capped 1-3 by level; counted from the enabled active skills unless the new
  `numEmpowerDefensiveSkills` setting says otherwise).
- **Whimsy Signal** is +20% additional Spell Damage taken (tlidb glossary, SS13), not 30%.
- **Secret Origin Unleash**'s Cast Speed per Focus Blessing is an increased bonus, not additional
  (tlidb: "+3 % Cast Speed for every stack of Focus Blessing").
- **Psychic Burst** (`src/data/skill/support.ts`): SS13 values, 26% at level 1 and +0.5 per level
  (36% at 21, 46% at 41); the engine had +1 per level to 21.
- **Grasp of Truth and SS13 wording** (`src/tli/mod-parser/templates.ts`): "+X% Elemental Resistance
  for enemies within 12m" (enemy resistance, behind a new `enemy_within_12m` condition and
  `targetEnemyWithin12m` setting); Penetrating's "+X% additional Elemental Damage for each type of
  Infiltration Effect the enemy has" (a new `num_infiltration_types` stackable, counted from the three
  Infiltration settings); "+X% Spell Elemental Damage"; Magister's "Gains 1 stack(s) of Focus
  Blessing when consuming Spell Burst or generating Tangle".

- **Fire Burst below level 20**: estimated from the level curve of the 23 flat-range spells whose
  tlidb cards have a level table (median share of their level-20 damage; 1.4% at level 1, 83.8% at
  19). It was level 20's damage at every level.
- **More parser lines**: "+X% damage while standing still" (new `standing_still` condition, on
  unless `isMoving`); "+X% additional Elemental Damage to enemies with Elemental Ailments" (new
  `enemy_has_elemental_ailment` condition: Ignited, Frostbitten, Frozen or Numbed).
- **Skills without a hand-written model** (`src/tli/skills/active-mods.ts`): a new
  `registerGeneratedActiveSkills` takes damage shapes the planner builds from tlidb's current skill
  cards (`server/engine/skill-shapes.js`: one spell hit or one weapon attack per cast, per-level
  values). `getActiveSkillMods` uses them when a skill has no factory; `resolvePerSkillMods`
  (`src/tli/calcs/offense.ts`) and `isSkillImplemented` count such skills as implemented. Hand-written
  factories always win. Skills newer than the engine's data are appended to `ActiveSkills` by the
  planner at start-up.

The engine's talent trees are an older season's. The planner (`server/engine/bridge.js`) compares
every allocated node with the log's current text for that node and, where they differ (Magister's
"+8% additional Hit Damage for skills cast by Spell Burst", which the engine still has as "+1 Max
Spell Burst"), passes the current text as a stat line instead of the engine's node.

Hero mechanics the engine lists but doesn't model (Berserker Rehan's Rage, Berserk and Seething
Spirit) are simulated outside it, in `server/sim/rehan.js` and `server/sim/attack.js`. Heroes newer
than the engine's data (Tide Whisper Selena: Dance of the Deep) are listed and simulated in
`server/sim/selena.js` and `server/sim/index.js`.

Changes made for CoffeeBingTest's Lightning Beam build (2026-10-13):

- **Law of Greed** (`src/tli/mod-parser/templates.ts`, `src/tli/mod.ts`, `src/tli/calcs/offense.ts`):
  "Seals X% Max Mana. Gains Insatiable Greed" becomes a new `InsatiableGreed` mod, and
  `calcSpellBurstChargeSpeedBonusPct` adds that share (150%) of the Attack Speed bonus to Spell Burst
  Charge Speed. Also parsed: "+X% damage per stack of Max Spell Burst, up to +Y%".
- **Ralph's Laws**: "+X% additional <type> Damage for every stack of Agility Blessing" and "Damage
  Penetrates X% Elemental Resistance for every stack of Agility Blessing".
- **Slates**: "Upon inflicting damage, penetrates X% of Elemental Resistance for each type of
  Elemental Ailment the enemy has" (a new `num_elemental_ailment_types` stackable).
- **Squidnova** (Squiddle): its Spell Burst bonus counts per stack, times the new `squidnovaStacks`
  setting (default 2, the player's "always at max stacks").
- **Numbed Effect from another skill**: a new `enemyNumbedEffectPct` setting replaces the main
  skill's own Numbed Effect when another skill (a triggered Thunder Spike) keeps the enemy Numbed.
- **Whimsy Signal's value**: a new `whimsySignalDmgPct` setting (default 20) replaces the +20%
  additional Spell Damage taken; Bing #2's Trouble Maker enhances it to 50-85% by trait level.
- **Ailment types on the enemy**: a new `num_ailment_types` stackable (the `numAilmentTypes`
  setting, else the elemental ailments the toggles put on) for Dirty Tricks' "+12% additional Hit
  Damage (multiplies) for every type of Ailment the enemy has" and Ailment Termination's "8.7%
  additional damage for every type of Ailment on enemy (multiplies)" (one factor per type: the
  per-stack `multiplicative` option).
- **Genius Idea Generator** (Bing #2 memory revival): "+X% Whimsy Signal Effect" parses, and "+1 to Max
  Spell Burst and +60% additional Spell Damage for Spells triggered by Ingenuity Overload" gives two new
  mods the Ingenuity Overload casts use (`IngenuityOverloadMaxSpellBurst`, `IngenuityOverloadDmgPct`).
- **Mark**: +10% additional Critical Strike Damage taken (tlidb SS14), was 20.
- **Max Frostbite Rating** with decimals (a prism's "+17.5 to Max Frostbite Rating").
- **Projectile Speed per Max Spell Burst** (Vorax neck, "+47% ... up to +200%") and **"0.14%
  additional Spell Damage for every 1% Life sealed"** (Nether King slate).
- **Skill levels past 40**: the level bonus stops at 40 (`Math.min(skillLevel, 40)`). Lightning Beam
  is level 43 in game and the in-combat Additional Damage panel fits the cap.

SS14 (Tartarus, 2026-10-15):

- **Signed hit-damage support lines** (`src/tli/skills/support-mod-templates.ts`): "+X% additional
  <type> Damage for the supported skill" (SS14 Control Spell, Splitting Lightning Bolt: Disintegration).
  The engine only had the unsigned form.
- Not in the vendored source but at start-up (`server/engine/ss14-supports.js`): supports the engine
  has get tlidb's SS14 per-level numbers when the card's scaling line is the same stat (Psychic Burst
  35.5% -> 30% at level 20, Spell Concentration 32% -> 30%, Control Spell 37.5% -> 32% and eight
  more); SS14's new supports (Turmoil Burst, Target Projection, Weakness Infiltration, Empowered
  Insight) are appended to `SupportSkills` as steady-state lines; Noble and Magnificent supports the
  engine lacks (Splitting Lightning Bolt's) are appended to their lists with no fixed lines, so their
  rolled line and rank bonus count.

SS14 Sage gear (2026-11-05, `src/tli/mod-parser/templates.ts`):

- **Magnus' Laws** per Tenacity Blessing stack: "+X% additional <type> Damage for every stack of
  Tenacity Blessing" and "Adds X - Y <type> Damage to Attacks and Spells per stack of Tenacity
  Blessing" (at the build's max stacks, like the Agility ones).
- **"+X% Max Life and Max Energy Shield"** (Necklace of Firebird) and **"+X% Max Life, Max Mana, and
  Max Energy Shield"** (Cicada Shell), which raise a Barrier Burst build's Barrier.
- **"Adds Elemental Damage equal to X% of Max Energy Shield to Attacks and Spells"** (Cicada Shell):
  that much Fire, Cold and Lightning each, per 100 Energy Shield. Whether the game splits it across
  the elements instead is unconfirmed.
- **Triggered skills and Spell Burst** (`src/tli/calcs/offense.ts`): an earlier planner change kept
  skills tagged Triggered (Barrier Burst) out of Spell Burst; the game's Damage panel for Barrier
  Burst shows Spell Burst rows (Max Spell Burst 4, 0.84 s charge, 508% bonus), so the gate is gone.
