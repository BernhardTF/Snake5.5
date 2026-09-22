// Per-skin shading parameters (all colours sRGB hex, converted to linear when applied).
import type { SkinId } from '../../types';

export interface SkinLook {
  index: number;
  base: string;
  pattern: string;
  belly: string;
  alt: string;
  /** Subsurface / thin-edge tint. */
  rim: string;
  rimStrength: number;
  roughness: number;
  clearcoat: number;
  keel: number;
  iridescence: number;
  sheen: number;
  /** Emissive strength for the pattern (ember). */
  emissive: number;
  iris: string;
  /** 0 = round pupil, 1 = vertical slit. */
  pupil: number;
  eyeGlow: number;
  horns: boolean;
  tongue: string;
}

export const SKIN_LOOKS: Record<SkinId, SkinLook> = {
  obsidian: {
    index: 0, base: '#171513', pattern: '#e0b64a', belly: '#3a332b', alt: '#2a2520',
    rim: '#6a3a22', rimStrength: 0.25, roughness: 0.34, clearcoat: 0.85, keel: 0.0,
    iridescence: 0, sheen: 0.25, emissive: 0, iris: '#c9a23c', pupil: 1, eyeGlow: 0, horns: false, tongue: '#c21d2a',
  },
  emerald: {
    index: 1, base: '#1c8a3a', pattern: '#eef7dc', belly: '#d4dc4a', alt: '#0f5f2a',
    rim: '#b8e04a', rimStrength: 0.55, roughness: 0.3, clearcoat: 0.9, keel: 0.0,
    iridescence: 0, sheen: 0.2, emissive: 0, iris: '#d8c24a', pupil: 1, eyeGlow: 0, horns: false, tongue: '#b0182a',
  },
  coral: {
    index: 2, base: '#c7261c', pattern: '#111111', belly: '#f0c419', alt: '#f4d23a',
    rim: '#ff5a3a', rimStrength: 0.5, roughness: 0.36, clearcoat: 0.75, keel: 0.0,
    iridescence: 0, sheen: 0.2, emissive: 0, iris: '#1a1a1a', pupil: 0, eyeGlow: 0, horns: false, tongue: '#2a1a1a',
  },
  krait: {
    index: 3, base: '#8fb3c9', pattern: '#141b24', belly: '#e2e9d6', alt: '#b9d2e0',
    rim: '#a8d4ea', rimStrength: 0.4, roughness: 0.38, clearcoat: 0.7, keel: 0.0,
    iridescence: 0.25, sheen: 0.3, emissive: 0, iris: '#20262c', pupil: 0, eyeGlow: 0, horns: false, tongue: '#3a4a58',
  },
  viper: {
    index: 4, base: '#cfa97a', pattern: '#6e4f33', belly: '#ecdcc0', alt: '#a88258',
    rim: '#e8b27a', rimStrength: 0.4, roughness: 0.72, clearcoat: 0.12, keel: 0.9,
    iridescence: 0, sheen: 0.1, emissive: 0, iris: '#b8905a', pupil: 1, eyeGlow: 0, horns: true, tongue: '#3a2a22',
  },
  albino: {
    index: 5, base: '#f6e9dd', pattern: '#f39a78', belly: '#fff8f0', alt: '#e0724e',
    rim: '#ff8a7a', rimStrength: 0.9, roughness: 0.36, clearcoat: 0.8, keel: 0.0,
    iridescence: 0, sheen: 0.35, emissive: 0, iris: '#c0142e', pupil: 0, eyeGlow: 0.15, horns: false, tongue: '#e0506a',
  },
  rainbow: {
    index: 6, base: '#b8592c', pattern: '#24160f', belly: '#e88a4a', alt: '#e6874a',
    rim: '#ff8a4a', rimStrength: 0.5, roughness: 0.26, clearcoat: 1.0, keel: 0.0,
    iridescence: 1.0, sheen: 0.2, emissive: 0, iris: '#6a4020', pupil: 1, eyeGlow: 0, horns: false, tongue: '#2a1a1a',
  },
  ember: {
    index: 7, base: '#161010', pattern: '#ff6a1a', belly: '#3a1a10', alt: '#ffb040',
    rim: '#ff4a10', rimStrength: 0.5, roughness: 0.62, clearcoat: 0.35, keel: 0.2,
    iridescence: 0, sheen: 0.1, emissive: 1, iris: '#ff7a20', pupil: 1, eyeGlow: 2.2, horns: false, tongue: '#ff5a1a',
  },
};
