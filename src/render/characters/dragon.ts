// Lóng: a Chinese celestial dragon. Jade scaled tube body, spiky gold dorsal ridge, flowing red/gold
// mane at the neck, a head with antler horns, big eyes and an open jaw, long golden barbels with
// spring physics, four paddling clawed legs, a flickering flame tuft on the tail and cloud wisps.
import * as THREE from 'three';
import type { RenderFrame } from '../../types';
import { LegendBase } from './common/base';
import { Tube } from './common/tube';
import { ParticlePool, SpriteMode } from './common/sprites';
import { newSample } from './common/track';
import { NOISE, patch } from './common/mats';
import { cone, ellipsoid, limb, merge, mirrorY, paint, paintGrad } from './common/geo';
import { clamp, commit, damp, hash1, instanced, lerp, Rng, setColor, smooth, writeTRS } from './common/util';

const MAXR = 1800;
const MAXSPIKE = 2600;
const NMANE = 52;
const NWH = 16;       // whisker nodes
const NFLAME = 11;

const JADE = '#157252', JADE_D = '#0b4a33', JADE_L = '#2a9a6a', GOLD = '#e8b73a', CREAM = '#f1e2b2', RED = '#c3202a';

// ---------------------------------------------------------------- geometry builders
function spikeGeo() {
  // swept-back blade: base along x, tip leaning to -x, thin in y
  const p = [
    [0.5, 0, 0], [0, 0.16, 0], [-0.5, 0, 0], [0, -0.16, 0], [-0.62, 0, 1],
  ];
  const f = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]];
  const pos: number[] = [];
  for (const t of f) for (const i of t) pos.push(...p[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function strandGeo() {
  // tapered, gently curved ribbon pointing along -X (length 1), width 1 at the root
  const seg = 8;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const cR = new THREE.Color('#ffffff'), cT = new THREE.Color('#ffe3a0');
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const x = -t;
    const w = 0.5 * Math.pow(1 - t, 0.8) * (0.7 + 0.3 * Math.sin(t * Math.PI));
    const z = 0.18 * Math.sin(t * Math.PI) - 0.1 * t;
    const y0 = 0.12 * Math.sin(t * Math.PI * 1.5);
    pos.push(x, y0 - w, z, x, y0 + w, z);
    const c = cR.clone().lerp(cT, t * t);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (i < seg) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function flameGeo() {
  // flame blade along +X (length 1): wavy tapering sheet, hot colours toward the tip
  const seg = 10;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c0 = new THREE.Color('#d8200a').multiplyScalar(1.2), c1 = new THREE.Color('#ff6a10').multiplyScalar(1.5), c2 = new THREE.Color('#ffc040').multiplyScalar(1.9);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = 0.5 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - 0.3 * t);
    const y0 = 0.18 * Math.sin(t * Math.PI * 1.2) * t;
    pos.push(t, y0 - w, 0.1 * t, t, y0 + w, 0.1 * t);
    const c = t < 0.5 ? c0.clone().lerp(c1, t * 2) : c1.clone().lerp(c2, (t - 0.5) * 2);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (i < seg) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function legGeo() {
  const parts: THREE.BufferGeometry[] = [];
  const up = limb([[0, 0, 0], [0.0, 0.12, -0.02], [0.06, 0.2, -0.08], [0.09, 0.225, -0.11]], [0.06, 0.045, 0.035, 0.03], 8);
  paintGrad(up, 1, 0.0, 0.22, JADE, JADE_L);
  parts.push(up);
  // four gold claws fanning forward/outward from the paw
  const paw = new THREE.Vector3(0.09, 0.225, -0.11);
  for (let k = 0; k < 4; k++) {
    const a = -0.35 + k * 0.42;
    const d = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.9 + 0.25, -0.15).normalize();
    const c = new THREE.ConeGeometry(0.016, 0.075, 6);
    c.translate(0, 0.0375, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    c.translate(paw.x + d.x * 0.02, paw.y + d.y * 0.02, paw.z + d.z * 0.02);
    parts.push(paint(c, GOLD));
  }
  // elbow flame tuft
  const tuft = new THREE.ConeGeometry(0.035, 0.14, 6);
  tuft.translate(0, 0.07, 0);
  tuft.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0.35, 0.3).normalize()));
  tuft.translate(0.0, 0.12, -0.01);
  parts.push(paint(tuft, '#e8452a'));
  return merge(parts);
}

