// Express: a steam locomotive + tender followed by carriages (one per ~2 cells of length) that ride the
// path like cars on a track (bogie chords). Warm-lit windows, spinning wheels with moving side rods,
// a smokestack puffing at a rate tied to speed, headlamp light on the sand. Death: derail + steam burst.
import * as THREE from 'three';
import type { RenderFrame } from '../../types';
import { LegendBase } from './common/base';
import { newSample } from './common/track';
import { ParticlePool, SpriteBatch, SpriteMode } from './common/sprites';
import { merge, paint, roundedBox, ellipsoid } from './common/geo';
import { basisApply, basisYPR, clamp, commit, damp, hash1, instanced, lerp, noShadow, Rng, setColor, smooth, writeHidden, writeTRS } from './common/util';

const MAXCAR = 300;
const MAXWHEEL = MAXCAR * 8 + 16;
const LOCO_L = 1.36;   // locomotive length (cells)
const TENDER_L = 0.82;
const GAP = 0.2;       // coupling gap between units
const CRIMSON = '#9c1119', BLACK = '#141417', CREAM = '#eadcb8', GOLDL = '#d9b04a', GREY = '#2c2d31';
const WARM = new THREE.Color('#ffc46a');

function cylX(r: number, len: number, x: number, y: number, z: number, seg = 16, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, false);
  g.rotateZ(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
function cylZ(rTop: number, rBot: number, h: number, x: number, y: number, z0: number, seg = 14) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z0 + h / 2);
  return g;
}
function box(lx: number, ly: number, lz: number, x: number, y: number, z0: number) {
  const g = new THREE.BoxGeometry(lx, ly, lz);
  g.translate(x, y, z0 + lz / 2);
  return g;
}

function locoGeo() {
  const P: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: string) => P.push(paint(g, c));
  add(roundedBox(1.26, 0.5, 0.08, 0.02, -0.02, 0, 0.08), BLACK);
  // running boards with red valance
  for (const sg of [1, -1]) {
    add(box(0.78, 0.06, 0.025, 0.14, sg * 0.27, 0.2), BLACK);
    add(box(0.78, 0.012, 0.05, 0.14, sg * 0.3, 0.16), CRIMSON);
  }
  add(cylX(0.19, 0.64, 0.2, 0, 0.33, 22), '#18181c');           // boiler
  add(cylX(0.205, 0.15, 0.585, 0, 0.33, 22), '#2c2c30');         // smokebox
  add(cylX(0.16, 0.03, 0.665, 0, 0.33, 18), '#3a3a3f');          // smokebox door
  add(cylZ(0.088, 0.06, 0.2, 0.55, 0, 0.47), '#101012');         // stack
  add(new THREE.TorusGeometry(0.085, 0.018, 6, 16).translate(0.55, 0, 0.67), '#1a1a1c');
  add(ellipsoid(0.06, 0.06, 0.05, 0.05, 0, 0.51, 12, 8), '#1c1c20'); // sand dome
  // cylinders
  for (const sg of [1, -1]) add(cylX(0.075, 0.22, 0.47, sg * 0.24, 0.17, 12), '#26262a');
  // cab with roof
  add(box(0.4, 0.6, 0.42, -0.38, 0, 0.12), CRIMSON);
  add(box(0.4, 0.61, 0.03, -0.38, 0, 0.36), GOLDL);               // lining
  add(roundedBox(0.48, 0.66, 0.05, 0.03, -0.39, 0, 0.53), '#1a1a1d');
  add(box(0.12, 0.3, 0.02, -0.39, 0, 0.58), '#26262a');           // roof vent
  // buffer beam + cowcatcher
  add(box(0.05, 0.6, 0.08, 0.64, 0, 0.1), CRIMSON);
  const cc = new THREE.Shape();
  cc.moveTo(0.66, -0.28); cc.lineTo(0.66, 0.28); cc.lineTo(0.86, 0.0); cc.closePath();
  const cow = new THREE.ExtrudeGeometry(cc, { depth: 0.1, bevelEnabled: false });
  cow.translate(0, 0, 0.015);
  add(cow, '#b3121a');
  for (let i = -2; i <= 2; i++) {
    const s = box(0.24, 0.012, 0.012, 0, 0, 0);
    s.rotateZ(i * 0.32);
    s.translate(0.74, i * 0.06, 0.12);
    add(s, '#8a8a90');
  }
  return merge(P);
}

