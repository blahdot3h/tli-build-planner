import * as R from "remeda";
import type { HeroTraitName } from "@/src/data/hero-trait";
import type { DmgModType } from "../constants";
import type { Configuration } from "../core";
import type { Mod, ModT } from "../mod";

type ModFactory = (levelIndex: number) => Mod[];

// TLI Build Planner: shorthand for the hero traits added below
type DmgExtra = Omit<Partial<ModT<"DmgPct">>, "type" | "value" | "dmgModType" | "addn">;
const addn = (value: number, dmgModType: DmgModType = "global", extra: DmgExtra = {}): Mod => ({ type: "DmgPct", value, dmgModType, addn: true, ...extra });
const inc = (value: number, dmgModType: DmgModType = "global", extra: DmgExtra = {}): Mod => ({ type: "DmgPct", value, dmgModType, addn: false, ...extra });
const minionAddn = (value: number, extra: Omit<Partial<ModT<"MinionDmgPct">>, "type" | "value" | "addn"> = {}): Mod => ({ type: "MinionDmgPct", value, addn: true, ...extra });
const speedAddn = (value: number, extra: Omit<Partial<ModT<"CspdPct">>, "type" | "value" | "addn"> = {}): Mod[] => [
  { type: "AspdPct", value, addn: true, ...extra },
  { type: "CspdPct", value, addn: true, ...extra },
];

