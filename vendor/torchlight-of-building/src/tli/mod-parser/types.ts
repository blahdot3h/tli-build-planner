import type { Mod } from "../mod";

// Runtime captures type (used internally by parser)
export interface RuntimeCaptures {
  [key: string]: string | number | boolean | undefined;
}

// Map of mod type names to their definitions (derived from Mod union)
export type ModTypeMap = {
  [M in Mod as M["type"]]: M;
};

// A compiled template ready to parse
export interface CompiledTemplate {
  templateStr: string;
  regex: RegExp;
  captureNames: string[];
  extractors: Map<string, (match: string) => string | number>;
}

// Output specification for multi-mod templates
export interface MultiOutput<TCaptures extends object = RuntimeCaptures> {
  mod: (captures: TCaptures) => Mod;
}

// A parser that can parse input and return mods
export interface ModParser {
  parse(input: string): Mod[] | undefined;
}

// Builder for fluent API - generic over captures type
export interface TemplateBuilder<
  TCaptures extends object = Record<string, unknown>,
> {
  // Define custom enum mapping for this template
  enum<TName extends string>(
    name: TName,
    mapping: Record<string, string>,
  ): TemplateBuilder<TCaptures>;

  // Custom capture extractor - adds/overrides the capture type
  capture<TName extends string, TValue>(
    name: TName,
    extractor: (match: RegExpMatchArray) => TValue,
  ): TemplateBuilder<TCaptures & { [K in TName]: TValue }>;

  // Output single mod - mapper returns full Mod (with type field for contextual typing)
  output(mapper: (captures: TCaptures) => Mod): ModParser;

  // Output single mod - type only (no additional fields needed)
  output<TModType extends keyof ModTypeMap>(modType: TModType): ModParser;

  // Output multiple mods from same template
  outputMany(specs: MultiOutput<TCaptures>[]): ModParser;

  // Output no mods (recognizes the pattern but produces empty array)
  outputNone(): ModParser;

  // Match against input (full string), returning captures. Throws if no match.
  match(input: string, context?: string): TCaptures;

  // Match against input (full string), returning captures or undefined.
  tryMatch(input: string): TCaptures | undefined;
}

// Multi-pattern builder (for alternate syntaxes)
export interface MultiTemplateBuilder<
  TCaptures extends object = Record<string, unknown>,
> {
  output(mapper: (captures: TCaptures) => Mod): ModParser;
}
