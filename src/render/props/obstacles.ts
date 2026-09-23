// Procedural obstacle geometry per biome. Unit-sized (radius ~1), scaled per obstacle.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { colorize, facetRock, fitUnit, fbm3, glowTexture, merge, noise3, prep, rng, setGlow, smoothstep, surface, sweep, vertexGlow } from './geo';
import type { BiomeId } from '../../types';

const C = (h: string) => new THREE.Color(h);
const lerpC = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));

export interface ObstacleGeo {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  /** Extra parts (e.g. cactus, coconut) with their own materials. */
  extra?: { geo: THREE.BufferGeometry; mat: THREE.Material; noShadow?: boolean }[];
  /** If set, static instances face this yaw (± a little jitter) instead of a random one. */
  alignYaw?: number;
  /**
   * How a moving hazard (vx/vy != 0) animates. 'roll' (default): centred ball rolling;
   * 'log': cylinder along local Y rolling about its axis, `lift` = its radius (unit space);
   * 'walk': base at z=0, faces its heading and bobs (hermit crab); 'hover': floats and spins.
   */
  motion?: 'roll' | 'log' | 'walk' | 'hover';
  lift?: number;
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

// ================================================================== expansion worlds
const xmats = {
  shell: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.35, sheenColor: new THREE.Color(1, 0.85, 0.8), side: THREE.DoubleSide }),
  leaf: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.48, clearcoat: 0.45, clearcoatRoughness: 0.35, side: THREE.DoubleSide }),
  wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
  reef: vertexGlow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 2.4 }), 'reef'),
  sulphur: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }),
  brine: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, metalness: 0 }),
  ice: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.8, 0.9, 1) }),
  crystal: vertexGlow(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, flatShading: true, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.5 }), 'crystal'),
  fungus: vertexGlow(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new THREE.Color(0.8, 1, 1), emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 2.2 }), 'fungus'),
  hoverGlow: new THREE.MeshBasicMaterial({ color: 0x9a7aff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
};

/** Strip to position/normal/color (+aGlow = k) for merging into a vertexGlow material. */
const glowPrep = (g: THREE.BufferGeometry, c: THREE.Color | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.Color), glow: number | ((p: THREE.Vector3) => number) = 0) =>
  setGlow(prep(g, c), glow);

function lathe(prof: [number, number][], seg: number) {
  let g: THREE.BufferGeometry = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(Math.max(0.0005, r), z)), seg);
  g.deleteAttribute('uv');
  g.rotateX(Math.PI / 2); // lathe Y axis -> +Z
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ pinksands: queen conch, sea grape
/** Queen conch lying on its side: knobbed tan spire, flared glossy pink lip. Front (canal) at -x. */
function queenConch(seed: number, lipScale = 1): THREE.BufferGeometry {
  const r = rng(seed);
  const knobN = 7 + Math.floor(r() * 3);
  const ph = r() * 6.28;
  const rad = (u: number) => {
    const body = u < 0.5 ? 0.1 + 0.33 * Math.sin((u / 0.5) * Math.PI / 2) : 0.43 * Math.pow(1 - (u - 0.5) / 0.5, 1.05);
    const whorl = u > 0.55 ? 1 + 0.07 * Math.abs(Math.sin((u - 0.55) * 34)) : 1;
    return Math.max(0.004, body * whorl);
  };
  const tan = C('#dcb88a'), band = C('#9c6436'), cream = C('#f6ead2'), pinkU = C('#f2a08e');
  const body = surface(44, 26, (u, v, o) => {
    const phi = v * Math.PI * 2;
    const s = Math.sin(phi), c = Math.cos(phi);
    let rr = rad(u);
    const knobMask = smoothstep(0.38, 0.5, u) * (1 - smoothstep(0.8, 0.95, u));
    const knob = Math.pow(Math.max(0, Math.cos(phi * 2.0 - 0.9)), 2) * Math.pow(Math.max(0, Math.cos(u * knobN * 6.28 * 0.9 + ph)), 5);
    rr *= 1 + 0.55 * knob * knobMask;
    o.set(-0.95 + 1.9 * u, c * rr, Math.max(-0.2, s * rr * 0.86));
  });
  colorize(body, (p, n) => {
    const u = (p.x + 0.95) / 1.9;
    const zig = Math.sin(u * 44 + Math.sin(Math.atan2(p.z, p.y) * 5) * 1.6 + ph);
    let c = lerpC(tan, band, smoothstep(0.55, 0.95, zig) * 0.85);
    c = lerpC(c, cream, smoothstep(0.34, 0.6, Math.hypot(p.y, p.z) / (rad(u) + 1e-3) - 0.8) + smoothstep(0.1, 0.5, n.z) * 0.15);
    if (p.z < -0.05) c = lerpC(c, pinkU, 0.6);
    return c.multiplyScalar(0.9 + 0.2 * noise3(p.x * 14, p.y * 14, p.z * 14, seed));
  });
  // flared lip on +y, rising towards the spire
  const pinkD = C('#e4586e'), salmon = C('#f7937e'), peach = C('#ffd7b0'), yell = C('#f8c46a');
  const lip = surface(28, 10, (u, w, o) => {
    const ux = 0.08 + 0.62 * u;
    const W = (0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.6) + 0.04) * lipScale;
    const y0 = rad(ux) * 0.92;
    let z = W * (0.62 * w - 0.34 * w * w) + 0.03 + 0.2 * Math.pow(u, 3) * w;
    z -= 0.05 * smoothstep(0.85, 1, w);
    o.set(-0.95 + 1.9 * ux + 0.12 * w * u, y0 + w * W, z);
  });
  colorize(lip, (p) => {
    const w = Math.min(1, Math.max(0, (p.y - 0.1) / 0.62));
    let c = lerpC(yell, pinkD, smoothstep(0.0, 0.3, w));
    c = lerpC(c, salmon, smoothstep(0.35, 0.7, w));
    c = lerpC(c, peach, smoothstep(0.75, 1, w));
    return c.multiplyScalar(0.94 + 0.12 * noise3(p.x * 9, p.y * 9, 1, seed + 2));
  });
  const g = merge([prep(body, undefined), prep(lip, undefined)].map((x, i) => { x.setAttribute('color', (i ? lip : body).getAttribute('color')); return x; }));
  g.translate(0, 0, 0.2);
  return g;
}

