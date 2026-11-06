import { z } from "zod";

// Installed destiny on a ring
const BaseInstalledDestinySchema = z.object({
  destinyName: z.string(),
  destinyType: z.string(),
  resolvedAffix: z.string(),
});

export type InstalledDestiny = z.infer<typeof BaseInstalledDestinySchema>;
export const InstalledDestinySchema = BaseInstalledDestinySchema;

// Default empty ring state
const EMPTY_RING_STATE = { installedDestiny: undefined } as const;

// Ring slot state (SaveData version)
export const RingSlotStateSchema = z
  .object({
    installedDestiny: InstalledDestinySchema.optional().catch(undefined),
  })
  .catch(EMPTY_RING_STATE);

export type RingSlotState = z.infer<typeof RingSlotStateSchema>;

// Default empty rings
const EMPTY_RINGS = {
  innerRing1: EMPTY_RING_STATE,
  innerRing2: EMPTY_RING_STATE,
  innerRing3: EMPTY_RING_STATE,
  innerRing4: EMPTY_RING_STATE,
  innerRing5: EMPTY_RING_STATE,
  innerRing6: EMPTY_RING_STATE,
  midRing1: EMPTY_RING_STATE,
  midRing2: EMPTY_RING_STATE,
  midRing3: EMPTY_RING_STATE,
} as const;

// Pactspirit rings container
export const PactspiritRingsSchema = z
  .object({
    innerRing1: RingSlotStateSchema,
    innerRing2: RingSlotStateSchema,
    innerRing3: RingSlotStateSchema,
    innerRing4: RingSlotStateSchema,
    innerRing5: RingSlotStateSchema,
    innerRing6: RingSlotStateSchema,
    midRing1: RingSlotStateSchema,
    midRing2: RingSlotStateSchema,
    midRing3: RingSlotStateSchema,
  })
  .catch(EMPTY_RINGS);

export type PactspiritRings = z.infer<typeof PactspiritRingsSchema>;

// Undetermined fate sub-slot (micro or medium)
export const UndeterminedFateSlotSchema = z
  .object({
    installedDestiny: InstalledDestinySchema.optional().catch(undefined),
  })
  .catch({ installedDestiny: undefined });

export type UndeterminedFateSlot = z.infer<typeof UndeterminedFateSlotSchema>;

// Undetermined fate configuration
export const UndeterminedFateSchema = z.object({
  numMicroSlots: z.number().catch(0),
  numMediumSlots: z.number().catch(0),
  microSlots: z.array(UndeterminedFateSlotSchema).catch([]),
  mediumSlots: z.array(UndeterminedFateSlotSchema).catch([]),
});

export type UndeterminedFate = z.infer<typeof UndeterminedFateSchema>;

// Default empty pactspirit slot
const EMPTY_PACTSPIRIT_SLOT = {
  pactspiritName: undefined,
  level: 1,
  rings: EMPTY_RINGS,
  undeterminedFate: undefined,
} as const;

// Pactspirit slot
export const PactspiritSlotSchema = z
  .object({
    pactspiritName: z.string().optional().catch(undefined),
    level: z.number().catch(1),
    rings: PactspiritRingsSchema,
    undeterminedFate: UndeterminedFateSchema.optional().catch(undefined),
  })
  .catch(EMPTY_PACTSPIRIT_SLOT);

export type PactspiritSlot = z.infer<typeof PactspiritSlotSchema>;

// Pactspirit page
export const PactspiritPageSchema = z
  .object({
    slot1: PactspiritSlotSchema,
    slot2: PactspiritSlotSchema,
    slot3: PactspiritSlotSchema,
  })
  .catch({
    slot1: EMPTY_PACTSPIRIT_SLOT,
    slot2: EMPTY_PACTSPIRIT_SLOT,
    slot3: EMPTY_PACTSPIRIT_SLOT,
  });

export type PactspiritPage = z.infer<typeof PactspiritPageSchema>;
