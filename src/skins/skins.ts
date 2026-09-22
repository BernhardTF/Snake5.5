import type { SkinId } from '../types';

export interface SkinInfo {
  id: SkinId;
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
  { id: 'obsidian', name: 'Obsidian Gold', species: 'Garden serpent', description: 'Ink-black scales with a single wandering thread of gold.', unlockText: 'Default', unlockLevel: 1, swatch: ['#1e1c1a', '#d9b44a', '#3a332b'] },
  { id: 'emerald', name: 'Emerald', species: 'Green tree python', description: 'Leaf-green with a spine of white flecks.', unlockText: 'Reach level 2', unlockLevel: 2, swatch: ['#1f8a3a', '#e8f5d0', '#c9d94a'] },
  { id: 'coral', name: 'Coral', species: 'Coral snake', description: 'Red, black and yellow bands. Beautiful, and a warning.', unlockText: 'Reach level 4', unlockLevel: 4, swatch: ['#c7261c', '#111111', '#f0c419'] },
  { id: 'krait', name: 'Sea Krait', species: 'Banded sea krait', description: 'Silver-blue rings built for the tide.', unlockText: 'Reach level 6', unlockLevel: 6, swatch: ['#8fb3c9', '#18212b', '#dfe8ee'] },
  { id: 'viper', name: 'Horned Viper', species: 'Desert horned viper', description: 'Sand-coloured, dappled, and nearly invisible on the dunes.', unlockText: 'Reach level 8', unlockLevel: 8, swatch: ['#c9a478', '#7a5a3a', '#e8d6b8'] },
  { id: 'albino', name: 'Albino Ghost', species: 'Albino corn snake', description: 'Pearl and peach with ruby eyes.', unlockText: 'Achievement: Length 50', unlockLevel: 0, unlockAchievement: 'len50', swatch: ['#f4e6da', '#f0a58a', '#fff7ef'] },
  { id: 'rainbow', name: 'Rainbow Boa', species: 'Brazilian rainbow boa', description: 'Copper scales that shimmer every colour in the light.', unlockText: 'Achievement: Combo x8', unlockLevel: 0, unlockAchievement: 'combo8', swatch: ['#b3542a', '#2a1a12', '#e07a3a'] },
  { id: 'ember', name: 'Ember Serpent', species: 'Mythic', description: 'Cracked obsidian with molten veins. It glows in the dark.', unlockText: 'Achievement: Fire Walker', unlockLevel: 0, unlockAchievement: 'svart_score', swatch: ['#1a1210', '#ff6a1a', '#3a1a10'] },
];

export const SKIN_BY_ID: Record<SkinId, SkinInfo> = Object.fromEntries(
  SKINS.map((s) => [s.id, s]),
) as Record<SkinId, SkinInfo>;