/** One round sea-grape leaf (radius R), notch at the stem (-x), red veins, cupped. */
function grapeLeaf(R: number, seed: number, tone: THREE.Color) {
  const r = rng(seed);
  const ph = r() * 6;
  const g = surface(6, 22, (u, v, o) => {
    const a = v * Math.PI * 2;
    const notch = 1 - 0.3 * Math.exp(-(((a - Math.PI) / 0.32) ** 2));
    const rr = R * u * notch * (1 + 0.04 * Math.sin(a * 5 + ph));
    o.set(Math.cos(a) * rr, Math.sin(a) * rr, 0.28 * R * u * u + 0.03 * R * Math.sin(a * 6 + ph) * u);
  }, true);
  const vein = C('#b8323a'), edge = tone.clone().lerp(C('#c8c85a'), 0.3), dark = tone.clone().multiplyScalar(0.62);
  colorize(g, (p) => {
    const rr = Math.hypot(p.x, p.y) / R, a = Math.atan2(p.y, p.x);
    let c = lerpC(dark, tone, smoothstep(0.0, 0.5, rr));
    c = lerpC(c, edge, smoothstep(0.8, 1, rr));
    const mid = Math.exp(-((p.y / (R * 0.045)) ** 2)) * (p.x > -R * 0.6 ? 1 : 0);
    const lat = smoothstep(0.93, 1, Math.cos(a * 7)) * smoothstep(0.15, 0.35, rr) * (1 - smoothstep(0.8, 0.95, rr));
    return lerpC(c, vein, Math.max(mid * 0.85, lat * 0.55));
  });
  return g;
}

function seaGrape(seed: number, grapes: boolean, size = 1): THREE.BufferGeometry {
  const r = rng(seed);
  const tones = [C('#5a9c3a'), C('#3f8032'), C('#6aa844'), C('#4c8e36')];
  const geos: THREE.BufferGeometry[] = [];
  const n = 9 + Math.floor(r() * 4);
  const stemC = C('#8a3a28');
  for (let i = 0; i < n; i++) {
    const inner = i < 3;
    const a = (i / n) * Math.PI * 2 * 2.4 + r() * 0.4;
    const d = inner ? 0.12 + r() * 0.12 : 0.4 + r() * 0.2;
    const R = (inner ? 0.3 : 0.36 + r() * 0.08) * size;
    const tone = r() < 0.12 ? C('#c8542e') : r() < 0.12 ? C('#b8b040') : tones[Math.floor(r() * 4)];
    const lf = grapeLeaf(R, seed + i * 13, tone);
    lf.translate(R * 0.85, 0, 0);
    lf.rotateY(-(inner ? 0.15 : 0.35 + r() * 0.3));
    lf.rotateZ(a);
    const z = (inner ? 0.55 : 0.22 + r() * 0.18) * size;
    lf.translate(Math.cos(a) * d * size, Math.sin(a) * d * size, z);
    geos.push(prep(lf, undefined)); geos[geos.length - 1].setAttribute('color', lf.getAttribute('color'));
    const tip = new THREE.Vector3(Math.cos(a) * d * size, Math.sin(a) * d * size, z);
    geos.push(sweep([new THREE.Vector3(0, 0, 0), new THREE.Vector3(tip.x * 0.4, tip.y * 0.4, z * 0.8), tip], [0.035, 0.028, 0.02], 5, 1, () => stemC));
  }
  if (grapes) {
    const a0 = r() * 6.28;
    for (let k = 0; k < 14; k++) {
      const s = new THREE.SphereGeometry(0.06 + r() * 0.015, 8, 6);
      const t = k / 14;
      s.translate(Math.cos(a0) * (0.35 + t * 0.35) + (r() - 0.5) * 0.12, Math.sin(a0) * (0.35 + t * 0.35) + (r() - 0.5) * 0.12, 0.62 - t * 0.2);
      geos.push(prep(s, lerpC(C('#6a2a6a'), C('#8aa040'), r() * 0.5 + t * 0.4)));
    }
  }
  return merge(geos);
}

function hermitConch(seed: number): ObstacleGeo {
  const shell = queenConch(seed, 0.7);
  shell.rotateZ(Math.PI); // canal (front) to +x
  fitUnit([shell], 0.95);
  const legs: THREE.BufferGeometry[] = [];
  const red = C('#d8452c'), tip = C('#5a1a10');
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const y0 = s * (0.12 + k * 0.1);
      legs.push(sweep([new THREE.Vector3(0.7, y0, 0.12), new THREE.Vector3(0.88, y0 + s * 0.25, 0.2), new THREE.Vector3(0.95, y0 + s * 0.42, 0.02)], [0.05, 0.04, 0.02], 5, 1, (t) => lerpC(red, tip, t * t)));
    }
    const claw = new THREE.SphereGeometry(0.12, 10, 8);
    claw.scale(1.3, 0.8, 0.6); claw.translate(0.98, s * 0.12, 0.12);
    legs.push(prep(claw, (p) => lerpC(C('#e8653a'), tip, smoothstep(1.05, 1.13, p.x))));
  }
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.035, 6, 4); e.translate(0.9, s * 0.05, 0.3);
    legs.push(prep(e, C('#1a1010')));
  }
  return { geo: shell, mat: xmats.shell, extra: [{ geo: merge(legs), mat: mats.plant }], motion: 'walk' };
}

function pinksands(seed: number, v: number, big: boolean, rolling: boolean): ObstacleGeo {
  if (rolling) return hermitConch(seed);
  if (big) {
    const bush = seaGrape(seed, true, 1.25);
    bush.translate(0.25, 0.2, 0);
    const conch = queenConch(seed + 1);
    conch.rotateZ(0.4); conch.scale(0.8, 0.8, 0.8); conch.translate(-0.55, -0.6, 0);
    fitUnit([bush, conch], 1);
    return { geo: conch, mat: xmats.shell, extra: [{ geo: bush, mat: xmats.leaf }] };
  }
  if (v === 1 || v === 4) { const g = seaGrape(seed, false); fitUnit([g]); return { geo: g, mat: xmats.leaf }; }
  if (v === 5) { const g = seaGrape(seed, true); fitUnit([g]); return { geo: g, mat: xmats.leaf }; }
  if (v === 2) {
    const conch = queenConch(seed);
    const tuft = seaGrape(seed + 3, false, 0.55); tuft.translate(0.55, -0.55, 0);
    fitUnit([conch, tuft]);
    return { geo: conch, mat: xmats.shell, extra: [{ geo: tuft, mat: xmats.leaf }] };
  }
  const g = queenConch(seed);
  fitUnit([g], 1);
  return { geo: g, mat: xmats.shell };
}

