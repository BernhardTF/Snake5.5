// Floating power-up tokens: glyph + glowing ring + halo. Built once, cloned per pickup.
import * as THREE from 'three';
import { glowTexture, merge, prep, sweep } from './geo';
import { noShadow, unitPlane } from './foods';
import type { PowerupKind } from '../../types';

export const POWERUP_COLOR: Record<PowerupKind, string> = {
  slow: '#4fb4ff', ghost: '#dfe9ff', magnet: '#ff3b3b', double: '#ffc83a', shed: '#5fe06a',
};

function glyphHourglass() {
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20; // 0..1 along length
    const y = (t - 0.5) * 0.36;
    const r = 0.018 + 0.1 * Math.pow(Math.abs(Math.sin(t * Math.PI)), 0.8) * (1 - 0.85 * Math.exp(-(((t - 0.5) / 0.08) ** 2)));
    prof.push(new THREE.Vector2(r, y));
  }
  const glass = new THREE.LatheGeometry(prof, 20);
  glass.rotateZ(Math.PI / 2);
  const caps: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const c = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 20);
    c.rotateZ(Math.PI / 2); c.translate(s * 0.195, 0, 0);
    caps.push(prep(c, new THREE.Color('#e0b060')));
    if (s > 0) for (const k of [-1, 1]) {
      const rod = new THREE.CylinderGeometry(0.01, 0.01, 0.38, 6);
      rod.rotateZ(Math.PI / 2); rod.translate(0, k * 0.1, 0);
      caps.push(prep(rod, new THREE.Color('#e0b060')));
    }
  }
  const sand = new THREE.ConeGeometry(0.075, 0.1, 16);
  sand.rotateZ(Math.PI / 2); sand.translate(-0.12, 0, 0);
  return {
    parts: [
      { geo: glass, mat: new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.05, transparent: true, opacity: 0.45, emissive: new THREE.Color('#2a7ad8'), emissiveIntensity: 0.6, clearcoat: 1, depthWrite: false }) },
      { geo: merge(caps), mat: new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.3 }) },
      { geo: sand, mat: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: new THREE.Color('#3a9cff'), emissiveIntensity: 1.2, roughness: 0.6 }) },
    ],
  };
}

function glyphGhost() {
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = t * Math.PI / 2;
    prof.push(new THREE.Vector2(0.13 * Math.sin(a) + 0.0001, 0.1 + 0.13 * Math.cos(a)));
  }
  prof.reverse();
  prof.push(new THREE.Vector2(0.13, -0.12));
  const g = new THREE.LatheGeometry(prof, 28);
  // wavy skirt
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0.05) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      p.setY(i, y + 0.03 * Math.sin(a * 5) * (0.05 - y) / 0.17);
      const s = 1 + (0.05 - y) * 0.4;
      p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s);
    }
  }
  g.computeVertexNormals();
  // lathe axis = +y (screen up); the face (eyes) looks toward +z, i.e. the camera
  const eyes: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.025, 8, 6);
    e.scale(1, 1.4, 0.6);
    e.translate(s * 0.05, 0.11, 0.115);
    eyes.push(prep(e));
  }
  return {
    parts: [
      { geo: g, mat: new THREE.MeshPhysicalMaterial({ color: 0xf2f6ff, roughness: 0.4, transparent: true, opacity: 0.85, emissive: new THREE.Color('#9fc0ff'), emissiveIntensity: 0.55, sheen: 1, sheenColor: new THREE.Color(0.8, 0.9, 1) }) },
      { geo: merge(eyes), mat: new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.3 }) },
    ],
  };
}

function glyphMagnet() {
  const arc = new THREE.TorusGeometry(0.13, 0.05, 12, 28, Math.PI);
  arc.translate(0, 0.02, 0);
  const legs: THREE.BufferGeometry[] = [prep(arc)];
  const tips: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const l = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 16);
    l.translate(s * 0.13, -0.03, 0);
    legs.push(prep(l));
    const t = new THREE.CylinderGeometry(0.052, 0.052, 0.07, 16);
    t.translate(s * 0.13, -0.115, 0);
    tips.push(prep(t));
  }
  return {
    parts: [
      { geo: merge(legs), mat: new THREE.MeshPhysicalMaterial({ color: 0xe02020, roughness: 0.25, clearcoat: 1, emissive: new THREE.Color('#ff2020'), emissiveIntensity: 0.35 }) },
      { geo: merge(tips), mat: new THREE.MeshPhysicalMaterial({ color: 0xd8dde4, metalness: 1, roughness: 0.2 }) },
    ],
  };
}

