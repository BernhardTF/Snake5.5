// Per-skin shading parameters (all colours sRGB hex, converted to linear when applied).
import type { SnakeSkinId } from '../../types';

export interface SkinLook {
  /** Branch index in the skin shader (uSkin). */
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
  /** three.js thin-film iridescence on the specular lobe (0..1). */
  iridescence: number;
  sheen: number;
  /** Emissive strength for the pattern (ember, bluecoral, nebula). */
  emissive: number;
  iris: string;
  /** 0 = round pupil, 1 = vertical slit. */
  pupil: number;
  eyeGlow: number;
  /** Viper supraocular horns. */
  horns: boolean;
  tongue: string;
  // ---- optional extras (defaults keep the original 8 skins unchanged)
  /** A 6th pattern colour (uCExtra). */
  extra?: string;
  /** 0 = normal head, 1 = very broad triangular (gaboon) head. */
  headWidth?: number;
  /** Small paired horns on the snout tip (gaboon). */
  nasalHorns?: boolean;
  /** A crown of 3-4 spiky scaled "eyelashes" above each eye (eyelash viper). */
  lashes?: boolean;
  /** Eye size multiplier (default 1). */
  eyeScale?: number;
  /** Tongue emissive intensity (default 0; ember keeps its historic 1.5). */
  tongueGlow?: number;
  /** Custom thin-film (oil-slick) sheen spread over the whole lit body, 0..1. */
  iridX?: number;
  /** three.js iridescence thickness range in nm (default [220, 620]). */
  iridRange?: [number, number];
  /** Glass body: transmission on medium+ quality, alpha-blended glass on low. */
  glass?: boolean;
  /** Hint for the contact-shadow pass: occluder strength 0..1 (default 1). */
  shadow?: number;
}

export const SKIN_LOOKS: Record<SnakeSkinId, SkinLook> = {
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
    tongueGlow: 1.5,
  },
  // ---- expansion
  gaboon: {
    // tan / buff / dark-brown geometric saddles with pale borders, velvety keeled scales
    index: 8, base: '#94704a', pattern: '#2e1b12', belly: '#e0cfb0', alt: '#cdb285',
    rim: '#d8a878', rimStrength: 0.3, roughness: 0.66, clearcoat: 0.14, keel: 0.85,
    iridescence: 0, sheen: 0.45, emissive: 0, iris: '#c8b48a', pupil: 1, eyeGlow: 0, horns: false, tongue: '#2a201c',
    extra: '#eadcb6', headWidth: 1, nasalHorns: true, eyeScale: 0.82,
  },
  bluecoral: {
    // midnight navy, electric-blue lateral stripes, coral-red head and tail
    index: 9, base: '#0a1230', pattern: '#2fb4ff', belly: '#0e1838', alt: '#ee2f26',
    rim: '#3a7aff', rimStrength: 0.5, roughness: 0.28, clearcoat: 0.9, keel: 0.0,
    iridescence: 0, sheen: 0.2, emissive: 0.8, iris: '#181414', pupil: 0, eyeGlow: 0, horns: false, tongue: '#1a1420',
    extra: '#ff6a48', eyeScale: 0.78,
  },
  paradise: {
    // black scales edged lime green, orange-red stars down the spine
    index: 10, base: '#060807', pattern: '#8fe03a', belly: '#c8dc58', alt: '#ff4f1c',
    rim: '#9fe04a', rimStrength: 0.45, roughness: 0.3, clearcoat: 0.85, keel: 0.0,
    iridescence: 0, sheen: 0.2, emissive: 0, iris: '#c8a848', pupil: 0, eyeGlow: 0, horns: false, tongue: '#262a26',
    extra: '#ffd23a', eyeScale: 1.05,
  },
  sunbeam: {
    // glossy black-brown with the strongest oil-slick iridescence, pale belly
    index: 11, base: '#16110e', pattern: '#2a1f18', belly: '#d9d2ca', alt: '#3a2c22',
    rim: '#6a5aff', rimStrength: 0.25, roughness: 0.1, clearcoat: 1.0, keel: 0.0,
    iridescence: 1.0, sheen: 0.05, emissive: 0, iris: '#1a1614', pupil: 0, eyeGlow: 0, horns: false, tongue: '#262220',
    iridX: 1.0, iridRange: [120, 980], eyeScale: 0.62,
  },
  eyelash: {
    // banana-gold morph with dark freckles and a crown of scaled lashes
    index: 12, base: '#f2c01a', pattern: '#5a3208', belly: '#fff0a0', alt: '#f5cf3a',
    rim: '#ffd84a', rimStrength: 0.65, roughness: 0.48, clearcoat: 0.4, keel: 0.8,
    iridescence: 0, sheen: 0.2, emissive: 0, iris: '#c8b030', pupil: 1, eyeGlow: 0, horns: false, tongue: '#2a2418',
    extra: '#b8300e', lashes: true, eyeScale: 1.08,
  },
  mangrove: {
    // lacquer black, thin crisp sulphur-yellow rings, yellow chin and lips
    index: 13, base: '#060607', pattern: '#ffd21a', belly: '#15171b', alt: '#ffe04a',
    rim: '#3a3a50', rimStrength: 0.2, roughness: 0.12, clearcoat: 1.0, keel: 0.0,
    iridescence: 0, sheen: 0.1, emissive: 0, iris: '#2e2012', pupil: 1, eyeGlow: 0, horns: false, tongue: '#141416',
    eyeScale: 1.22,
  },
  nebula: {
    // a window into space: drifting violet/pink/cyan clouds and twinkling stars
    index: 14, base: '#07041a', pattern: '#7a4dff', belly: '#0d0724', alt: '#ff5fd2',
    rim: '#8a6aff', rimStrength: 0.7, roughness: 0.2, clearcoat: 1.0, keel: 0.0,
    iridescence: 0, sheen: 0.15, emissive: 1, iris: '#e6d8ff', pupil: 1, eyeGlow: 1.3, horns: false, tongue: '#b58cff',
    extra: '#3ad0ff', tongueGlow: 0.9,
  },
  crystal: {
    // living glass: transmission, fresnel rim, facet sparkle, caustics, faint ice tint
    index: 15, base: '#eef9ff', pattern: '#bfe6ff', belly: '#f6fcff', alt: '#ffffff',
    rim: '#cfefff', rimStrength: 1.0, roughness: 0.05, clearcoat: 1.0, keel: 0.0,
    iridescence: 0.35, sheen: 0, emissive: 0, iris: '#8fe0ff', pupil: 1, eyeGlow: 0.9, horns: false, tongue: '#b8ecff',
    extra: '#a8dcff', tongueGlow: 0.5, glass: true, shadow: 0.35, iridRange: [300, 700],
  },
};