// ------------------------------------------------------------------ vaadhoo: driftwood, dark coral rock
function woodColor(seed: number) {
  const pale = C('#cfc7b6'), grey = C('#978f82'), crack = C('#3a3129'), warm = C('#b8a58a');
  return (t: number, a: number) => {
    const grain = noise3(t * 26, a * 9, 0, seed);
    let c = lerpC(grey, pale, grain * 0.9 + 0.15);
    c = lerpC(c, warm, noise3(t * 4, a * 3, 3, seed + 1) * 0.35);
    const cr = Math.pow(Math.max(0, Math.cos(2 * Math.PI * (a * 5 + 0.5 * noise3(t * 5, 0, 0, seed + 2)))), 60);
    return lerpC(c, crack, cr * 0.9);
  };
}
function branchSweep(p0: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, seed: number, geos: THREE.BufferGeometry[], droop = 0) {
  const r = rng(seed);
  const pts: THREE.Vector3[] = [], rr: number[] = [];
  const q = p0.clone(), d = dir.clone().normalize();
  const n = 6;
  for (let i = 0; i <= n; i++) {
    pts.push(q.clone()); rr.push(r0 * (1 - 0.85 * Math.pow(i / n, 1.3)) + 0.004);
    d.x += (r() - 0.5) * 0.3; d.y += (r() - 0.5) * 0.3; d.z -= droop; d.normalize();
    q.addScaledVector(d, len / n);
  }
  geos.push(sweep(pts, rr, 7, 1, woodColor(seed)));
  const cap = new THREE.SphereGeometry(rr[n] * 1.1, 5, 4); cap.translate(q.x, q.y, q.z);
  geos.push(prep(cap, C('#b8b0a0')));
}
/** Bleached driftwood log. kind 0 straight+stubs, 1 root ball, 2 forked. Along x, on the sand. */
function driftwood(seed: number, kind: number): THREE.BufferGeometry {
  const r = rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const R = 0.2 + r() * 0.05, bend = (r() - 0.5) * 0.4;
  const pts: THREE.Vector3[] = [], rr: number[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const rad = R * (1 + 0.18 * (noise3(t * 6, 0, 0, seed) - 0.5) * 2) * (0.78 + 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.1)));
    pts.push(new THREE.Vector3(-1 + 2 * t, bend * Math.sin(Math.PI * t), rad * 0.92));
    rr.push(rad);
  }
  geos.push(sweep(pts, rr, 12, 1, woodColor(seed)));
  for (const [i, s] of [[0, -1], [n, 1]] as const) {
    const cap = new THREE.SphereGeometry(rr[i], 10, 6);
    cap.scale(0.55, 1, 1); cap.translate(pts[i].x, pts[i].y, pts[i].z);
    geos.push(prep(cap, (p) => lerpC(C('#e0d8c6'), C('#8a7a66'), noise3(p.y * 30, p.z * 30, s, seed) * 0.8)));
  }
  if (kind === 1) {
    const e = pts[0];
    for (let k = 0; k < 7; k++) {
      const a = Math.PI + (k / 6 - 0.5) * 2.6 + (r() - 0.5) * 0.3;
      branchSweep(e.clone().add(new THREE.Vector3(0.05, 0, 0)), new THREE.Vector3(Math.cos(a), Math.sin(a), 0.25 + r() * 0.5), 0.3 + r() * 0.3, R * 0.45, seed + k * 7, geos, 0.12);
    }
  } else if (kind === 2) {
    const m = pts[Math.floor(n * 0.45)];
    const s = r() < 0.5 ? -1 : 1;
    branchSweep(m, new THREE.Vector3(0.75, s * 0.65, 0.05), 1.0, R * 0.72, seed + 3, geos, 0.02);
    branchSweep(pts[Math.floor(n * 0.75)], new THREE.Vector3(0.4, -s * 0.9, 0.3), 0.35, R * 0.4, seed + 5, geos, 0.1);
  } else {
    for (let k = 0; k < 2; k++) {
      const m = pts[3 + Math.floor(r() * (n - 6))];
      const s = r() < 0.5 ? -1 : 1;
      branchSweep(m.clone().add(new THREE.Vector3(0, 0, R * 0.3)), new THREE.Vector3((r() - 0.5) * 0.8, s, 0.35), 0.22 + r() * 0.15, R * 0.4, seed + 9 + k, geos, 0.05);
    }
  }
  return merge(geos);
}
/** Rolling driftwood: straight log centred on its axis, along local Y. */
function driftLog(seed: number): ObstacleGeo {
  const geos: THREE.BufferGeometry[] = [];
  const R = 0.42, n = 12;
  const pts: THREE.Vector3[] = [], rr: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3(0, -1.15 + 2.3 * t, 0));
    rr.push(R * (0.9 + 0.1 * Math.sin(Math.PI * t)) * (1 + 0.12 * (noise3(t * 5, 1, 0, seed) - 0.5)));
  }
  geos.push(sweep(pts, rr, 12, 1, woodColor(seed)));
  for (const i of [0, n]) {
    const cap = new THREE.SphereGeometry(rr[i], 10, 6); cap.scale(1, 0.4, 1); cap.translate(0, pts[i].y, 0);
    geos.push(prep(cap, (p) => { const ring = Math.sin(Math.hypot(p.x, p.z) * 60) * 0.5 + 0.5; return lerpC(C('#e6dcc8'), C('#a8927a'), ring * 0.6); }));
  }
  branchSweep(new THREE.Vector3(0, 0.3, R * 0.8), new THREE.Vector3(0.2, 0.3, 1), 0.3, 0.12, seed + 4, geos);
  branchSweep(new THREE.Vector3(0, -0.5, -R * 0.8), new THREE.Vector3(-0.2, -0.2, -1), 0.25, 0.1, seed + 6, geos);
  return { geo: merge(geos), mat: xmats.wood, motion: 'log', lift: R };
}
function coralRock(seed: number, scale = new THREE.Vector3(1, 0.86, 0.62)): THREE.BufferGeometry {
  const r = rng(seed);
  const o = r() * 100;
  const pit = (p: THREE.Vector3) => smoothstep(0.62, 0.78, noise3(p.x * 7 + o, p.y * 7, p.z * 7, seed + 3));
  const g = blob(4,
    (p) => 1 + (fbm3(p.x * 1.4 + o, p.y * 1.4, p.z * 1.4, seed, 4) - 0.5) * 0.55 - pit(p) * 0.09 + (noise3(p.x * 13, p.y * 13, p.z * 13, seed + 1) - 0.5) * 0.06,
    (p, n) => {
      const base = C('#262a31'), top = C('#565e68'), hole = C('#0d0f13'), crust = C('#a8a69a');
      let c = lerpC(base, top, smoothstep(0.1, 0.95, n.z) * 0.8 + fbm3(p.x * 3, p.y * 3, p.z * 3 + o, seed + 5, 3) * 0.3 - 0.15);
      const cr = noise3(p.x * 9 + o, p.y * 9, p.z * 9, seed + 7);
      if (cr > 0.72) c = lerpC(c, crust, (cr - 0.72) * 3.2);
      return lerpC(c, hole, pit(p) * 0.9);
    }, scale, -0.25);
  // bioluminescent specks nestle in the pits
  const glow = C('#3ad8ff');
  const col = g.getAttribute('color');
  const p = g.getAttribute('position');
  const a = new Float32Array(p.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const sp = noise3(v.x * 16 + o, v.y * 16, v.z * 16, seed + 11);
    if (sp > 0.8 && v.z > 0.05) { a[i] = (sp - 0.8) * 5 * 0.5; col.setXYZ(i, glow.r, glow.g, glow.b); }
  }
  g.setAttribute('aGlow', new THREE.BufferAttribute(a, 1));
  return g;
}
function vaadhoo(seed: number, v: number, big: boolean, rolling: boolean): ObstacleGeo {
  if (rolling) return driftLog(seed);
  if (big) {
    const r1 = coralRock(seed); r1.scale(0.7, 0.7, 0.8); r1.translate(-0.35, 0.3, 0);
    const r2 = coralRock(seed + 1); r2.scale(0.5, 0.5, 0.6); r2.translate(0.55, -0.45, 0);
    const rock = merge([r1, r2]);
    const wood = driftwood(seed + 2, 1); wood.rotateZ(-0.6); wood.scale(0.95, 0.95, 0.95); wood.translate(0.1, 0.05, 0.15);
    fitUnit([rock, wood], 1);
    return { geo: rock, mat: xmats.reef, extra: [{ geo: wood, mat: xmats.wood }] };
  }
  if (v === 0 || v === 3 || v === 5) {
    const g = driftwood(seed, v === 0 ? 0 : v === 3 ? 1 : 2);
    fitUnit([g], 1);
    return { geo: g, mat: xmats.wood };
  }
  const g = coralRock(seed);
  if (v === 4) {
    const s = coralRock(seed + 5); s.scale(0.42, 0.42, 0.5); s.translate(0.72, -0.55, 0);
    const m = merge([g, s]); fitUnit([m]); return { geo: m, mat: xmats.reef };
  }
  fitUnit([g], 1);
  return { geo: g, mat: xmats.reef };
}

