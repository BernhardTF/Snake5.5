// Per-biome visual parameters: light, palette, sim behaviour, grade, particles.
import * as THREE from 'three';
import type { BiomeId } from '../types';

export const BIOME_INDEX: Record<BiomeId, number> = {
  karesansui: 0, erg: 1, lagoon: 2, svartsandur: 3, salar: 4,
};

type V3 = [number, number, number];

export interface BiomeVisual {
  id: BiomeId;
  index: number;
  sunDir: V3;
  /** Linear sun radiance (colour × intensity). */
  sun: V3;
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
  };
  grade: {
    lift: V3; gamma: V3; gain: V3;
    sat: number; contrast: number; vignette: number; exposure: number;
  };
  bloom: { threshold: number; strength: number; radius: number };
  env: { zenith: string; horizon: string; nadir: string; sunGlow: string };
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
    sun: [2.9, 2.55, 2.05],
    sky: [0.42, 0.46, 0.55],
    ground: [0.36, 0.31, 0.25],
    sandA: '#d6cdbd', sandB: '#f1ebdf', sandC: '#8f8679',
    depthScale: 0.17,
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
    sun: [3.3, 2.45, 1.45],
    sky: [0.38, 0.40, 0.52],
    ground: [0.55, 0.30, 0.13],
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
    sun: [3.0, 1.9, 1.5],
    sky: [0.55, 0.42, 0.62],
    ground: [0.35, 0.24, 0.22],
    sandA: '#a88468', sandB: '#c9a585', sandC: '#6b5040',
    depthScale: 0.15,
    sim: { diffusion: 0.003, talus: 2.5, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 0, bDecay: 1 / 7, waves: true },
    grade: { lift: [0.02, 0.0, 0.025], gamma: [1.0, 1.02, 1.0], gain: [1.06, 0.97, 0.95], sat: 1.1, contrast: 1.05, vignette: 0.42, exposure: 1.0 },
    bloom: { threshold: 1.0, strength: 0.5, radius: 0.8 },
    env: { zenith: '#5a6fa8', horizon: '#ff9f7a', nadir: '#3a4a66', sunGlow: '#ffd2a0' },
    ambient: 'spray',
    burst: ['#ff5d73', '#ff9aa8', '#ffe0c0'],
  },
  svartsandur: {
    id: 'svartsandur', index: 3,
    sunDir: n3(-0.4, 0.55, 0.72),
    sun: [0.75, 0.9, 1.15],
    sky: [0.14, 0.26, 0.3],
    ground: [0.05, 0.05, 0.06],
    sandA: '#2a2a2c', sandB: '#58585c', sandC: '#121213',
    depthScale: 0.17,
    sim: { diffusion: 0.0008, talus: 4.5, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 1, bDecay: 1 / 20, waves: false },
    grade: { lift: [0.0, 0.01, 0.02], gamma: [1.02, 1.0, 0.97], gain: [1.0, 1.02, 1.06], sat: 1.05, contrast: 1.1, vignette: 0.5, exposure: 1.15 },
    bloom: { threshold: 0.75, strength: 0.8, radius: 0.85 },
    env: { zenith: '#0b1a2e', horizon: '#1e6b5c', nadir: '#050608', sunGlow: '#7fe0c0' },
    ambient: 'embers',
    burst: ['#ff8a2a', '#ffc15a', '#ff4d1a'],
  },
  salar: {
    id: 'salar', index: 4,
    sunDir: n3(-0.42, 0.5, 0.76),
    sun: [2.7, 2.75, 2.85],
    sky: [0.5, 0.62, 0.82],
    ground: [0.55, 0.56, 0.58],
    sandA: '#e8e6e2', sandB: '#fbfbf8', sandC: '#b9b7b4',
    depthScale: 0.12,
    sim: { diffusion: 0.0006, talus: 5, erode: 0, windX: 0, windY: 0, smear: 0, heatSet: 1, bDecay: 1 / 30, waves: false },
    grade: { lift: [0.0, 0.005, 0.015], gamma: [1.0, 1.0, 0.98], gain: [0.98, 1.0, 1.04], sat: 1.0, contrast: 1.04, vignette: 0.3, exposure: 0.92 },
    bloom: { threshold: 1.15, strength: 0.4, radius: 0.7 },
    env: { zenith: '#3f78c8', horizon: '#dbe9f7', nadir: '#c9ccd2', sunGlow: '#ffffff' },
    ambient: 'glints',
    burst: ['#d6336c', '#f06595', '#ffe066'],
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