function brassGeo() {
  const P: THREE.BufferGeometry[] = [];
  for (const x of [-0.06, 0.12, 0.3, 0.47]) P.push(cylX(0.196, 0.022, x, 0, 0.33, 22));
  P.push(ellipsoid(0.075, 0.075, 0.07, 0.26, 0, 0.5, 14, 10));        // steam dome
  P.push(cylZ(0.022, 0.022, 0.08, -0.12, 0, 0.5, 8));                 // whistle
  P.push(cylZ(0.05, 0.055, 0.07, 0.6, 0, 0.5, 12));                    // lamp housing
  P.push(new THREE.TorusGeometry(0.09, 0.012, 6, 16).translate(0.55, 0, 0.6));
  for (const sg of [1, -1]) P.push(box(0.36, 0.008, 0.012, -0.38, sg * 0.305, 0.3));
  return merge(P);
}

function tenderGeo() {
  const P: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: string) => P.push(paint(g, c));
  add(roundedBox(0.8, 0.5, 0.08, 0.02, 0, 0, 0.08), BLACK);
  add(roundedBox(0.76, 0.6, 0.28, 0.04, 0, 0, 0.14), CRIMSON);
  add(box(0.77, 0.61, 0.025, 0, 0, 0.36), GOLDL);
  const coal = ellipsoid(0.34, 0.26, 0.09, 0.02, 0, 0.4, 20, 10);
  const p = coal.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const n = hash1(i * 7.1) * 0.025;
    p.setZ(i, Math.max(0.39, p.getZ(i) + n));
  }
  coal.computeVertexNormals();
  return { body: merge(P), coal: merge([paint(coal, '#1a1a1c')]) };
}

function carriageGeo() {
  // unit length along x (scaled per instance); real width/height
  const P: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: string) => P.push(paint(g, c));
  add(box(0.96, 0.46, 0.06, 0, 0, 0.08), BLACK);                    // underframe
  add(box(1.0, 0.62, 0.22, 0, 0, 0.13), CRIMSON);                   // lower body
  for (const sg of [1, -1]) add(box(1.0, 0.012, 0.018, 0, sg * 0.312, 0.3), GOLDL); // pinstripe
  // sloped window band (cream) both sides + roof
  const band: number[] = [];
  const idx: number[] = [];
  const prof: [number, number][] = [[-0.31, 0.35], [-0.17, 0.46], [0.17, 0.46], [0.31, 0.35]];
  for (const x of [-0.5, 0.5]) for (const [y, z] of prof) band.push(x, y, z);
  for (let j = 0; j < 3; j++) { const a = j, b = j + 1, c = j + 4, d = j + 5; idx.push(a, c, b, b, c, d); }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(band, 3));
  bg.setIndex(idx);
  bg.computeVertexNormals();
  // colour: cream on the slopes, dark roof in the middle (split vertices by face colours)
  const nb = bg.toNonIndexed();
  const col = new Float32Array(nb.getAttribute('position').count * 3);
  const cr = new THREE.Color(CRIMSON), rf = new THREE.Color('#2a2a2e');
  for (let i = 0; i < col.length / 3; i++) {
    const tri = Math.floor(i / 3);
    const c = tri === 2 || tri === 3 ? rf : cr;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  nb.setAttribute('color', new THREE.BufferAttribute(col, 3));
  nb.computeVertexNormals();
  P.push(nb);
  add(box(1.0, 0.62, 0.02, 0, 0, 0.34), '#7a0d14');                // band sill
  // roof: raised clerestory with vents
  add(roundedBox(0.94, 0.34, 0.07, 0.03, 0, 0, 0.43), '#2e2e33');
  for (const sg of [1, -1]) add(box(1.0, 0.014, 0.012, 0, sg * 0.172, 0.455), GOLDL);
  add(roundedBox(0.8, 0.14, 0.04, 0.015, 0, 0, 0.495), '#4a4a50');
  for (let i = -2; i <= 2; i++) add(cylZ(0.02, 0.024, 0.03, i * 0.17, 0, 0.52, 8), '#1c1c1f');
  // end gangways
  for (const sx of [1, -1]) add(box(0.04, 0.3, 0.3, sx * 0.51, 0, 0.12), '#1a1a1c');
  return merge(P);
}

