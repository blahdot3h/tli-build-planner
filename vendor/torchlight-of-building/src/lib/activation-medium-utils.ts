import { ActivationMediumSkills } from "@/src/data/skill";
import type {
  ActivationMediumAffixDef,
  BaseActivationMediumSkill,
} from "@/src/data/skill/types";
import { craft } from "@/src/tli/crafting/craft";

/**
 * Get activation medium skill data by name.
 */
export const getActivationMediumSkill = (
  name: string,
): BaseActivationMediumSkill | undefined => {
  return ActivationMediumSkills.find((s) => s.name === name);
};

/**
 * Get affixes for a specific tier.
 */
export const getAffixesForTier = (
  skill: BaseActivationMediumSkill,
  tier: 0 | 1 | 2 | 3,
): ActivationMediumAffixDef[] => {
  if (skill.affixDefs === undefined) return [];
  return skill.affixDefs[tier] ?? [];
};

/**
 * Get exclusive groups from a list of affixes.
 * Returns map of groupName -> array of affix indices in that group.
 */
export const getExclusiveGroups = (
  affixes: ActivationMediumAffixDef[],
): Map<string, number[]> => {
  const groups = new Map<string, number[]>();
  affixes.forEach((affix, index) => {
    if (affix.exclusiveGroup !== undefined) {
      const existing = groups.get(affix.exclusiveGroup) ?? [];
      existing.push(index);
      groups.set(affix.exclusiveGroup, existing);
    }
  });
  return groups;
};

// Pattern to match range values like (17-24), (-6--4), or (0.13-0.18)
const RANGE_PATTERN = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;

/**
 * Check if an affix string has any (min-max) value ranges.
 */
export const hasValueRange = (affix: string): boolean => {
  RANGE_PATTERN.lastIndex = 0;
  return RANGE_PATTERN.test(affix);
};

/**
 * Craft an affix with a given quality percentage.
 * Uses the existing craft() function from crafting/craft.ts
 */
export const craftAffix = (affix: string, percentage: number): string => {
  return craft({ craftableAffix: affix }, percentage);
};

/**
 * Get worst (tier 3) defaults for an activation medium skill.
 * Returns the slot with worst tier and worst quality (percentage 0).
 */
export const getWorstActivationMediumDefaults = (
  skill: BaseActivationMediumSkill,
): { tier: 0 | 1 | 2 | 3; affixes: string[] } => {
  const tier = 3 as const;
  const tierAffixes = getAffixesForTier(skill, tier);

  // For each affix at this tier, use minimum values (worst quality = 0%)
  const affixes: string[] = [];
  const usedGroups = new Set<string>();

  for (const affixDef of tierAffixes) {
    // Skip if this exclusive group already has an affix
    if (affixDef.exclusiveGroup !== undefined) {
      if (usedGroups.has(affixDef.exclusiveGroup)) continue;
      usedGroups.add(affixDef.exclusiveGroup);
    }

    // Use minimum value (0% quality)
    const interpolated = craftAffix(affixDef.affix, 0);
    affixes.push(interpolated);
  }

  return { tier, affixes };
};
