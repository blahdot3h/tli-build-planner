export interface HeroMemoryBaseStats {
  source: "Origin" | "Discipline" | "Progress";
  affixTemplate: string;
  normal: { 1: number; 10: number };
  magic: { 1: number; 10: number; 20: number };
  rare: { 1: number; 10: number; 20: number; 30: number };
  epic: { 1: number; 10: number; 20: number; 30: number; 40: number };
  ultimate: {
    1: number;
    10: number;
    20: number;
    30: number;
    40: number;
    50: number;
  };
}
