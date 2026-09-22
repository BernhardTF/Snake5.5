// Procedural obstacle geometry per biome. Unit-sized (radius ~1), scaled per obstacle.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm3, merge, noise3, prep, rng, sweep } from './geo';
import type { BiomeId } from '../../types';

const C = (h: string) => new THREE.Color(h);
const lerpC = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));

export interface ObstacleGeo {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  /** Extra parts (e.g. cactus, coconut) with their own materials. */
  extra?: { geo: THREE.BufferGeometry; mat: THREE.Material }[];
}

const mats = {
  rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
  rockFlat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, flatShading: true }),
  salt: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color(0.9, 0.95, 1) }),
  coral: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
  plant: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.3 }),
};

/** Displaced blob (smooth normals). f(p, n) returns radial scale. */
function blob(detail: number, disp: (p: THREE.Vector3) => number, color: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color, scale: THREE.Vector3, floor = -0.25) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = disp(v.clone());
    v.multiplyScalar(d).multiply(scale);
    if (v.z < floor) v.z = floor + (v.z - floor) * 0.15;
    p.setXYZ(i, v.x, v.y, v.z - (floor > -1 ? floor * 0.6 : 0));
  }
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const col = new Float32Array(p.count * 3);
  const nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i);
    const c = color(v, nn);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------------ karesansui: mossy granite
function granite(seed: number, round = false): ObstacleGeo {
  const r = rng(seed);
  const sc = round ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(1, 0.78 + r() * 0.2, 0.55 + r() * 0.2);
  const o = r() * 100;
  const grey = C('#8d8983'), dark = C('#3e3b39'), light = C('#cfc9bf'), moss = C('#4f6a2e'), moss2 = C('#2c4219');
  const geo = blob(4,
    (p) => 1 + (fbm3(p.x * 1.3 + o, p.y * 1.3, p.z * 1.3, seed, 4) - 0.5) * (round ? 0.25 : 0.5) + (noise3(p.x * 6, p.y * 6, p.z * 6 + o, seed + 5) - 0.5) * 0.05,
    (p, n) => {
      const sp = noise3(p.x * 22 + o, p.y * 22, p.z * 22, seed + 9);
      let c = lerpC(grey, grey.clone().multiplyScalar(0.8), fbm3(p.x * 3, p.y * 3, p.z * 3 + o, seed + 2, 3));
      if (sp > 0.78) c = lerpC(c, dark, (sp - 0.78) * 5);
      else if (sp < 0.2) c = lerpC(c, light, (0.2 - sp) * 4);
      if (!round) {
        const mn = fbm3(p.x * 2.5 + o, p.y * 2.5, p.z * 2.5, seed + 3, 4);
        const base = Math.max(0, 1 - (p.z + 0.02) / 0.22);
        const top = Math.max(0, n.z - 0.55) * 2.2;
        const m = Math.max(base * 1.1 * (mn > 0.45 ? 1 : 0.25), top * 0.8 * (mn > 0.6 ? 1 : 0));
        c = lerpC(c, lerpC(moss, moss2, noise3(p.x * 14, p.y * 14, p.z * 14, seed) * 1.2), Math.min(1, m));
      }
      return c;
    }, sc, round ? -10 : -0.25);
  return { geo, mat: mats.rock };
}

// ------------------------------------------------------------------ erg: layered sandstone
function sandstone(seed: number, round = false): ObstacleGeo {
  const r = rng(seed);
  const o = r() * 100;
  const sc = round ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(1, 0.8 + r() * 0.2, 0.6 + r() * 0.25);
  const bands = [C('#9a3c1a'), C('#b85a2c'), C('#d88a50'), C('#7e3014'), C('#c46a38'), C('#e8a870')];
  const geo = blob(4,
    (p) => {
      const n = fbm3(p.x * 1.1 + o, p.y * 1.1, p.z * 1.1, seed, 4);
      let d = 1 + (n - 0.5) * (round ? 0.25 : 0.55);
      if (!round) d += 0.035 * Math.sin(p.z * 22 + n * 5) + 0.1 * Math.max(0, p.z) * (1 - Math.abs(p.z));
      return d;
    },
    (p) => {
      const t = p.z * 16 + fbm3(p.x * 1.5, p.y * 1.5, p.z * 0.5 + o, seed + 1, 3) * 1.6 + Math.sin(p.x * 3 + p.y * 2) * 0.3;
      const i = Math.floor(t), f = t - i;
      const a = bands[((i % 6) + 6) % 6], b = bands[(((i + 1) % 6) + 6) % 6];
      const c = lerpC(a, b, f * f);
      return c.multiplyScalar(0.85 + 0.25 * noise3(p.x * 18, p.y * 18, p.z * 18, seed + 4));
    }, sc, round ? -10 : -0.25);
  return { geo, mat: mats.rock };
}

