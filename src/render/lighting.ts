// Shared lighting state. Written by GameRenderer (per biome / per frame), read by any custom
// ShaderMaterial (snake, props) that wants to match the sand lighting exactly.
// GameRenderer also mirrors these into real THREE lights so standard/physical materials work.
import * as THREE from 'three';

export const LIGHT = {
  /** Normalised direction *towards* the sun (z > 0 = above the sand). */
  sunDir: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() },
  sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
  /** Second sun (twin-sun worlds, e.g. kepler). Direction *towards* it; colour is linear radiance
   *  (colour × intensity) and is exactly black (0,0,0) on single-sun worlds, so adding
   *  `sun2Color * max(dot(N, sun2Dir), 0)` to a material is always safe. */
  sun2Dir: { value: new THREE.Vector3(0.55, 0.5, 0.65).normalize() },
  sun2Color: { value: new THREE.Color(0, 0, 0) },
  skyColor: { value: new THREE.Color(0.55, 0.6, 0.7) },
  groundColor: { value: new THREE.Color(0.5, 0.45, 0.4) },
  /** Seconds, for animated shaders. */
  time: { value: 0 },
  /** 0..1 death desaturation etc. */
  deathFade: { value: 0 },
};