function windowGeo() {
  // warm window panes laid on the sloped band (unit carriage length)
  const P: THREE.BufferGeometry[] = [];
  const n = 6;
  for (const sg of [1, -1]) for (let i = 0; i < n; i++) {
    const x = -0.4 + (i / (n - 1)) * 0.8;
    const g = new THREE.PlaneGeometry(0.1, 0.11);
    // plane in the sloped band: tilt around x (band slope ≈ 38°)
    g.rotateX(sg * -0.67);
    g.translate(x, sg * 0.24, 0.425);
    P.push(g);
  }
  return merge(P);
}

function wheelGeo() {
  // wheel with alternating tread stripes so the spin reads from above; axle along Y
  const g = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false).toNonIndexed();
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color('#1a1a1c'), b = new THREE.Color('#9a9aa0'), face = new THREE.Color('#8f1218');
  for (let i = 0; i < p.count; i += 3) {
    // triangle centroid
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    let c: THREE.Color;
    if (Math.abs(cy) > 0.49) c = face; // side faces (red spoked wheel)
    else { const ang = Math.atan2(cz, cx); c = Math.floor((ang + Math.PI) / (Math.PI / 4)) % 2 === 0 ? a : b; }
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export class TrainView extends LegendBase {
  readonly id = 'train' as const;
  private loco: THREE.Mesh;
  private brass: THREE.Mesh;
  private tender: THREE.Mesh;
  private lamp: THREE.Mesh;
  private lampMat: THREE.MeshBasicMaterial;
  private cars: THREE.InstancedMesh;
  private wins: THREE.InstancedMesh;
  private wheels: THREE.InstancedMesh;
  private rods: THREE.InstancedMesh;
  private couplers: THREE.InstancedMesh;
  private winMat: THREE.MeshBasicMaterial;
  private smoke = new ParticlePool(140, { mode: SpriteMode.Smoke, drag: 1.1, buoyancy: 0.6, fadeIn: 0.12, renderOrder: 11 });
  private steam = new ParticlePool(80, { mode: SpriteMode.Smoke, drag: 1.6, buoyancy: 0.9, fadeIn: 0.05, renderOrder: 11 });
  private glow = new SpriteBatch(2 * MAXCAR + 16, { mode: SpriteMode.Soft, additive: true, renderOrder: 3 });
  private rng = new Rng(5);
  private smp = newSample();
  private tmp = newSample();
  private p3 = { x: 0, y: 0, z: 0 };
  private nVis = 0;
  private puffAcc = 0;
  private wheelAng = 0;
  private sinceEat = 9;
  private unitSide = new Float32Array(MAXCAR + 2);
  private flick = new Float32Array(MAXCAR);

  constructor() {
    super();
    this.object.name = 'legend-train';
    this.smoothLen = 0.2;
    const paintMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.18 });
    const brassMat = new THREE.MeshPhysicalMaterial({ color: '#dcae48', metalness: 1, roughness: 0.24 });
    const steelMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.35 });
    this.loco = new THREE.Mesh(locoGeo(), paintMat);
    this.brass = new THREE.Mesh(brassGeo(), brassMat);
    const tg = tenderGeo();
    this.tender = new THREE.Mesh(tg.body, paintMat);
    const coalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2 });
    this.tender.add(new THREE.Mesh(tg.coal, coalMat));
    this.solids.push(coalMat);
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2c8').multiplyScalar(5), toneMapped: false });
    this.lamp = noShadow(new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 8).translate(0.645, 0, 0.535), this.lampMat));
    for (const m of [this.loco, this.brass, this.tender, this.lamp]) { m.matrixAutoUpdate = false; m.frustumCulled = false; }
    for (const m of [this.loco, this.brass, this.tender]) { m.castShadow = true; m.receiveShadow = true; }
    this.cars = instanced(carriageGeo(), paintMat, MAXCAR, false);
    this.winMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide });
    this.wins = noShadow(instanced(windowGeo(), this.winMat, MAXCAR, true));
    this.wheels = instanced(wheelGeo(), steelMat, MAXWHEEL, false);
    const rodMat = new THREE.MeshPhysicalMaterial({ color: '#b8b8c0', metalness: 0.9, roughness: 0.25 });
    this.rods = instanced(merge([box(1, 1, 1, 0, 0, -0.5)]), rodMat, 4, false);
    this.couplers = instanced(merge([paint(box(1, 0.1, 0.07, 0, 0, 0.11), '#1a1a1c'), paint(box(0.3, 0.46, 0.03, 0, 0, 0.13), '#26262a')]), steelMat, MAXCAR + 2, false);
    for (const m of [this.cars, this.wheels, this.rods, this.couplers]) { m.castShadow = true; m.receiveShadow = true; }
    this.solids.push(paintMat, brassMat, steelMat, rodMat);
    for (let i = 0; i < this.unitSide.length; i++) this.unitSide[i] = hash1(i * 2.3 + 0.7) < 0.5 ? -1 : 1;
    for (let i = 0; i < MAXCAR; i++) this.flick[i] = hash1(i * 5.1);
    this.object.add(this.loco, this.brass, this.tender, this.lamp, this.cars, this.wins, this.wheels, this.rods, this.couplers,
      this.glow.mesh, this.smoke.mesh, this.steam.mesh);
  }

  /** Place a rigid unit between bogie arclengths; returns yaw and writes position into smp. */
  private unit(sC: number, halfBase: number) {
    this.track.chord(sC - halfBase, sC + halfBase, this.smp, this.tmp);
    return Math.atan2(this.smp.ty, this.smp.tx);
  }

  /** Derail pose for unit u: [roll, yaw kink, lift]. */
  private derail(u: number, td: number, out: { x: number; y: number; z: number }) {
    const d = u * 0.07;
    const k = smooth(d, d + 0.55, td);
    const side = this.unitSide[Math.min(u, this.unitSide.length - 1)];
    const amt = 0.42 + 0.25 * hash1(u * 3.3);
    out.x = k * side * amt;
    out.y = k * side * 0.2 * (u === 0 ? 0.5 : 1);
    out.z = k;
    return out;
  }

  protected draw(f: RenderFrame) {
    const sn = f.snake, tr = this.track, dt = this.dt;
    const sc = this.r / 0.34;
    const L = tr.L;
    const alive = sn.alive;
    const td = alive ? 0 : sn.deathT;
    const spd = alive ? Math.abs(sn.speed) : 0;
    const r = this.rng;
    const dead = alive ? 0 : smooth(0.1, 1.2, td);
    if (this.eats) this.sinceEat = 0;
    this.sinceEat += dt;
    this.wheelAng += (alive ? Math.abs(sn.speed) * dt : 0) / (0.12 * sc);
    const lampOn = (alive ? 1 : (td < 1.2 ? (r.next() < 0.6 ? 1 : 0.1) * (1 - td / 1.2) : 0)) * this.glowFade;
    const glow = this.glow;
    glow.begin();
    const dr = this.p3;

    // ---------------- locomotive
    const sLoco = LOCO_L * 0.5 * sc - 0.12 * sc;
    let yaw = this.unit(sLoco, 0.42 * sc);
    let x = this.smp.x, y = this.smp.y;
    this.derail(0, td, dr);
    const lRoll = alive ? 0 : dr.x, lYaw = yaw + (alive ? 0 : dr.y);
    const lift = Math.abs(lRoll) * 0.3 * sc;
    writeTRS(this.loco.matrix.elements, 0, x, y, lift, lYaw, 0, lRoll, sc, sc, sc);
    const lm = this.loco.matrix.elements;
    this.brass.matrix.fromArray(lm); this.lamp.matrix.fromArray(lm);
    this.loco.matrixWorldNeedsUpdate = this.brass.matrixWorldNeedsUpdate = this.lamp.matrixWorldNeedsUpdate = true;
    this.lampMat.color.setRGB(5 * lampOn + 0.05, 4.6 * lampOn + 0.05, 3.6 * lampOn + 0.05);
    // wheels + rods (3 drivers per side)
    const W = this.wheels.instanceMatrix.array as Float32Array;
    let nw = 0;
    const wr = 0.135 * sc;
    const ang = this.wheelAng;
    for (let i = 0; i < 3; i++) {
      const lx = (-0.38 + i * 0.27) * sc;
      for (let sd = 0; sd < 2; sd++) {
        const sg = sd === 0 ? 1 : -1;
        basisYPR(lYaw, 0, lRoll);
        basisApply(x, y, lift, lx, sg * 0.33 * sc, wr, this.p3);
        writeTRS(W, nw++, this.p3.x, this.p3.y, this.p3.z, lYaw, -ang, lRoll, wr, 0.05 * sc, wr);
      }
    }
    const R = this.rods.instanceMatrix.array as Float32Array;
    for (let sd = 0; sd < 2; sd++) {
      const sg = sd === 0 ? 1 : -1;
      const cx = Math.sin(ang) * 0.06 * sc, cz = Math.cos(ang) * 0.06 * sc;
      basisYPR(lYaw, 0, lRoll);
      basisApply(x, y, lift, -0.11 * sc + cx, sg * 0.37 * sc, wr + cz, this.p3);
      writeTRS(R, sd, this.p3.x, this.p3.y, this.p3.z + 0.012 * sc, lYaw, 0, lRoll, 0.62 * sc, 0.018 * sc, 0.024 * sc);
      // main rod to the cylinder crosshead
      basisYPR(lYaw, 0, lRoll);
      basisApply(x, y, lift, 0.2 * sc + cx * 0.5, sg * 0.37 * sc, 0.17 * sc + cz * 0.5, this.p3);
      writeTRS(R, 2 + sd, this.p3.x, this.p3.y, this.p3.z + 0.012 * sc, lYaw, Math.atan2(cz * 0.5, 0.5), lRoll, 0.5 * sc, 0.016 * sc, 0.02 * sc);
    }
    commit(this.rods, 4);
    // smoke stack puffs (rate tied to speed), headlamp light, whistle steam on eat
    const cyaw = Math.cos(lYaw), syaw = Math.sin(lYaw);
    basisYPR(lYaw, 0, lRoll);
    basisApply(x, y, lift, 0.55 * sc, 0, 0.7 * sc, this.p3);
    const stackX = this.p3.x, stackY = this.p3.y, stackZ = this.p3.z;
    if (alive) {
      const rate = spd > 0.05 ? Math.min(11, 1.6 + spd * 1.25) : 1.2;
      this.puffAcc += dt * rate;
      while (this.puffAcc > 1) {
        this.puffAcc -= 1;
        const g = 0.38 + 0.25 * r.next();
        this.smoke.spawn(stackX, stackY, stackZ, -cyaw * spd * 0.1 + r.range(-0.15, 0.15), -syaw * spd * 0.1 + r.range(-0.15, 0.15), 0.6,
          r.range(1.4, 2.2), 0.16 * sc, r.range(0.75, 1.05) * sc, g, g, g * 1.04, 0.72, r.next() * 6.28, r.range(-0.8, 0.8));
      }
    }
    if (this.eats) {
      basisYPR(lYaw, 0, lRoll);
      basisApply(x, y, lift, -0.12 * sc, 0, 0.62 * sc, this.p3);
      for (let i = 0; i < 10; i++) this.steam.spawn(this.p3.x, this.p3.y, this.p3.z, r.range(-0.3, 0.3), r.range(-0.3, 0.3), 1.2, r.range(0.5, 0.9), 0.06 * sc, 0.35 * sc, 1, 1, 1, 0.7, r.next() * 6, 0.5);
    }
    if (this.justDied) {
      for (let i = 0; i < 34; i++) {
        const a = r.next() * Math.PI * 2, sp = r.range(0.4, 1.8);
        this.steam.spawn(x + r.range(-0.3, 0.3), y + r.range(-0.3, 0.3), 0.3 * sc, Math.cos(a) * sp, Math.sin(a) * sp, r.range(0.3, 1.5), r.range(1.2, 2.4), 0.2 * sc, r.range(0.8, 1.4) * sc, 1, 1, 1, 0.75, r.next() * 6, 0.4);
      }
    }
    if (!alive && td < 2.5 && r.next() < dt * 10 * (1 - td / 2.5)) {
      this.steam.spawn(x + r.range(-0.3, 0.3), y + r.range(-0.3, 0.3), 0.25 * sc, r.range(-0.3, 0.3), r.range(-0.3, 0.3), 0.8, 1.2, 0.15 * sc, 0.6 * sc, 1, 1, 1, 0.45, r.next() * 6, 0.3);
    }
    if (lampOn > 0.02) {
      const lx = x + cyaw * 1.25 * sc, ly = y + syaw * 1.25 * sc;
      glow.push(lx, ly, 0.012, 1.4 * sc, 0.75 * sc, lYaw, WARM.r, WARM.g * 0.95, WARM.b * 0.8, 0.3 * lampOn);
      glow.push(x + cyaw * 0.7 * sc, y + syaw * 0.7 * sc, 0.6 * sc, 0.4 * sc, 0.4 * sc, 0, 1, 0.95, 0.8, 0.5 * lampOn);
    }

    // ---------------- tender
    const sTen = LOCO_L * sc - 0.12 * sc + GAP * sc + TENDER_L * 0.5 * sc;
    const Cp = this.couplers.instanceMatrix.array as Float32Array;
    let nc = 0;
    if (sTen < L + 0.3 * sc) {
      yaw = this.unit(sTen, 0.28 * sc);
      x = this.smp.x; y = this.smp.y;
      this.derail(1, td, dr);
      const tRoll = alive ? 0 : dr.x, tYaw = yaw + (alive ? 0 : dr.y);
      writeTRS(this.tender.matrix.elements, 0, x, y, Math.abs(tRoll) * 0.3 * sc, tYaw, 0, tRoll, sc, sc, sc);
      this.tender.matrixWorldNeedsUpdate = true;
      this.tender.visible = true;
      for (let i = 0; i < 2; i++) for (let sd = 0; sd < 2; sd++) {
        const sg = sd === 0 ? 1 : -1;
        basisYPR(tYaw, 0, tRoll);
        basisApply(x, y, Math.abs(tRoll) * 0.3 * sc, (i === 0 ? 0.24 : -0.24) * sc, sg * 0.315 * sc, 0.1 * sc, this.p3);
        writeTRS(W, nw++, this.p3.x, this.p3.y, this.p3.z, tYaw, -ang * 1.35, tRoll, 0.1 * sc, 0.045 * sc, 0.1 * sc);
      }
      // coupling loco ↔ tender
      const sJ = LOCO_L * sc - 0.12 * sc + GAP * 0.5 * sc;
      this.unit(sJ, 0.12 * sc);
      writeTRS(Cp, nc++, this.smp.x, this.smp.y, 0, Math.atan2(this.smp.ty, this.smp.tx), 0, 0, (GAP + 0.1) * sc, sc, sc);
    } else this.tender.visible = false;

    // ---------------- carriages
    const sCar = sTen + TENDER_L * 0.5 * sc + GAP * sc;
    const avail = L - sCar + 0.25 * sc;
    const target = avail > 0.9 * sc ? Math.max(1, Math.round(avail / (2.0 * sc))) : 0;
    this.nVis += (target - this.nVis) * damp(alive ? 3 : 0, dt);
    if (Math.abs(target - this.nVis) < 0.002) this.nVis = target;
    if (this.nVis > MAXCAR) this.nVis = MAXCAR;
    const nCar = Math.min(MAXCAR, Math.ceil(this.nVis - 1e-3));
    const pitch = avail / Math.max(1, this.nVis);
    const Cm = this.cars.instanceMatrix.array as Float32Array;
    const Wn = this.wins.instanceMatrix.array as Float32Array;
    const winStep = Math.max(1, Math.ceil(nCar / 150));
    for (let i = 0; i < nCar; i++) {
      const a = clamp(this.nVis - i, 0, 1);
      const app = a >= 1 ? 1 : 1 - Math.pow(1 - a, 3);
      const len = (pitch - GAP * sc) * (0.25 + 0.75 * app);
      const sC = sCar + i * pitch + len * 0.5;
      if (tr.crossesGap(sC - len * 0.5 - 0.1, sC + len * 0.5 + 0.1)) { writeHidden(Cm, i); writeHidden(Wn, i); continue; }
      yaw = this.unit(sC, Math.max(0.1, len * 0.5 - 0.28 * sc));
      x = this.smp.x; y = this.smp.y;
      this.derail(2 + i, td, dr);
      const cRoll = alive ? 0 : dr.x, cYaw = yaw + (alive ? 0 : dr.y);
      const b = this.bulgeAt(f, sC, Math.max(0.5, len * 0.45));
      const bounce = alive ? 0.03 * sc * Math.min(1, b) * Math.abs(Math.sin(this.t * 18)) : 0;
      const ws = sc * (0.7 + 0.3 * app) * (1 + 0.05 * Math.min(1, b));
      const cz = Math.abs(cRoll) * 0.3 * sc + bounce;
      writeTRS(Cm, i, x, y, cz, cYaw, 0, cRoll, len, ws, ws);
      writeTRS(Wn, i, x, y, cz, cYaw, 0, cRoll, len, ws, ws);
      // warm windows flicker gently, glow brighter as a meal passes through
      const on = alive ? 1 : Math.max(0, 1 - smooth(0.3 + i * 0.05, 1.2 + i * 0.05, td));
      const fl = 0.85 + 0.15 * Math.sin(this.t * (3 + this.flick[i] * 5) + i * 1.7);
      const I = (1.5 * fl + 2.5 * Math.min(1, b)) * on * this.glowFade * app;
      setColor(this.wins, i, WARM.r * I + 0.03, WARM.g * I + 0.025, WARM.b * I + 0.02);
      if (i % winStep === 0 && I > 0.05) {
        const c = Math.cos(cYaw), s = Math.sin(cYaw);
        for (let sd = 0; sd < 2; sd++) {
          const sg = sd === 0 ? 1 : -1;
          glow.push(x - s * sg * 0.45 * sc, y + c * sg * 0.45 * sc, 0.011, len * 0.95, 0.42 * sc, cYaw, WARM.r, WARM.g * 0.9, WARM.b * 0.7, 0.07 * I);
        }
      }
      // bogie wheels: 2 bogies x 2 axles x 2 sides
      for (let bg = 0; bg < 2; bg++) {
        const sB = sC + (bg === 0 ? -1 : 1) * Math.max(0.1, len * 0.5 - 0.28 * sc);
        tr.sample(sB, this.tmp);
        const byaw = Math.atan2(this.tmp.ty, this.tmp.tx) + (alive ? 0 : dr.y);
        const bx = this.tmp.x, by = this.tmp.y;
        for (let ax = 0; ax < 2; ax++) for (let sd = 0; sd < 2; sd++) {
          if (nw >= MAXWHEEL) break;
          const sg = sd === 0 ? 1 : -1;
          basisYPR(byaw, 0, cRoll);
          basisApply(bx, by, cz, (ax === 0 ? 0.11 : -0.11) * sc * app, sg * 0.315 * ws, 0.085 * ws, this.p3);
          writeTRS(W, nw++, this.p3.x, this.p3.y, this.p3.z, byaw, -ang * 1.6, cRoll, 0.085 * ws, 0.04 * ws, 0.085 * ws);
        }
      }
      // coupling to the unit in front
      const sJ = sC - len * 0.5 - GAP * 0.5 * sc;
      this.unit(sJ, 0.12 * sc);
      writeTRS(Cp, nc++, this.smp.x, this.smp.y, 0, Math.atan2(this.smp.ty, this.smp.tx), 0, 0, (GAP + 0.12) * sc * app, sc * (0.7 + 0.3 * app), sc);
    }
    commit(this.cars, nCar); commit(this.wins, nCar); commit(this.wheels, nw); commit(this.couplers, nc);
    glow.end();
    this.smoke.step(dt); this.smoke.render();
    this.steam.step(dt); this.steam.render();
    this.smoke.material.uniforms.uFade.value = 1 - this.ghostK * 0.5;
    this.steam.material.uniforms.uFade.value = 1 - this.ghostK * 0.5;
    void lerp; void dead;
  }
}