// ------------------------------------------------------------------ lagoon: coral heads, coconuts
function brainCoral(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const o = r() * 100;
  const base = [C('#c9a86a'), C('#b89a78'), C('#a8a060')][seed % 3];
  const groove = base.clone().multiplyScalar(0.35);
  const meander = (p: THREE.Vector3) => {
    const w = fbm3(p.x * 1.6 + o, p.y * 1.6, p.z * 1.6, seed + 7, 2) * 2;
    const n = noise3(p.x * 4.2 + w, p.y * 4.2 - w, p.z * 4.2 + o, seed);
    return Math.abs(Math.sin(n * 26));
  };
  return blob(5,
    (p) => 1 + (fbm3(p.x, p.y, p.z + o, seed + 1, 3) - 0.5) * 0.25 + meander(p) * 0.1,
    (p) => {
      const m = meander(p);
      return lerpC(groove, base, Math.min(1, m * 2.2 - 0.25)).multiplyScalar(0.9 + 0.2 * noise3(p.x * 9, p.y * 9, p.z * 9, seed));
    }, new THREE.Vector3(1, 0.92, 0.62), -0.3);
}

function branchCoral(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const pal = [[C('#7a3a8a'), C('#d8a0e0')], [C('#d0501a'), C('#ffb070')], [C('#c83a5a'), C('#ffb0c0')]][seed % 3];
  const geos: THREE.BufferGeometry[] = [];
  const grow = (p: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const pts: THREE.Vector3[] = [], rr: number[] = [];
    const q = p.clone();
    const d = dir.clone();
    const n = 5;
    for (let i = 0; i <= n; i++) {
      pts.push(q.clone()); rr.push(rad * (1 - 0.35 * i / n));
      d.x += (r() - 0.5) * 0.25; d.y += (r() - 0.5) * 0.25; d.z += 0.06; d.normalize();
      q.addScaledVector(d, len / n);
    }
    const t0 = depth / 3;
    geos.push(sweep(pts, rr, 7, 1, (t) => lerpC(pal[0], pal[1], t0 + t / 3)));
    // tip cap
    const s = new THREE.SphereGeometry(rad * 0.68, 7, 5);
    s.translate(q.x, q.y, q.z);
    geos.push(prep(s, lerpC(pal[0], pal[1], t0 + 0.34)));
    if (depth < 2) {
      const k = 2 + (r() < 0.5 ? 1 : 0);
      for (let i = 0; i < k; i++) {
        const nd = d.clone().add(new THREE.Vector3((r() - 0.5) * 1.1, (r() - 0.5) * 1.1, 0.45)).normalize();
        grow(q, nd, len * 0.75, rad * 0.7, depth + 1);
      }
    }
  };
  const trunks = 6 + Math.floor(r() * 3);
  for (let i = 0; i < trunks; i++) {
    const a = (i / trunks) * Math.PI * 2 + r() * 0.5;
    const d0 = 0.1 + r() * 0.25;
    grow(new THREE.Vector3(Math.cos(a) * d0, Math.sin(a) * d0, 0), new THREE.Vector3(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.85).normalize(), 0.3 + r() * 0.12, 0.085, 0);
  }
  // rounded base mound
  const mound = new THREE.SphereGeometry(0.45, 12, 8);
  mound.scale(1, 1, 0.35);
  geos.push(prep(mound, pal[0].clone().multiplyScalar(0.7)));
  return merge(geos);
}

function coconut(seed: number, centered = false): { geo: THREE.BufferGeometry; eyes: THREE.BufferGeometry } {
  const o = seed * 0.37;
  const geo = blob(4,
    (p) => 1 + (noise3(p.x * 3 + o, p.y * 3, p.z * 3, seed) - 0.5) * 0.08,
    (p) => {
      const fib = noise3(p.x * 30, p.y * 4 + o, p.z * 30, seed + 1);
      return lerpC(C('#5a3a1e'), C('#8a6034'), fib).multiplyScalar(0.8 + 0.3 * noise3(p.x * 8, p.y * 8, p.z * 8, seed));
    }, new THREE.Vector3(0.5, 0.42, 0.4), -10);
  const eyes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const s = new THREE.SphereGeometry(0.035, 6, 4);
    s.translate(0.485, Math.cos(a) * 0.07, Math.sin(a) * 0.07);
    eyes.push(prep(s, C('#2a1a0e')));
  }
  const e = merge(eyes);
  if (!centered) { geo.translate(0, 0, 0.3); e.translate(0, 0, 0.3); }
  return { geo, eyes: e };
}

