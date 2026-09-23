// Mecha: a serpent automaton of rigid brushed-titanium modules with visible gaps, dark joint cores
// wrapped in glowing cyan servo rings, a wedge head with a sweeping visor scan light, and
// flickering exhaust vents. Death: a shower of sparks, then the lights flicker out.
import * as THREE from 'three';
import type { RenderFrame } from '../../types';
import { LegendBase } from './common/base';
import { newSample } from './common/track';
import { NOISE, patch } from './common/mats';
import { ParticlePool, SpriteBatch, SpriteMode } from './common/sprites';
import { merge, mirrorY, paint, roundedBox } from './common/geo';
import { basisApply, clamp, commit, damp, hash1, instanced, lerp, noShadow, Rng, setColor, smooth, writeHidden, writeTRS } from './common/util';

const MAXSEG = 1500;
const PITCH = 0.36;
const CY = new THREE.Color('#35e6ff');

/** Extruded chamfered armour shell, unit box x∈[-.5,.5], y∈[-.5,.5], z∈[0,1]. Flat shaded. */
function shellGeo(): THREE.BufferGeometry {
  const ring: [number, number][] = [[-0.46, 0.02], [-0.5, 0.36], [-0.42, 0.7], [-0.24, 0.9], [0.24, 0.9], [0.42, 0.7], [0.5, 0.36], [0.46, 0.02]];
  const st: [number, number][] = [[-0.5, 0.8], [-0.4, 1.0], [0.4, 1.0], [0.5, 0.8]]; // x, scale
  const cz = 0.4;
  const P = (x: number, k: number, j: number): [number, number, number] => [x, ring[j][0] * k, cz + (ring[j][1] - cz) * k];
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (let s = 0; s < st.length - 1; s++) {
    for (let j = 0; j < ring.length - 1; j++) {
      const a = P(st[s][0], st[s][1], j), b = P(st[s + 1][0], st[s + 1][1], j);
      const c = P(st[s][0], st[s][1], j + 1), d = P(st[s + 1][0], st[s + 1][1], j + 1);
      tri(a, b, c); tri(b, d, c);
    }
  }
  // end caps
  for (const [x, k, flip] of [[-0.5, 0.8, 1], [0.5, 0.8, 0]] as const) {
    const cc: [number, number, number] = [x, 0, cz];
    for (let j = 0; j < ring.length - 1; j++) {
      const a = P(x, k, j), b = P(x, k, j + 1);
      if (flip) tri(cc, a, b); else tri(cc, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // raised chevron armour plate on top (points toward the head) + side skirts
  const ch = new THREE.Shape();
  ch.moveTo(0.46, 0); ch.lineTo(0.08, 0.3); ch.lineTo(-0.36, 0.3); ch.lineTo(0.0, 0.06); ch.lineTo(0.0, -0.06); ch.lineTo(-0.36, -0.3); ch.lineTo(0.08, -0.3); ch.closePath();
  const plate = new THREE.ExtrudeGeometry(ch, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  plate.translate(-0.02, 0, 0.88);
  const skirts = [];
  for (const sg of [1, -1]) {
    const sk = new THREE.BoxGeometry(0.7, 0.05, 0.22);
    sk.translate(0, sg * 0.49, 0.22);
    skirts.push(paint(sk, '#6a7078'));
  }
  return merge([paint(g, '#ffffff'), paint(plate, '#5a6068'), ...skirts]);
}

function headGeo() {
  const parts: THREE.BufferGeometry[] = [];
  // wedge cranium
  const sh = new THREE.Shape();
  const outline: [number, number][] = [[0.36, 0], [0.22, 0.21], [-0.08, 0.28], [-0.27, 0.2], [-0.27, -0.2], [-0.08, -0.28], [0.22, -0.21]];
  sh.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) sh.lineTo(outline[i][0], outline[i][1]);
  sh.closePath();
  const cr = new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035, bevelSegments: 1 });
  cr.translate(0, 0, 0.07);
  parts.push(paint(cr, '#9aa3ad'));
  // crest plate
  const cs = new THREE.Shape();
  cs.moveTo(0.14, 0); cs.lineTo(0.02, 0.1); cs.lineTo(-0.24, 0.12); cs.lineTo(-0.24, -0.12); cs.lineTo(0.02, -0.1); cs.closePath();
  const crest = new THREE.ExtrudeGeometry(cs, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
  crest.translate(0, 0, 0.3);
  parts.push(paint(crest, '#4a525c'));
  // cheek armour
  for (const sg of [1, -1]) {
    const b = roundedBox(0.24, 0.07, 0.12, 0.02, -0.06, sg * 0.25, 0.08);
    parts.push(paint(b, '#5a626c'));
  }
  // antenna fins
  for (const sg of [1, -1]) {
    const fs = new THREE.Shape();
    fs.moveTo(0, 0); fs.lineTo(-0.26, 0.05); fs.lineTo(-0.3, 0.03); fs.lineTo(-0.06, -0.03); fs.closePath();
    const fin = new THREE.ExtrudeGeometry(fs, { depth: 0.015, bevelEnabled: false });
    fin.rotateX(Math.PI / 2);
    fin.rotateZ(sg * 0.35);
    fin.translate(-0.14, sg * 0.13, 0.36);
    parts.push(paint(fin, '#3a4048'));
  }
  return merge(parts);
}

function visorGeo() {
  // chevron band across the front edges
  const s = new THREE.Shape();
  s.moveTo(0.335, 0); s.lineTo(0.2, 0.19); s.lineTo(0.12, 0.17); s.lineTo(0.25, 0); s.lineTo(0.12, -0.17); s.lineTo(0.2, -0.19); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 });
  g.translate(0, 0, 0.285);
  return g;
}

