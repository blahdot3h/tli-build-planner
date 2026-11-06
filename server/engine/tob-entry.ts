// What the server uses from the vendored Torchlight of Building engine (MIT licensed, see
// vendor/torchlight-of-building). scripts/build-engine.js bundles this into tob.bundle.js.

export { loadSave } from '../../vendor/torchlight-of-building/src/tli/storage/load-save';
export { calculateOffense } from '../../vendor/torchlight-of-building/src/tli/calcs/offense';
export { parseMod } from '../../vendor/torchlight-of-building/src/tli/mod-parser/index';
export { DEFAULT_CONFIGURATION } from '../../vendor/torchlight-of-building/src/tli/core';
export { SaveDataSchema } from '../../vendor/torchlight-of-building/src/lib/schemas/save-data.schema';
export { EQUIPMENT_TYPES } from '../../vendor/torchlight-of-building/src/tli/gear-data-types';
export { TalentTrees } from '../../vendor/torchlight-of-building/src/data/talent-tree/index';
export {
  ActiveSkills,
  PassiveSkills,
  SupportSkills,
  MagnificentSupportSkills,
  NobleSupportSkills,
  ActivationMediumSkills,
} from '../../vendor/torchlight-of-building/src/data/skill/index';
export { CoreTalents } from '../../vendor/torchlight-of-building/src/data/core-talent/index';
export { HeroTraits } from '../../vendor/torchlight-of-building/src/data/hero-trait/index';
export { isHeroTraitImplemented, getHeroTraitMods, resolveHeroTraitSynergies } from '../../vendor/torchlight-of-building/src/tli/hero/hero-trait-mods';
export { HeroMemories } from '../../vendor/torchlight-of-building/src/data/hero-memory/index';
export { Pactspirits } from '../../vendor/torchlight-of-building/src/data/pactspirit/index';
export { Legendaries } from '../../vendor/torchlight-of-building/src/data/legendary/index';
// What a loadout uses that the engine can't count: unimplemented skills/supports/traits, support
// affixes without mods, and stat lines (talents, gear, slates...) its parser didn't understand
export {
  collectUnimplementedItems,
  collectUnimplementedSupportAffixes,
  collectUnparseableAffixes,
} from '../../vendor/torchlight-of-building/src/lib/debug-utils';
export { getAllAffixes } from '../../vendor/torchlight-of-building/src/tli/calcs/affix-collectors';
// Damage shapes for skills without a hand-written model, built from tlidb cards (skill-shapes.js)
export { registerGeneratedActiveSkills, hasGeneratedActiveSkill } from '../../vendor/torchlight-of-building/src/tli/skills/active-mods';
// Buff-only skills built from tlidb cards: Scent Weaver Sage's Elixir skills (elixirs.js)
export { registerGeneratedBuffSkills, hasGeneratedBuffSkill } from '../../vendor/torchlight-of-building/src/tli/skills/active-mods';
// Which skills have a damage model (the sample build's skill picker offers those first)
export { isSkillImplemented } from '../../vendor/torchlight-of-building/src/tli/skills/is-implemented';