// ------------------------------------------------------------------ dallol: sulphur chimneys, salt pillars
function chimney(seed: number, h: number, r0: number, geos: THREE.BufferGeometry[], pools: THREE.BufferGeometry[]) {
  const o = rng(seed)() * 50;
  const prof: [number, number][] = [
    [r0 * 1.3, 0], [r0 * 1.12, 0.07 * h], [r0 * 0.9, 0.3 * h], [r0 * 0.74, 0.62 * h], [r0 * 0.64, 0.88 * h],
    [r0 * 0.7, 0.97 * h], [r0 * 0.66, 1.02 * h], [r0 * 0.52, 1.03 * h], [r0 * 0.44, 0.96 * h], [r0 * 0.4, 0.9 * h],
  ];
  const g = lathe(prof, 28);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + (fbm3(v.x * 5 + o, v.y * 5, v.z * 4, seed, 3) - 0.5) * 0.35 + 0.05 * Math.sin(v.z * 40 / h + o);
    p.setXYZ(i, v.x * k, v.y * k, v.z);
  }
  g.computeVertexNormals();
  const brown = C('#8e4a14'), ochre = C('#c8781e'), acid = C('#e9d21c'), pale = C('#f2f0b4'), green = C('#a8dc5a'), inner = C('#1a8a6a');
  colorize(g, (q) => {
    const t = q.z / h;
    const rr = Math.hypot(q.x, q.y) / r0;
    const n = fbm3(q.x * 6 + o, q.y * 6, q.z * 6, seed + 2, 3);
    let c = lerpC(brown, ochre, smoothstep(0.0, 0.25, t + (n - 0.5) * 0.3));
    c = lerpC(c, acid, smoothstep(0.2, 0.55, t + (n - 0.5) * 0.35));
    c = lerpC(c, pale, smoothstep(0.75, 0.95, t + (n - 0.5) * 0.2));
    if (t > 0.9) c = lerpC(c, green, smoothstep(0.62, 0.5, rr) * 0.9);
    if (rr < 0.5 && t > 0.88) c = lerpC(c, inner, smoothstep(0.5, 0.42, rr));
    return c;
  });
  geos.push(g);
  const pool = new THREE.CircleGeometry(r0 * 0.46, 16);
  pool.translate(0, 0, 0.92 * h);
  pools.push(prep(pool, (q) => lerpC(C('#5ef0c8'), C('#0e9a78'), Math.hypot(q.x, q.y) / (r0 * 0.46))));
}
function saltPillar(seed: number, h: number, r0: number): THREE.BufferGeometry {
  const r = rng(seed);
  const o = r() * 50;
  const prof: [number, number][] = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let rr = r0 * (1.15 - 0.3 * t) * (1 + 0.12 * Math.sin(t * 17 + o) + 0.06 * Math.sin(t * 41 + o * 2));
    if (t > 0.86) rr *= Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.14) ** 2)) * 0.9 + 0.1;
    prof.push([rr, t * h]);
  }
  prof.push([0.001, h * 1.0]);
  const g = lathe(prof, 22);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + (noise3(v.x * 7 + o, v.y * 7, v.z * 3, seed) - 0.5) * 0.28;
    p.setXYZ(i, v.x * k, v.y * k, v.z);
  }
  g.computeVertexNormals();
  const white = C('#f7f5ee'), cream = C('#e6dab8'), rust = C('#c4702e'), green = C('#c6de98');
  colorize(g, (q, n) => {
    const t = q.z / h;
    const band = Math.sin(t * 26 + noise3(q.x * 3, q.y * 3, 0, seed) * 3 + o);
    let c = lerpC(white, cream, smoothstep(0.2, 0.8, band));
    c = lerpC(c, rust, smoothstep(0.86, 0.98, band) * (1 - smoothstep(0.8, 0.95, t)) * 0.9);
    c = lerpC(c, green, (1 - smoothstep(0.0, 0.18, t)) * 0.7);
    return lerpC(c, white, smoothstep(0.6, 0.95, n.z));
  });
  return g;
}
function dallol(seed: number, v: number, big: boolean, rolling: boolean): ObstacleGeo {
  const r = rng(seed);
  if (rolling) {
    const g = blob(3, (p) => 1 + (fbm3(p.x * 2, p.y * 2, p.z * 2, seed, 3) - 0.5) * 0.35,
      (p) => {
        const s = fbm3(p.x * 2.5, p.y * 2.5, p.z * 2.5, seed + 1, 3);
        return lerpC(C('#f6f4ea'), C('#e8d020'), smoothstep(0.52, 0.66, s)).multiplyScalar(0.9 + 0.2 * noise3(p.x * 12, p.y * 12, p.z * 12, seed));
      }, new THREE.Vector3(1, 1, 1), -10);
    return { geo: g, mat: mats.salt };
  }
  const geos: THREE.BufferGeometry[] = [], pools: THREE.BufferGeometry[] = [];
  const kindPillar = !big && (v === 1 || v === 4);
  if (kindPillar) {
    const ps: THREE.BufferGeometry[] = [];
    const n = 2 + (v === 4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r();
      const d = k === 0 ? 0.05 : 0.5;
      const pl = saltPillar(seed + k, k === 0 ? 1.45 : 0.8 + r() * 0.3, k === 0 ? 0.45 : 0.3);
      pl.translate(Math.cos(a) * d, Math.sin(a) * d, 0);
      ps.push(pl);
    }
    const g = merge(ps); fitUnit([g]);
    return { geo: g, mat: mats.salt };
  }
  const main = big ? 0.7 : 0.62;
  chimney(seed, big ? 1.3 : 1.05, main, geos, pools);
  const n = big ? 4 : v === 2 ? 2 : v === 5 ? 0 : 1;
  for (let k = 0; k < n; k++) {
    const a = (k / Math.max(1, n)) * Math.PI * 2 + r() * 1.2;
    const d = big ? 0.95 + r() * 0.2 : 0.72;
    const sub: THREE.BufferGeometry[] = [];
    chimney(seed + 11 + k, 0.45 + r() * 0.3, 0.26 + r() * 0.06, sub, pools);
    sub[0].translate(Math.cos(a) * d, Math.sin(a) * d, 0);
    pools[pools.length - 1].translate(Math.cos(a) * d, Math.sin(a) * d, 0);
    geos.push(sub[0]);
  }
  let pillar: THREE.BufferGeometry | null = null;
  if (big) { pillar = saltPillar(seed + 7, 1.6, 0.36); pillar.translate(-0.9, 0.75, 0); }
  const main0 = merge(pillar ? [...geos] : geos);
  const pl = merge(pools);
  const fit = [main0, pl]; if (pillar) fit.push(pillar);
  fitUnit(fit, 1);
  const extra = [{ geo: pl, mat: xmats.brine }];
  if (pillar) extra.push({ geo: pillar, mat: mats.salt });
  return { geo: main0, mat: xmats.sulphur, extra };
}

