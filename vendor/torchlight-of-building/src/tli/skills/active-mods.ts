import { clamp } from "remeda";
import { ActiveSkills } from "@/src/data/skill/active";
import type {
  ActiveSkillName,
  BaseActiveSkill,
  SkillOffense,
} from "@/src/data/skill/types";
import type { DmgChunkType, Mod } from "../mod";
import { activeSkillModFactories } from "./active-factories";

// Added by TLI Build Planner: skills without a hand-written factory get one built from tlidb's
// current skill card (server/engine/skill-shapes.js), registered once at start-up. A hand-written
// factory always wins.
export interface GeneratedActiveSkill {
  shape: "spell" | "attack";
  dmgType?: DmgChunkType;
  levels: Record<string, number[]>;
  intrinsic?: Mod[];
}
const generatedSkills = new Map<string, GeneratedActiveSkill>();
export const registerGeneratedActiveSkills = (
  table: Record<string, GeneratedActiveSkill>,
): void => {
  for (const [name, skill] of Object.entries(table)) {
    generatedSkills.set(name, skill);
  }
};
export const hasGeneratedActiveSkill = (name: string): boolean =>
  generatedSkills.has(name) &&
  activeSkillModFactories[name as ActiveSkillName] === undefined;
// Added by TLI Build Planner: buff-only skills (Scent Weaver Sage's Elixir skills) whose buff mods
// are built from tlidb's skill cards at start-up (server/engine/elixirs.js). The buff mods are
// scaled like any buff skill's (Elixir Skill Effect for skills tagged Elixir).
const generatedBuffSkills = new Map<string, (level: number) => Mod[]>();
export const registerGeneratedBuffSkills = (
  table: Record<string, (level: number) => Mod[]>,
): void => {
  for (const [name, factory] of Object.entries(table)) {
    generatedBuffSkills.set(name, factory);
  }
};
export const hasGeneratedBuffSkill = (name: string): boolean =>
  generatedBuffSkills.has(name) &&
  activeSkillModFactories[name as ActiveSkillName] === undefined;
const at = (values: number[] | undefined, level: number): number =>
  values?.[level - 1] ?? 0;
const generatedSkillMods = (
  skill: GeneratedActiveSkill,
  level: number,
): { offense?: SkillOffense; mods?: Mod[] } => {
  const { levels } = skill;
  const mods = skill.intrinsic ?? [];
  if (skill.shape === "spell") {
    return {
      offense: {
        addedDmgEffPct: { value: at(levels.addedDmgEffPct, level) },
        spellDmg: {
          value: {
            min: at(levels.spellDmgMin, level),
            max: at(levels.spellDmgMax, level),
          },
          dmgType: skill.dmgType ?? "physical",
          castTime: at(levels.castTime, level) || 1,
        },
      },
      mods,
    };
  }
  return {
    offense: {
      weaponAtkDmgPct: { value: at(levels.weaponAtkDmgPct, level) },
      addedDmgEffPct: { value: at(levels.addedDmgEffPct, level) },
    },
    mods,
  };
};

/**
 * Get all mods and offense stats for an active skill at a given level.
 */
export const getActiveSkillMods = (
  skillName: ActiveSkillName,
  level: number,
): { offense?: SkillOffense; mods?: Mod[]; buffMods?: Mod[] } => {
  const clampedLevel = clamp(level, { min: 1, max: 40 });
  const factory = activeSkillModFactories[skillName];
  if (factory === undefined) {
    const generated = generatedSkills.get(skillName);
    const buff = generatedBuffSkills.get(skillName);
    // Skill has no level-scaling mods
    return {
      ...(generated ? generatedSkillMods(generated, clampedLevel) : {}),
      ...(buff ? { buffMods: buff(clampedLevel) } : {}),
    };
  }

  // Get levelValues from generated skill data
  const skill = ActiveSkills.find((s) => s.name === skillName) as
    | BaseActiveSkill
    | undefined;
  if (skill === undefined) {
    console.error(`Active skill "${skillName}" not found`);
    return {};
  }

  const levelValues = skill.levelValues;
  if (levelValues === undefined) {
    return {};
  }

  return factory(clampedLevel, levelValues);
};
