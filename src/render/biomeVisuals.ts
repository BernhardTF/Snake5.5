// Per-biome visual parameters: light, palette, sim behaviour, grade, particles.
import * as THREE from 'three';
import type { BiomeId } from '../types';

export const BIOME_INDEX: Record<BiomeId, number> = {
  karesansui: 0, erg: 1, lagoon: 2, svartsandur: 3, salar: 4,
  pinksands: 5, vaadhoo: 6, dallol: 7, luna: 8, mars: 9, titan: 10, kepler: 11,
};
/** Number of biome shader variants (BIOME define 0..BIOME_COUNT-1). */
export const BIOME_COUNT = 12;

type V3 = [number, number, number];

export interface BiomeVisual {
  id: BiomeId;
  index: number;
  sunDir: V3;
  /** Linear sun radiance (colour × intensity). */
  sun: V3;
  /** Optional second sun (kepler): direction + linear radiance. Absent = no second sun. */
  sun2Dir?: V3;
  sun2?: V3;
  sky: V3;
  ground: V3;
  /** Sand albedo palette (sRGB hex): base, light grain, dark grain. */
  sandA: string; sandB: string; sandC: string;
  /** World-unit height of a groove with R = -1. */
  depthScale: number;
  sim: {
    diffusion: number;   // cells^2/s plain slump
    talus: number;       // allowed slope (R units per cell) before avalanche
    erode: number;       // 1/s : pattern restore rate (erg)
    windX: number; windY: number; // smear direction (unit) for erg
    smear: number;
    heatSet: number;     // value written in B by stamps (0 = none)
    bDecay: number;      // 1/s decay of B
    waves: boolean;
    /** 0 = soft slumping groove profile, 1 = crisp, sharp-edged stamp (luna). */
    sharp?: number;
    /** Calm lapping shoreline along the top side: idle waterline `edge` cells below the top, swash `amp`. */
    lap?: { edge: number; amp: number };
    /** Mars dust devils refill trails where they pass. */
    devils?: boolean;
    /** Titan methane drizzle (random drop impacts) + methane lake on the left. */
    drizzle?: boolean;
  };
  /** Contact shadow look: blur scale (1 = default) and darkness (default 0.82). */
  shadow?: { soft: number; dark: number };
  grade: {
    lift: V3; gamma: V3; gain: V3;
    sat: number; contrast: number; vignette: number; exposure: number;
  };
  bloom: { threshold: number; strength: number; radius: number };
  env: {
    zenith: string; horizon: string; nadir: string; sunGlow: string;
    /** Cloud breakup (default 1), specular window strip (default 1), scene.environmentIntensity. */
    clouds?: number; strip?: number; intensity?: number;
    /** Glow colour of the second sun in the environment map (kepler). */
    sunGlow2?: string;
  };
  ambient: 'petals' | 'wisps' | 'spray' | 'embers' | 'glints';
  /** Burst palette for eat events (sRGB hex). */
  burst: string[];
}

const n3 = (x: number, y: number, z: number): V3 => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