// ------------------------------------------------------------------ luna: ejecta boulders
function moonRockColor(seed: number) {
  const base = C('#8a8883'), light = C('#b6b3ac'), dark = C('#55534f');
  return (g: THREE.BufferGeometry) => {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const col = new Float32Array(p.count * 3);
    const r = rng(seed + 3);
    for (let i = 0; i < p.count; i += 3) {
      const tint = 0.82 + r() * 0.3;
      for (let k = 0; k < 3; k++) {
        const j = i + k;
        const x = p.getX(j), y = p.getY(j), z = p.getZ(j), nz = n.getZ(j);
        let c = lerpC(base, light, smoothstep(0.1, 0.9, nz) * 0.6 + (noise3(x * 4, y * 4, z * 4, seed) - 0.5) * 0.5);
        c = lerpC(c, dark, (1 - smoothstep(0.0, 0.18, z)) * 0.5);
        if (noise3(x * 22, y * 22, z * 22, seed + 5) > 0.8) c = lerpC(c, dark, 0.6);
        c.multiplyScalar(tint);
        col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
}
function boulder(seed: number, s: THREE.Vector3, detail = 1, cuts = 8, jag = 0.35, floor: number | null = -0.22) {
  const g = facetRock(seed, { detail, cuts, jag, scale: s, floor });
  return prep(moonRockColor(seed)(g), undefined);
}
function recolor(g: THREE.BufferGeometry, src: THREE.BufferGeometry) { g.setAttribute('color', src.getAttribute('color')); return g; }
function luna(seed: number, v: number, big: boolean, rolling: boolean): ObstacleGeo {
  const r = rng(seed);
  if (rolling) {
    const g0 = facetRock(seed, { detail: 2, cuts: 6, jag: 0.12, floor: null });
    return { geo: recolor(prep(g0), moonRockColor(seed)(g0)), mat: mats.rockFlat };
  }
  const parts: THREE.BufferGeometry[] = [];
  const add = (sd: number, sc: THREE.Vector3, x: number, y: number, rot: number, detail = 1) => {
    const g0 = facetRock(sd, { detail, cuts: 8, jag: 0.35, scale: sc, floor: -0.22 });
    moonRockColor(sd)(g0);
    const g = recolor(prep(g0), g0);
    g.rotateZ(rot); g.translate(x, y, 0);
    parts.push(g);
  };
  if (big) {
    // small crater with a raised rim, boulders thrown on it
    const prof: [number, number][] = [[0.001, 0.015], [0.4, 0.02], [0.62, 0.1], [0.8, 0.22], [0.9, 0.2], [1.02, 0.08], [1.18, 0.0]];
    const rim = lathe(prof, 40);
    const p = rim.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getY(i), p.getX(i));
      const z = p.getZ(i);
      p.setZ(i, z * (1 + 0.35 * (noise3(Math.cos(a) * 2, Math.sin(a) * 2, 0, seed) - 0.5) * 2));
    }
    rim.computeVertexNormals();
    colorize(rim, (q) => {
      const rr = Math.hypot(q.x, q.y);
      let c = lerpC(C('#5f5d59'), C('#a8a6a0'), smoothstep(0.35, 0.85, rr));
      c = lerpC(c, C('#7a7874'), smoothstep(0.9, 1.15, rr));
      return c.multiplyScalar(0.9 + 0.2 * noise3(q.x * 12, q.y * 12, 0, seed));
    });
    parts.push(prep(rim, undefined)); recolor(parts[0], rim);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + r() * 0.8;
      const s = 0.26 + r() * 0.16;
      add(seed + k * 5, new THREE.Vector3(s, s * (0.8 + r() * 0.3), s * 0.9), Math.cos(a) * 0.86, Math.sin(a) * 0.86, r() * 6);
    }
    add(seed + 40, new THREE.Vector3(0.18, 0.15, 0.16), 0.1, -0.1, 1);
    const g = merge(parts); fitUnit([g]);
    return { geo: g, mat: mats.rockFlat };
  }
  const el = v % 3 === 1;
  add(seed, new THREE.Vector3(1, el ? 0.62 : 0.86, el ? 0.62 : 0.78), 0, 0, 0);
  const peb = 2 + (v % 3);
  for (let k = 0; k < peb; k++) {
    const a = r() * 6.28, s = 0.14 + r() * 0.14;
    add(seed + 17 + k, new THREE.Vector3(s, s * 0.9, s * 0.7), Math.cos(a) * 0.95, Math.sin(a) * 0.95, r() * 6, 0);
  }
  const g = merge(parts); fitUnit([g]);
  return { geo: g, mat: mats.rockFlat };
}

