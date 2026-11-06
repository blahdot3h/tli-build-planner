// Escapist Bing: Creative Genius (#2), trait values by trait level from tlidb's Creative Genius page
// (six levels; the sixth through Artificial Moon). The engine has the damage numbers; the Spell
// Burst simulation (server/sim/spell.js) plays out these timing rules.
export const BING_HERO = 'Escapist Bing: Creative Genius (#2)';

// Traits only the simulation models (the engine has no number for them)
export const BING_SIM_TRAITS = ['Flash of Brilliance'];

// Mind Domain: "Gains 1 stack of Whimsy for every 0.5s staying in the energy field. Stacks up to
// (3/4/5/6/7/8) time(s)"
export const MIND_DOMAIN_CAP = [3, 4, 5, 6, 7, 8];
// Flash of Brilliance: "Casting a Main Skill has a (20/25/25/30/30/40)% chance to trigger Whimsy
// Explosion without consuming Whimsy Essence. Interval: (3.5/3.5/3/3/2.5/2.5) s"
export const FLASH_CHANCE = [20, 25, 25, 30, 30, 40];
export const FLASH_INTERVAL = [3.5, 3.5, 3, 3, 2.5, 2.5];
// Multi-Coupling Equation: "+1 Max Spell Burst for every 2 Empower or Defensive Skill(s) affecting
// you. Stacks up to (1/1/2/2/2/3) time(s)", and "+(0/15/15/30/45/45)% Empower and Defensive Skill
// Effect Duration"
export const MULTI_COUPLING_CAP = [1, 1, 2, 2, 2, 3];
export const MULTI_COUPLING_DURATION = [0, 15, 15, 30, 45, 45];
// Trouble Maker: "Effect of Whimsy Signal enhanced to: (+50/+50/+65/+65/+80/+85)% additional Spell
// Damage taken" (the engine setting whimsySignalDmgPct; Whimsy Signal is +20% without it)
export const TROUBLE_MAKER_SIGNAL = [50, 50, 65, 65, 80, 85];
// Traits the engine counts through a setting the bridge sets from the trait level
export const BING_SETTING_TRAITS = ['Trouble Maker'];

// A picked trait's level (1-6), or 0 when it isn't picked
export function bingTraitLevel(hero, name) {
  if (!Object.values(hero?.traits ?? {}).includes(name)) return 0;
  return Math.max(1, Math.min(6, hero?.levels?.[name] ?? 1));
}
