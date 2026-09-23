// Small shared helpers for Legend characters: instance matrix writers, PRNG, easing, ghost control.
import * as THREE from 'three';

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smooth(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** Frame-rate independent exponential approach factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Deterministic hash → [0,1). */
export function hash1(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Tiny allocation-free PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed = 1) { this.s = seed >>> 0; }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  sign() { return this.next() < 0.5 ? -1 : 1; }
}

// Scratch basis written by basisYPR.
const B = { fx: 1, fy: 0, fz: 0, lx: 0, ly: 1, lz: 0, ux: 0, uy: 0, uz: 1 };

/**
 * Basis with local +X forward, +Y left, +Z up.
 * yaw about world Z, then pitch (nose up > 0), then roll about forward (left side up > 0).
 */
export function basisYPR(yaw: number, pitch: number, roll: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), spp = Math.sin(pitch);
  const fx = cp * cy, fy = cp * sy, fz = spp;
  const l0x = -sy, l0y = cy, l0z = 0;
  const u0x = -spp * cy, u0y = -spp * sy, u0z = cp;
  if (roll !== 0) {
    const cr = Math.cos(roll), sr = Math.sin(roll);
    B.lx = l0x * cr + u0x * sr; B.ly = l0y * cr + u0y * sr; B.lz = l0z * cr + u0z * sr;
    B.ux = -l0x * sr + u0x * cr; B.uy = -l0y * sr + u0y * cr; B.uz = -l0z * sr + u0z * cr;
  } else {
    B.lx = l0x; B.ly = l0y; B.lz = l0z; B.ux = u0x; B.uy = u0y; B.uz = u0z;
  }
  B.fx = fx; B.fy = fy; B.fz = fz;
  return B;
}

/** Write a TRS matrix (column-major) into an instance matrix array. */
export function writeTRS(a: Float32Array | number[], i: number, px: number, py: number, pz: number,
  yaw: number, pitch: number, roll: number, sx: number, sy: number, sz: number) {
  const b = basisYPR(yaw, pitch, roll);
  const o = i * 16;
  a[o] = b.fx * sx; a[o + 1] = b.fy * sx; a[o + 2] = b.fz * sx; a[o + 3] = 0;
  a[o + 4] = b.lx * sy; a[o + 5] = b.ly * sy; a[o + 6] = b.lz * sy; a[o + 7] = 0;
  a[o + 8] = b.ux * sz; a[o + 9] = b.uy * sz; a[o + 10] = b.uz * sz; a[o + 11] = 0;
  a[o + 12] = px; a[o + 13] = py; a[o + 14] = pz; a[o + 15] = 1;
}

/** Local offset (fwd, left, up) → world, using the last basisYPR/writeTRS basis. */
export function basisApply(px: number, py: number, pz: number, f: number, l: number, u: number, out: { x: number; y: number; z: number }) {
  out.x = px + B.fx * f + B.lx * l + B.ux * u;
  out.y = py + B.fy * f + B.ly * l + B.uy * u;
  out.z = pz + B.fz * f + B.lz * l + B.uz * u;
  return out;
}

export function writeHidden(a: Float32Array, i: number) {
  const o = i * 16;
  for (let k = 0; k < 16; k++) a[o + k] = 0;
}

/** Make an InstancedMesh that is never culled and whose matrices are written manually. */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, max: number, colors = false): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colors) {
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

/** Flag an InstancedMesh's first `n` instances as changed. */
export function commit(m: THREE.InstancedMesh, n: number) {
  m.count = n;
  m.instanceMatrix.clearUpdateRanges();
  m.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) {
    m.instanceColor.clearUpdateRanges();
    m.instanceColor.addUpdateRange(0, Math.max(1, n) * 3);
    m.instanceColor.needsUpdate = true;
  }
}

export function setColor(m: THREE.InstancedMesh, i: number, r: number, g: number, b: number) {
  const a = m.instanceColor!.array as Float32Array;
  a[i * 3] = r; a[i * 3 + 1] = g; a[i * 3 + 2] = b;
}

export function noShadow<T extends THREE.Object3D>(o: T): T {
  o.userData.noShadow = true;
  o.castShadow = false;
  o.receiveShadow = false;
  o.frustumCulled = false;
  return o;
}

/**
 * Ghost fade for solid materials: toggles transparency (two cached programs), and
 * scales opacity. `k` 0..1 = ghost amount, `op` = target ghost opacity.
 */
export function applyGhost(mats: THREE.Material[], k: number, op: number) {
  const tr = k > 0.01;
  const o = tr ? 1 - (1 - op) * k : 1;
  for (let i = 0; i < mats.length; i++) {
    const m = mats[i];
    if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
    m.opacity = o * ((m.userData.baseOpacity as number | undefined) ?? 1);
    m.depthWrite = true;
  }
}

/** Standard ghost flicker opacity (matches the snake's ghost look). */
export const ghostOpacity = (t: number) => 0.34 + 0.07 * Math.sin(t * 23) * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 3.1);

/** sRGB hex → linear THREE.Color (convenience). */
export const col = (hex: string | number) => new THREE.Color(hex);
