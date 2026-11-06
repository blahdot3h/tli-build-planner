export interface VoraxLimbData {
  name: string;
  legendaryNames: string[];
  craftableAffixes: {
    craftableAffix: string;
    tier: string;
    affixType: "Basic" | "Advanced" | "Ultimate";
    section: "prefix" | "suffix";
  }[];
  baseAffixes: { affix: string; tier: string }[];
}
