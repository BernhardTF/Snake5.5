// Shared lighting state. Written by GameRenderer (per biome / per frame), read by any custom
// ShaderMaterial (snake, props) that wants to match the sand lighting exactly.
// GameRenderer also mirrors these into real THREE lights so standard/physical materials work.
import * as THREE from 'three';

export const LIGHT = {
  /** Normalised direction *towards* the sun (z > 0 = above the sand). */
  sunDir: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() },
  sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
  skyColor: { value: new THREE.Color(0.55, 0.6, 0.7) },
  groundColor: { value: new THREE.Color(0.5, 0.45, 0.4) },
  /** Seconds, for animated shaders. */
  time: { value: 0 },
  /** 0..1 death desaturation etc. */
  deathFade: { value: 0 },
};