export class MechaView extends LegendBase {
  readonly id = 'mecha' as const;
  private uShell = { uGhost: { value: 0 }, uT: { value: 0 }, uPower: { value: 1 } };
  private shells: THREE.InstancedMesh;
  private cores: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private vents: THREE.InstancedMesh;
  private head = new THREE.Group();
  private scan: THREE.Mesh;
  private scanMat: THREE.MeshBasicMaterial;
  private jawL: THREE.Mesh; private jawR: THREE.Mesh;
  private beacon: THREE.Mesh;
  private beaconMat: THREE.MeshBasicMaterial;
  private tailSpike: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private ventMat: THREE.MeshBasicMaterial;
  private visorMat: THREE.MeshPhysicalMaterial;
  private glow = new SpriteBatch(420, { mode: SpriteMode.Soft, additive: true, renderOrder: 3 });
  private sparks = new ParticlePool(220, { mode: SpriteMode.Spark, additive: true, gravity: -7, floor: true, drag: 0.6, stretch: 0.05, fadeIn: 0 });
  private smoke = new ParticlePool(40, { mode: SpriteMode.Smoke, drag: 0.8, buoyancy: 0.4, fadeIn: 0.2, renderOrder: 11 });
  private rng = new Rng(21);
  private smp = newSample();
  private tmp = newSample();
  private p3 = { x: 0, y: 0, z: 0 };
  private jawOpen = 0;
  private eatT = 9;
  private power = 1;
  private sparkAcc = 0;
  private segRoll = new Float32Array(MAXSEG);

