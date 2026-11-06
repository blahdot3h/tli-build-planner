import type {
  CritDmgModType,
  CritRatingModType,
  DmgModType,
} from "./constants";
import type { DmgRange } from "./core";

export const DmgChunkTypes = [
  "physical",
  "cold",
  "lightning",
  "fire",
  "erosion",
] as const;

export type DmgChunkType = (typeof DmgChunkTypes)[number];

export const ResPenTypes = [
  "cold",
  "lightning",
  "fire",
  "erosion",
  "elemental",
  "all",
] as const;

export type ResPenType = (typeof ResPenTypes)[number];

export const ResTypes = [
  "cold",
  "lightning",
  "fire",
  "erosion",
  "elemental",
] as const;

export type ResType = (typeof ResTypes)[number];

export const InfiltrationTypes = ["cold", "lightning", "fire"] as const;

export type InfiltrationType = (typeof InfiltrationTypes)[number];

export const MinionDmgModTypes = [
  "physical",
  "cold",
  "lightning",
  "fire",
  "erosion",
  "elemental",
] as const;

export type MinionDmgModType = (typeof MinionDmgModTypes)[number];

export const SkillAreaModTypes = ["global", "curse"] as const;

export type SkillAreaModType = (typeof SkillAreaModTypes)[number];

export const AspdModTypes = ["melee"] as const;

export type AspdModType = (typeof AspdModTypes)[number];

export const DoubleDmgModTypes = ["attack", "spell"] as const;

export type DoubleDmgModType = (typeof DoubleDmgModTypes)[number];

export const SkillCostTypes = ["attack"] as const;

export type SkillCostType = (typeof SkillCostTypes)[number];

export const SkillLevelTypes = [
  "main",
  "support",
  "active",
  "passive",
  "attack",
  "persistent",
  "erosion",
  "spell",
  "lightning",
  "cold",
  "fire",
  "melee",
  "minion",
  "mobility",
  "physical",
  "projectile",
  "all",
  "spirit_magus",
] as const;

export type SkillLevelType = (typeof SkillLevelTypes)[number];

export const DmgTakenTypes = ["physical", "damage_over_time"] as const;

export type DmgTakenType = (typeof DmgTakenTypes)[number];

export const HeroTraitLevelTypes = [
  "origin",
  "discipline",
  "progress",
] as const;

export type HeroTraitLevelType = (typeof HeroTraitLevelTypes)[number];

export const SealedManaCompTypes = ["spirit_magus"] as const;

export type SealedManaCompSkillType = (typeof SealedManaCompTypes)[number];