function headGeo() {
  const P: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: string) => P.push(paint(g, c));
  add(ellipsoid(0.18, 0.17, 0.12, -0.01, 0, 0.14), JADE);
  add(ellipsoid(0.12, 0.1, 0.09, 0.02, 0.12, 0.12), JADE_D);
  add(ellipsoid(0.12, 0.1, 0.09, 0.02, -0.12, 0.12), JADE_D);
  add(ellipsoid(0.18, 0.12, 0.085, 0.18, 0, 0.14), JADE_L);
  add(ellipsoid(0.13, 0.045, 0.05, 0.15, 0, 0.2), '#58c890');
  // nose pad + nostrils
  add(ellipsoid(0.05, 0.1, 0.05, 0.32, 0, 0.17), GOLD);
  add(ellipsoid(0.014, 0.018, 0.01, 0.35, 0.05, 0.208), '#6a3a10');
  add(ellipsoid(0.014, 0.018, 0.01, 0.35, -0.05, 0.208), '#6a3a10');
  // cream upper lip
  add(ellipsoid(0.17, 0.125, 0.03, 0.19, 0, 0.085), CREAM);
  // open lower jaw + red mouth interior
  const jaw = ellipsoid(0.15, 0.1, 0.04, 0.0, 0, 0);
  jaw.rotateY(0.22); jaw.translate(0.24, 0, 0.035);
  add(jaw, '#a8c890');
  add(ellipsoid(0.13, 0.085, 0.035, 0.22, 0, 0.065), '#9a1016');
  // fangs poking out at the lips
  for (const sg of [1, -1]) {
    const f = new THREE.ConeGeometry(0.016, 0.07, 6);
    f.rotateX(-Math.PI / 2); // point down
    f.rotateX(sg * 0.55);
    f.translate(0.27, sg * 0.115, 0.07);
    add(f, '#fffbe8');
  }
  // eyes: sclera + gold iris + slit pupil, bulging up and out
  for (const sg of [1, -1]) {
    const c = new THREE.Vector3(0.035, sg * 0.125, 0.235);
    add(ellipsoid(0.07, 0.062, 0.058, c.x, c.y, c.z, 14, 10), '#fbf3cf');
    const d = new THREE.Vector3(0.35, sg * 0.5, 0.8).normalize();
    add(ellipsoid(0.038, 0.038, 0.038, c.x + d.x * 0.034, c.y + d.y * 0.034, c.z + d.z * 0.034, 12, 8), '#f0a010');
    add(ellipsoid(0.012, 0.024, 0.02, c.x + d.x * 0.058, c.y + d.y * 0.058, c.z + d.z * 0.058, 8, 6), '#050302');
    // flame brow sweeping back
    const b = cone(0.2, 0.034, 0, 0, 0, 7);
    b.rotateZ(Math.PI);
    b.rotateY(0.35);
    b.rotateZ(sg * -0.45);
    b.translate(0.1, sg * 0.1, 0.29);
    add(b, '#e03a22');
    // ear fin
    const e = cone(0.17, 0.05, 0, 0, 0, 5);
    e.scale(1, 1, 0.35);
    e.rotateZ(Math.PI + sg * -0.8);
    e.translate(-0.06, sg * 0.16, 0.16);
    add(e, JADE_L);
  }
  // antler horns (main beam sweeping back/out/up with two tines)
  for (const sg of [1, -1]) {
    const beam = limb([[-0.04, sg * 0.07, 0.24], [-0.17, sg * 0.12, 0.34], [-0.31, sg * 0.17, 0.39], [-0.44, sg * 0.21, 0.37]], [0.03, 0.025, 0.019, 0.008], 7);
    paintGrad(beam, 0, -0.44, -0.04, '#caa24a', '#f4e6c0');
    P.push(beam);
    const t1 = limb([[-0.17, sg * 0.12, 0.34], [-0.12, sg * 0.2, 0.44], [-0.09, sg * 0.21, 0.47]], [0.018, 0.011, 0.005], 6);
    paint(t1, '#e8d4a0'); P.push(t1);
    const t2 = limb([[-0.3, sg * 0.17, 0.39], [-0.27, sg * 0.26, 0.46], [-0.25, sg * 0.28, 0.48]], [0.015, 0.009, 0.004], 6);
    paint(t2, '#e0c890'); P.push(t2);
  }
  return merge(P);
}

// ---------------------------------------------------------------- view
export class DragonView extends LegendBase {
  readonly id = 'dragon' as const;
  private tube = new Tube({ radial: 20, maxRings: MAXR, flank: 0.9, belly: 0.62 });
  private u = { uDead: { value: 0 }, uT: { value: 0 } };
  private spikes: THREE.InstancedMesh;
  private mane: THREE.InstancedMesh;
  private legsL: THREE.InstancedMesh;
  private legsR: THREE.InstancedMesh;
  private flames: THREE.InstancedMesh;
  private head = new THREE.Group();
  private lids: THREE.Mesh[] = [];
  private tongue: THREE.Mesh;
  private flameMat: THREE.MeshBasicMaterial;
  // whiskers
  private wx = new Float32Array(2 * NWH); private wy = new Float32Array(2 * NWH); private wz = new Float32Array(2 * NWH);
  private wpx = new Float32Array(2 * NWH); private wpy = new Float32Array(2 * NWH); private wpz = new Float32Array(2 * NWH);
  private wInit = false;
  private wGeo = new THREE.BufferGeometry();
  private wPos = new Float32Array(2 * NWH * 2 * 3);
  private wNor = new Float32Array(2 * NWH * 2 * 3);
  private clouds = new ParticlePool(90, { mode: SpriteMode.Cloud, drag: 0.8, fadeIn: 0.25, renderOrder: 2 });
  private embers = new ParticlePool(40, { mode: SpriteMode.Ember, additive: true, drag: 1.5, buoyancy: 0.4, fadeIn: 0.05 });
  private rng = new Rng(8);
  private smp = newSample();
  private tmp = newSample();
  private p3 = { x: 0, y: 0, z: 0 };
  private gait = 0;
  private turnLag = 0;
  private cloudAcc = 0;
  private emberAcc = 0;
  private blink = 0;
  private nextBlink = 2;
  private tongueT = 9;
  private maneLag = new Float32Array(NMANE);
  private maneSeed = new Float32Array(NMANE);

