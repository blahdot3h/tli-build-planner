import {
  ActivationMediumSkills,
  MagnificentSupportSkills,
  NobleSupportSkills,
  SupportSkills,
} from "@/src/data/skill";
import type {
  BaseActiveSkill,
  BaseSkill,
  BaseSupportSkill,
  InferredSkillKind,
  SupportTarget,
} from "@/src/data/skill/types";

type TargetSkill = BaseActiveSkill | BaseSkill;

const matchesTarget = (skill: TargetSkill, target: SupportTarget): boolean => {
  if (target === "any") return true;

  // Matches Spell skills excluding Summon, Channeled, Sentry
  if (target === "spell_burst") {
    const tags = skill.tags;
    return (
      tags.includes("Spell") &&
      !tags.includes("Summon") &&
      !tags.includes("Channeled") &&
      !tags.includes("Sentry")
    );
  }

  // InferredSkillKind string - only active skills have kinds
  if (typeof target === "string") {
    if (skill.type !== "Active") return false;
    return (skill as BaseActiveSkill).kinds.includes(
      target as InferredSkillKind,
    );
  }

  // { skillType: "active" | "passive" } optionally with requiredKind
  if ("skillType" in target) {
    const typeMatches =
      (target.skillType === "active" && skill.type === "Active") ||
      (target.skillType === "passive" && skill.type === "Passive");

    if (!typeMatches) return false;

    // Check requiredKind if present
    if ("requiredKind" in target) {
      if (skill.type !== "Active") return false;
      return (skill as BaseActiveSkill).kinds.includes(target.requiredKind);
    }
    return true;
  }

  // { tags: SkillTag[] } optionally with requiredKind - must have ALL specified tags
  if ("tags" in target) {
    const tagsMatch = target.tags.every((tag) => skill.tags.includes(tag));
    if (!tagsMatch) return false;

    // Check requiredKind if present
    if ("requiredKind" in target) {
      if (skill.type !== "Active") return false;
      return (skill as BaseActiveSkill).kinds.includes(target.requiredKind);
    }
    return true;
  }

  return false;
};

export const canSupport = (
  skill: TargetSkill,
  supportSkill: BaseSupportSkill,
): boolean => {
  // cannotSupportTargets takes precedence
  if (supportSkill.cannotSupportTargets.some((t) => matchesTarget(skill, t))) {
    return false;
  }

  // Check if any supportTarget matches
  return supportSkill.supportTargets.some((t) => matchesTarget(skill, t));
};

// all the strings are the names of the skills
export interface AvailableSupports {
  activationMedium: string[];
  magnificent: string[];
  noble: string[];
  compatible: string[];
  other: string[];
}

export const listAvailableSupports = (
  skill: TargetSkill,
  // supportSkillSlot is 1-indexed
  supportSkillSlot: number,
): AvailableSupports => {
  const result: AvailableSupports = {
    activationMedium: [],
    magnificent: [],
    noble: [],
    compatible: [],
    other: [],
  };

  // Activation Medium: only available in slot 1
  if (supportSkillSlot === 1) {
    for (const am of ActivationMediumSkills) {
      if (canSupport(skill, am)) {
        result.activationMedium.push(am.name);
      } else {
        result.other.push(am.name);
      }
    }
  }

  // Magnificent: only available in slot 3, matches by supportTarget === skill.name
  if (supportSkillSlot === 3) {
    for (const mag of MagnificentSupportSkills) {
      if (mag.supportTarget === skill.name) {
        result.magnificent.push(mag.name);
      }
      // Not matching magnificent skills are NOT added to other
    }
  }

  // Noble: only available in slot 5, matches by supportTarget === skill.name
  if (supportSkillSlot === 5) {
    for (const noble of NobleSupportSkills) {
      if (noble.supportTarget === skill.name) {
        result.noble.push(noble.name);
      }
      // Not matching noble skills are NOT added to other
    }
  }

  // Regular support skills: always available
  for (const support of SupportSkills) {
    if (canSupport(skill, support)) {
      result.compatible.push(support.name);
    } else {
      result.other.push(support.name);
    }
  }

  return result;
};