export const Stackables = [
  "willpower",
  "main_stat",
  "stat",
  "highest_stat",
  "str",
  "dex",
  "int",
  "frostbite_rating",
  "projectile",
  "jump",
  "skill_use",
  "skill_charges_on_use",
  "cruelty_buff",
  "fervor",
  "movement_speed_bonus_pct",
  "max_mana",
  "mana_consumed_recently",
  "mercury_pt",
  "unsealed_mana_pct",
  "unsealed_life_pct",
  "sealed_mana_pct",
  "sealed_life_pct",
  "focus_blessing",
  "agility_blessing",
  "tenacity_blessing",
  "any_blessing",
  "desecration",
  "torment",
  "num_enemies_affected_by_warcry",
  "num_enemies_nearby",
  "enemy_numbed_stacks",
  "level",
  "max_spell_burst",
  "spell_burst_charge_speed_bonus_pct",
  "has_hit_enemy_with_elemental_dmg_recently",
  "num_spell_skills_used_recently",
  "num_unique_weapon_types_equipped",
  "num_max_multistrikes_recently",
  "proj_speed_pct",
  // max channel stacks beyond initial skill channel stacks
  "additional_max_channel_stack",
  "channel_stack",
  // skill-specific
  "mind_control_link",
  "unused_mind_control_link",
  "arcane_circle_stack",
  "berserking_blade_buff",
  // hero-specific
  "stalker",
  "twisted_spacetime",
  "dance_of_frost",
  // added by TLI Build Planner: Bing #2 Mind Domain's Whimsy, Multi-Coupling Equation's count
  "whimsy",
  "num_empower_defensive_skills",
  // added by TLI Build Planner: Penetrating ("for each type of Infiltration Effect the enemy has")
  "num_infiltration_types",
  // added by TLI Build Planner: "for each type of Elemental Ailment the enemy has"
  "num_elemental_ailment_types",
  // added by TLI Build Planner: "for every type of Ailment the enemy has" (Dirty Tricks, Ailment
  // Termination); the numAilmentTypes setting, else the elemental ailments the toggles put on
  "num_ailment_types",
  // added by TLI Build Planner: crowd control types on an Intimidated enemy (Wings of Light); the
  // numCrowdControlTypes setting, 0 when the enemy isn't Intimidated
  "num_crowd_control_types",
  "num_enemies_inside_realm_of_mercury",
  // pactspirit-specific
  "repentance",
  "pure_heart",
  "seconds_with_elite_nearby",
  "num_ice_puppet_stacks",
  "num_times_regained_recently",
  "pct_life_lost",
  "feline_stimulant",
  // defenses
  "armor",
  "evasion",
  "energy_shield",
  "total_block_pct",
  "block_ratio",
  "attack_block_pct",
  "num_main_spell_skills_cast_recently",
  "skill_area",
  "num_aura",
  "steep_strike_chance_pct",
  // Added by TLI Build Planner: Scent Weaver Sage. Elixir skills cast recently (Omni-Elixir Notes)
  // and Temporary Life as a % of base Max Life (Elixir of Immortality)
  "elixir_casts_recently",
  "temporary_life_pct",
  // Added by TLI Build Planner: hero resources the combat toggles set. Rehan's Rage, Carino #3's
  // Heat Up stacks, Carino #1's chance a shot uses Special Ammo (%), Gemma #1's seconds Purgatory
  // has been up, Rosa #1's Murderous Intent, Moto's Command, Iris #1's Nourishment stacks and
  // Thea #1's allocated Legendary Medium Talents
  "rage",
  "heat_up",
  "special_ammo_pct",
  "purgatory_seconds",
  "murderous_intent",
  "command",
  "nourishment",
  "legendary_medium_talents",
] as const;

export type Stackable = (typeof Stackables)[number];

export type StatType = "str" | "dex" | "int";

export type StatModType = "str" | "dex" | "int" | "all";

// mod value is multiplied by number of stackable divided by amt
// e.g. per 35 frostbite with 105 frostbite means x3
export interface PerStackable {
  stackable: Stackable;
  // number of max stacks
  limit?: number; // default infinity
  // max limit of mod's value
  valueLimit?: number; // default infinite
  // how much to divide the stackable number by
  amt?: number; // default 1
  // whether or not each stack causes the multiplier to compound
  // this only applies to percentage-based mods, like DmgPct
  // i.e. newvalue=(1+value)^(count)-1 instead of newvalue=value*count
  // example: if mod value is 10%, and there's 2 stacks, the final mod value should be 21%
  multiplicative?: boolean; // default false
}