  constructor() {
    super();
    this.object.name = 'legend-mecha';
    this.smoothLen = 0.2;
    const u = this.uShell;
    const shellMat = patch(new THREE.MeshPhysicalMaterial({
      color: 0xffffff, vertexColors: true, metalness: 0.8, roughness: 0.38, clearcoat: 0.2, clearcoatRoughness: 0.4, emissive: 0xffffff,
    }), {
      uniforms: u,
      fragDecl: `uniform float uGhost, uT, uPower;\n${NOISE}`,
      color: /* glsl */ `
        {
          vec3 p = vLoc;
          // brushed streaks along the module, panel grooves and a dark spine plate
          float br = lvn(vec2(p.x * 6.0, p.y * 180.0)) * 0.6 + lvn(vec2(p.x * 3.0 + 7.0, p.y * 420.0)) * 0.4;
          vec3 ti = vec3(0.46, 0.5, 0.55) * (0.86 + 0.24 * br);
          float groove = max(exp(-pow((abs(p.y) - 0.3) / 0.012, 2.0)), exp(-pow((abs(p.x) - 0.3) / 0.012, 2.0)) * step(0.8, p.z));
          ti *= 1.0 - 0.55 * groove;

          // hazard chevrons on the side skirts
          float chev = step(0.9, fract((p.x + abs(p.y) * 0.6) * 5.0)) * step(p.z, 0.3) * step(0.4, abs(p.y));
          ti = mix(ti, vec3(0.6, 0.45, 0.05), chev * 0.6);
          diffuseColor.rgb *= ti;
        }
      `,
      rough: 'roughnessFactor = clamp(roughnessFactor + 0.2 * lvn(vec2(vLoc.x * 5.0, vLoc.y * 90.0)) - 0.1, 0.12, 1.0);',
      emissive: /* glsl */ `
        {
          float scan = 0.55 + 0.45 * sin(vWPos.y * 60.0 - uT * 8.0);
          totalEmissiveRadiance = vec3(0.1, 0.55, 0.75) * uGhost * (0.25 + 0.5 * scan);
          // tiny status LEDs along the spine plate
          vec2 q = vec2(fract(vLoc.x * 2.0 + 0.5) - 0.5, abs(vLoc.y) - 0.1);
          float led = step(length(q * vec2(1.0, 3.0)), 0.06) * step(0.96, vLoc.z) * step(abs(vLoc.y), 0.2);
          totalEmissiveRadiance += vec3(0.2, 1.4, 1.8) * led * uPower * (0.6 + 0.4 * sin(uT * 4.0 + vWPos.x * 3.0));
        }
      `,
    });
    this.shells = instanced(shellGeo(), shellMat, MAXSEG, true);
    const coreMat = new THREE.MeshPhysicalMaterial({ color: '#23272d', metalness: 0.85, roughness: 0.45 });
    const coreG = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1);
    coreG.rotateZ(Math.PI / 2);
    coreG.translate(0, 0, 0.5);
    this.cores = instanced(coreG, coreMat, MAXSEG + 1, false);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const ringG = new THREE.TorusGeometry(0.5, 0.1, 6, 28);
    ringG.rotateY(Math.PI / 2);
    this.rings = noShadow(instanced(ringG, this.ringMat, MAXSEG + 1, true));
    this.ventMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const ventG = merge([roundedBox(0.1, 0.03, 0.02, 0.008, 0, -0.03, 0), roundedBox(0.1, 0.03, 0.02, 0.008, 0, 0.03, 0)]);
    this.vents = noShadow(instanced(ventG, this.ventMat, MAXSEG, true));
    for (const m of [this.shells, this.cores]) { m.castShadow = true; m.receiveShadow = true; }

