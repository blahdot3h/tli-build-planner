import { clamp } from "remeda";

export type ValueRange = { min: number; max: number };

const getDecimalPlaces = (numStr: string): number => {
  const decimalIndex = numStr.indexOf(".");
  return decimalIndex === -1 ? 0 : numStr.length - decimalIndex - 1;
};

const interpolateValue = (
  range: ValueRange,
  percentage: number,
  decimalPlaces: number,
): string => {
  if (percentage < 0 || percentage > 100) {
    console.error(`Percentage must be 0-100, got ${percentage}`);
  }
  const clampedPercentage = clamp(percentage, { min: 0, max: 100 });
  const value = range.min + (range.max - range.min) * (clampedPercentage / 100);
  if (decimalPlaces === 0) {
    return Math.round(value).toString();
  }
  return value.toFixed(decimalPlaces);
};

// Pattern to match range values like (17-24), (-6--4), or (0.13-0.18)
const RANGE_PATTERN = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;

const interpolateRange = (
  minStr: string,
  maxStr: string,
  percentage: number,
): string => {
  const min = parseFloat(minStr);
  const max = parseFloat(maxStr);
  const decimalPlaces = Math.max(
    getDecimalPlaces(minStr),
    getDecimalPlaces(maxStr),
  );
  const interpolated = interpolateValue(
    { min, max },
    percentage,
    decimalPlaces,
  );

  // Add + prefix for non-negative values from ranges that span negative to positive
  if (min < 0 && max > 0 && parseFloat(interpolated) >= 0) {
    return `+${interpolated}`;
  }
  return interpolated;
};

/**
 * Crafts a single affix string by interpolating value ranges from the craftableAffix format
 *
 * @param affix - The gear affix with craftableAffix property
 * @param percentage - Value from 0-100 representing crafting quality
 * @returns The final affix string with interpolated values
 *
 * @example
 * craft({ craftableAffix: "+(17-24)% Speed" }, 0)   // "+17% Speed"
 * craft({ craftableAffix: "+(17-24)% Speed" }, 50)  // "+21% Speed"
 * craft({ craftableAffix: "+(17-24)% Speed" }, 100) // "+24% Speed"
 */
export const craft = <T extends { craftableAffix: string }>(
  affix: T,
  percentage: number,
): string => {
  let result = affix.craftableAffix;
  result = result.replace(RANGE_PATTERN, (_match, minStr, maxStr) =>
    interpolateRange(minStr, maxStr, percentage),
  );
  return result;
};

/**
 * Crafts an affix string using individual percentages for each value range.
 * Falls back to DEFAULT_QUALITY (or 50) for any missing percentage entries.
 */
export const craftMulti = <T extends { craftableAffix: string }>(
  affix: T,
  percentages: number[],
): string => {
  let result = affix.craftableAffix;
  let rangeIndex = 0;
  result = result.replace(RANGE_PATTERN, (_match, minStr, maxStr) => {
    const percentage = percentages[rangeIndex] ?? 50;
    rangeIndex++;
    return interpolateRange(minStr, maxStr, percentage);
  });
  return result;
};

/**
 * Extracts range descriptors from an affix string for labeling sliders.
 * Returns an array of { min, max } for each range found.
 */
export type RangeDescriptor = { min: string; max: string };

export const extractRanges = (affixString: string): RangeDescriptor[] => {
  const ranges: RangeDescriptor[] = [];
  const pattern = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;
  let match: RegExpExecArray | null;
  match = pattern.exec(affixString);
  while (match !== null) {
    ranges.push({ min: match[1], max: match[2] });
    match = pattern.exec(affixString);
  }
  return ranges;
};