export const BIOME_VISUALS: Record<BiomeId, BiomeVisual> = {
  karesansui: {
    id: 'karesansui', index: 0,
    sunDir: n3(-0.5, 0.62, 0.62),
    sun: [1.5, 1.3, 1.02],
    sky: [0.24, 0.27, 0.34],
    ground: [0.2, 0.17, 0.13],
    sandA: '#d6cdbd', sandB: '#f1ebdf', sandC: '#8f8679',
    depthScale: 0.24,
    sim: { diffusion: 0.00015, talus: 6, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 0, bDecay: 0, waves: false },
    grade: { lift: [0.01, 0.005, 0.0], gamma: [1.0, 1.0, 1.02], gain: [1.03, 1.0, 0.95], sat: 1.02, contrast: 1.06, vignette: 0.32, exposure: 1.0 },
    bloom: { threshold: 1.05, strength: 0.35, radius: 0.7 },
    env: { zenith: '#8fa6c4', horizon: '#f2d9b0', nadir: '#6b5a48', sunGlow: '#fff1d0' },
    ambient: 'petals',
    burst: ['#f7c6d3', '#fbe1e8', '#e98aa6'],
  },
  erg: {
    id: 'erg', index: 1,
    sunDir: n3(-0.62, 0.5, 0.5),
    sun: [1.75, 1.22, 0.7],
    sky: [0.2, 0.22, 0.3],
    ground: [0.3, 0.16, 0.07],
    sandA: '#d98f4e', sandB: '#f0b46f', sandC: '#9c5328',
    depthScale: 0.19,
    sim: { diffusion: 0.0015, talus: 3.5, erode: 1 / 32, windX: 0.8, windY: -0.6, smear: 0.35, heatSet: 0, bDecay: 0, waves: false },
    grade: { lift: [0.02, 0.005, -0.01], gamma: [1.0, 1.0, 1.04], gain: [1.05, 0.99, 0.9], sat: 1.08, contrast: 1.08, vignette: 0.4, exposure: 1.0 },
    bloom: { threshold: 1.1, strength: 0.4, radius: 0.75 },
    env: { zenith: '#6f9ad6', horizon: '#ffd79a', nadir: '#9a5a2a', sunGlow: '#fff0c8' },
    ambient: 'wisps',
    burst: ['#f3c07a', '#d9953f', '#ffe2a8'],
  },
  lagoon: {
    id: 'lagoon', index: 2,
    sunDir: n3(-0.55, 0.72, 0.42),
    sun: [1.5, 0.92, 0.7],
    sky: [0.3, 0.22, 0.36],
    ground: [0.18, 0.12, 0.11],
    sandA: '#94715a', sandB: '#c29c7a', sandC: '#57402f',
    depthScale: 0.15,
    sim: { diffusion: 0.0007, talus: 3.5, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 0, bDecay: 1 / 7, waves: true },
    grade: { lift: [0.02, 0.0, 0.025], gamma: [1.0, 1.02, 1.0], gain: [1.06, 0.97, 0.95], sat: 1.1, contrast: 1.05, vignette: 0.42, exposure: 1.0 },
    bloom: { threshold: 1.0, strength: 0.5, radius: 0.8 },
    env: { zenith: '#7d86c0', horizon: '#ffb27a', nadir: '#3a4a66', sunGlow: '#ffd2a0' },
    ambient: 'spray',
    burst: ['#ff5d73', '#ff9aa8', '#ffe0c0'],
  },
  svartsandur: {
    id: 'svartsandur', index: 3,
    sunDir: n3(-0.4, 0.55, 0.72),
    sun: [0.42, 0.52, 0.7],
    sky: [0.07, 0.13, 0.16],
    ground: [0.02, 0.02, 0.025],
    sandA: '#38383c', sandB: '#505056', sandC: '#1a1a1c',
    depthScale: 0.17,
    sim: { diffusion: 0.0008, talus: 4.5, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 1, bDecay: 1 / 20, waves: false },
    grade: { lift: [0.0, 0.01, 0.02], gamma: [1.02, 1.0, 0.97], gain: [1.0, 1.02, 1.06], sat: 1.05, contrast: 1.1, vignette: 0.5, exposure: 1.15 },
    bloom: { threshold: 0.75, strength: 0.8, radius: 0.85 },
    env: { zenith: '#0b1a2e', horizon: '#1e6b5c', nadir: '#050608', sunGlow: '#7fe0c0', intensity: 0.6 },
    ambient: 'embers',
    burst: ['#ff8a2a', '#ffc15a', '#ff4d1a'],
  },
  salar: {
    id: 'salar', index: 4,
    sunDir: n3(-0.42, 0.5, 0.76),
    sun: [1.35, 1.38, 1.45],
    sky: [0.28, 0.36, 0.5],
    ground: [0.28, 0.28, 0.3],
    sandA: '#d8d6d2', sandB: '#f2f2ef', sandC: '#a9a7a4',
    depthScale: 0.12,
    sim: { diffusion: 0.0006, talus: 5, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 1, bDecay: 1 / 30, waves: false },
    grade: { lift: [0.0, 0.005, 0.015], gamma: [1.0, 1.0, 0.98], gain: [0.98, 1.0, 1.04], sat: 1.05, contrast: 1.06, vignette: 0.3, exposure: 0.85 },
    bloom: { threshold: 1.15, strength: 0.4, radius: 0.7 },
    env: { zenith: '#3f78c8', horizon: '#dbe9f7', nadir: '#c9ccd2', sunGlow: '#ffffff' },
    ambient: 'glints',
    burst: ['#d6336c', '#f06595', '#ffe066'],
  },
  // ------------------------------------------------------------------ Expansion 1 worlds
  pinksands: {
    id: 'pinksands', index: 5,
    sunDir: n3(-0.32, 0.42, 0.85),
    sun: [1.62, 1.52, 1.36],
    sky: [0.25, 0.33, 0.43],
    ground: [0.3, 0.22, 0.2],
    sandA: '#ecc0b4', sandB: '#fcf3ec', sandC: '#c9303f',
    depthScale: 0.16,
    sim: { diffusion: 0.0009, talus: 3.5, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 1, bDecay: 1 / 30, waves: false, lap: { edge: 2.1, amp: 0.55 } },
    grade: { lift: [0.0, 0.004, 0.012], gamma: [1.0, 1.0, 1.0], gain: [1.02, 0.99, 0.99], sat: 1.1, contrast: 1.05, vignette: 0.26, exposure: 0.92 },
    bloom: { threshold: 1.15, strength: 0.32, radius: 0.7 },
    env: { zenith: '#3f8fe0', horizon: '#d9f1f7', nadir: '#e8c3b8', sunGlow: '#fffbe8' },
    ambient: 'spray',
    burst: ['#f7b6c2', '#ffe3e8', '#e88a9e'],
  },
  vaadhoo: {
    id: 'vaadhoo', index: 6,
    sunDir: n3(0.34, 0.6, 0.72),
    sun: [0.2, 0.27, 0.43],
    sky: [0.03, 0.05, 0.1],
    ground: [0.01, 0.012, 0.02],
    sandA: '#8f8a80', sandB: '#aba69c', sandC: '#4d4a44',
    depthScale: 0.15,
    sim: { diffusion: 0.0008, talus: 3.5, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 1, bDecay: 1 / 12, waves: false, lap: { edge: 2.3, amp: 0.6 } },
    grade: { lift: [0.0, 0.006, 0.02], gamma: [1.02, 1.0, 0.97], gain: [0.95, 1.0, 1.08], sat: 1.08, contrast: 1.06, vignette: 0.5, exposure: 1.3 },
    bloom: { threshold: 0.55, strength: 0.95, radius: 0.85 },
    env: { zenith: '#050c1e', horizon: '#1a2c50', nadir: '#05070c', sunGlow: '#cfe0ff', clouds: 0.35, intensity: 0.5 },
    ambient: 'spray',
    burst: ['#8fe8ff', '#e0f7ff', '#3fb8ff'],
  },
  dallol: {
    id: 'dallol', index: 7,
    sunDir: n3(-0.3, 0.38, 0.88),
    sun: [1.78, 1.74, 1.64],
    sky: [0.28, 0.3, 0.33],
    ground: [0.32, 0.3, 0.12],
    sandA: '#d3c936', sandB: '#f4f2e2', sandC: '#c0661f',
    depthScale: 0.12,
    sim: { diffusion: 0.0003, talus: 6, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 1, bDecay: 1 / 14, waves: false },
    grade: { lift: [0.005, 0.008, 0.0], gamma: [1.0, 1.0, 1.02], gain: [1.02, 1.02, 0.97], sat: 1.1, contrast: 1.08, vignette: 0.3, exposure: 0.86 },
    bloom: { threshold: 1.15, strength: 0.35, radius: 0.7 },
    env: { zenith: '#8fb3d9', horizon: '#f2eedc', nadir: '#cfc55a', sunGlow: '#ffffff' },
    ambient: 'wisps',
    burst: ['#ffffff', '#f3f7ff', '#e8e27a'],
  },
  luna: {
    id: 'luna', index: 8,
    sunDir: n3(-0.64, 0.4, 0.62),
    sun: [2.2, 2.16, 2.08],
    sky: [0.004, 0.0042, 0.005],
    ground: [0.006, 0.006, 0.006],
    sandA: '#8c8984', sandB: '#a9a6a0', sandC: '#5a5854',
    depthScale: 0.16,
    sim: { diffusion: 0, talus: 1000, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 0, bDecay: 0, waves: false, sharp: 1 },
    shadow: { soft: 0.3, dark: 0.985 },
    grade: { lift: [0.0, 0.0, 0.0], gamma: [1.0, 1.0, 1.0], gain: [1.0, 1.0, 1.01], sat: 0.85, contrast: 1.1, vignette: 0.45, exposure: 0.88 },
    bloom: { threshold: 1.2, strength: 0.3, radius: 0.7 },
    env: { zenith: '#000000', horizon: '#010102', nadir: '#2a2927', sunGlow: '#ffffff', clouds: 0, strip: 0.25 },
    ambient: 'glints',
    burst: ['#dff3ff', '#9fd8ff', '#ffffff'],
  },
  mars: {
    id: 'mars', index: 9,
    sunDir: n3(-0.72, 0.3, 0.46),
    sun: [1.5, 1.1, 0.78],
    sky: [0.3, 0.19, 0.12],
    ground: [0.22, 0.1, 0.05],
    sandA: '#b0673a', sandB: '#cf8f5c', sandC: '#6b3820',
    depthScale: 0.15,
    sim: { diffusion: 0.0006, talus: 4, erode: 0, windX: 0.85, windY: 0.52, smear: 0, heatSet: 0, bDecay: 0, waves: false, devils: true },
    grade: { lift: [0.02, 0.008, 0.0], gamma: [1.0, 1.01, 1.03], gain: [1.04, 0.98, 0.9], sat: 1.02, contrast: 1.06, vignette: 0.45, exposure: 1.0 },
    bloom: { threshold: 1.1, strength: 0.35, radius: 0.75 },
    env: { zenith: '#c49a6c', horizon: '#e8c08a', nadir: '#6a3a20', sunGlow: '#e4ecff' },
    ambient: 'wisps',
    burst: ['#e8f6ff', '#bfe4ff', '#ffffff'],
  },
  titan: {
    id: 'titan', index: 10,
    sunDir: n3(-0.35, 0.45, 0.82),
    sun: [0.46, 0.29, 0.13],
    sky: [0.34, 0.19, 0.075],
    ground: [0.13, 0.065, 0.028],
    sandA: '#4d3726', sandB: '#634a33', sandC: '#2b1d13',
    depthScale: 0.14,
    sim: { diffusion: 0.0012, talus: 3.5, erode: 0, windX: 0.96, windY: 0.28, smear: 0, heatSet: 0, bDecay: 1 / 7, waves: false, drizzle: true },
    shadow: { soft: 2.4, dark: 0.55 },
    grade: { lift: [0.03, 0.012, 0.0], gamma: [0.98, 1.0, 1.05], gain: [1.05, 0.96, 0.82], sat: 0.95, contrast: 0.9, vignette: 0.5, exposure: 1.35 },
    bloom: { threshold: 1.0, strength: 0.4, radius: 0.85 },
    env: { zenith: '#8a5a2a', horizon: '#c98a45', nadir: '#2a1a0e', sunGlow: '#ffcf8a', clouds: 0.6, intensity: 0.8 },
    ambient: 'wisps',
    burst: ['#e0883a', '#b85a1e', '#ffc070'],
  },
  kepler: {
    id: 'kepler', index: 11,
    sunDir: n3(-0.62, 0.3, 0.62),
    sun: [1.2, 0.7, 0.34],
    sun2Dir: n3(0.55, 0.52, 0.62),
    sun2: [0.34, 0.7, 1.0],
    sky: [0.19, 0.11, 0.29],
    ground: [0.11, 0.06, 0.15],
    sandA: '#9d7fc6', sandB: '#d6c3f2', sandC: '#57397f',
    depthScale: 0.16,
    sim: { diffusion: 0.0009, talus: 4, erode: 0, windX: 0.6, windY: 0.8, smear: 0, heatSet: 1, bDecay: 1 / 7, waves: false },
    grade: { lift: [0.02, 0.0, 0.035], gamma: [1.0, 1.02, 0.98], gain: [1.03, 0.96, 1.05], sat: 1.1, contrast: 1.07, vignette: 0.45, exposure: 1.0 },
    bloom: { threshold: 0.85, strength: 0.65, radius: 0.8 },
    env: { zenith: '#3a2a6e', horizon: '#e79cc6', nadir: '#3a2450', sunGlow: '#ffc080', sunGlow2: '#80e0ff' },
    ambient: 'glints',
    burst: ['#ff4fd8', '#4fe8ff', '#fff0ff'],
  },
};

const _c = new THREE.Color();
/** sRGB hex -> linear THREE.Color components. */
export function lin(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
}
export function linInto(out: THREE.Color | THREE.Vector3, hex: string) {
  _c.setStyle(hex, THREE.SRGBColorSpace);
  if ((out as THREE.Color).isColor) (out as THREE.Color).copy(_c);
  else (out as THREE.Vector3).set(_c.r, _c.g, _c.b);
  return out;
}