export const Conditions = [
  "holding_shield",
  "is_dual_wielding",
  "has_one_handed_weapon",
  "enemy_frostbitten",
  "realm_of_mercury",
  "has_focus_blessing",
  "has_agility_blessing",
  "has_tenacity_blessing",
  "enemy_has_desecration",
  "enemy_has_trauma",
  "enemy_is_ignited", // added by TLI Build Planner
  "enemy_within_12m", // added by TLI Build Planner (Grasp of Truth)
  "standing_still", // added by TLI Build Planner
  "enemy_has_elemental_ailment", // added by TLI Build Planner (Mercurial Torment)
  "has_full_mana",
  "has_low_mana",
  "enemy_paralyzed",
  "target_enemy_is_elite",
  "target_enemy_is_nearby",
  "target_enemy_is_distant",
  "target_enemy_is_in_proximity",
  "has_blocked_recently",
  "has_elites_nearby",
  "enemy_has_ailment",
  "has_hasten",
  "has_crit_recently",
  "has_blur",
  "blur_ended_recently",
  "channeling",
  "sages_insight_fire",
  "sages_insight_cold",
  "sages_insight_lightning",
  "sages_insight_erosion",
  // Added by TLI Build Planner: an Elixir skill (Scent Weaver Sage) is up
  "elixir_active",
  // Oracle Thea #2: you (and the target) are inside / outside the Divine Realm
  "in_divine_realm",
  "outside_divine_realm",
  // Tide Whisper Selena #1: Loud Song form, or the Bard form
  "loud_song",
  "bard_song",
  "at_max_channeled_stacks",
  "enemy_at_max_affliction",
  "enemy_is_cursed",
  "equipped_in_left_ring_slot",
  "equipped_in_right_ring_slot",
  "enemy_has_desecration_and_cc",
  "enemy_has_cold_infiltration",
  "enemy_has_lightning_infiltration",
  "enemy_has_fire_infiltration",
  "target_enemy_frozen_recently",
  "enemy_frozen",
  "enemy_numbed",
  "has_fervor",
  "has_used_mobility_skill_recently",
  "has_moved_recently",
  "is_moving",
  "has_cast_curse_recently",
  "taking_damage_over_time",
  // pactspirits
  "has_portrait_of_a_fallen_saintess_pactspirit",
  "has_squidnova",
  "frostbitten_heart_is_active",
  "at_low_life",
] as const;

export type Condition = (typeof Conditions)[number];

// Conditions that depend on intermediate calculations in resolveModsForOffenseSkill,
// rather than static configuration values
export const ResolvedConditions = [
  "have_both_sealed_mana_and_life",
  "at_max_focus_blessing",
  "at_max_feline_stimulant_stacks",
] as const;

export type ResolvedCondition = (typeof ResolvedConditions)[number];

export type Comparator = "lt" | "lte" | "eq" | "gt" | "gte";

// e.g. "greater than 1 nearby enemy" would be {target: "num_enemies_nearby", comparator: "gt", value: 1}
//   and would be satisfied if configuration's `numEnemiesNearby` > 1
export interface ConditionThreshold {
  target: Stackable;
  comparator: Comparator;
  value: number;
}

// Common fields automatically added to all mod types
interface ModBase {
  per?: PerStackable;
  cond?: Condition;
  resolvedCond?: ResolvedCondition;
  condThreshold?: ConditionThreshold;
  src?: string;
}