function lagoon(seed: number, big: boolean, round = false): ObstacleGeo {
  if (round) {
    const c = coconut(seed, true);
    c.geo.scale(2, 2, 2); c.eyes.scale(2, 2, 2);
    return { geo: merge([c.geo, c.eyes]), mat: mats.coral };
  }
  const kind = seed % 4;
  if (big) {
    // cluster: brain coral + branch coral
    const a = brainCoral(seed); a.scale(0.62, 0.62, 0.62); a.translate(-0.3, -0.15, 0);
    const b = branchCoral(seed + 1); b.scale(0.7, 0.7, 0.7); b.translate(0.35, 0.25, 0);
    const parts = [a, b];
    if (kind === 3) { const cn = coconut(seed); const g = merge([cn.geo, cn.eyes]); g.scale(0.7, 0.7, 0.7); g.translate(0.35, -0.45, 0); parts.push(g); }
    return { geo: merge(parts), mat: mats.coral };
  }
  if (kind === 3) { const c = coconut(seed); const g = merge([c.geo, c.eyes]); g.scale(1.6, 1.6, 1.6); return { geo: g, mat: mats.coral }; }
  if (kind === 1) { const g = branchCoral(seed); g.scale(1.5, 1.5, 1.2); return { geo: g, mat: mats.coral }; }
  return { geo: brainCoral(seed), mat: mats.coral };
}

// ------------------------------------------------------------------ svartsandur: basalt columns
function basalt(seed: number, round = false): ObstacleGeo {
  if (round) {
    const g = blob(3, (p) => 1 + (fbm3(p.x * 2, p.y * 2, p.z * 2, seed, 3) - 0.5) * 0.3,
      (p) => lerpC(C('#1c1c1e'), C('#3a3a3e'), noise3(p.x * 10, p.y * 10, p.z * 10, seed)), new THREE.Vector3(1, 1, 1), -10);
    return { geo: g, mat: mats.rockFlat };
  }
  const r = rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const hexR = 0.2;
  const cells: [number, number][] = [];
  for (let q = -3; q <= 3; q++) for (let s = -3; s <= 3; s++) {
    const x = hexR * 1.75 * (q + s * 0.5), y = hexR * 1.52 * s;
    if (Math.hypot(x, y) < 0.92) cells.push([x, y]);
  }
  for (const [x, y] of cells) {
    const d = Math.hypot(x, y);
    const h = Math.max(0.15, (1 - d * 0.6) * (0.35 + r() * 1.0));
    const g = new THREE.CylinderGeometry(hexR * 0.8, hexR * 0.97, h, 6, 1, false);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, h / 2 - 0.05);
    g.rotateZ(Math.PI / 6);
    // tilt tops slightly
    const p = g.getAttribute('position');
    const tx = (r() - 0.5) * 0.12, ty = (r() - 0.5) * 0.12;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      if (z > h / 2) p.setZ(i, z + p.getX(i) * tx + p.getY(i) * ty);
    }
    g.translate(x, y, 0);
    const ng = g.toNonIndexed();
    ng.deleteAttribute('uv');
    ng.computeVertexNormals();
    const top = C('#50535a'), side = C('#26272b'), edge = C('#34363b');
    const pn = ng.getAttribute('position'), nn = ng.getAttribute('normal');
    const col = new Float32Array(pn.count * 3);
    const sh = 0.55 + r() * 0.8;
    for (let i = 0; i < pn.count; i++) {
      const up = nn.getZ(i);
      const z = pn.getZ(i);
      let c = up > 0.8 ? top.clone() : lerpC(side, edge, noise3(pn.getX(i) * 8, pn.getY(i) * 8, z * 12, seed));
      c = c.multiplyScalar(sh * (0.7 + 0.45 * Math.min(1, z / 0.9)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(ng);
  }
  return { geo: merge(geos), mat: mats.rockFlat };
}

// ------------------------------------------------------------------ salar: salt mounds + cactus
function saltMound(seed: number, round = false): THREE.BufferGeometry {
  const r = rng(seed);
  const o = r() * 100;
  const white = C('#f6f6f2'), blue = C('#c8d4e6'), grey = C('#d8d6d0');
  return blob(4,
    (p) => {
      if (round) return 1 + (fbm3(p.x * 2 + o, p.y * 2, p.z * 2, seed, 3) - 0.5) * 0.3;
      return (1 + (fbm3(p.x * 2.2 + o, p.y * 2.2, p.z * 2.2, seed, 4) - 0.5) * 0.6 + (noise3(p.x * 9, p.y * 9, p.z * 9, seed + 1) - 0.5) * 0.12);
    },
    (p, n) => {
      const c = lerpC(white, blue, (1 - n.z) * 0.35 + (noise3(p.x * 6, p.y * 6, p.z * 6, seed) - 0.5) * 0.3);
      return lerpC(c, grey, Math.max(0, 0.15 - p.z) * 3);
    },
    round ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(1, 0.9, 0.95), round ? -10 : -0.2);
}
function pinch(g: THREE.BufferGeometry, k: number) {
  const p = g.getAttribute('position');
  let maxZ = 0;
  for (let i = 0; i < p.count; i++) maxZ = Math.max(maxZ, p.getZ(i));
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, p.getZ(i) / maxZ);
    const s = 1 - k * Math.pow(t, 1.4);
    p.setXY(i, p.getX(i) * s, p.getY(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

function cactus(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const cols = 2 + Math.floor(r() * 2);
  for (let k = 0; k < cols; k++) {
    const h = 0.5 + r() * 0.45, rad = 0.2 + r() * 0.06;
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const z = t * h;
      const rr = t < 0.8 ? rad : rad * Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 2));
      prof.push(new THREE.Vector2(Math.max(0.001, rr), z));
    }
    prof.push(new THREE.Vector2(0.0005, h + 0.001));
    let g: THREE.BufferGeometry = new THREE.LatheGeometry(prof, 36);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-4);
    const p = g.getAttribute('position');
    const col = new Float32Array(p.count * 3);
    const green = C('#4f7f3a'), dgreen = C('#2e5424'), spine = C('#f2efe0');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const rib = Math.cos(a * 11);
      const s = 1 + 0.12 * rib;
      p.setXYZ(i, x * s, y, z * s);
      let c = lerpC(dgreen, green, rib * 0.5 + 0.5);
      const areole = rib > 0.9 && Math.sin(y * 60) > 0.85;
      if (areole) c = spine.clone();
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.rotateX(Math.PI / 2);
    const a = (k / cols) * Math.PI * 2 + r();
    const d = k === 0 ? 0 : 0.34;
    g.rotateY((r() - 0.5) * 0.3);
    g.translate(Math.cos(a) * d, Math.sin(a) * d, -0.02);
    g.computeVertexNormals();
    geos.push(g);
  }
  return merge(geos);
}