    // head
    const headMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.3, clearcoat: 0.3 });
    const hm = new THREE.Mesh(headGeo(), headMat);
    this.visorMat = new THREE.MeshPhysicalMaterial({ color: '#04070a', metalness: 0.3, roughness: 0.05, clearcoat: 1, emissive: '#0a3a48' });
    const visor = new THREE.Mesh(visorGeo(), this.visorMat);
    this.scanMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#aaf6ff').multiplyScalar(5), toneMapped: false });
    this.scan = noShadow(new THREE.Mesh(roundedBox(0.05, 0.075, 0.02, 0.01), this.scanMat));
    const jawMat = new THREE.MeshPhysicalMaterial({ color: '#3c434b', metalness: 0.9, roughness: 0.35 });
    const jawS = new THREE.Shape();
    jawS.moveTo(0, 0); jawS.lineTo(0.2, 0.02); jawS.lineTo(0.17, -0.06); jawS.lineTo(0, -0.05); jawS.closePath();
    const jawG = new THREE.ExtrudeGeometry(jawS, { depth: 0.07, bevelEnabled: false });
    jawG.translate(0, 0, 0.04);
    this.jawL = new THREE.Mesh(jawG, jawMat); this.jawL.position.set(0.2, 0.2, 0);
    this.jawR = new THREE.Mesh(mirrorY(jawG), jawMat); this.jawR.position.set(0.2, -0.2, 0);
    for (const m of [hm, visor, this.jawL, this.jawR]) { m.castShadow = true; m.receiveShadow = true; }
    this.head.add(hm, visor, this.scan, this.jawL, this.jawR);
    this.head.matrixAutoUpdate = false;
    // tail spike + beacon
    const spikeG = new THREE.ConeGeometry(0.1, 0.4, 6);
    spikeG.rotateZ(Math.PI / 2); // point -X
    spikeG.translate(-0.2, 0, 0.14);
    this.tailSpike = new THREE.Mesh(spikeG, jawMat);
    this.tailSpike.castShadow = true;
    this.tailSpike.matrixAutoUpdate = false;
    this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3030').multiplyScalar(4), toneMapped: false });
    this.beacon = noShadow(new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 6), this.beaconMat));
    this.beacon.matrixAutoUpdate = false;

    this.solids.push(shellMat, coreMat, headMat, this.visorMat, jawMat);
    for (let i = 0; i < MAXSEG; i++) this.segRoll[i] = hash1(i * 1.31) * 2 - 1;
    this.object.add(this.cores, this.shells, this.rings, this.vents, this.head, this.tailSpike, this.beacon, this.glow.mesh, this.sparks.mesh, this.smoke.mesh);
  }

  protected draw(f: RenderFrame) {
    const sn = f.snake, tr = this.track, dt = this.dt;
    const sc = this.r / 0.34;
    const L = tr.L;
    const alive = sn.alive;
    const td = alive ? 0 : sn.deathT;
    const r = this.rng;
    const dead = alive ? 0 : smooth(0.2, 1.6, td);
    this.uShell.uT.value = this.t;
    this.uShell.uGhost.value = this.ghostK;
    if (this.eats) this.eatT = 0;
    this.eatT += dt;

    // power: stable while alive; on death it stutters and dies within ~2.2 s
    if (alive) this.power += (1 - this.power) * damp(4, dt);
    else {
      const base = Math.max(0, 1 - td / 2.2);
      const flick = r.next() < 0.35 + 0.4 * base ? 1 : 0.1;
      this.power = base * base * flick;
    }
    const P = this.power * this.glowFade;
    this.uShell.uPower.value = P;

    // death: sparks from every joint + smoke, then quiet
    if (this.justDied) this.deathBurst(L, sc);
    if (!alive && td < 1.8) {
      this.sparkAcc += dt * 60 * (1 - td / 1.8);
      while (this.sparkAcc > 1) { this.sparkAcc -= 1; this.sparkAt(r.range(0, L), sc, 1, 5); }
    }

    // ---------------- head
    const sH = 0.14 * sc;
    tr.chord(sH - 0.14 * sc, sH + 0.16 * sc, this.smp, this.tmp);
    const hx = this.smp.x, hy = this.smp.y, hyaw = Math.atan2(this.smp.ty, this.smp.tx);
    writeTRS(this.head.matrix.elements, 0, hx, hy, -0.02 * sc * dead, hyaw, -0.06 * dead, 0.08 * dead, sc, sc, sc);
    this.head.matrixWorldNeedsUpdate = true;
    // visor scan: ping-pong sweep along the chevron
    const scanU = alive ? Math.sin(this.t * 2.6) : Math.sin(this.t * 9) * (1 - dead);
    {
      const a = Math.abs(scanU);
      const sg = scanU >= 0 ? 1 : -1;
      this.scan.position.set(0.3 - a * 0.13, sg * a * 0.18, 0.325);
      this.scan.rotation.z = -sg * 0.95 * Math.min(1, a * 4);
      this.scan.updateMatrix();
      this.scanMat.color.setRGB(0.66 * 5 * P + 0.02, 0.96 * 5 * P + 0.02, 5 * P + 0.02);
      this.visorMat.emissive.setRGB(0.02 * P, 0.14 * P, 0.2 * P);
    }
    let jaw = 0.05 + 0.18 * sn.interest * (0.5 + 0.5 * Math.sin(this.t * 6));
    if (this.eatT < 0.4) jaw = this.eatT < 0.12 ? 0.6 : lerp(0.6, 0, (this.eatT - 0.12) / 0.28);
    if (!alive) jaw = 0.25 * dead;
    this.jawOpen += (jaw - this.jawOpen) * damp(20, dt);
    this.jawL.rotation.z = this.jawOpen; this.jawR.rotation.z = -this.jawOpen;
    this.jawL.updateMatrix(); this.jawR.updateMatrix();

    // ---------------- modules
    const pitch = PITCH * sc;
    const sFirst = 0.54 * sc;
    const sLast = L - 0.2 * sc;
    const nSeg = Math.max(0, Math.min(MAXSEG, Math.floor((sLast - sFirst) / pitch) + 1));
    const S = this.shells.instanceMatrix.array as Float32Array;
    const C = this.cores.instanceMatrix.array as Float32Array;
    const R = this.rings.instanceMatrix.array as Float32Array;
    const V = this.vents.instanceMatrix.array as Float32Array;
    const glow = this.glow;
    glow.begin();
    let nv = 0;
    const wave = this.t * 2.2;
    const glowStep = Math.max(1, Math.ceil(nSeg / 380));
    let lastX = hx, lastY = hy, lastYaw = hyaw, lastW = 1;
    for (let k = 0; k <= nSeg; k++) {
      // joint k sits in front of module k (joint 0 = neck)
      const sj = sFirst + (k - 0.5) * pitch;
      const hideJ = sj > sLast || tr.gapDist(sj) < 0.22 * sc;
      const fromTail = L - sj;
      const tT = lerp(0.5, 1, smooth(0, 2.2 * sc, fromTail));
      if (!hideJ) {
        tr.sample(sj, this.smp);
        const yaw = Math.atan2(this.smp.ty, this.smp.tx);
        const b = this.bulgeAt(f, sj, 0.45 * sc);
        const js = sc * tT * (1 + 0.25 * Math.min(1, b));
        const sag = -0.015 * sc * dead;
        writeTRS(C, k, this.smp.x, this.smp.y, sag + 0.02 * sc, yaw, 0, 0, 0.16 * sc, 0.34 * js, 0.3 * js);
        writeTRS(R, k, this.smp.x, this.smp.y, sag + 0.14 * js, yaw, 0, 0, 0.32 * sc, 0.36 * js, 0.36 * js);
        const pulse = 0.55 + 0.45 * Math.sin(wave - k * 0.55);
        const I = P * (0.7 + 1.5 * pulse + 3.5 * Math.min(1, b)) * (alive ? 1 : (r.next() < 0.5 ? 1 : 0.2));
        setColor(this.rings, k, CY.r * I, CY.g * I, CY.b * I);
        if (k % (glowStep * 2) === 0 && P > 0.02) glow.push(this.smp.x, this.smp.y, 0.012, 0.85 * sc, 0.85 * sc, 0, CY.r, CY.g, CY.b, 0.1 * P * (0.6 + 0.4 * pulse + Math.min(1, b)));
      } else { writeHidden(C, k); writeHidden(R, k); }
      if (k === nSeg) break;
      const s = sFirst + k * pitch;
      if (tr.gapDist(s) < 0.25 * sc) { writeHidden(S, k); continue; }
      tr.chord(s - 0.16 * sc, s + 0.16 * sc, this.smp, this.tmp);
      const x = this.smp.x, y = this.smp.y, yaw = Math.atan2(this.smp.ty, this.smp.tx);
      const tTs = lerp(0.5, 1, smooth(0, 2.2 * sc, L - s));
      const b = this.bulgeAt(f, s, 0.45 * sc);
      const bw = 1 + 0.3 * Math.min(1.2, b);
      const w = 0.66 * sc * tTs * bw;
      const h = 0.29 * sc * lerp(0.7, 1, tTs) * (1 + 0.2 * Math.min(1, b));
      const roll = this.segRoll[k] * 0.06 * dead;
      writeTRS(S, k, x, y, -0.012 * sc * dead, yaw, 0, roll, 0.3 * sc * lerp(0.8, 1, tTs), w, h);
      const tint = 0.92 + 0.1 * this.segRoll[k] * 0.5;
      setColor(this.shells, k, tint, tint, tint * 1.02);
      // exhaust vents on every third module
      if (k % 3 === 1 && nv < MAXSEG) {
        basisApply(x, y, -0.012 * sc * dead, -0.04 * 0.3 * sc, 0, h * 0.905, this.p3);
        for (let sd = 0; sd < 2; sd++) {
          const sg = sd === 0 ? 1 : -1;
          const lx = -Math.sin(yaw) * sg * w * 0.28, ly = Math.cos(yaw) * sg * w * 0.28;
          writeTRS(V, nv, this.p3.x + lx, this.p3.y + ly, this.p3.z, yaw, 0, roll, sc, sc * tTs, sc);
          const fl = (0.55 + 0.45 * Math.sin(this.t * 17 + k * 3.1 + sd) * Math.sin(this.t * 7.3 + k)) * P;
          const e = alive ? fl * 3.2 : fl * 1.5;
          setColor(this.vents, nv, 1.0 * e + 0.04, 0.32 * e + 0.03, 0.06 * e + 0.03);
          nv++;
        }
        if (alive && r.next() < dt * 1.2 * P) {
          this.smoke.spawn(this.p3.x, this.p3.y, this.p3.z + 0.05, 0, 0, 0.3, 1.0, 0.08 * sc, 0.35 * sc, 0.75, 0.76, 0.8, 0.18, r.next() * 6, 0.4);
        }
      }
      lastX = x; lastY = y; lastYaw = yaw; lastW = tTs;
    }
    commit(this.shells, nSeg); commit(this.cores, nSeg + 1); commit(this.rings, nSeg + 1); commit(this.vents, nv);

    // ---------------- tail spike + beacon
    {
      const sT = Math.min(L, sFirst + Math.max(0, nSeg - 1) * pitch);
      tr.chord(sT - 0.12 * sc, sT + 0.12 * sc, this.smp, this.tmp);
      const x = this.smp.x, y = this.smp.y, yaw = Math.atan2(this.smp.ty, this.smp.tx);
      const ts = sc * lerp(0.6, 1, lastW);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const bx = x - c * 0.14 * sc, by = y - s * 0.14 * sc;
      writeTRS(this.tailSpike.matrix.elements, 0, bx, by, 0, yaw, 0, 0, ts, ts, ts);
      this.tailSpike.matrixWorldNeedsUpdate = true;
      const tipX = bx - c * 0.36 * ts, tipY = by - s * 0.36 * ts;
      const blink = (this.t % 1.1) < 0.12 ? 1 : 0.08;
      const bI = P * blink;
      writeTRS(this.beacon.matrix.elements, 0, tipX, tipY, 0.15 * ts, yaw, 0, 0, 1, 1, 1);
      this.beacon.matrixWorldNeedsUpdate = true;
      this.beaconMat.color.setRGB(4 * bI + 0.05, 0.4 * bI + 0.02, 0.4 * bI + 0.02);
      if (bI > 0.3) glow.push(tipX, tipY, 0.012, 0.9 * sc, 0.9 * sc, 0, 1, 0.15, 0.1, 0.35 * bI);
      this.tailSpike.visible = nSeg > 0;
      this.beacon.visible = nSeg > 0;
    }

    // ---------------- visor scan beam on the sand ahead
    if (P > 0.03) {
      const ang = hyaw - scanU * 0.55;
      const c = Math.cos(ang), s = Math.sin(ang);
      const reach = 0.95 * sc;
      const ox = hx + Math.cos(hyaw) * 0.3 * sc, oy = hy + Math.sin(hyaw) * 0.3 * sc;
      glow.push(ox + c * reach * 0.5, oy + s * reach * 0.5, 0.013, reach, 0.26 * sc, ang, CY.r, CY.g, CY.b, 0.22 * P);
      glow.push(ox + c * reach, oy + s * reach, 0.014, 0.26 * sc, 0.26 * sc, 0, 0.6, 1, 1, 0.35 * P);
    }
    glow.end();
    this.sparks.step(dt); this.sparks.render();
    this.smoke.step(dt); this.smoke.render();
    void lastX; void lastY; void lastYaw; void clamp;
  }

  private sparkAt(s: number, sc: number, k: number, n: number) {
    const tr = this.track, r = this.rng;
    if (tr.gapDist(s) < 0.2) return;
    tr.sample(s, this.smp);
    for (let i = 0; i < n; i++) {
      const a = r.next() * Math.PI * 2;
      const sp = r.range(0.8, 3.2) * k * sc;
      const hot = r.next();
      this.sparks.spawn(this.smp.x, this.smp.y, 0.28 * sc, Math.cos(a) * sp, Math.sin(a) * sp, r.range(0.5, 2.6), r.range(0.3, 0.8),
        0.13 * sc, 0.06 * sc, 5, 2.4 + 1.6 * hot, 0.6 + 1.4 * hot, 1);
    }
  }

  private deathBurst(L: number, sc: number) {
    const r = this.rng;
    for (let i = 0; i < 16; i++) this.sparkAt(r.range(0, Math.max(0.1, L)), sc, 1.3, 6);
    this.sparkAt(0.1 * sc, sc, 1.6, 20);
    for (let i = 0; i < 10; i++) {
      this.track.sample(r.range(0, Math.max(0.1, L)), this.smp);
      this.smoke.spawn(this.smp.x, this.smp.y, 0.3 * sc, r.range(-0.2, 0.2), r.range(-0.2, 0.2), 0.3, r.range(1.5, 2.5), 0.2 * sc, 0.8 * sc, 0.3, 0.3, 0.32, 0.55, r.next() * 6, 0.3);
    }
  }
}