// ------------------------------------------------------------------ mars: ventifacts, mesa chunks
const MARS_WIND = 0.55; // radians: the prevailing wind all ventifacts are carved along
function ventifact(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const o = r() * 100;
  const cutN = new THREE.Vector3(-0.85, (r() - 0.5) * 0.5, 0.55).normalize();
  const cutN2 = new THREE.Vector3(-0.5, (r() < 0.5 ? -1 : 1) * 0.7, 0.45).normalize();
  const flute = (p: THREE.Vector3) => Math.sin(p.y * 17 + p.z * 5 + 1.6 * noise3(p.x * 2 + o, 0, 0, seed));
  const g = blob(4,
    (p) => {
      let d = 1 + (fbm3(p.x * 1.3 + o, p.y * 1.3, p.z * 1.3, seed, 4) - 0.5) * 0.4;
      d += 0.055 * flute(p) * smoothstep(-0.1, 0.3, p.z);
      // keel: pinch the upper flanks into a ridge along the wind
      d *= 1 - 0.18 * smoothstep(0.2, 0.9, p.z) * Math.abs(p.y);
      return d;
    },
    (p, n) => {
      const bas = C('#3d3634'), dark = C('#1f1b1a'), rust = C('#b4552a'), dust = C('#d08452');
      const f = flute(p);
      let c = lerpC(bas, dark, smoothstep(0.2, -0.9, f) * 0.8);
      c.multiplyScalar(0.85 + 0.3 * noise3(p.x * 10, p.y * 10, p.z * 10, seed));
      // rust dust in troughs + banked on the lee (+x), dusting on flat tops
      const lee = smoothstep(0.1, 0.8, p.x) * (1 - smoothstep(0.0, 0.35, p.z));
      c = lerpC(c, rust, Math.max(smoothstep(-0.3, -0.95, f) * 0.55, lee * 0.8, (1 - smoothstep(0.0, 0.12, p.z)) * 0.7));
      c = lerpC(c, dust, smoothstep(0.8, 0.98, n.z) * smoothstep(0.55, 0.75, fbm3(p.x * 3 + o, p.y * 3, 0, seed + 4, 3)));
      return c;
    }, new THREE.Vector3(1.15, 0.72, 0.64), -0.25);
  // wind-planed facets on the windward (-x) side
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (const [n, d] of [[cutN, 0.42], [cutN2, 0.48]] as const) {
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = v.dot(n) - d;
      if (k > 0) { v.addScaledVector(n, -k); p.setXYZ(i, v.x, v.y, v.z); }
    }
  }
  g.computeVertexNormals();
  return g;
}
function mesa(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const cols = [C('#8e3c1e'), C('#c07040'), C('#5a3426'), C('#d49a66'), C('#a4502a')];
  const geos: THREE.BufferGeometry[] = [];
  let z = 0;
  const L = 4;
  const o = r() * 10;
  for (let l = 0; l < L; l++) {
    const R = 1 - l * 0.2 - r() * 0.05, th = 0.16 + r() * 0.08;
    const s = new THREE.Shape();
    const N = 14;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rr = R * (0.82 + 0.3 * noise3(Math.cos(a) * 1.5 + o, Math.sin(a) * 1.5, l, seed));
      const x = Math.cos(a) * rr * 1.12, y = Math.sin(a) * rr * 0.85;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    const eg = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.035, bevelSegments: 1 });
    eg.deleteAttribute('uv');
    eg.translate(0.1 * l * (r() - 0.5), 0.1 * l * (r() - 0.5), z + 0.03);
    const ng = eg.index ? eg.toNonIndexed() : eg;
    ng.deleteAttribute('normal'); ng.computeVertexNormals();
    const base = cols[(l + seed) % cols.length];
    colorize(ng, (p, n) => {
      let c = base.clone().multiplyScalar(0.85 + 0.3 * noise3(p.x * 8, p.y * 8, p.z * 20, seed + l));
      if (n.z > 0.7) c = lerpC(c, C('#d88a58'), 0.55);
      return c.multiplyScalar(0.8 + 0.25 * smoothstep(0, 1, p.z));
    });
    geos.push(ng);
    z += th + 0.03;
  }
  return merge(geos);
}
function mars(seed: number, v: number, big: boolean, rolling: boolean): ObstacleGeo {
  if (rolling) {
    const g = blob(3, (p) => 1 + (fbm3(p.x * 2, p.y * 2, p.z * 2, seed, 3) - 0.5) * 0.3 + 0.03 * Math.sin(p.y * 14),
      (p) => lerpC(C('#3a3230'), C('#b05228'), smoothstep(0.45, 0.65, fbm3(p.x * 2.5, p.y * 2.5, p.z * 2.5, seed + 1, 3))), new THREE.Vector3(1, 1, 1), -10);
    return { geo: g, mat: mats.rock };
  }
  if (big || v === 5) {
    const m = mesa(seed);
    if (big) {
      const vf = ventifact(seed + 1); vf.scale(0.5, 0.5, 0.55); vf.translate(0.95, -0.7, 0);
      fitUnit([m, vf]);
      return { geo: m, mat: mats.rockFlat, extra: [{ geo: vf, mat: mats.rock }], alignYaw: MARS_WIND };
    }
    fitUnit([m]);
    return { geo: m, mat: mats.rockFlat, alignYaw: MARS_WIND };
  }
  const g = ventifact(seed);
  if (v === 2) {
    const s = ventifact(seed + 3); s.scale(0.42, 0.42, 0.45); s.translate(0.95, 0.6, 0);
    const m = merge([g, s]); fitUnit([m]); return { geo: m, mat: mats.rock, alignYaw: MARS_WIND };
  }
  fitUnit([g]);
  return { geo: g, mat: mats.rock, alignYaw: MARS_WIND };
}

