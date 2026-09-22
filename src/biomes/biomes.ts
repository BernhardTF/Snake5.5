import type { BiomeId } from '../types';

export interface BiomeInfo {
  id: BiomeId;
  name: string;
  /** Native / local flavour title. */
  localName: string;
  region: string;
  culture: string;
  tagline: string;
  description: string;
  unlockLevel: number;
  foodName: string;
  obstacleName: string;
  /** UI accent colours (css). */
  accent: string;
  accentSoft: string;
  /** Background css gradient used behind cards/loading for this biome. */
  cardGradient: string;
}

export const BIOMES: BiomeInfo[] = [
  {
    id: 'karesansui',
    name: 'Karesansui',
    localName: '枯山水',
    region: 'Kyoto, Japan',
    culture: 'Japanese dry rock garden',
    tagline: 'Rake the silence.',
    description: 'Pale granite gravel raked into still lines. Stones rest in rippled rings while maple shadows sway.',
    unlockLevel: 1,
    foodName: 'Sakura blossom',
    obstacleName: 'Moss stone',
    accent: '#c9a45c',
    accentSoft: '#efe4cc',
    cardGradient: 'linear-gradient(160deg,#efe7d6 0%,#d8ccb2 60%,#b9a887 100%)',
  },
  {
    id: 'erg',
    name: 'Erg Chebbi',
    localName: 'عرق الشبي',
    region: 'Sahara, Morocco',
    culture: 'Amazigh desert caravan',
    tagline: 'The wind keeps no secrets.',
    description: 'Amber dunes ribbed by the wind. Your trail is slowly swallowed by drifting sand.',
    unlockLevel: 2,
    foodName: 'Golden date',
    obstacleName: 'Sandstone boulder',
    accent: '#e0892f',
    accentSoft: '#f6d9b0',
    cardGradient: 'linear-gradient(160deg,#f3c27a 0%,#d98a3d 55%,#8f4a1f 100%)',
  },
  {
    id: 'lagoon',
    name: 'Motu Lagoon',
    localName: 'Motu',
    region: 'French Polynesia',
    culture: 'Polynesian island shore',
    tagline: 'The tide forgives everything.',
    description: 'Wet sunset sand, mirror-bright. Waves roll in and wash your story away.',
    unlockLevel: 3,
    foodName: 'Hibiscus',
    obstacleName: 'Coral head',
    accent: '#ff7a6b',
    accentSoft: '#ffd9c8',
    cardGradient: 'linear-gradient(160deg,#ffb38a 0%,#e46b7a 50%,#3d5f8f 100%)',
  },
  {
    id: 'svartsandur',
    name: 'Svartsandur',
    localName: 'Svartsandur',
    region: 'South coast, Iceland',
    culture: 'Norse volcanic shore',
    tagline: 'Fire sleeps beneath the black.',
    description: 'Black basalt sand under the aurora. Every scar you carve exposes the embers below.',
    unlockLevel: 5,
    foodName: 'Ember crystal',
    obstacleName: 'Basalt column',
    accent: '#ff6a2a',
    accentSoft: '#9fe3d0',
    cardGradient: 'linear-gradient(160deg,#1d2a3a 0%,#121418 55%,#3b1a10 100%)',
  },
  {
    id: 'salar',
    name: 'Salar',
    localName: 'Salar de Uyuni',
    region: 'Altiplano, Bolivia',
    culture: 'Andean high plateau',
    tagline: 'Walk on the sky.',
    description: 'A crust of salt polygons under a film of water that mirrors the sky. Your wet trail slowly dries.',
    unlockLevel: 7,
    foodName: 'Kantuta flower',
    obstacleName: 'Salt mound',
    accent: '#d6336c',
    accentSoft: '#e6f1fb',
    cardGradient: 'linear-gradient(160deg,#eaf4ff 0%,#bcd7f0 55%,#8aa6c8 100%)',
  },
];

export const BIOME_BY_ID: Record<BiomeId, BiomeInfo> = Object.fromEntries(
  BIOMES.map((b) => [b.id, b]),
) as Record<BiomeId, BiomeInfo>;
