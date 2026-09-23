import type { SkinId } from '../types';

export interface SkinInfo {
  id: SkinId;
  /** 'snake' = scaled tube skin, 'legend' = special non-snake character with its own renderer. */
  kind: 'snake' | 'legend';
  name: string;
  species: string;
  description: string;
  /** Human readable unlock condition. */
  unlockText: string;
  /** Profile level that unlocks it (0 = achievement-only / default). */
  unlockLevel: number;
  /** Alternative: achievement id that unlocks it. */
  unlockAchievement?: string;
  /** Swatch css colours for UI cards [base, pattern, belly]. */
  swatch: [string, string, string];
}

export const SKINS: SkinInfo[] = [
  { kind: 'snake', id: 'obsidian', name: 'Obsidian Gold', species: 'Garden serpent', description: 'Ink-black scales with a single wandering thread of gold.', unlockText: 'Default', unlockLevel: 1, swatch: ['#1e1c1a', '#d9b44a', '#3a332b'] },
  { kind: 'snake', id: 'emerald', name: 'Emerald', species: 'Green tree python', description: 'Leaf-green with a spine of white flecks.', unlockText: 'Reach level 2', unlockLevel: 2, swatch: ['#1f8a3a', '#e8f5d0', '#c9d94a'] },
  { kind: 'snake', id: 'coral', name: 'Coral', species: 'Coral snake', description: 'Red, black and yellow bands. Beautiful, and a warning.', unlockText: 'Reach level 4', unlockLevel: 4, swatch: ['#c7261c', '#111111', '#f0c419'] },
  { kind: 'snake', id: 'krait', name: 'Sea Krait', species: 'Banded sea krait', description: 'Silver-blue rings built for the tide.', unlockText: 'Reach level 6', unlockLevel: 6, swatch: ['#8fb3c9', '#18212b', '#dfe8ee'] },
  { kind: 'snake', id: 'viper', name: 'Horned Viper', species: 'Desert horned viper', description: 'Sand-coloured, dappled, and nearly invisible on the dunes.', unlockText: 'Reach level 8', unlockLevel: 8, swatch: ['#c9a478', '#7a5a3a', '#e8d6b8'] },
  { kind: 'snake', id: 'albino', name: 'Albino Ghost', species: 'Albino corn snake', description: 'Pearl and peach with ruby eyes.', unlockText: 'Achievement: Length 50', unlockLevel: 0, unlockAchievement: 'len50', swatch: ['#f4e6da', '#f0a58a', '#fff7ef'] },
  { kind: 'snake', id: 'rainbow', name: 'Rainbow Boa', species: 'Brazilian rainbow boa', description: 'Copper scales that shimmer every colour in the light.', unlockText: 'Achievement: Combo x8', unlockLevel: 0, unlockAchievement: 'combo8', swatch: ['#b3542a', '#2a1a12', '#e07a3a'] },
  { kind: 'snake', id: 'ember', name: 'Ember Serpent', species: 'Mythic', description: 'Cracked obsidian with molten veins. It glows in the dark.', unlockText: 'Achievement: Fire Walker', unlockLevel: 0, unlockAchievement: 'svart_score', swatch: ['#1a1210', '#ff6a1a', '#3a1a10'] },
  // ---- new snakes
  { kind: 'snake', id: 'gaboon', name: 'Gaboon', species: 'Gaboon viper', description: 'Leaf-litter geometry of hourglasses and diamonds. The perfect camouflage.', unlockText: 'Reach level 9', unlockLevel: 9, swatch: ['#b89a74', '#4a2e22', '#e7d7bd'] },
  { kind: 'snake', id: 'bluecoral', name: 'Blue Coral', species: 'Blue Malaysian coral snake', description: 'Electric-blue stripes on midnight scales, with a head and tail of burning red.', unlockText: 'Reach level 11', unlockLevel: 11, swatch: ['#0c1430', '#29b6ff', '#ff3b3b'] },
  { kind: 'snake', id: 'paradise', name: 'Paradise', species: 'Paradise flying snake', description: 'Green and black lace with orange-red stars down the spine.', unlockText: 'Reach level 13', unlockLevel: 13, swatch: ['#1e3a1e', '#7fdc3a', '#ff6a2a'] },
  { kind: 'snake', id: 'sunbeam', name: 'Sunbeam', species: 'Sunbeam snake', description: 'Glossy black that shatters into oil-slick rainbows in direct light.', unlockText: 'Reach level 15', unlockLevel: 15, swatch: ['#15161a', '#6a5aff', '#2bd0b0'] },
  { kind: 'snake', id: 'eyelash', name: 'Eyelash', species: 'Eyelash viper (golden morph)', description: 'Banana-gold with freckles and a crown of scaled lashes above the eyes.', unlockText: 'Reach level 17', unlockLevel: 17, swatch: ['#f2c21a', '#b87a0a', '#fff0a0'] },
  { kind: 'snake', id: 'mangrove', name: 'Mangrove', species: 'Mangrove cat snake', description: 'Lacquer black ringed with thin bands of sulphur yellow.', unlockText: 'Achievement: Beyond Earth', unlockLevel: 0, unlockAchievement: 'beyond', swatch: ['#0b0b0c', '#ffd21a', '#f5e070'] },
  { kind: 'snake', id: 'nebula', name: 'Nebula', species: 'Mythic', description: 'A body full of drifting galaxies and starlight.', unlockText: 'Achievement: Moonwalker', unlockLevel: 0, unlockAchievement: 'moonwalker', swatch: ['#0a0620', '#7a4dff', '#ff5fd2'] },
  { kind: 'snake', id: 'crystal', name: 'Crystal', species: 'Mythic', description: 'Living glass that refracts the world beneath it.', unlockText: 'Achievement: Stargazer', unlockLevel: 0, unlockAchievement: 'kepler_score', swatch: ['#dff4ff', '#9fd8ff', '#ffffff'] },
  // ---- legends (special characters)
  { kind: 'legend', id: 'centipede', name: 'Centipede', species: 'Giant desert centipede', description: 'A hundred rippling legs and armoured amber plates. It swarms, it never slithers.', unlockText: 'Reach level 13', unlockLevel: 13, swatch: ['#6a2a12', '#f09a2a', '#2a120a'] },
  { kind: 'legend', id: 'eel', name: 'Volt Eel', species: 'Electric eel', description: 'Slick, finned and crackling with 800 volts of living lightning.', unlockText: 'Reach level 15', unlockLevel: 15, swatch: ['#2a3a2e', '#7affea', '#c9b27a'] },
  { kind: 'legend', id: 'dragon', name: 'Lóng', species: 'Celestial dragon', description: 'Jade scales, golden whiskers, a flowing mane and fins. It brings the rain.', unlockText: 'Reach level 18', unlockLevel: 18, swatch: ['#0f6a4a', '#f2c94c', '#c0392b'] },
  { kind: 'legend', id: 'mecha', name: 'Mecha', species: 'Serpent automaton', description: 'Brushed titanium segments, glowing servo joints and a scanning visor.', unlockText: 'Reach level 21', unlockLevel: 21, swatch: ['#8a939e', '#35e0ff', '#2a2f36'] },
  { kind: 'legend', id: 'train', name: 'Express', species: 'Steam locomotive', description: 'A brass-and-crimson engine that adds a carriage for every meal. All aboard.', unlockText: 'Reach level 25', unlockLevel: 25, swatch: ['#1b1b1f', '#b8322a', '#d8b25a'] },
  { kind: 'legend', id: 'comet', name: 'Comet', species: 'Celestial wanderer', description: 'A blazing nucleus trailing a tail of ice and plasma. It does not eat, it absorbs.', unlockText: 'Reach level 28', unlockLevel: 28, swatch: ['#1a2a6a', '#9fe8ff', '#ffffff'] },
];

export const SKIN_BY_ID: Record<SkinId, SkinInfo> = Object.fromEntries(
  SKINS.map((s) => [s.id, s]),
) as Record<SkinId, SkinInfo>;

export const SNAKE_SKINS = SKINS.filter((s) => s.kind === 'snake');
export const LEGENDS = SKINS.filter((s) => s.kind === 'legend');
export const isLegend = (id: SkinId) => SKIN_BY_ID[id]?.kind === 'legend';