// Unique fields for each mod type (excluding type, per, cond, src)
interface ModDefinitions {
  DmgPct: {
    value: number;
    dmgModType: DmgModType;
    addn: boolean;
    isEnemyDebuff?: boolean;
  };
  AddnMaxDmgPct: { value: number; addn: true; dmgType?: DmgChunkType };
  AddnMinDmgPct: { value: number; addn: true; dmgType?: DmgChunkType };
  ElementalSpellDmgPct: { value: number; addn: boolean };
  FlatDmgToAtks: { value: DmgRange; dmgType: DmgChunkType };
  FlatDmgToSpells: { value: DmgRange; dmgType: DmgChunkType };
  FlatCritRating: { value: number; modType: CritRatingModType };
  CritRatingPct: { value: number; modType: CritRatingModType };
  CritDmgPct: {
    value: number;
    addn: boolean;
    modType: CritDmgModType;
    isEnemyDebuff?: boolean;
  };
  AspdPct: { value: number; addn: boolean; aspdModType?: AspdModType };
  CspdPct: { value: number; addn: boolean };
  // minions
  MinionDmgPct: {
    value: number;
    addn?: boolean;
    minionDmgModType?: MinionDmgModType;
  };
  AddnMaxMinionDmgPct: { value: number };
  FlatDmgToMinions: { value: DmgRange; dmgType: DmgChunkType };
  MinionAspdPct: { value: number; addn: boolean };
  MinionCspdPct: { value: number; addn: boolean };
  MinionCritRatingPct: { value: number; addn?: boolean };
  MinionFlatCritRating: { value: number };
  MinionCritDmgPct: { value: number; addn?: boolean };
  MinionResPenPct: { value: number; penType: ResPenType };
  MinionArmorPenPct: { value: number };
  MinionMaxLifePct: { value: number };
  MinionSkillAreaPct: { value: number };
  MinionDoubleDmgChancePct: { value: number };
  // end minions
  ProjSpdPct: { value: number; addn?: boolean };
  ProjSizePct: { value: number };
  DoubleDmgChancePct: { value: number; doubleDmgModType?: DoubleDmgModType };
  Stat: { value: number; statModType: StatModType };
  StatPct: { value: number; statModType: StatModType };
  GainsFervor: object;
  HaveFervor: object;
  FixedFervorPts: { value: number };
  FervorEffPct: { value: number };
  FervorBaseEffSkillAreaPct: { value: number; perFervorAmt: number };
  FervorBaseEffDmgPct: { value: number; perFervorAmt: number };
  FrailEffPct: { value: number };
  SteepStrikeChancePct: { value: number };
  SteepStrikeDmgPct: { value: number; addn: boolean };
  SweepSlashDmgPct: { value: number; addn: boolean };
  AddnMainHandDmgPct: { value: number };
  GearAspdPct: { value: number };
  GearCritRatingPct: { value: number };
  FlatGearDmg: {
    value: DmgRange;
    modType:
      | "physical"
      | "cold"
      | "lightning"
      | "fire"
      | "erosion"
      | "elemental";
  };
  GearPhysDmgPct: { value: number };
  GearEleDmgPct: { value: number };
  // defenses
  AttackBlockChancePct: { value: number };
  SpellBlockChancePct: { value: number };
  BlockRatioPct: { value: number };
  BlockRatioPctOverride: { value: number };
  GearEnergyShield: { value: number };
  GearEnergyShieldPct: { value: number };
  MaxEnergyShieldPct: { value: number; addn: boolean };
  MaxEnergyShield: { value: number };
  EnergyShieldRegenPerSecPct: { value: number };
  GearArmor: { value: number };
  GearArmorPct: { value: number };
  Armor: { value: number };
  ArmorPct: { value: number; addn: boolean };
  GearEvasion: { value: number };
  GearEvasionPct: { value: number };
  Evasion: { value: number };
  EvasionPct: { value: number; addn: boolean };
  DefensePct: { value: number };
  ResistancePct: { value: number; resType: ResType };
  MaxResistancePct: { value: number; resType: ResType };
  LifeRegainPct: { value: number };
  EnergyShieldRegainPct: { value: number };
  EnergyShieldChargeSpeedPct: { value: number };
  RestoreLifePctPerSec: { value: number };
  DmgTakenPct: { value: number; addn?: boolean; dmgTakenType?: DmgTakenType };
  ConvertDmgTakenPct: { value: number; from: DmgChunkType; to: DmgChunkType };
  AvoidElementalAilmentsChancePct: { value: number };
  AvoidSpellDmgChancePct: { value: number };
  CriticalStrikeDmgMitigationPct: { value: number };
  // end defenses
  Reap: { duration: number; cooldown: number };
  ReapDurationPct: { value: number };
  ReapCdrPct: { value: number; addn?: boolean };
  AspdWhenMultistrikingPct: { value: number; addn: boolean };
  MultistrikeChancePct: { value: number };
  MultistrikeIncDmgPct: { value: number };
  // initial multistrike count, e.g. if there's 3 of this, first strike will
  // get bonuses as if it's the 4th hit instead of the 1st
  InitialMultistrikeCount: { value: number };
  ConvertDmgPct: { from: DmgChunkType; to: DmgChunkType; value: number };
  AddsDmgAsPct: { from: DmgChunkType; to: DmgChunkType; value: number };
  // added by TLI Build Planner (True Flame)
  AfflictionToFireHitPct: { value: number };
  // added by TLI Build Planner (Escalating Affliction): each Affliction point rolls min-max% instead of 1%
  AfflictionPointRollPct: { min: number; max: number };
  MaxWillpowerStacks: { value: number };
  ShadowQuant: { value: number };
  ShadowDmgPct: { value: number; addn: boolean };
  LuckyDmg: object;
  LuckyCrit: object;
  Jump: { value: number };
  BaseProjectileQuant: { value: number };
  Projectile: { value: number };
  MaxProjectile: { value: number; override?: boolean };
  MaxSpellBurst: { value: number };
  SpellBurstChargeSpeedPct: { value: number; addn?: boolean };
  SpellBurstAdditionalDmgPct: { value: number; addn: true };
  PlaySafe: { value: number };
  // added by TLI Build Planner: Law of Greed's Insatiable Greed, "150% of the bonuses to Attack
  // Speed is also applied to Spell Burst Charge Speed"
  InsatiableGreed: { value: number };
  CdrPct: { value: number };
  SkillAreaPct: {
    value: number;
    skillAreaModType: SkillAreaModType;
    addn?: boolean;
  };
  KnockbackDistancePct: { value: number; addn?: boolean };
  SkillEffDurationPct: { value: number };
  SkillEffPct: { value: number; addn?: boolean };
  AuraEffPct: {
    value: number;
    addn?: boolean;
    unscalable?: boolean;
    skillName?: string;
  };
  FocusBuffEffPct: { value: number; addn?: boolean };
  FocusSpeedPct: { value: number; addn?: boolean };
  SpiritMagusOriginEffPct: { value: number; addn?: boolean };
  CurseEffPct: { value: number; addn?: boolean };
  // Added by TLI Build Planner: Scent Weaver Sage's Elixir skills. Elixir Skill Effect scales the
  // buffs of skills tagged Elixir, on top of the general Skill Effect.
  ElixirEffPct: { value: number; addn?: boolean };
  ElixirEffDurationPct: { value: number; addn?: boolean };
  // "Elixir Skills gain N Charging Progress every second" (uptime only; no DPS effect here)
  ElixirChargingPerSec: { value: number };
  // Everlasting Nectar: value% of the Max Life or Max Mana bonus (the larger) also counts as
  // Elixir Skill Effect, up to valueLimit
  ElixirEffFromLifeManaPct: { value: number; valueLimit: number };
  // Pungent Stimulant Salt: value% of the Elixir skills' Skill Effect bonus also applies to the
  // Empower (up to empowerLimit) and Curse (up to curseLimit) skills it prepares
  ElixirEffShareToPrepared: {
    value: number;
    empowerLimit: number;
    curseLimit: number;
  };
  // Added by TLI Build Planner: hero trait pieces resolved against each other
  // (hero-trait-mods.ts resolveHeroTraitSynergies) or in the spell DPS (calcAvgSpellDps)
  // Commander Moto: Overload's additional Minion damage before Overload Effect, and that effect
  OverloadBaseDmgPct: { value: number };
  OverloadEffPct: { value: number; addn?: boolean };
  // Tide Whisper Selena #1: Tide Effect, and the additional damage lines it scales
  TideEffPct: { value: number; addn?: boolean };
  TideDmgPct: { value: number; isEnemyDebuff?: boolean };
  // Oracle Thea #1: God's Boon's bonuses (doubled by Prophecy of Purity)
  GodsBoonDmgPct: { value: number };
  GodsBoonDoubleDmgPct: { value: number };
  // Spacetime Witness Youga #1: Spacetime Illusions casting your main skill
  IllusionCount: { value: number };
  IllusionCastsPerSec: { value: number };
  IllusionFreqPct: { value: number };
  IllusionFreqPerCdrPct: { value: number };
  IllusionCastsAsYou: object;
  PlayerCannotCast: object;
  IllusionDmgPct: { value: number; addn: boolean };
  IllusionDmgFromCspdPct: { value: number; valueLimit: number };
  IllusionDmgPerFreqPct: { value: number };
  CurseDurationPct: { value: number };
  AddnCurse: { value: number };
  WarcryEffPct: { value: number; addn?: boolean };
  SealedManaCompPct: {
    value: number;
    addn?: boolean;
    skillName?: string;
    skillType?: SealedManaCompSkillType;
  };
  ResPenPct: { value: number; penType: ResPenType };
  ArmorPenPct: { value: number };
  ManaBeforeLifePct: { value: number };
  HasHasten: object;
  GeneratesHasten: object;
  MovementSpeedPct: { value: number; addn?: boolean };
  MobilitySkillCdrPct: { value: number; addn?: boolean };
  SpellDmgBonusAppliesToAtkDmg: object;
  MaxLife: { value: number };
  MaxLifePct: { value: number; addn: boolean };
  LifeRegenPerSecPct: { value: number };
  FlatLifeRegenPerSec: { value: number };
  LifeRegenSpeedPct: { value: number };
  MaxMana: { value: number };
  MaxManaPct: { value: number; addn: boolean };
  ManaRegenPerSecPct: { value: number };
  ManaRegenSpeedPct: { value: number };
  MercuryBaptismDmgPct: { value: number };
  MaxMercuryPtsPct: { value: number };
  MaxFocusBlessing: { value: number };
  MaxAgilityBlessing: { value: number };
  MaxTenacityBlessing: { value: number };
  FocusBlessingDurationPct: { value: number };
  AgilityBlessingDurationPct: { value: number };
  TenacityBlessingDurationPct: { value: number };
  GeneratesFocusBlessing: object;
  GeneratesAgilityBlessing: object;
  GeneratesTenacityBlessing: object;
  MaxFortitudeStack: { value: number };
  GeneratesFortitude: object;
  MaxChannel: { value: number };
  MinChannel: { value: number };
  TerraChargeRecoverySpeedPct: { value: number };
  MaxTerraChargeStack: { value: number };
  MaxTerraQuant: { value: number };
  MaxSentryQuant: { value: number };
  CommandPerSec: { value: number };
  GeneratesBarrier: object;
  BarrierShieldPct: { value: number; addn?: boolean };
  GeneratesHardened: object;
  GeneratesTorment: object;
  GeneratesDeflection: object;
  GeneratesBlur: { value: number };
  BlurEffPct: { value: number };
  MaxRepentance: { value: number };
  GeneratesRepentance: { value: number };
  SkillLevel: { value: number; skillLevelType: SkillLevelType };
  HeroTraitLevel: { value: number; heroTraitLevelType?: HeroTraitLevelType };
  GearBasePhysDmg: { value: number };
  GearBaseCritRating: { value: number };
  GearBaseAttackSpeed: { value: number };
  SkillCost: { value: number; skillCostType?: SkillCostType };
  SkillCostPct: { value: number; addn?: boolean };
  GeneratesAttackAggression: object;
  HasAttackAggression: object;
  AttackAggressionEffPct: { value: number };
  GeneratesSpellAggression: object;
  HasSpellAggression: object;
  SpellAggressionEffPct: { value: number };
  MainSkillSupportedBy: { skillName: string; level: number };
  CurrentSkillSupportedBy: { skillName: string; level: number };
  TriggersSkill: { skillName: string; level: number };
  EliminationPct: { value: number };
  SealConversion: object;
  OverrideSupportSkillManaMultPct: { value: number };
  XPEarnedPct: { value: number };
  // skill specific
  IsTangle: object;
  HasDormantEntanglement: object;
  MaxTangleQuant: { value: number };
  MaxTangleQuantPerEnemy: { value: number };
  // infiltrations
  InflictsInfiltration: { infiltrationType: InfiltrationType };
  InfiltrationEffPct: {
    value: number;
    infiltrationType: InfiltrationType;
    addn?: boolean;
  };
  // ailments
  AilmentDurationPct: { value: number };
  InflictWiltPct: { value: number; isEnemyDebuff?: boolean };
  WiltChancePct: { value: number };
  WiltDurationPct: { value: number };
  BaseWiltFlatDmg: { value: number };
  WiltDmgPct: { value: number; addn?: boolean };
  MaxFrostbiteRating: { value: number };
  MaxFrostbiteRatingLimitOverride: { value: number };
  FrostbiteEffPct: { value: number };
  InflictFrostbitePct: { value: number; isEnemyDebugg?: boolean };
  InflictParalysisPct: { value: number };
  FreezeDurationPct: { value: number };
  InflictFrail: object;
  InflictNumbed: object;
  NumbedEffPct: { value: number };
  NumbedChancePct: { value: number };
  InflictTrauma: object;
  BaseTraumaFlatDmg: { value: number };
  TraumaDmgPct: { value: number; addn?: boolean };
  TraumaDurationPct: { value: number };
  IgniteDurationPct: { value: number; addn?: boolean };
  IgniteDmgPct: { value: number; addn?: boolean };
  BaseIgniteFlatDmg: { value: number };
  Taunts: object;
  // non-ailment debuffs
  InflictsMark: object;
  MarkEffPct: { value: number };
  InflictsBlind: object;
  // skill-specific
  MindControlMaxLink: { value: number };
  InitialMaxChannel: { value: number };
  AfflictionInflictedPerSec: { value: number };
  AfflictionEffectPct: { value: number; addn?: boolean };
  CannotInflictWilt: object;
  ChainLightningWebOfLightning: object;
  ChainLightningMerge: { shotgunFalloffCoefficient: number };
  MaxBerserkingBladeStacks: { value: number };
  ComboFinisherAspdPct: { value: number; addn?: boolean };
  ComboStarter1AspdPct: { value: number; addn?: boolean };
  ComboStarter2AspdPct: { value: number; addn?: boolean };
  ComboFinisherAmplificationPct: { value: number; addn?: boolean };
  ComboFinisherCharge: { value: number };
  ComboPointGainedFromStarter: { value: number };
  SpectralSlashMaxClones: { value: number };
  DoubleBerserkingBladeUpperLimit: object;
  // enemy mods
  EnemyRes: { value: number; resType: ResType };
  // core talent specific
  ReapPurificationPct: { value: number };
  SpellRipple: { chancePct: number; pctOfHitDmg: number };
  JoinedForceDisableOffhand: object;
  JoinedForceAddOffhandToMainhandPct: { value: number };
  Conductive: { value: number };
  ChangeTenacityToAddnDmgPct: { value: number };
  TradeoffDexGteStrAspdPct: { value: number };
  TradeoffStrGteDexDmgPct: { value: number };
  // hero-specific mods
  Blasphemer: object;
  // bing2
  WhimsyEssenceRecoverySpeedPct: { value: number };
  WhimsySignalEffPct: { value: number };
  // added by TLI Build Planner: "+X% Whimsy Effect" (Genius Idea Generator): scales the Whimsy stacks' +5%
  WhimsyEffPct: { value: number };
  // added by TLI Build Planner: Genius Idea Generator (Bing #2 memory revival), "+1 to Max Spell Burst
  // and +60% additional Spell Damage for Spells triggered by Ingenuity Overload"
  IngenuityOverloadMaxSpellBurst: { value: number };
  IngenuityOverloadDmgPct: { value: number };
  RestoreWhimsyEssenceOnSpellBurst: { value: number };
  // erika1
  WindStalker: object;
  GeneratesStalker: object;
  MaxStalker: { value: number };
  // youga 2
  SpacetimeElapsePct: { value: number };
  SpacetimeRecordedDmgBonusPct: { value: number; perStack?: boolean };
  TwistedSpacetimeStacks: { value: number };
  // pactspirit stuff
  SquidnovaEffPct: { value: number };
  GeneratesSquidnova: object;
  MaxPureHeartStacks: { value: number };
  MaxFelineStimulantStacks: { value: number };
  // legendary gear
  DisableMainStatDmg: object;
  TrinityElePen: object;
  TrinitySingleElement: object;
  TrinityNoConversion: object;
  // immunities
  ImmuneToBlinding: object;
  ImmuneToElementalAilments: object;
  ImmuneToFrostbite: object;
  ImmuneToIgnite: object;
  ImmuneToNumbed: object;
  ImmuneToParalysis: object;
  ImmuneToSlow: object;
  ImmuneToTrauma: object;
  ImmuneToWeaken: object;
  ImmuneToWilt: object;
  ImmuneToCrowdControl: object;
  ImmuneToCurse: object;
}

// Generate the Mod union type from ModDefinitions
export type Mod = {
  [K in keyof ModDefinitions]: { type: K } & ModDefinitions[K] & ModBase;
}[keyof ModDefinitions];

export type ModT<T extends keyof ModDefinitions> = Extract<Mod, { type: T }>;