const heroTraitModFactories: Partial<Record<HeroTraitName, ModFactory>> = {
  // Frostfire Gemma: Frostbitten Heart (#2)
  "Frostbitten Heart": () => [
    { type: "InflictFrostbitePct", value: 100 },
    {
      type: "DmgPct",
      value: 20,
      addn: true,
      dmgModType: "cold",
      cond: "frostbitten_heart_is_active",
    },
  ],
  Deepfreeze: (i) => [
    {
      type: "MaxFrostbiteRatingLimitOverride",
      value: [150, 150, 200, 200, 200][i],
    },
    { type: "FrostbiteEffPct", value: [65, 90, 110, 130, 150][i] },
  ],
  // Frostfire Gemma: Blooming Frost Flower (#2)
  "Blooming Frost Flower": (i) => [
    { type: "MaxFrostbiteRating", value: [35, 45, 55, 65, 75][i] },
  ],
  "Dance of Frost": (i) => [
    {
      type: "DmgPct",
      value: [8, 10, 12, 15, 18][i],
      dmgModType: "cold",
      addn: true,
      isEnemyDebuff: true,
      per: { stackable: "dance_of_frost", limit: 4 },
    },
  ],
  // Cateye Erika: Wind Stalker (#1)
  // TLI Build Planner: tlidb's +26% Movement Speed, and +20% additional Attack Damage at level 5
  "Wind Stalker": (i) => [
    { type: "MovementSpeedPct", value: 26 },
    { type: "WindStalker" },
    { type: "GeneratesStalker" },
    ...(i >= 4 ? [addn(20, "attack")] : []),
  ],
  // "X% of the increase/decrease on Movement Speed is also applied to additional Attack Damage, up to +Y%"
  Interest: (i) => [addn([20, 24, 28, 32, 36][i] / 100, "attack", { per: { stackable: "movement_speed_bonus_pct", valueLimit: [30, 36, 42, 48, 54][i] } })],
  "Cat's Scratch": (i) => [{ type: "MultistrikeIncDmgPct", value: [27, 34, 41, 48, 55][i] }],
  "Have Fun": (i) => [
    { type: "MainSkillSupportedBy", skillName: "Multistrike", level: 10 },
    { type: "AspdPct", addn: true, value: [2, 6, 12, 18, 24][i] },
  ],
  "Cat's Vision": (i) => [
    {
      type: "MaxStalker",
      value: 1,
      per: { stackable: "num_max_multistrikes_recently", limit: 3 },
    },
    {
      type: "DmgPct",
      dmgModType: "global",
      addn: true,
      value: [-4, 2, 8, 14, 20][i],
    },
  ],
  "Cat's Punches": (i) => [
    { type: "GeneratesStalker" },
    {
      type: "InitialMultistrikeCount",
      value: 1,
      per: { stackable: "stalker", amt: 3 },
    },
    {
      type: "DmgPct",
      dmgModType: "global",
      addn: true,
      value: [-18, -12, -6, 0, 6][i],
    },
  ],
  // Escapist Bing: Creative Genius (#2)
  // TLI Build Planner: SS13 values from tlidb's Creative Genius page. Traits have six levels
  // there (the sixth through Artificial Moon's "+1 to Non-Base Hero Trait Level"). The base trait
  // adds +5/+10/+15/+20% additional Spell Damage at levels 2-5.
  "Creative Genius": (i) => [
    { type: "MaxSpellBurst", value: 1 },
    ...(i > 0
      ? [
          {
            type: "DmgPct" as const,
            value: [0, 5, 10, 15, 20][Math.min(i, 4)],
            dmgModType: "spell" as const,
            addn: true,
          },
        ]
      : []),
  ],
  // tlidb: "Instantly restores 5 Whimsy Essence when activating Spell Burst, and restores 6
  // additional Whimsy Essence for every 2 stacks of Spell Burst Charge consumed. Interval: 1s"
  "Inspiration Overflow": (i) => [
    { type: "RestoreWhimsyEssenceOnSpellBurst", value: 5 },
    {
      type: "RestoreWhimsyEssenceOnSpellBurst",
      value: 6,
      per: { stackable: "max_spell_burst", amt: 2 },
    },
    {
      type: "SpellBurstAdditionalDmgPct",
      value: [10, 15, 20, 25, 30, 35][i],
      addn: true,
    },
  ],
  // tlidb: "Gains 1 stack of Whimsy for every 0.5s staying in the energy field. Stacks up to
  // (3/4/5/6/7/8) time(s)"; Whimsy: "+5% additional Spell Damage (multiplies) for 10s". Stacks
  // come from config.whimsyStacks (the player standing in the field).
  "Mind Domain": (i) => [
    {
      type: "DmgPct",
      value: 5,
      dmgModType: "spell",
      addn: true,
      per: {
        stackable: "whimsy",
        limit: [3, 4, 5, 6, 7, 8][i],
        multiplicative: true,
      },
    },
  ],
  "Auto-Ingenuity Program": (i) => [
    {
      type: "WhimsyEssenceRecoverySpeedPct",
      value: [-10, -5, 0, 5, 10, 15][i],
    },
  ],
  "Hyper-Resonance Hypothesis": (i) => [
    {
      type: "SpellBurstChargeSpeedPct",
      addn: true,
      value: [15, 19, 23, 27, 31, 35][i],
    },
  ],
  // tlidb: "For every 2 Empower or Defensive Skill(s) affecting you, +1 Max Spell Burst. Stacks
  // up to (1/1/2/2/2/3) time(s)". Its +Empower/Defensive duration only matters for buff uptime.
  "Multi-Coupling Equation": (i) => [
    {
      type: "MaxSpellBurst",
      value: 1,
      per: {
        stackable: "num_empower_defensive_skills",
        amt: 2,
        limit: [1, 1, 2, 2, 2, 3][i],
      },
    },
  ],
  // Scent Weaver Sage: Licorice Note (#1). TLI Build Planner: values from tlidb's Licorice_Note
  // page (SS14; the engine's own trait text has older numbers). The Scent Bottle ingredients
  // aren't in the game log, so the planner passes the picked ones as stat lines
  // (server/sim/sage.js); the traits here carry what doesn't depend on them.
  // Level 5 adds Artificial Moon: "+12% additional Elixir Skill Effect for the Elixir Skills from
  // any Scent Bottle"
  "Licorice Note": (i) =>
    i >= 4 ? [{ type: "ElixirEffPct", value: 12, addn: true }] : [],
  // "(200/230/260/290/320)% of the Skill Effect Bonus applied to Elixir Skills of the Basic Scent
  // Bottle is also applied to its prepared Empower Skills, up to +(40/70/100/130/160)%" and to its
  // prepared Curse Skills "up to +(30/50/70/90/110)%". Every slotted Empower/Curse skill is taken
  // as prepared (buffs at full uptime).
  "Pungent Stimulant Salt": (i) => [
    {
      type: "ElixirEffShareToPrepared",
      value: [200, 230, 260, 290, 320][i],
      empowerLimit: [40, 70, 100, 130, 160][i],
      curseLimit: [30, 50, 70, 90, 110][i],
    },
  ],
  // "For every Temporary Life equal to 5% of Base Max Life ..., +(1/1.5/2/2.5/3)% additional
  // damage, up to +(5/10/15/20/25)%"; Temporary Life caps at (20/25/30/40/50)% of base Max Life.
  // config.temporaryLifePct sets how much is held (default: the cap)
  "Elixir of Immortality": (i) => [
    {
      type: "DmgPct",
      dmgModType: "global",
      addn: true,
      value: [1, 1.5, 2, 2.5, 3][i],
      per: {
        stackable: "temporary_life_pct",
        amt: 5,
        limit: [20, 25, 30, 40, 50][i] / 5,
        valueLimit: [5, 10, 15, 20, 25][i],
      },
    },
  ],
  // "+(18/21/24/27/30)% additional Elixir Skill Effect after casting Elixir Skill (6/6/5/4/3)
  // time(s). Lasts for 4 s" (taken as always up) and "-30% additional Elixir Skill Effect Duration"
  "Scent of Ambition": (i) => [
    { type: "ElixirEffPct", value: [18, 21, 24, 27, 30][i], addn: true },
    { type: "ElixirEffDurationPct", value: -30, addn: true },
  ],
  // "(100/120/140/160/180)% of the bonus applied to Max Life or Max Mana is also applied to Elixir
  // Skill Effect, up to +(30/40/50/60/70)%"
  "Everlasting Nectar": (i) => [
    {
      type: "ElixirEffFromLifeManaPct",
      value: [100, 120, 140, 160, 180][i],
      valueLimit: [30, 40, 50, 60, 70][i],
    },
  ],
  // The Special Scent Bottle (third skill slot); its one ingredient comes in as a planner line
  "Licorice Tincture Blend": () => [],
  // ---- TLI Build Planner: the heroes the engine listed without models, from tlidb's SS14 pages.
  // Where a trait needs something the formula has no notion of (reload downtime, bombs on the
  // ground, kills, a chance to lose a stack), the stat part is here and the planner lists the
  // rest as not counted (server/sim/heroNotes.js). Resources come from the combat toggles
  // (stackables rage, heat_up, special_ammo_pct, purgatory_seconds, murderous_intent, command,
  // nourishment, legendary_medium_talents) at full value by default: buffs always up.

  // Berserker Rehan: Anger (#1). Burst has no model: Tunnel Vision's -80% for everything else
  // counts, its Burst bonus can't.
  Anger: () => [addn(0.22, "global", { per: { stackable: "rage" } }), { type: "MovementSpeedPct", value: 0.1, per: { stackable: "rage" } }],
  "Frenzy Furious": (i) => [{ type: "CritRatingPct", modType: "global", value: [0.3, 0.5, 0.7, 0.9, 1.1][i], per: { stackable: "rage" } }],
  "Tunnel Vision": () => [addn(-80)],

  // Divineshot Carino: Ranger of Glory (#1). Projectile skills always spend ammo; Special Ammo on
  // the share of shots the toggle says (30% by default, the reload chance).
  "Ranger of Glory": (i) => [addn([35, 42, 49, 56, 63][i], "projectile")],
  "Ammo Expert": (i) => [addn([15, 23, 31, 39, 47][i], "global", { per: { stackable: "special_ammo_pct", amt: 100 } })],
  "Well Prepared": (i) => [addn([15, 20, 25, 30, 35][i], "global", { per: { stackable: "special_ammo_pct", amt: 100 } })],
  // Divineshot Carino: Lethal Flash (#2). Evil Ouroboros: the returning projectile hits the target
  // again, so two hits at (100 - X)%: +20..40% in all.
  "Lethal Flash": (i) => [
    addn([50, 57, 65, 73, 82][i]),
    { type: "Projectile", value: 2 },
    ...(i >= 4 ? [{ type: "MainSkillSupportedBy", skillName: "Multiple Projectiles", level: 1 } as Mod] : []),
  ],
  "Evil Ouroboros": (i) => [addn([20, 25, 30, 35, 40][i], "projectile")],
  "Impending Doom": (i) => [addn([46, 53, 60, 69, 77][i], "projectile"), { type: "GeneratesFortitude" }],
  "Shadow Magazine": (i) => [addn([5, 10, 16, 21, 27][i])],
  "Weightless Step": (i) => [addn([28, 34, 40, 47, 55][i], "projectile"), { type: "Jump", value: 1 }],
  "Born in the Breeze": (i) => [addn([32, 38, 44, 50, 56][i], "projectile"), { type: "GeneratesDeflection" }],
  // Divineshot Carino: Zealot of War (#3). Heat Up stacks from the toggle (6, a magazine).
  "Zealot of War": (i) => [addn([20, 26, 32, 38, 38][i]), { type: "Projectile", value: 2 }],
  "Incinerated Glory": (i) => [addn([1.6, 2, 2.3, 2.6, 3][i], "projectile", { per: { stackable: "heat_up" } })],
  Ceasefire: (i) => (i >= 4 ? [addn(21)] : []),
  "Extreme Heat": (i) => (i >= 4 ? [addn(16)] : []),
  "Eternal Flames": (i) => [...speedAddn(0.4, { per: { stackable: "heat_up" } }), ...(i >= 4 ? [addn(21)] : [])],

  // Cateye Erika: Lightning Shadow (#2). Feline Figure keeps the enemy Numbed; the "additional
  // Numbed Effect" lines go in as Numbed Effect (the engine has one kind).
  "Lightning Shadow": (i) => [{ type: "InflictNumbed" }, { type: "NumbedEffPct", value: [18, 30, 43, 55, 68][i] }],
  "Electroplated Motif": (i) => [{ type: "NumbedEffPct", value: [20, 25, 30, 35, 40][i] }],
  "Wild Lightning": (i) => [{ type: "NumbedEffPct", value: 0.4, per: { stackable: "movement_speed_bonus_pct", valueLimit: [80, 90, 100, 110, 120][i] } }],
  "Swift as Lightning": (i) => [
    addn([1, 1.5, 2, 2.5, 3][i], "global", { per: { stackable: "enemy_numbed_stacks", amt: 4, limit: 10 } }),
    { type: "MovementSpeedPct", value: 2, per: { stackable: "enemy_numbed_stacks", amt: 4, limit: 10 } },
  ],
  "Charging Equation": (i) => [{ type: "NumbedEffPct", value: [3, 3.5, 4, 4.5, 5][i], per: { stackable: "enemy_numbed_stacks", limit: 10 } }],
  // Cateye Erika: Vendetta's Sting (#3). The main melee attack is taken as triggered by Vendetta.
  "Vendetta's Sting": (i) => [addn([5, 10, 15, 20, 25][i] + (i >= 4 ? 10 : 0), "attack")],
  "Twinblade Onslaught": (i) => [addn([10, 15, 20, 25, 30][i], "attack", { cond: "is_dual_wielding" })],
  "Swift Stalk": (i) => [addn([30, 45, 60, 75, 90][i], "global", { cond: "target_enemy_is_elite" })],
  "Feline Fury": () => [{ type: "FlatCritRating", modType: "attack", value: 150, cond: "is_dual_wielding" }],

  // Escapist Bing: Blast Nova (#1). The bombs are the main skill's projectiles; stack bonuses at
  // their caps (bombs thrown recently, bombs on the field).
  "Blast Nova": (i) => [{ type: "Projectile", value: 2 }, ...(i >= 4 ? [addn(20)] : [])],
  "Firepower Coverage": (i) => [{ type: "AspdPct", value: [-40, -37, -34, -31, -27][i], addn: true, cond: "is_moving" }, { type: "MovementSpeedPct", value: -30 }],
  "Dangerous Runaway": (i) => [addn([15, 18, 21, 24, 27][i])],
  "Phantom Delivery": (i) => [addn([40, 45, 50, 55, 60][i])],
  "Radiation Effect": (i) => [{ type: "AspdPct", value: [20, 25, 30, 35, 40][i], addn: true }],
  "Frenzy Hound": (i) => [addn([35, 40, 45, 50, 55][i])],

  // Frostfire Gemma: Flame of Pleasure (#1). The target stands in Purgatory.
  "Flame of Pleasure": (i) => [addn([45, 52, 60, 68, 76][i], "global", { isEnemyDebuff: true })],
  "Infernal Damnation": (i) => [
    addn([6, 7, 8, 9, 10][i], "global", { per: { stackable: "purgatory_seconds" } }),
    minionAddn([6, 7, 8, 9, 10][i], { per: { stackable: "purgatory_seconds" } }),
  ],
  "Banquet of Bliss": (i) => [{ type: "TriggersSkill", skillName: "Scorch", level: [10, 15, 20, 30, 40][i] }],
  "Dress Licker": (i) => [addn([30, 35, 40, 45, 50][i], "global", { isEnemyDebuff: true }), addn(30, "fire")],
  // Frostfire Gemma: Frostbitten Heart (#2), the two the engine lacked
  "Frigid Infusion": (i) => [{ type: "EnemyRes", resType: "cold", value: [-20, -25, -35, -40, -45][i] }],
  // Frostfire Gemma: Ice-Fire Fusion (#3). Frostfire Rampage taken as up.
  "Ice-Fire Fusion": (i) => [addn([20, 23, 26, 30, 33][i], "fire"), addn([20, 23, 26, 30, 33][i], "cold")],
  "Ice-Fire Embrace": (i) => [
    addn([10, 13, 16, 19, 22][i], "cold"),
    addn([10, 13, 16, 19, 22][i], "fire"),
    { type: "ResistancePct", resType: "fire", value: 10 },
    { type: "ResistancePct", resType: "cold", value: 10 },
  ],
  "Restless Ice-Fire": (i) => [{ type: "ResPenPct", penType: "elemental", value: [12, 15, 18, 21, 24][i] }, { type: "MovementSpeedPct", value: 20 }],
  "Bone-piercing Heat": (i) => [{ type: "AddsDmgAsPct", from: "cold", to: "fire", value: [30, 36, 42, 48, 54][i] }],
  "Ice to Blaze": () => [{ type: "ConvertDmgPct", from: "cold", to: "fire", value: 99 }],

  // Oracle Thea: Wisdom of The Gods (#1), tlidb's SS14 tree. God's Boon consumes 5 Focus
  // Blessings (resolveHeroTraitSynergies doubles its bonuses with Prophecy of Purity).
  "Wisdom of The Gods": (i) => [{ type: "GodsBoonDmgPct", value: [20, 28, 36, 44, 52][i] }],
  "Prophecy of Truth": (i) => [addn(3, "global", { per: { stackable: "legendary_medium_talents", valueLimit: [8, 11, 14, 17, 20][i] } })],
  "Prophecy of Revelation": (i) => (i >= 4 ? [inc(24)] : []),
  "Prophecy of Punishment": (i) => [{ type: "LuckyDmg" }, { type: "AddnMaxDmgPct", addn: true, value: [1, 1.8, 2.7, 3.8, 5][i], per: { stackable: "agility_blessing" } }],
  "Predicted Reincarnation": (i) => [{ type: "GodsBoonDmgPct", value: 5 * [5, 6.5, 8, 9.5, 11][i] }],
  "Farewell Prophecy": (i) => [{ type: "GodsBoonDoubleDmgPct", value: 5 * [4, 5, 6, 7, 8][i] }],
  "Prophecy of Purity": (i) => [{ type: "SkillEffDurationPct", value: [-15, -5, 5, 15, 25][i] }],
  // Oracle Thea: Incarnation of the Gods (#2). "in_divine_realm" (the toggle) says where you stand.
  "Incarnation of the Gods": (i) => [
    addn([3, 3.8, 4.5, 5.3, 6][i], "global", { per: { stackable: "any_blessing", limit: 8 } }),
    ...(i >= 4 ? [addn(1, "global", { per: { stackable: "any_blessing", limit: 15 } })] : []),
  ],
  "Tenacious Divinity": (i) => [addn([20, 26, 32, 35, 38][i])],
  "Agile Godhood": (i) => speedAddn([18, 24, 28, 31, 34][i]),
  "Might Flow": (i) => [
    ...speedAddn(0.75, { per: { stackable: "any_blessing", valueLimit: 15 }, cond: "outside_divine_realm" }),
    addn([0.5, 0.8, 1.1, 1.4, 1.7][i], "global", { per: { stackable: "any_blessing", valueLimit: [10, 16, 22, 28, 34][i] }, cond: "outside_divine_realm" }),
  ],
  "Divine Realm Power": (i) => [
    addn([20, 26, 32, 38, 45][i], "global", { cond: "in_divine_realm" }),
    { type: "AspdPct", value: [29, 40, 52, 58, 65][i], addn: false, cond: "outside_divine_realm" },
    { type: "CspdPct", value: [29, 40, 52, 58, 65][i], addn: false, cond: "outside_divine_realm" },
  ],
  Incarnation: (i) => [addn([13, 15, 17, 20, 25][i], "global", { cond: "in_divine_realm" })],
  "Divine Spirit": (i) => [inc([1.8, 1.9, 2, 2.15, 2.3][i], "global", { per: { stackable: "pct_life_lost", amt: 3 }, cond: "outside_divine_realm" })],

  // Spacetime Witness Youga: Spacetime Illusion (#1): the illusions' casts join yours in
  // calcAvgSpellDps
  "Spacetime Illusion": (i) => [
    { type: "IllusionCount", value: 1 },
    { type: "IllusionCastsPerSec", value: 1 / 1.5 },
    ...(i > 0 ? [addn([0, 5, 10, 15, 20][i], "spell")] : []),
  ],
  "Me and Myself": (i) => [{ type: "IllusionFreqPct", value: 60 }, { type: "IllusionFreqPerCdrPct", value: [5, 7, 9, 11, 13][i] }],
  "Make it Quick": (i) => [{ type: "IllusionDmgFromCspdPct", value: [50, 55, 60, 65, 70][i], valueLimit: 300 }],
  "Eeeendless Mana": (i) => [{ type: "IllusionCastsAsYou" }, { type: "IllusionDmgPerFreqPct", value: [1, 1.15, 1.3, 1.45, 1.6][i] }],
  "I'm an Illusion": (i) => [
    { type: "PlayerCannotCast" },
    { type: "IllusionCount", value: 1 },
    { type: "IllusionDmgPct", value: [-5, -1, 3, 7, 11][i], addn: true },
    { type: "MovementSpeedPct", value: -30 },
  ],
  "I'm Out of Mana": (i) => [addn(10 * [5, 6.3, 7.5, 8.8, 10][i])],
  // Spacetime Witness Youga: The Ultimate One (#3): only the plain stat lines
  "I Arrive Alongside Destiny": (i) => (i > 0 ? [{ type: "CdrPct", value: [0, 7, 14, 21, 28][i] }] : []),
  "I Meet the Selves": (i) => (i > 0 ? [{ type: "SkillEffDurationPct", value: [0, 7, 14, 21, 28][i] }] : []),

  // Commander Moto: Order Calling (#1). Overload is always up on the minions; its effect bonuses
  // multiply its +60% (resolveHeroTraitSynergies), Charge Forward's from the Command toggle.
  "Order Calling": (i) => [{ type: "OverloadBaseDmgPct", value: 60 }, ...(i >= 4 ? [minionAddn(22)] : [])],
  Veteran: () => [{ type: "MinionAspdPct", value: 20, addn: false }, { type: "MinionCspdPct", value: 20, addn: false }],
  "All In": (i) => [{ type: "OverloadEffPct", value: [80, 90, 100, 120, 140][i] }],
  "Self-Reconstruct": (i) => [minionAddn([25, 32, 40, 50, 60][i])],
  "Overload Program": (i) => [{ type: "OverloadEffPct", value: [10, 15, 20, 25, 30][i] }],
  "Charge Forward": (i) => [{ type: "OverloadEffPct", value: [9, 11, 13, 15, 18][i], per: { stackable: "command", amt: 5, valueLimit: [90, 110, 130, 150, 180][i] } }],
  "Radiation Field": (i) => [
    ...speedAddn(10),
    { type: "MinionAspdPct", value: 10, addn: true },
    { type: "MinionCspdPct", value: 10, addn: true },
    addn([3, 4, 6, 7, 8][i], "global", { per: { stackable: "num_aura" } }),
    minionAddn([3, 4, 6, 7, 8][i], { per: { stackable: "num_aura" } }),
  ],
  // Commander Moto: Charge Calling (#2). The Self-Destruct is the minions' damage; part stacks at cap.
  "Charge Calling": (i) => [minionAddn([20, 26, 32, 38, 44][i]), ...(i >= 4 ? [minionAddn(12)] : [])],
  "Unstoppable Wave": (i) => [minionAddn(10 * [3, 3.5, 4, 4.5, 5][i])],
  "Guerilla Tactics": (i) => [minionAddn(3 * [10, 12, 15, 18, 20][i])],

  // Lightbringer Rosa: High Court Chariot (#1). You fight inside the Holy Domain.
  "High Court Chariot": (i) => [{ type: "AttackBlockChancePct", value: 30 }, { type: "SpellBlockChancePct", value: 30 }, addn([20, 26, 32, 38, 44][i])],
  "Unbreakable Stand": (i) => [addn([6, 7, 8, 9, 10][i], "global", { per: { stackable: "num_enemies_nearby", valueLimit: [50, 60, 70, 80, 90][i] } })],
  Invulnerability: (i) => [{ type: "BlockRatioPct", value: [7, 9, 11, 13, 15][i] }],
  "Divine Intervention": (i) => [addn([0.3, 0.37, 0.44, 0.51, 0.58][i], "global", { per: { stackable: "murderous_intent" } })],
  Improvision: (i) => [addn([40, 50, 60, 70, 80][i], "global", { cond: "has_blocked_recently" })],

  // The Forsaken Iris: Growing Breeze (#1) and Vigilant Breeze (#2): the Spirit Magi's damage
  "Growing Breeze": (i) => [minionAddn(30, { per: { stackable: "nourishment", limit: 10 } }), ...(i >= 4 ? [minionAddn(20)] : [])],
  "Vigilant Breeze": (i) => (i >= 4 ? [minionAddn(20)] : []),
  "Whirlwind Tango": () => [minionAddn(-60)],
  "Happiest Reunion": (i) => [minionAddn(3 * [1, 2, 3, 4, 5][i])],

  // Tide Whisper Selena: Sing with the Tide (#1). The target stands on a Tide; Tide Effect scales
  // the Tide's damage lines (resolveHeroTraitSynergies); the "loud_song" toggle picks the form.
  "Sing with the Tide": (i) => [
    { type: "TideDmgPct", value: 15 },
    ...(i >= 4 ? [{ type: "TideDmgPct", value: 20, isEnemyDebuff: true } as Mod] : []),
    { type: "AspdPct", value: -20, addn: true, cond: "loud_song" },
    { type: "CspdPct", value: -20, addn: true, cond: "loud_song" },
    { type: "MovementSpeedPct", value: -20, addn: true, cond: "loud_song" },
    { type: "TideEffPct", value: 80, addn: true, cond: "loud_song" },
  ],
  "Undersea Ballad": (i) => [{ type: "TideEffPct", value: 1, per: { stackable: "skill_area", valueLimit: [90, 100, 110, 120, 130][i] } }],
  "Wave Aria": (i) => [{ type: "TideDmgPct", value: [10, 13, 16, 19, 22][i] }],
  "Sea Foam Nocturne": (i) => [{ type: "TideEffPct", value: [16, 18, 20, 22, 24][i], addn: true, per: { stackable: "additional_max_channel_stack", limit: 5 } }],
  "Idyll of the Tide": (i) => [addn(15 * [1, 1.3, 1.6, 1.9, 2.2][i])],
  "Chantey of Sinking": (i) => [{ type: "TideEffPct", value: 2 * [35, 45, 55, 65, 75][i], cond: "loud_song" }],
  "Murmurs of the Distant Tide": (i) => [{ type: "TideEffPct", value: [60, 70, 80, 90, 100][i], addn: true, cond: "bard_song" }],

  // Oracle Thea: Blasphemer (#3)
  Blasphemer: () => [{ type: "Blasphemer" }],
  // TLI Build Planner: the resistances; Desecration only affecting Elites changes nothing here
  "Disgraced Minister": (i) => [
    { type: "ResistancePct", resType: "erosion", value: [10, 15, 20, 25, 30][i] },
    { type: "MaxResistancePct", resType: "erosion", value: [3, 4, 4, 5, 5][i] },
  ],
  "Unholy Baptism": (i) => [
    {
      type: "DmgPct",
      addn: true,
      value: [5, 10, 15, 20, 25][i],
      dmgModType: "erosion",
    },
  ],
  "Onset of Depravity": () => [
    {
      type: "EnemyRes",
      resType: "erosion",
      value: -10,
      cond: "enemy_has_desecration_and_cc",
    },
  ],
  // todo: too lazy to add conditional on hitting desecrated target for now
  "Tarnished Sage": (i) => [
    { type: "AspdPct", addn: false, value: [10, 15, 20, 25, 30][i] },
    { type: "CspdPct", addn: false, value: [10, 15, 20, 25, 30][i] },
    { type: "MovementSpeedPct", addn: false, value: [10, 15, 20, 25, 30][i] },
  ],
  // Rosa 2
  "Unsullied Blade": () => [{ type: "SpellDmgBonusAppliesToAtkDmg" }],
  "Born to Cleanse": (i) => [
    {
      type: "DmgPct",
      value: 0.4 * 25,
      dmgModType: "elemental",
      addn: true,
      cond: "realm_of_mercury",
    },
    {
      type: "AddnMainHandDmgPct",
      value: [20, 27, 34, 41, 48][i],
      cond: "realm_of_mercury",
    },
  ],
  "Boundless Sanctuary": (i) => [
    {
      type: "DmgPct",
      value: [6, 7, 8, 9, 10][i],
      dmgModType: "elemental",
      addn: true,
      per: {
        stackable: "num_enemies_inside_realm_of_mercury",
        valueLimit: [60, 70, 80, 90, 100][i],
      },
    },
  ],
  "Baptism of Purity": (i) => [
    { type: "MaxManaPct", value: 20, addn: true },
    { type: "InflictsInfiltration", infiltrationType: "cold" },
    { type: "InflictsInfiltration", infiltrationType: "lightning" },
    { type: "InflictsInfiltration", infiltrationType: "fire" },
    { type: "MercuryBaptismDmgPct", value: [12, 20, 28, 36, 44][i] },
  ],
  "Cleanse Filth": (i) => [
    {
      type: "DmgPct",
      value: [2, 2.5, 3, 3.5, 4][i],
      dmgModType: "elemental",
      addn: true,
      per: {
        stackable: "max_mana",
        valueLimit: [40, 50, 60, 70, 80][i],
        amt: 1000,
      },
    },
    { type: "ManaBeforeLifePct", value: 25, cond: "realm_of_mercury" },
  ],
  "Utmost Devotion": (i) => [
    {
      type: "MaxMercuryPtsPct",
      value: 10,
      per: {
        stackable: "max_mana",
        valueLimit: [200, 250, 300, 350, 400][i],
        amt: 1000,
      },
    },
    {
      type: "DmgPct",
      value: [0.08, 0.08, 0.1, 0.1, 0.1][i],
      dmgModType: "elemental",
      addn: true,
      per: { stackable: "mercury_pt" },
    },
  ],
  "Spacetime Elapse": () => [{ type: "SpacetimeElapsePct", value: 30 }],
  "Spacetime Speed-up": (i) => [
    {
      type: "SpacetimeRecordedDmgBonusPct",
      value: [5, 6.5, 8, 9.5, 11][i],
      per: { stackable: "twisted_spacetime", limit: 5 },
      addn: true,
    },
  ],
  "Spacetime Upheaval": (i) => [
    {
      type: "DmgPct",
      dmgModType: "damage_over_time",
      addn: true,
      value: [30, 37, 44, 51, 58][i],
    },
  ],
  "Spacetime Cutting": (i) => [
    { type: "GeneratesTorment" },
    { type: "DmgTakenPct", addn: true, value: [-10, -14, -18, -21, -24][i] },
  ],
  "Spacetime Pause": (i) => [
    {
      type: "SpacetimeRecordedDmgBonusPct",
      value: [60, 70, 80, 90, 100][i],
      addn: true,
    },
  ],
  "Spacetime Expansion": () => [],
};

