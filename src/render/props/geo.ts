// Small procedural geometry toolkit shared by the snake head parts and the props.
// Everything here runs once at build time (never per frame).
import * as THREE from 'three';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ value noise 3D
function hash3(x: number, y: number, z: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x: number, y: number, z: number, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
export function fbm3(x: number, y: number, z: number, seed = 0, oct = 4) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f, seed + i * 17);
    f *= 2.03; a *= 0.5;
  }
  return s / (1 - Math.pow(0.5, oct));
}

// ------------------------------------------------------------------ sweep (tapered tube)
/**
 * Sweeps a circle (optionally flattened) along a polyline with per-point radius.
 * Caps both ends with a cone point. Returns non-indexed-free indexed geometry with normals.
 */
export function sweep(
  pts: THREE.Vector3[], radii: number[], radial = 8, flat = 1, color?: (t: number, a: number) => THREE.Color,
): THREE.BufferGeometry {
  const n = pts.length;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  let prevN = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    if (i === 0) {
      N.set(0, 0, 1);
      if (Math.abs(T.dot(N)) > 0.9) N.set(1, 0, 0);
      N.sub(T.clone().multiplyScalar(N.dot(T))).normalize();
    } else {
      N.copy(prevN).sub(T.clone().multiplyScalar(prevN.dot(T))).normalize();
    }
    prevN.copy(N);
    B.crossVectors(T, N).normalize();
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const cx = Math.cos(ang), cy = Math.sin(ang) * flat;
      const r = radii[i];
      pos.push(pts[i].x + (N.x * cx + B.x * cy) * r, pts[i].y + (N.y * cx + B.y * cy) * r, pts[i].z + (N.z * cx + B.z * cy) * r);
      const nx = N.x * cx + B.x * cy / Math.max(flat, 0.05), ny = N.y * cx + B.y * cy / Math.max(flat, 0.05), nz = N.z * cx + B.z * cy / Math.max(flat, 0.05);
      const l = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / l, ny / l, nz / l);
      if (color) { const c = color(i / (n - 1), j / radial); col.push(c.r, c.g, c.b); }
    }
  }
  const V = radial + 1;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * V + j, b = a + 1, c = a + V, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Merge geometries (all must share the same attribute set). Converts to indexed. */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const attrs = Object.keys(geos[0].attributes);
  const out: Record<string, number[]> = {};
  for (const k of attrs) out[k] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : indexify(g0);
    for (const k of attrs) {
      const a = g.getAttribute(k) as THREE.BufferAttribute;
      if (!a) throw new Error('merge: missing attribute ' + k);
      for (let i = 0; i < a.count * a.itemSize; i++) out[k].push(a.array[i] as number);
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += g.getAttribute('position').count;
  }
  const r = new THREE.BufferGeometry();
  for (const k of attrs) r.setAttribute(k, new THREE.Float32BufferAttribute(out[k], geos[0].getAttribute(k).itemSize));
  r.setIndex(idx);
  return r;
}

function indexify(g: THREE.BufferGeometry) {
  const n = g.getAttribute('position').count;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  g.setIndex(idx);
  return g;
}

/** Strip to position/normal(/color) so heterogeneous three primitives can be merged. */
export function prep(g: THREE.BufferGeometry, color?: THREE.Color | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.Color)) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  out.setAttribute('normal', g.getAttribute('normal'));
  if (g.index) out.setIndex(g.index);
  if (color) {
    const p = g.getAttribute('position'), nn = g.getAttribute('normal');
    const c = new Float32Array(p.count * 3);
    const v = new THREE.Vector3(), vn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      let cc: THREE.Color;
      if (typeof color === 'function') { v.fromBufferAttribute(p, i); vn.fromBufferAttribute(nn, i); cc = color(v, vn); }
      else cc = color;
      c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b;
    }
    out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return out;
}

export function srgb(hex: string | number) {
  return new THREE.Color(hex as any);
}

/** Radial gradient texture for soft glows / halos / dust puffs. */
let _glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

/** Recompute smooth normals after displacement, welding by position. */
export function smoothNormals(g: THREE.BufferGeometry) {
  g.computeVertexNormals();
  return g;
}
