import { z } from "zod";

// Support skill slot types (discriminated union)
export const SupportSkillSlotSchema = z.object({
  skillType: z.literal("support"),
  name: z.string(),
  level: z.number().optional(),
});

export type SupportSkillSlot = z.infer<typeof SupportSkillSlotSchema>;

export const MagnificentSupportSkillSlotSchema = z.object({
  skillType: z.literal("magnificent_support"),
  name: z.string(),
  tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  rank: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  craftedAffix: z.string(),
  value: z.number(),
});

export type MagnificentSupportSkillSlot = z.infer<
  typeof MagnificentSupportSkillSlotSchema
>;

export const NobleSupportSkillSlotSchema = z.object({
  skillType: z.literal("noble_support"),
  name: z.string(),
  tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  rank: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  craftedAffix: z.string(),
  value: z.number(),
});

export type NobleSupportSkillSlot = z.infer<typeof NobleSupportSkillSlotSchema>;

export const ActivationMediumSkillSlotSchema = z.object({
  skillType: z.literal("activation_medium"),
  name: z.string(),
  tier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  affixes: z.array(z.string()),
});

export type ActivationMediumSkillSlot = z.infer<
  typeof ActivationMediumSkillSlotSchema
>;

// Combined base support skill slot (discriminated union)
export const BaseSupportSkillSlotSchema = z.discriminatedUnion("skillType", [
  SupportSkillSlotSchema,
  MagnificentSupportSkillSlotSchema,
  NobleSupportSkillSlotSchema,
  ActivationMediumSkillSlotSchema,
]);

export type BaseSupportSkillSlot = z.infer<typeof BaseSupportSkillSlotSchema>;

// Default empty support skills
const EMPTY_SUPPORT_SKILLS = {
  1: undefined,
  2: undefined,
  3: undefined,
  4: undefined,
  5: undefined,
} as const;

// Support skills container (5 optional slots)
export const SupportSkillsSchema = z
  .object({
    1: BaseSupportSkillSlotSchema.optional().catch(undefined),
    2: BaseSupportSkillSlotSchema.optional().catch(undefined),
    3: BaseSupportSkillSlotSchema.optional().catch(undefined),
    4: BaseSupportSkillSlotSchema.optional().catch(undefined),
    5: BaseSupportSkillSlotSchema.optional().catch(undefined),
  })
  .catch(EMPTY_SUPPORT_SKILLS);

export type SupportSkills = z.infer<typeof SupportSkillsSchema>;

// Skill slot (base schema without catch)
const BaseSkillSlotSchema = z.object({
  skillName: z.string().optional(),
  enabled: z.boolean(),
  level: z.number().optional(),
  supportSkills: SupportSkillsSchema,
});

export type SkillSlot = z.infer<typeof BaseSkillSlotSchema>;
export const SkillSlotSchema = BaseSkillSlotSchema;

// Default empty active skill slots
const EMPTY_ACTIVE_SKILLS = {
  1: undefined,
  2: undefined,
  3: undefined,
  4: undefined,
  5: undefined,
} as const;

// Active skill slots (5 optional slots)
export const ActiveSkillSlotsSchema = z
  .object({
    1: SkillSlotSchema.optional().catch(undefined),
    2: SkillSlotSchema.optional().catch(undefined),
    3: SkillSlotSchema.optional().catch(undefined),
    4: SkillSlotSchema.optional().catch(undefined),
    5: SkillSlotSchema.optional().catch(undefined),
  })
  .catch(EMPTY_ACTIVE_SKILLS);

export type ActiveSkillSlots = z.infer<typeof ActiveSkillSlotsSchema>;

// Default empty passive skill slots
const EMPTY_PASSIVE_SKILLS = {
  1: undefined,
  2: undefined,
  3: undefined,
  4: undefined,
} as const;

// Passive skill slots (4 optional slots)
export const PassiveSkillSlotsSchema = z
  .object({
    1: SkillSlotSchema.optional().catch(undefined),
    2: SkillSlotSchema.optional().catch(undefined),
    3: SkillSlotSchema.optional().catch(undefined),
    4: SkillSlotSchema.optional().catch(undefined),
  })
  .catch(EMPTY_PASSIVE_SKILLS);

export type PassiveSkillSlots = z.infer<typeof PassiveSkillSlotsSchema>;

// Skill page
export const SkillPageSchema = z
  .object({
    activeSkills: ActiveSkillSlotsSchema,
    passiveSkills: PassiveSkillSlotsSchema,
  })
  .catch({
    activeSkills: EMPTY_ACTIVE_SKILLS,
    passiveSkills: EMPTY_PASSIVE_SKILLS,
  });

export type SkillPage = z.infer<typeof SkillPageSchema>;