// ------------------------------------------------------------------ titan: water-ice cobbles
function cobble(seed: number, s: number, x: number, y: number, round = false): THREE.BufferGeometry {
  const r = rng(seed);
  const o = r() * 100;
  const sc = round ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(1, 0.78 + r() * 0.15, 0.6 + r() * 0.12);
  const g = blob(3,
    (p) => 1 + (fbm3(p.x * 1.2 + o, p.y * 1.2, p.z * 1.2, seed, 3) - 0.5) * 0.22,
    (p, n) => {
      const top = C('#e8f0f6'), side = C('#a4b8cc'), stain = C('#4e3a2a'), frost = C('#ffffff');
      let c = lerpC(side, top, smoothstep(-0.2, 0.8, n.z));
      c = lerpC(c, C('#c8b89a'), smoothstep(0.62, 0.8, noise3(p.x * 5 + o, p.y * 5, p.z * 5, seed + 2)) * 0.45);
      if (!round) c = lerpC(c, stain, (1 - smoothstep(-0.05, 0.25, p.z)) * 0.75);
      if (noise3(p.x * 20, p.y * 20, p.z * 20, seed + 3) > 0.78) c = lerpC(c, frost, 0.6);
      return c;
    }, sc, round ? -10 : -0.3);
  if (!round) { g.scale(s, s, s); g.translate(x, y, 0); }
  return g;
}
function titan(seed: number, v: number, big: boolean, rolling: boolean): ObstacleGeo {
  const r = rng(seed);
  if (rolling) return { geo: cobble(seed, 1, 0, 0, true), mat: xmats.ice };
  const parts: THREE.BufferGeometry[] = [];
  const n = big ? 5 : 1 + (v % 3);
  parts.push(cobble(seed, big ? 0.62 : 0.82, big ? -0.25 : 0, big ? 0.15 : 0));
  for (let k = 1; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r();
    const s = big ? 0.3 + r() * 0.22 : 0.26 + r() * 0.12;
    const d = big ? 0.75 : 0.8;
    parts.push(cobble(seed + k * 3, s, Math.cos(a) * d, Math.sin(a) * d));
  }
  const g = merge(parts); fitUnit([g]);
  return { geo: g, mat: xmats.ice };
}