function salar(seed: number, big: boolean, round = false): ObstacleGeo {
  if (round) return { geo: saltMound(seed, true), mat: mats.salt };
  const mound = pinch(saltMound(seed), 0.55);
  if (seed % 3 === 0 || big) {
    const c = cactus(seed);
    if (big) { c.scale(0.8, 0.8, 0.8); c.translate(0.45, 0.4, 0); mound.scale(0.8, 0.8, 0.8); mound.translate(-0.2, -0.15, 0); }
    else { c.scale(1.65, 1.65, 1.3); return { geo: c, mat: mats.plant, extra: [] }; }
    return { geo: mound, mat: mats.salt, extra: [{ geo: c, mat: mats.plant }] };
  }
  return { geo: mound, mat: mats.salt };
}

// ------------------------------------------------------------------ dispatcher
const cache = new Map<string, ObstacleGeo>();
export const OBSTACLE_VARIANTS = 6;

export function obstacleGeo(b: BiomeId, seed: number, big: boolean, rolling: boolean): ObstacleGeo {
  const v = ((seed % OBSTACLE_VARIANTS) + OBSTACLE_VARIANTS) % OBSTACLE_VARIANTS;
  const key = `${b}:${v}:${big ? 1 : 0}:${rolling ? 1 : 0}`;
  let g = cache.get(key);
  if (g) return g;
  const sd = v * 7919 + 13;
  switch (b) {
    case 'karesansui': g = granite(sd, rolling); break;
    case 'erg': g = sandstone(sd, rolling); break;
    case 'lagoon': g = lagoon(sd + (v % 4), big, rolling); break;
    case 'svartsandur': g = basalt(sd, rolling); break;
    default: g = salar(v * 3 + (big ? 1 : 0), big, rolling); break;
  }
  if (!rolling && b === 'karesansui' && big) {
    // pair of stones for 2x2 footprints
    const s2 = granite(sd + 3);
    s2.geo.scale(0.45, 0.45, 0.45); s2.geo.translate(0.62, -0.55, 0);
    g.geo.scale(0.85, 0.85, 0.85); g.geo.translate(-0.12, 0.1, 0);
    g = { geo: merge([g.geo, s2.geo]), mat: g.mat };
  }
  cache.set(key, g);
  return g;
}
