import { Blends } from "@/src/data/blend/blends";
import type { Blend } from "@/src/data/blend/types";

export const getBlendAffixes = (): readonly Blend[] => Blends;

interface BlendParts {
  name: string;
  description: string;
}

// Parse blend affix to extract bracketed name and remaining description
// "[Caged Fury] description..." -> { name: "Caged Fury", description: "description..." }
const parseBlendAffix = (affixText: string): BlendParts => {
  const match = affixText.match(/^\[([^\]]+)\]([\s\S]*)/);
  if (!match) {
    return { name: affixText, description: "" };
  }
  return { name: match[1], description: match[2].trim() };
};

// Format blend for storage - just the extracted name
export const formatBlendAffix = (blend: Blend): string => {
  return parseBlendAffix(blend.affix).name;
};

// Format blend for dropdown display
// Bracketed affixes like "[Caged Fury] desc..." show as just "Caged Fury"
// Non-bracketed affixes show text with newlines replaced by slashes
export const formatBlendOption = (blend: Blend): string => {
  const { name, description } = parseBlendAffix(blend.affix);
  // If there's a description, it was a bracketed affix - just show the name
  if (description) {
    return name;
  }
  // Non-bracketed affix - replace newlines with slashes and truncate
  const display = name.replace(/\n/g, " / ");
  return display.length > 60 ? `${display.substring(0, 57)}...` : display;
};

// Format blend for preview display - shows full affix text with newlines preserved
export const formatBlendPreview = (blend: Blend): string => {
  const { name, description } = parseBlendAffix(blend.affix);
  // If there's a description, show name on first line, then description
  if (description) {
    return `${name}\n${description}`;
  }
  // Non-bracketed affix - show full text as-is
  return name;
};