function glyphDouble() {
  const coin = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 40);
  coin.rotateX(Math.PI / 2);
  const rim = new THREE.TorusGeometry(0.19, 0.018, 8, 40);
  rim.translate(0, 0, 0.026);
  // "x2" relief
  const relief: THREE.BufferGeometry[] = [];
  const z = 0.03;
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const b = new THREE.BoxGeometry(0.13, 0.026, 0.02);
    b.rotateZ(a); b.translate(-0.075, -0.01, z);
    relief.push(prep(b));
  }
  const two: THREE.Vector3[] = [];
  const P = (x: number, y: number) => two.push(new THREE.Vector3(0.06 + x * 0.15, y * 0.15, z));
  for (let i = 0; i <= 10; i++) { const a = Math.PI * 0.95 - (i / 10) * Math.PI * 1.15; P(Math.cos(a) * 0.45, 0.45 + Math.sin(a) * 0.45); }
  P(-0.2, -0.3); P(-0.45, -0.7); P(0.0, -0.7); P(0.45, -0.7);
  relief.push(prep(sweep(two, two.map(() => 0.017), 6, 0.8)));
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.22, emissive: new THREE.Color('#ff9a10'), emissiveIntensity: 0.35 });
  return {
    parts: [
      { geo: merge([prep(coin), prep(rim)]), mat: gold },
      { geo: merge(relief), mat: new THREE.MeshPhysicalMaterial({ color: 0xfff0b0, metalness: 1, roughness: 0.15, emissive: new THREE.Color('#ffb020'), emissiveIntensity: 0.6 }) },
    ],
  };
}

function glyphShed() {
  // coiled shed skin: a twisted translucent ring with scale stripes
  const pts: THREE.Vector3[] = [], rr: number[] = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = t * Math.PI * 2 * 1.15;
    const R = 0.15 - 0.03 * t;
    pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0.02 * Math.sin(t * 9)));
    rr.push(0.045 * (1 - 0.7 * t) + 0.006);
  }
  const g = sweep(pts, rr, 10, 0.75, (t, a) => {
    const stripe = 0.5 + 0.5 * Math.sin(t * 90 + a * 12);
    return new THREE.Color('#bff5a0').lerp(new THREE.Color('#5ab84a'), stripe * 0.6);
  });
  return {
    parts: [{ geo: g, mat: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, transparent: true, opacity: 0.9, emissive: new THREE.Color('#2a9a30'), emissiveIntensity: 0.5, sheen: 1, sheenColor: new THREE.Color(0.8, 1, 0.8), side: THREE.DoubleSide }) }],
  };
}

const cache = new Map<PowerupKind, THREE.Group>();
let ringGeo: THREE.BufferGeometry | null = null;

/** Build (once) and return the template for a power-up kind. Children: 'glyph' group, 'ring', 'halo'. */
export function powerupTemplate(kind: PowerupKind): THREE.Group {
  let t = cache.get(kind);
  if (t) return t;
  const col = new THREE.Color(POWERUP_COLOR[kind]);
  const g = kind === 'slow' ? glyphHourglass() : kind === 'ghost' ? glyphGhost() : kind === 'magnet' ? glyphMagnet() : kind === 'double' ? glyphDouble() : glyphShed();
  const root = new THREE.Group();
  const glyph = new THREE.Group();
  glyph.name = 'glyph';
  glyph.scale.setScalar(1.45);
  for (const p of g.parts) {
    const m = new THREE.Mesh(p.geo, p.mat);
    m.castShadow = true;
    glyph.add(m);
  }
  root.add(glyph);
  ringGeo ??= (() => {
    const r = new THREE.TorusGeometry(0.3, 0.018, 6, 48);
    // dashed look: tick marks
    const ticks: THREE.BufferGeometry[] = [prep(r)];
    for (let i = 0; i < 12; i++) {
      const b = new THREE.BoxGeometry(0.05, 0.02, 0.012);
      b.translate(0.345, 0, 0);
      b.rotateZ((i / 12) * Math.PI * 2);
      ticks.push(prep(b));
    }
    return merge(ticks);
  })();
  const ring = noShadow(new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), toneMapped: false, transparent: true, opacity: 0.9 })));
  ring.name = 'ring';
  ring.position.z = 0.03;
  root.add(ring);
  const halo = noShadow(new THREE.Mesh(unitPlane(), new THREE.MeshBasicMaterial({ map: glowTexture(), color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.75 })));
  halo.name = 'halo';
  halo.scale.setScalar(1.25);
  halo.position.z = 0.02;
  root.add(halo);
  cache.set(kind, root);
  return root;
}