// TLI Build Planner: traits that scale each other, once every picked trait is known. Moto's
// Overload Effect bonuses multiply Overload's +60% (Charge Forward's from the Command toggle);
// Thea #1's Prophecy of Purity doubles God's Boon; Selena #1's Tide Effect scales the Tide's
// damage lines (its Skill Area share is taken at its cap, its channel stacks at their limit).
// The form toggles are read from the configuration, as this runs before the engine's own filters.
export const resolveHeroTraitSynergies = (
  mods: Mod[],
  names: readonly string[],
  config: Partial<Configuration> = {},
): Mod[] => {
  const command = config.command ?? 25;
  const overloadEff = R.sumBy(
    mods.filter((m): m is ModT<"OverloadEffPct"> => m.type === "OverloadEffPct"),
    (m) =>
      m.per?.stackable === "command"
        ? Math.min(m.per.valueLimit ?? Infinity, m.value * Math.floor(command / (m.per.amt ?? 1)))
        : m.value,
  );
  const purity = names.includes("Prophecy of Purity") ? 2 : 1;
  const loud = config.loudSong ?? false;
  const tideUp = (m: Mod): boolean =>
    m.cond === undefined || (m.cond === "loud_song" ? loud : m.cond === "bard_song" ? !loud : true);
  const tideValue = (m: ModT<"TideEffPct">): number => {
    if (m.per?.stackable === "skill_area") return m.per.valueLimit ?? m.value;
    if (m.per !== undefined) return m.value * (m.per.limit ?? 1);
    return m.value;
  };
  const tide = mods.filter((m): m is ModT<"TideEffPct"> => m.type === "TideEffPct").filter(tideUp);
  const tideMult =
    (1 + R.sumBy(tide.filter((m) => m.addn !== true), tideValue) / 100) *
    tide.filter((m) => m.addn === true).reduce((p, m) => p * (1 + tideValue(m) / 100), 1);

  const out: Mod[] = [];
  for (const m of mods) {
    switch (m.type) {
      case "OverloadBaseDmgPct":
        out.push({ type: "MinionDmgPct", value: m.value * (1 + overloadEff / 100), addn: true, src: m.src });
        break;
      case "OverloadEffPct":
      case "TideEffPct":
        break;
      case "GodsBoonDmgPct":
        out.push({ type: "DmgPct", dmgModType: "global", addn: true, value: m.value * purity, src: m.src });
        break;
      case "GodsBoonDoubleDmgPct":
        out.push({ type: "DoubleDmgChancePct", value: m.value * purity, src: m.src });
        break;
      case "TideDmgPct":
        out.push({ type: "DmgPct", dmgModType: "global", addn: true, value: m.value * tideMult, isEnemyDebuff: m.isEnemyDebuff, src: m.src });
        break;
      default:
        out.push(m);
    }
  }
  return out;
};

export const getHeroTraitMods = (name: HeroTraitName, level: number): Mod[] => {
  const mods = heroTraitModFactories[name]?.(level - 1) ?? [];
  return mods.map((mod) => ({ ...mod, src: `HeroTrait: ${name} Lv.${level}` }));
};

/**
 * Check if a hero trait has a factory implementation.
 */
export const isHeroTraitImplemented = (name: HeroTraitName): boolean => {
  return heroTraitModFactories[name] !== undefined;
};