// ------------------------------------------------------------------ kepler: crystal spires, fungus caps
const VIOLET = C('#7a44ff'), CYAN = C('#3ee6ff'), ORCHID = C('#d060ff');
function prism(rad: number, h: number, hue: number, seed: number): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(rad * 0.86, rad, h, 6, 2, true);
  body.translate(0, h / 2, 0);
  const tip = new THREE.ConeGeometry(rad * 0.86, rad * 2.2, 6, 1, true);
  tip.translate(0, h + rad * 1.1, 0);
  const top = h + rad * 2.2;
  const g = merge([prep(body), prep(tip)]).toNonIndexed();
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  const base = hue < 0.5 ? lerpC(VIOLET, ORCHID, hue * 2) : lerpC(VIOLET, CYAN, (hue - 0.5) * 2);
  colorize(g, (p) => {
    const t = p.z / top;
    let c = lerpC(base.clone().multiplyScalar(0.4), base, smoothstep(0.0, 0.6, t));
    c = lerpC(c, C('#ffffff'), smoothstep(0.75, 1.0, t) * 0.55);
    return c.multiplyScalar(0.9 + 0.2 * noise3(p.x * 20, p.y * 20, p.z * 8, seed));
  });
  setGlow(g, (p) => 0.08 + 0.7 * Math.pow(Math.max(0, p.z / top), 2.2));
  return g;
}
function crystalSpires(seed: number, n: number, spread = 0.55): THREE.BufferGeometry {
  const r = rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const hue0 = r();
  for (let i = 0; i < n; i++) {
    const main = i === 0;
    const h = main ? 1.15 + r() * 0.3 : 0.4 + r() * 0.5;
    const rad = main ? 0.2 : 0.09 + r() * 0.07;
    const g = prism(rad, h, (hue0 + r() * 0.45) % 1, seed + i);
    const a = (i / n) * Math.PI * 2 + r() * 0.5;
    const tilt = main ? 0.1 : 0.35 + r() * 0.45;
    g.rotateY(tilt);
    g.rotateZ(a);
    const d = main ? 0 : spread * (0.5 + r() * 0.5);
    g.translate(Math.cos(a) * d, Math.sin(a) * d, -0.04);
    geos.push(g);
  }
  // dark violet host rock
  const rock0 = facetRock(seed + 99, { detail: 1, cuts: 5, jag: 0.3, scale: new THREE.Vector3(spread + 0.25, spread + 0.15, 0.3), floor: -0.1 });
  geos.push(glowPrep(rock0, (p) => lerpC(C('#1e1330'), C('#3e2a5c'), smoothstep(0, 0.3, p.z)), 0));
  return merge(geos.map((g) => { if (!g.getAttribute('aGlow')) setGlow(g, 0); return g; }));
}
function fungusCap(seed: number, R: number, h: number, pal: number): THREE.BufferGeometry {
  const r = rng(seed);
  const o = r() * 100;
  const stalk = lathe([[R * 0.2, 0], [R * 0.17, h * 0.5], [R * 0.15, h * 0.9], [0.001, h]], 10);
  const top = h + R * 0.42;
  const cap = lathe([[0.001, top], [R * 0.45, top - R * 0.06], [R * 0.8, top - R * 0.2], [R, top - R * 0.42], [R * 0.92, top - R * 0.47], [R * 0.5, top - R * 0.4], [R * 0.16, h * 0.95]], 26);
  const [c0, c1, spot] = pal === 0 ? [C('#27c4b0'), C('#0b4a5e'), C('#b4ffe4')] : pal === 1 ? [C('#e44aa4'), C('#5a1848'), C('#ffe0f4')] : [C('#ff8a3a'), C('#7a2a2a'), C('#fff0a0')];
  const gill = C('#2a1a3a');
  const spotF = (p: THREE.Vector3) => smoothstep(0.7, 0.76, noise3(p.x * 9 / R + o, p.y * 9 / R, p.z * 4, seed));
  const cg = glowPrep(cap, (p, n) => {
    if (n.z < -0.1) return gill;
    const rr = Math.hypot(p.x, p.y) / R;
    const c = lerpC(c0, c1, smoothstep(0.3, 1.0, rr));
    return lerpC(c, spot, spotF(p) * (n.z > 0 ? 1 : 0));
  }, (p) => spotF(p) * 0.9 + 0.04);
  const sg = glowPrep(stalk, C('#e0d4ee'), 0);
  return merge([sg, cg]);
}
function fungusPatch(seed: number, n: number): THREE.BufferGeometry {
  const r = rng(seed);
  const pal = Math.floor(r() * 3);
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const main = i === 0;
    const R = main ? 0.62 : 0.26 + r() * 0.16;
    const g = fungusCap(seed + i, R, main ? 0.55 : 0.28 + r() * 0.2, pal);
    const a = (i / n) * Math.PI * 2 + r();
    const d = main ? 0 : 0.7;
    g.rotateX((r() - 0.5) * 0.2);
    g.translate(Math.cos(a) * d - (main ? 0 : 0), Math.sin(a) * d, 0);
    geos.push(g);
  }
  return merge(geos);
}
function hoverCrystal(seed: number): ObstacleGeo {
  const r = rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const core = lathe([[0.001, -1], [0.55, -0.12], [0.55, 0.12], [0.001, 1]], 6).toNonIndexed();
  core.computeVertexNormals();
  colorize(core, (p) => lerpC(CYAN, VIOLET, smoothstep(-0.8, 0.8, p.z + p.x * 0.3)).multiplyScalar(0.8 + 0.4 * (1 - Math.abs(p.z))));
  setGlow(core, (p) => 0.35 + 0.5 * Math.abs(p.z));
  geos.push(prep(core, undefined)); recolor(geos[0], core); geos[0].setAttribute('aGlow', core.getAttribute('aGlow'));
  for (let k = 0; k < 3; k++) {
    const s = prism(0.1, 0.25, r(), seed + k);
    s.translate(0, 0, -0.2);
    s.rotateX(Math.PI / 2 + 0.5);
    s.rotateZ((k / 3) * Math.PI * 2);
    const a = (k / 3) * Math.PI * 2;
    s.translate(Math.cos(a) * 0.95, Math.sin(a) * 0.95, (k - 1) * 0.2);
    geos.push(s);
  }
  const glow = new THREE.PlaneGeometry(2.6, 2.6);
  glow.translate(0, 0, -0.85);
  return { geo: merge(geos), mat: xmats.crystal, extra: [{ geo: glow, mat: hoverGlowMat(), noShadow: true }], motion: 'hover' };
}
let _hoverGlow: THREE.MeshBasicMaterial | null = null;
function hoverGlowMat() {
  if (_hoverGlow) return _hoverGlow;
  _hoverGlow = xmats.hoverGlow;
  _hoverGlow.map = glowTexture();
  return _hoverGlow;
}
function kepler(seed: number, v: number, big: boolean, rolling: boolean): ObstacleGeo {
  if (rolling) return hoverCrystal(seed);
  if (big) {
    const sp = crystalSpires(seed, 8, 0.7); sp.translate(-0.35, 0.3, 0);
    const fu = fungusPatch(seed + 1, 3); fu.scale(0.7, 0.7, 0.7); fu.translate(0.75, -0.65, 0);
    fitUnit([sp, fu]);
    return { geo: sp, mat: xmats.crystal, extra: [{ geo: fu, mat: xmats.fungus }] };
  }
  if (v === 1 || v === 4) { const g = fungusPatch(seed, v === 1 ? 3 : 2); fitUnit([g]); return { geo: g, mat: xmats.fungus }; }
  const g = crystalSpires(seed, v === 5 ? 9 : 5 + (v % 3));
  fitUnit([g]);
  return { geo: g, mat: xmats.crystal };
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
    case 'salar': g = salar(v * 3 + (big ? 1 : 0), big, rolling); break;
    case 'pinksands': g = pinksands(sd, v, big, rolling); break;
    case 'vaadhoo': g = vaadhoo(sd, v, big, rolling); break;
    case 'dallol': g = dallol(sd, v, big, rolling); break;
    case 'luna': g = luna(sd, v, big, rolling); break;
    case 'mars': g = mars(sd, v, big, rolling); break;
    case 'titan': g = titan(sd, v, big, rolling); break;
    case 'kepler': g = kepler(sd, v, big, rolling); break;
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