  constructor() {
    super();
    this.object.name = 'legend-dragon';
    this.smoothLen = 0.22;
    const u = this.u;
    const bodyMat = patch(new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.42, metalness: 0.05, clearcoat: 0.55, clearcoatRoughness: 0.3,
      iridescence: 0.25, iridescenceIOR: 1.5,
    }), {
      uniforms: u,
      vertDecl: 'attribute vec4 aInfo; varying vec4 vInfo;',
      vert: 'vInfo = aInfo;',
      fragDecl: `varying vec4 vInfo; uniform float uDead, uT;\n${NOISE}`,
      color: /* glsl */ `
        float s = vInfo.x;
        float a = vInfo.z;
        float d = 1.0 - abs(a - 0.5) * 2.0;   // 1 = spine, 0 = belly
        // overlapping scales on a staggered lattice; free rounded edge toward the tail
        float rows = 20.0;
        float len = 0.068;
        vec2 p = vec2(a * rows, s / len);
        float best = -1e3; vec2 bq = vec2(0.0);
        for (int dj = 0; dj < 2; dj++) {
          float r = floor(p.y) - float(dj);
          float off = 0.5 * mod(r, 2.0);
          for (int di = -1; di <= 1; di++) {
            float cx = floor(p.x - off) + float(di) + 0.5 + off;
            vec2 q = vec2(p.x - cx, p.y - r);
            if (length(q * vec2(1.0, 0.9)) < 0.72 && q.y > -0.05 && r > best) { best = r; bq = q; }
          }
        }
        float e = clamp(length(bq * vec2(1.0, 0.9)) / 0.72, 0.0, 1.0);
        float aa = clamp(1.6 - max(fwidth(p.x), fwidth(p.y)) * 2.2, 0.0, 1.0);
        e = mix(0.55, e, aa);
        vec3 jade = vec3(0.008, 0.15, 0.065), jadeL = vec3(0.05, 0.42, 0.2), jadeD = vec3(0.002, 0.035, 0.018);
        float n = lvn(vec2(s * 3.0, a * 9.0));
        vec3 c = mix(jadeL, jade, smoothstep(0.0, 0.75, e) * 0.8 + 0.2 * n);
        c = mix(c, jadeD, smoothstep(0.78, 0.98, e));
        // darker along the spine, golden sheen on the upper flanks
        c *= mix(1.0, 0.72, smoothstep(0.82, 1.0, d));
        c += vec3(0.25, 0.18, 0.02) * smoothstep(0.55, 0.7, d) * (1.0 - smoothstep(0.7, 0.85, d)) * 0.35;
        // cream-gold ventral scutes
        float belly = 1.0 - smoothstep(0.2, 0.32, d);
        float sc = fract(s / 0.085);
        vec3 bc = mix(vec3(0.85, 0.66, 0.3), vec3(0.62, 0.42, 0.14), smoothstep(0.7, 1.0, sc));
        c = mix(c, bc, belly);
        c = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))) * vec3(0.8, 0.85, 0.82), uDead * 0.8);
        diffuseColor.rgb = c;
      `,
      rough: 'roughnessFactor = clamp(roughnessFactor + uDead * 0.3, 0.05, 1.0);',
    });
    const body = new THREE.Mesh(this.tube.geometry, bodyMat);
    body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false;

    const goldMat = new THREE.MeshPhysicalMaterial({ color: '#f4c440', metalness: 0.45, roughness: 0.32, clearcoat: 0.5, emissive: '#3a2000' });
    this.spikes = instanced(spikeGeo(), goldMat, MAXSPIKE, true);
    const maneMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide, sheen: 1, sheenColor: new THREE.Color('#ffb070'), sheenRoughness: 0.5 });
    this.mane = instanced(strandGeo(), maneMat, NMANE + 8, true);
    const legMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1, clearcoat: 0.6 });
    const lg = legGeo();
    this.legsL = instanced(lg, legMat, 2, false);
    this.legsR = instanced(mirrorY(lg), legMat, 2, false);
    this.flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
    this.flames = instanced(flameGeo(), this.flameMat, NFLAME, true);
    this.flames.userData.noShadow = true;
    for (const m of [this.spikes, this.mane, this.legsL, this.legsR]) { m.castShadow = true; m.receiveShadow = true; }

    const headMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.08, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const hm = new THREE.Mesh(headGeo(), headMat);
    hm.castShadow = true; hm.receiveShadow = true;
    this.head.add(hm);
    const lidMat = new THREE.MeshPhysicalMaterial({ color: JADE, roughness: 0.4, clearcoat: 0.6 });
    for (const sg of [1, -1]) {
      const lid = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), lidMat);
      lid.position.set(0.035, sg * 0.125, 0.235);
      lid.scale.set(0.074, 0.066, 0.001);
      this.lids.push(lid);
      this.head.add(lid);
    }
    const tongueMat = new THREE.MeshPhysicalMaterial({ color: '#d42a3a', roughness: 0.3, clearcoat: 1 });
    this.tongue = new THREE.Mesh(limb([[0, 0, 0], [0.1, 0, -0.005], [0.17, 0.03, -0.01], [0.21, -0.005, -0.012]], [0.024, 0.02, 0.012, 0.004], 7), tongueMat);
    this.tongue.position.set(0.25, 0, 0.07);
    this.head.add(this.tongue);
    this.head.matrixAutoUpdate = false;

    // whisker ribbon strips
    this.wGeo.setAttribute('position', new THREE.BufferAttribute(this.wPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.wGeo.setAttribute('normal', new THREE.BufferAttribute(this.wNor, 3).setUsage(THREE.DynamicDrawUsage));
    const widx: number[] = [];
    for (let w = 0; w < 2; w++) for (let i = 0; i < NWH - 1; i++) {
      const a = (w * NWH + i) * 2;
      widx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.wGeo.setIndex(widx);
    this.wGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const whiskerMat = new THREE.MeshPhysicalMaterial({ color: '#f2c24a', metalness: 0.7, roughness: 0.28, side: THREE.DoubleSide, emissive: '#3a2200' });
    const whiskers = new THREE.Mesh(this.wGeo, whiskerMat);
    whiskers.frustumCulled = false; whiskers.castShadow = true;

    this.solids.push(bodyMat, goldMat, maneMat, legMat, headMat, lidMat, tongueMat, whiskerMat);
    for (let i = 0; i < NMANE; i++) this.maneSeed[i] = hash1(i * 3.7 + 1);
    this.object.add(body, this.spikes, this.mane, this.legsL, this.legsR, this.head, whiskers, this.flames, this.clouds.mesh, this.embers.mesh);
  }

  private widthAt(s: number, L: number, sc: number) {
    // neck narrower just behind the head, fuller mid-body, long taper to a slender tail
    let w = lerp(0.165, 0.27, smooth(0.5 * sc, 1.6 * sc, s)) * sc;
    const tailStart = Math.max(1.0 * sc, L * 0.5);
    if (s > tailStart) {
      const t = clamp((s - tailStart) / Math.max(0.1, L - tailStart), 0, 1);
      w *= lerp(1, 0.28, Math.pow(t, 1.1));
    }
    return w;
  }

  /** Body centre + surface top at arclength s (uses last built tube). */
  private ringInfo(s: number) {
    const tube = this.tube;
    const q = tube.ringAt(s);
    return q;
  }

  protected draw(f: RenderFrame) {
    const sn = f.snake, tr = this.track, tube = this.tube, dt = this.dt;
    const sc = this.r / 0.34;
    const L = tr.L;
    const alive = sn.alive;
    const td = alive ? 0 : sn.deathT;
    const spd = Math.abs(sn.speed);
    this.u.uT.value = this.t;
    const dead = alive ? 0 : smooth(0.3, 2.2, td);
    this.u.uDead.value = dead * 0.7;
    this.turnLag += (sn.turnRate - this.turnLag) * damp(3, dt);
    if (this.eats) this.tongueT = 0;
    this.tongueT += dt;

    // ---------------- body tube
    const sStart = 0.42 * sc;
    tube.layout(tr, sStart, L, 0.04 * sc, 1.2 * sc, 0.06 * sc);
    const n = tube.rings;
    for (let q = 0; q < n; q++) {
      const s = tube.s[q];
      let w = this.widthAt(s, L, sc);
      const b = this.bulgeAt(f, s, 0.42 * sc);
      w *= 1 + 0.4 * Math.min(1.2, b);
      const gd = tr.gapDist(s);
      const capL = 0.26 * sc;
      if (gd < capL) { const t = 1 - gd / capL; w *= Math.sqrt(Math.max(0, 1 - t * t)); }
      // tail end: round off into the flame tuft
      const te = L - s;
      if (te < 0.08 * sc) w *= Math.sqrt(Math.max(0, te / (0.08 * sc)));
      const h = w * 0.95;
      tube.w[q] = w; tube.h[q] = h; tube.zc[q] = h * 0.62 + 0.004 + 0.02 * sc * (1 - dead) * smooth(0, 0.8, s) * (1 - smooth(L * 0.6, L, s));
    }
    tube.build();

    // ---------------- head
    const HS = 1.3;
    const sH = 0.3 * sc;
    tr.chord(sH - 0.18 * sc, sH + 0.18 * sc, this.smp, this.tmp);
    const hx = this.smp.x, hy = this.smp.y;
    const hyaw = Math.atan2(this.smp.ty, this.smp.tx);
    const bob = alive ? 0.012 * Math.sin(this.t * 2.2) : -0.02 * dead;
    const headPitch = alive ? 0.03 * Math.sin(this.t * 1.7) : -0.05 * dead;
    writeTRS(this.head.matrix.elements, 0, hx, hy, bob * sc, hyaw, headPitch, alive ? -this.turnLag * 0.02 : 0, sc * HS, sc * HS, sc * HS);
    this.head.matrixWorldNeedsUpdate = true;
    // blinks, closing eyes on death
    this.nextBlink -= dt;
    if (alive && this.nextBlink < 0) { this.blink = 0.16; this.nextBlink = 2 + this.rng.next() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    const lid = alive ? (this.blink > 0 ? Math.sin((this.blink / 0.16) * Math.PI) : 0) : smooth(0.2, 1.0, td);
    for (const l of this.lids) { l.scale.z = 0.001 + lid * 0.07; l.visible = lid > 0.02; }
    // tongue: flicks with interest, lashes on eat
    const tOut = this.tongueT < 0.5 ? Math.sin(Math.min(1, this.tongueT / 0.5) * Math.PI) : alive ? 0.35 * sn.interest * (0.5 + 0.5 * Math.sin(this.t * 9)) : 0.4 * dead;
    this.tongue.scale.set(0.3 + 0.9 * tOut, 1, 1);
    this.tongue.rotation.z = Math.sin(this.t * 13) * 0.15 * tOut;
    this.tongue.visible = tOut > 0.05;
    this.tongue.updateMatrix();

    // ---------------- whiskers (verlet chains trailing from the snout)
    this.updateWhiskers(hx, hy, hyaw, sc * HS, alive, dt);

    // ---------------- dorsal spikes
    const S = this.spikes.instanceMatrix.array as Float32Array;
    const sp0 = 0.5 * sc, spStep = 0.12 * sc;
    let ns = 0;
    const sEnd = L - 0.25 * sc;
    for (let s = sp0; s < sEnd && ns < MAXSPIKE; s += spStep) {
      if (tr.gapDist(s) < 0.22 * sc) continue;
      const q = tube.ringAt(s);
      const x = tube.x[q], y = tube.y[q], tx = tube.tx[q], ty = tube.ty[q];
      const top = tube.zc[q] + tube.h[q];
      const big = (ns & 1) === 0 ? 1 : 0.62;
      const taper = lerp(0.45, 1, smooth(sEnd, L * 0.5, s)) * lerp(0.6, 1, smooth(sp0, sp0 + 0.6 * sc, s));
      const ssz = big * taper * sc;
      const flutter = alive ? 0.06 * Math.sin(this.t * 3 - s * 2) : 0;
      writeTRS(S, ns, x, y, top - 0.035 * sc, Math.atan2(ty, tx), flutter, 0, 0.17 * ssz, 0.42 * ssz, 0.15 * ssz);
      setColor(this.spikes, ns, 1, big === 1 ? 0.95 : 0.78, big === 1 ? 0.85 : 0.55);
      ns++;
    }
    commit(this.spikes, ns);

    // ---------------- mane (red/gold strands streaming back from the neck + chin tufts)
    this.updateMane(f, hx, hy, hyaw, sc, alive, dead, spd, L, HS);

    // ---------------- legs (front pair behind the mane, hind pair mid-body), paddling
    const strideHz = alive ? Math.min(2.6, 0.35 + spd / 2.4) : 0;
    this.gait += dt * strideHz * Math.PI * 2;
    const sF = Math.min(1.25 * sc, L * 0.35), sHd = clamp(L * 0.55, sF + 0.8 * sc, Math.max(sF + 0.8 * sc, L - 1.0 * sc));
    const LLm = this.legsL.instanceMatrix.array as Float32Array, LRm = this.legsR.instanceMatrix.array as Float32Array;
    let nl = 0;
    for (let pair = 0; pair < 2; pair++) {
      const s = pair === 0 ? sF : sHd;
      if (s > L - 0.3 * sc || tr.gapDist(s) < 0.3 * sc) continue;
      tr.chord(s - 0.15 * sc, s + 0.15 * sc, this.smp, this.tmp);
      const q = tube.ringAt(s);
      const x = this.smp.x, y = this.smp.y, yaw = Math.atan2(this.smp.ty, this.smp.tx);
      const w = tube.w[q], zc = tube.zc[q];
      const lsc = sc * (pair === 0 ? 1 : 0.92);
      for (let side = 0; side < 2; side++) {
        const sg = side === 0 ? 1 : -1;
        const ph = this.gait + (pair === 0 ? 0 : Math.PI) + (side === 0 ? 0 : Math.PI);
        let sw = Math.sin(ph) * 0.55, lift = Math.max(0, Math.cos(ph)) * 0.35;
        if (!alive) { sw = lerp(sw, -0.6, dead); lift = lerp(lift, 0.5, dead); }
        const c = Math.cos(yaw), si = Math.sin(yaw);
        const lx = -si * sg * w * 0.72, ly = c * sg * w * 0.72;
        writeTRS(side === 0 ? LLm : LRm, pair, x + lx, y + ly, zc * 0.95, yaw + sg * (sw + 0.15), 0, sg * lift, lsc, lsc, lsc);
        // paw clouds while paddling
        if (alive && lift < 0.05 && Math.sin(ph) > 0.4 && this.rng.next() < dt * 6) {
          this.clouds.spawn(x + lx * 1.8, y + ly * 1.8, 0.04 * sc, -c * 0.2, -si * 0.2, 0, 1.2, 0.18 * sc, 0.5 * sc, 1, 0.97, 0.92, 0.45, this.rng.next() * 6, (this.rng.next() - 0.5) * 0.6, 1.4);
        }
      }
      nl = pair + 1;
    }
    commit(this.legsL, Math.max(nl, 0)); commit(this.legsR, Math.max(nl, 0));
    if (nl === 1 && sHd > L - 0.3 * sc) { /* short body: only the front pair */ }

    // ---------------- tail flame tuft
    this.updateFlames(f, L, sc, alive, td, dead);

    // ---------------- cloud wisps trailing along the body
    const cloudRate = alive ? (2.5 + spd * 0.9) * Math.min(3, 0.5 + L / (8 * sc)) : (this.justDied ? 0 : 0);
    if (this.justDied) for (let i = 0; i < 18; i++) this.spawnCloud(L, sc, 1.6);
    this.cloudAcc += dt * cloudRate;
    while (this.cloudAcc > 1) { this.cloudAcc -= 1; this.spawnCloud(L, sc, 1); }
    this.clouds.step(dt); this.clouds.render();
    this.clouds.material.uniforms.uFade.value = 1 - this.ghostK * 0.5;
    this.embers.step(dt); this.embers.render();
    this.embers.material.uniforms.uFade.value = this.glowFade;
  }

  private spawnCloud(L: number, sc: number, k: number) {
    const r = this.rng, tr = this.track;
    const s = r.range(0.3 * sc, Math.max(0.4 * sc, L));
    if (tr.gapDist(s) < 0.3) return;
    tr.sample(s, this.smp);
    const sg = r.sign();
    const w = this.widthAt(s, L, sc);
    const lat = sg * (w + r.range(0.0, 0.18) * sc);
    const x = this.smp.x - this.smp.ty * lat, y = this.smp.y + this.smp.tx * lat;
    const vx = -this.smp.ty * sg * 0.18 - this.smp.tx * 0.12, vy = this.smp.tx * sg * 0.18 - this.smp.ty * 0.12;
    this.clouds.spawn(x, y, 0.03 * sc, vx * k, vy * k, 0, r.range(1.6, 2.6), 0.25 * sc, r.range(0.7, 1.05) * sc * k, 1, 0.98, 0.93, 0.5, r.next() * 6.28, (r.next() - 0.5) * 0.5, 1.5);
  }

  private updateWhiskers(hx: number, hy: number, hyaw: number, sc: number, alive: boolean, dt: number) {
    const c = Math.cos(hyaw), s = Math.sin(hyaw);
    const segL = 0.05 * sc;
    const steps = dt > 0 ? 2 : 0;
    for (let w = 0; w < 2; w++) {
      const sg = w === 0 ? 1 : -1;
      const rx = hx + c * 0.31 * sc - s * sg * 0.09 * sc, ry = hy + s * 0.31 * sc + c * sg * 0.09 * sc, rz = 0.16 * sc;
      const base = w * NWH;
      const jump = Math.hypot(this.wx[base] - rx, this.wy[base] - ry) > 1.0;
      if (!this.wInit || jump) {
        for (let i = 0; i < NWH; i++) {
          const a = hyaw + sg * 2.4;
          this.wx[base + i] = this.wpx[base + i] = rx + Math.cos(a) * segL * i;
          this.wy[base + i] = this.wpy[base + i] = ry + Math.sin(a) * segL * i;
          this.wz[base + i] = this.wpz[base + i] = rz;
        }
      }
      for (let st = 0; st < steps; st++) {
        const h = dt / steps;
        this.wx[base] = rx; this.wy[base] = ry; this.wz[base] = rz;
        let tx = rx, ty = ry;
        for (let i = 1; i < NWH; i++) {
          const k = base + i;
          const vx = (this.wx[k] - this.wpx[k]) * 0.9, vy = (this.wy[k] - this.wpy[k]) * 0.9, vz = (this.wz[k] - this.wpz[k]) * 0.9;
          this.wpx[k] = this.wx[k]; this.wpy[k] = this.wy[k]; this.wpz[k] = this.wz[k];
          // rest pose: sweeping out then back in a lazy S that ripples over time
          const t = i / (NWH - 1);
          const wave = alive ? Math.sin(this.t * 2.4 - t * 5.0 + w * 1.3) * 0.35 : 0.05;
          const ang = hyaw + sg * (0.9 + 1.6 * t + wave * t);
          tx += Math.cos(ang) * segL; ty += Math.sin(ang) * segL;
          const tz = rz * (1 - t * 0.55) + 0.05 * sc * Math.sin(this.t * 1.9 + i * 0.5) * t;
          const kS = alive ? 4.0 : 1.2;
          this.wx[k] += vx + (tx - this.wx[k]) * kS * h;
          this.wy[k] += vy + (ty - this.wy[k]) * kS * h;
          this.wz[k] += vz + (tz - this.wz[k]) * kS * 2 * h;
          if (this.wz[k] < 0.02 * sc) this.wz[k] = 0.02 * sc;
        }
        for (let it = 0; it < 3; it++) {
          for (let i = 1; i < NWH; i++) {
            const a = base + i - 1, b = base + i;
            const dx = this.wx[b] - this.wx[a], dy = this.wy[b] - this.wy[a], dz = this.wz[b] - this.wz[a];
            const l = Math.hypot(dx, dy, dz) || 1e-6;
            const e = (l - segL) / l;
            if (i === 1) { this.wx[b] -= dx * e; this.wy[b] -= dy * e; this.wz[b] -= dz * e; }
            else {
              this.wx[a] += dx * e * 0.5; this.wy[a] += dy * e * 0.5; this.wz[a] += dz * e * 0.5;
              this.wx[b] -= dx * e * 0.5; this.wy[b] -= dy * e * 0.5; this.wz[b] -= dz * e * 0.5;
            }
          }
        }
      }
      // ribbon
      for (let i = 0; i < NWH; i++) {
        const k = base + i;
        const ka = base + Math.max(0, i - 1), kb = base + Math.min(NWH - 1, i + 1);
        let dx = this.wx[kb] - this.wx[ka], dy = this.wy[kb] - this.wy[ka];
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const wd = (0.021 * (1 - i / NWH) + 0.004) * sc;
        const o = (k * 2) * 3;
        this.wPos[o] = this.wx[k] - dy * wd; this.wPos[o + 1] = this.wy[k] + dx * wd; this.wPos[o + 2] = this.wz[k];
        this.wPos[o + 3] = this.wx[k] + dy * wd; this.wPos[o + 4] = this.wy[k] - dx * wd; this.wPos[o + 5] = this.wz[k];
        this.wNor[o] = -dy * 0.5; this.wNor[o + 1] = dx * 0.5; this.wNor[o + 2] = 0.85;
        this.wNor[o + 3] = dy * 0.5; this.wNor[o + 4] = -dx * 0.5; this.wNor[o + 5] = 0.85;
      }
    }
    this.wInit = true;
    const pa = this.wGeo.getAttribute('position') as THREE.BufferAttribute, na = this.wGeo.getAttribute('normal') as THREE.BufferAttribute;
    pa.needsUpdate = true; na.needsUpdate = true;
  }

  private updateMane(f: RenderFrame, hx: number, hy: number, hyaw: number, sc: number, alive: boolean, dead: number, spd: number, L: number, HS: number) {
    const M = this.mane.instanceMatrix.array as Float32Array;
    const tr = this.track, tube = this.tube, dt = this.dt;
    let k = 0;
    const s0 = 0.5 * sc, s1 = Math.min(L * 0.5, 1.35 * sc);
    const stream = alive ? Math.min(1, 0.4 + spd * 0.08) : 0.2;
    for (let i = 0; i < NMANE; i++) {
      const t = (i + 0.5) / NMANE;
      const s = lerp(s0, s1, (i >> 1) / (NMANE / 2));
      if (tr.gapDist(s) < 0.25 * sc) continue;
      const q = tube.ringAt(s);
      const x = tube.x[q], y = tube.y[q];
      const yaw = Math.atan2(tube.ty[q], tube.tx[q]);
      const w = tube.w[q], top = tube.zc[q] + tube.h[q];
      const sg = (i & 1) === 0 ? 1 : -1;
      const seed = this.maneSeed[i];
      const latK = 0.1 + 0.35 * seed;
      const lat = sg * w * latK;
      const target = alive
        ? 0.22 * Math.sin(this.t * 5.5 + i * 1.3) * (0.6 + 0.4 * stream) - this.turnLag * 0.06
        : 0;
      this.maneLag[i] += (target - this.maneLag[i]) * damp(alive ? 8 : 2, dt);
      const spread = (0.55 + 0.6 * seed) * (1 - 0.3 * stream) + 0.2 * dead;
      const ang = yaw + Math.PI - sg * spread + this.maneLag[i];
      const len = (0.4 + 0.22 * seed) * sc * (1 - 0.35 * t) * (1 - 0.15 * dead);
      const pitch = alive ? 0.32 - 0.12 * stream + 0.08 * Math.sin(this.t * 4 + i) : 0.1 - 0.3 * dead;
      const c = Math.cos(yaw), si = Math.sin(yaw);
      writeTRS(M, k, x - si * lat, y + c * lat, top + 0.005 * sc, ang, pitch, sg * 0.25, len, 0.13 * sc, len * 0.6);
      const red = seed < 0.62;
      if (red) setColor(this.mane, k, 0.62, 0.035, 0.03); else setColor(this.mane, k, 1.0, 0.62, 0.12);
      k++;
    }
    // chin/cheek tufts (in head space)
    const hc = Math.cos(hyaw), hs = Math.sin(hyaw);
    for (let j = 0; j < 6; j++) {
      const sg = (j & 1) === 0 ? 1 : -1;
      const fx = (-0.02 - (j >> 1) * 0.07) * HS, fy = sg * (0.17 + 0.01 * (j >> 1)) * HS;
      const x = hx + hc * fx * sc - hs * fy * sc, y = hy + hs * fx * sc + hc * fy * sc;
      const wav = alive ? 0.15 * Math.sin(this.t * 6 + j) - this.turnLag * 0.04 : 0;
      writeTRS(M, k, x, y, 0.13 * sc, hyaw + Math.PI - sg * (0.55 + 0.1 * (j >> 1)) + wav, 0.15, sg * 0.3, (0.3 - 0.04 * (j >> 1)) * sc, 0.15 * sc, 0.16 * sc);
      if ((j >> 1) === 1) setColor(this.mane, k, 1.0, 0.62, 0.12); else setColor(this.mane, k, 0.7, 0.05, 0.035);
      k++;
    }
    commit(this.mane, k);
    void f;
  }

  private updateFlames(f: RenderFrame, L: number, sc: number, alive: boolean, td: number, dead: number) {
    const tr = this.track;
    const Fm = this.flames.instanceMatrix.array as Float32Array;
    const sT = Math.max(0, L - 0.05 * sc);
    tr.chord(sT - 0.12 * sc, sT + 0.02 * sc, this.smp, this.tmp);
    const x = this.smp.x, y = this.smp.y, yaw = Math.atan2(this.smp.ty, this.smp.tx) + Math.PI;
    const q = this.tube.ringAt(sT);
    const z = this.tube.zc[q] + 0.02 * sc;
    const life = alive ? 1 : Math.max(0, 1 - td / 1.4);
    let nf = 0;
    for (let i = 0; i < NFLAME; i++) {
      const u = i / (NFLAME - 1) - 0.5;
      const fl = 0.75 + 0.25 * Math.sin(this.t * (9 + i * 1.7) + i * 2.1) + 0.12 * Math.sin(this.t * 23 + i * 5);
      const len = (0.62 - Math.abs(u) * 0.5) * sc * fl * (0.25 + 0.75 * life);
      if (len < 0.01) continue;
      const ang = yaw + u * 1.5 + 0.12 * Math.sin(this.t * 5 + i) - this.turnLag * 0.05;
      writeTRS(Fm, nf, x, y, z + 0.008 * i * sc, ang, 0.15, 0, len, (0.2 - Math.abs(u) * 0.08) * sc, len);
      const hot = 0.75 + 0.25 * fl;
      setColor(this.flames, nf, hot * life + 0.1, hot * life * 0.95 + 0.05, hot * life * 0.9 + 0.05);
      nf++;
    }
    commit(this.flames, nf);
    this.flameMat.opacity = 0.95 * (1 - this.ghostK * 0.4);
    // embers drifting off the flame
    this.emberAcc += this.dt * (alive ? 7 : 20 * life);
    while (this.emberAcc > 1) {
      this.emberAcc -= 1;
      const r = this.rng;
      const a = yaw + (r.next() - 0.5) * 1.6;
      const sp = r.range(0.3, 0.9) * sc;
      this.embers.spawn(x + Math.cos(a) * 0.2 * sc, y + Math.sin(a) * 0.2 * sc, z + 0.05, Math.cos(a) * sp, Math.sin(a) * sp, 0.2, r.range(0.4, 0.9), 0.07 * sc, 0.03 * sc, 3.5, 1.6, 0.4, 0.9);
    }
    if (!alive && td < 0.1) for (let i = 0; i < 8; i++) this.clouds.spawn(x, y, 0.1, (this.rng.next() - 0.5) * 0.6, (this.rng.next() - 0.5) * 0.6, 0, 2.2, 0.2 * sc, 0.8 * sc, 0.45, 0.42, 0.4, 0.5, this.rng.next() * 6, 0.3, 1.3);
    void f; void dead;
  }
}
