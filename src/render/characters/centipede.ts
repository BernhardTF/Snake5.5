// Centipede: rigid glossy chitin segments (one per ~0.3 cells), two legs per segment in a
// metachronal gait wave driven by distance travelled, swaying antennae, forcipules and trailing
// ultimate legs (cerci). It never undulates: every plate rides the path like a rigid car.
import * as THREE from 'three';
import type { RenderFrame } from '../../types';
import { LegendBase } from './common/base';
import { newSample } from './common/track';
import { commit, damp, instanced, lerp, setColor, smooth, writeHidden, writeTRS, basisApply, clamp01 } from './common/util';
import { ellipsoid, limb, merge, mirrorY, paint, paintGrad, superDome } from './common/geo';
import { NOISE, patch } from './common/mats';

const MAXSEG = 1700;
const PITCH = 0.3;
const TWO_PI = Math.PI * 2;
const ANT_A = new THREE.Color('#3a1206'), ANT_B = new THREE.Color('#d88a3a'), CERC = new THREE.Color('#e39a30');

function chitinMaterial(light: string, mid: string, dark: string, uDead: THREE.IUniform) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.45, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.1, sheen: 0,
  });
  return patch(m, {
    uniforms: { uLight: { value: new THREE.Color(light) }, uMid: { value: new THREE.Color(mid) }, uDark: { value: new THREE.Color(dark) }, uDead },
    fragDecl: `uniform vec3 uLight, uMid, uDark; uniform float uDead;\n${NOISE}`,
    color: /* glsl */ `
      {
        vec3 p = vLoc;
        float ay = abs(p.y);
        vec3 c = mix(uLight, uMid, smoothstep(0.02, 0.42, ay));
        // dark posterior margin (tail side = -x) and a thinner dark front lip
        float rear = 1.0 - smoothstep(-0.40, -0.14, p.x);
        c = mix(c, uDark, rear * 0.92);
        c *= 1.0 - 0.28 * smoothstep(0.30, 0.48, p.x);
        // paramedian sutures + central keel highlight
        float sut = exp(-pow((ay - 0.15) / 0.018, 2.0));
        c *= 1.0 - 0.38 * sut * (1.0 - rear);
        c += uLight * 0.18 * exp(-ay * ay / 0.004) * (1.0 - rear);
        // lateral rim darker
        c *= 1.0 - 0.45 * smoothstep(0.36, 0.5, ay);
        // micro mottling
        float n = lvn(p.xy * vec2(40.0, 26.0) + vWPos.xy * 3.0);
        c *= 0.9 + 0.2 * n;
        c = mix(c, c * vec3(0.45, 0.42, 0.4), uDead);
        diffuseColor.rgb *= c;
      }`,
    fragReplace: [['#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.clearcoat *= 1.0 - 0.75 * (1.0 - smoothstep(-0.42, -0.2, vLoc.x));']],
    rough: `roughnessFactor = clamp(roughnessFactor + 0.35 * (1.0 - smoothstep(-0.42, -0.2, vLoc.x)) + uDead * 0.3, 0.05, 1.0);`,
  });
}

export class CentipedeView extends LegendBase {
  readonly id = 'centipede' as const;
  private uDead = { value: 0 };
  private plates: THREE.InstancedMesh;
  private membranes: THREE.InstancedMesh;
  private legsL: THREE.InstancedMesh;
  private legsR: THREE.InstancedMesh;
  private beads: THREE.InstancedMesh;
  private head = new THREE.Group();
  private fangL: THREE.Mesh;
  private fangR: THREE.Mesh;
  private smp = newSample();
  private tmp = newSample();
  private p3 = { x: 0, y: 0, z: 0 };
  private cycles = 0;
  private fangOpen = 0;
  private eatT = 9;
  private sway = new Float32Array(4); // antenna L/R, cerci L/R lag state
  private turnLag = 0;
  private legSeed = new Float32Array(MAXSEG * 2);

  constructor() {
    super();
    this.object.name = 'legend-centipede';
    const plateMat = chitinMaterial('#ffbf55', '#d27a22', '#3a1406', this.uDead);
    const headMat = chitinMaterial('#7a2410', '#4a1308', '#180602', this.uDead);
    const memMat = new THREE.MeshStandardMaterial({ color: '#3a2413', roughness: 0.7 });
    const legMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const beadMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, clearcoat: 0.5 });
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: '#050505', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
    const fangMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
    this.solids.push(plateMat, headMat, memMat, legMat, beadMat, eyeMat, fangMat);

    const dome = superDome(44, 8, 3.6, 0.32, 0.55);
    {
      // shingle: low front edge tucks under the previous plate, raised rear margin overlaps the next
      const pa = dome.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), z = pa.getZ(i);
        pa.setZ(i, z * (0.6 + 0.4 * Math.min(1, (0.5 - x) * 1.25)));
      }
      dome.computeVertexNormals();
    }
    this.plates = instanced(dome, plateMat, MAXSEG, true);
    this.membranes = instanced(ellipsoid(0.5, 0.5, 0.5, 0, 0, 0, 10, 6), memMat, MAXSEG, false);

    // leg: hip at origin extending +Y (left side); coxa, femur up to the knee, tibia down to the claw
    const legG = limb(
      [[0, 0, 0], [0.01, 0.085, 0.05], [0.03, 0.175, 0.095], [-0.03, 0.265, 0.04], [-0.065, 0.315, 0.0]],
      [0.036, 0.031, 0.028, 0.021, 0.008], 7,
    );
    paintGradMulti(legG);
    this.legsL = instanced(legG, legMat, MAXSEG, true);
    this.legsR = instanced(mirrorY(legG), legMat, MAXSEG, true);
    this.beads = instanced(ellipsoid(0.5, 0.5, 0.5, 0, 0, 0, 8, 5), beadMat, 64, true);
    for (const m of [this.plates, this.membranes, this.legsL, this.legsR, this.beads]) { m.castShadow = true; m.receiveShadow = true; }

    // head capsule
    const hp = new THREE.Mesh(superDome(40, 8, 2.6, 0.3, 0.5), headMat);
    hp.scale.set(0.36, 0.56, 0.13);
    hp.position.set(-0.01, 0, 0.035);
    const eyes = new THREE.Mesh(merge([
      ellipsoid(0.022, 0.018, 0.016, 0.07, 0.15, 0.16), ellipsoid(0.016, 0.014, 0.013, 0.035, 0.175, 0.15),
      ellipsoid(0.016, 0.014, 0.013, 0.045, 0.135, 0.165), ellipsoid(0.013, 0.012, 0.011, 0.01, 0.16, 0.155),
      ellipsoid(0.022, 0.018, 0.016, 0.07, -0.15, 0.16), ellipsoid(0.016, 0.014, 0.013, 0.035, -0.175, 0.15),
      ellipsoid(0.016, 0.014, 0.013, 0.045, -0.135, 0.165), ellipsoid(0.013, 0.012, 0.011, 0.01, -0.16, 0.155),
    ]), eyeMat);
    // forcipules: stout curved fangs from under the head, tips black
    const fangG = limb([[0, 0, 0], [0.11, 0.035, 0.012], [0.21, 0.0, 0.02], [0.25, -0.08, 0.022], [0.235, -0.115, 0.02]], [0.058, 0.048, 0.032, 0.016, 0.004], 8);
    paintGrad(fangG, 1, -0.1, 0.02, '#080201', '#8a2610');
    this.fangL = new THREE.Mesh(fangG, fangMat);
    this.fangL.position.set(0.04, 0.13, 0.05);
    this.fangR = new THREE.Mesh(mirrorY(fangG), fangMat);
    this.fangR.position.set(0.04, -0.13, 0.05);
    for (const m of [hp, eyes, this.fangL, this.fangR]) { m.castShadow = true; m.receiveShadow = true; this.head.add(m); }
    this.head.matrixAutoUpdate = false;
    for (let i = 0; i < this.legSeed.length; i++) this.legSeed[i] = Math.random();

    this.object.add(this.membranes, this.plates, this.legsL, this.legsR, this.beads, this.head);
  }

  protected draw(f: RenderFrame) {
    const sn = f.snake, tr = this.track, dt = this.dt;
    const sc = this.r / 0.34;
    const L = tr.L;
    const alive = sn.alive;
    const td = alive ? 0 : sn.deathT;
    this.uDead.value = alive ? 0 : smooth(0.4, 2.0, td) * 0.55;
    if (this.eats) this.eatT = 0;
    this.eatT += dt;

    // gait clock: cycles advance with distance; cap the leg frequency so it never aliases
    const spd = Math.abs(sn.speed);
    const stride = Math.max(0.42, spd / 7.5) * sc;
    let thrash = 0;
    if (alive) this.cycles += (spd > 0.05 ? (spd * dt) / stride : dt * 0.35);
    else { thrash = Math.max(0, 1 - td / 1.6); this.cycles += dt * 9 * thrash; }
    const curl = alive ? 0 : smooth(0.5, 2.0, td);
    this.turnLag += (sn.turnRate - this.turnLag) * damp(4, dt);

    // ---------------- head
    const sHead = 0.02 * sc;
    tr.chord(sHead - 0.1 * sc, sHead + 0.12 * sc, this.smp, this.tmp);
    const hx = this.smp.x, hy = this.smp.y, hyaw = Math.atan2(this.smp.ty, this.smp.tx);
    writeTRS(this.head.matrix.elements, 0, hx, hy, 0, hyaw, 0, 0, sc, sc, sc);
    this.head.matrixWorldNeedsUpdate = true;
    // fangs: slow breathing, open with interest, snap on eat
    let open = 0.1 + 0.12 * sn.interest * (0.6 + 0.4 * Math.sin(this.t * 7));
    if (this.eatT < 0.35) open = this.eatT < 0.12 ? 0.55 : lerp(0.55, -0.1, (this.eatT - 0.12) / 0.23);
    if (!alive) open = lerp(0.1, 0.45, curl);
    this.fangOpen += (open - this.fangOpen) * damp(18, dt);
    this.fangL.rotation.z = this.fangOpen; this.fangR.rotation.z = -this.fangOpen;
    this.fangL.updateMatrix(); this.fangR.updateMatrix();

    // ---------------- segments + legs
    const pitch = PITCH * sc;
    const sFirst = 0.3 * sc;
    const sLast = L - 0.08 * sc;
    const nSeg = Math.max(0, Math.min(MAXSEG, Math.floor((sLast - sFirst) / pitch) + 1));
    const P = this.plates.instanceMatrix.array as Float32Array;
    const M = this.membranes.instanceMatrix.array as Float32Array;
    const LL = this.legsL.instanceMatrix.array as Float32Array;
    const LR = this.legsR.instanceMatrix.array as Float32Array;
    const lag = TWO_PI / 7.5;
    const legLen = 1.0;
    let lastX = hx, lastY = hy, lastYaw = hyaw, lastW = 0.5;
    for (let k = 0; k < nSeg; k++) {
      const s = sFirst + k * pitch;
      if (tr.gapDist(s) < 0.2 * sc) {
        writeHidden(P, k); writeHidden(M, k); writeHidden(LL, k); writeHidden(LR, k);
        continue;
      }
      tr.chord(s - 0.15 * sc, s + 0.15 * sc, this.smp, this.tmp);
      const x = this.smp.x, y = this.smp.y, yaw = Math.atan2(this.smp.ty, this.smp.tx);
      const fromTail = L - s;
      const tH = k === 0 ? 0.84 : k === 1 ? 0.94 : 1;
      const tT = lerp(0.55, 1, smooth(0.0, 1.6 * sc, fromTail));
      const grow = clamp01((sLast - s) / (pitch * 0.9) + 0.35); // newest tail plate eases in
      const b = this.bulgeAt(f, s, 0.4 * sc);
      const bw = 1 + 0.3 * Math.min(1.2, b), bh = 1 + 0.35 * Math.min(1.2, b);
      const w = 0.64 * tH * tT * bw * sc * grow;
      const plL = 0.4 * sc * (0.85 + 0.15 * tT) * grow;
      const h = 0.16 * tT * bh * sc;
      writeTRS(P, k, x, y, 0.035 * sc, yaw, 0, 0, plL, w, h);
      writeTRS(M, k, x, y, 0.07 * sc, yaw, 0, 0, 0.44 * sc * grow * tT, w * 0.78, 0.13 * sc * tT);
      // tint: first two segments darker (head colours), last three darker, slight per-plate variation
      const v = 0.94 + 0.12 * this.legSeed[k];
      const hd = k < 2 ? (k === 0 ? 0.45 : 0.7) : 1;
      const tl = lerp(0.5, 1, smooth(0.3 * sc, 1.4 * sc, fromTail));
      const cr = v * hd * tl, cg = v * hd * tl * (k < 2 ? 0.75 : 1), cb = v * hd * tl * (k < 2 ? 0.7 : 1);
      setColor(this.plates, k, cr, cg, cb);
      // legs (metachronal wave head → tail, left/right in antiphase)
      const legScale = sc * lerp(0.72, 1, tT) * (k === 0 ? 0.85 : 1) * grow;
      const splay = -0.12 - 0.28 * (1 - tT) + (k < 2 ? 0.25 : 0);
      for (let side = 0; side < 2; side++) {
        const sgn = side === 0 ? 1 : -1;
        let u = (this.cycles - (k * lag) / TWO_PI + side * 0.5) % 1;
        if (u < 0) u += 1;
        let th: number, lift: number;
        const amp = 0.55;
        if (u < 0.58) { th = amp * (1 - (2 * u) / 0.58); lift = 0; }
        else { const q = (u - 0.58) / 0.42; th = amp * (-1 + 2 * (q * q * (3 - 2 * q))); lift = Math.sin(Math.PI * q) * 0.42; }
        if (!alive) {
          const jit = this.legSeed[k * 2 + side];
          th = th * thrash * (0.6 + 0.8 * jit) * (1 - curl) + curl * (-0.75 - 0.3 * jit);
          lift = lift * thrash * (1 - curl) + curl * (0.75 + 0.35 * jit);
        } else if (spd < 0.05) { th *= 0.35; lift *= 0.4; }
        const ang = yaw + sgn * (splay + th);
        basisYawOffset(x, y, yaw, 0, sgn * w * 0.34, 0.1 * sc, this.p3);
        writeTRS(side === 0 ? LL : LR, k, this.p3.x, this.p3.y, this.p3.z, ang, 0, sgn * lift, legScale * legLen, legScale, legScale);
        const lc = 0.92 + 0.12 * this.legSeed[k * 2 + side];
        setColor(side === 0 ? this.legsL : this.legsR, k, lc * (k < 2 ? 0.8 : 1), lc * (k < 2 ? 0.7 : 1), lc * (k < 2 ? 0.65 : 1));
      }
      lastX = x; lastY = y; lastYaw = yaw; lastW = w;
    }
    commit(this.plates, nSeg); commit(this.membranes, nSeg); commit(this.legsL, nSeg); commit(this.legsR, nSeg);

    // ---------------- antennae (beads) + cerci
    const Bm = this.beads.instanceMatrix.array as Float32Array;
    let nb = 0;
    const NA = 12;
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? 1 : -1;
      const target = alive
        ? 0.16 * Math.sin(this.t * 2.2 + side * 1.9) + 0.07 * Math.sin(this.t * 5.1 + side) * (0.5 + sn.interest) - this.turnLag * 0.05
        : -0.1 * curl;
      this.sway[side] += (target - this.sway[side]) * damp(alive ? 10 : 3, dt);
      let ang = hyaw + sgn * (0.42 + (alive ? 0 : 0.35 * curl)) + this.sway[side] * sgn;
      basisYawOffset(hx, hy, hyaw, 0.12 * sc, sgn * 0.075 * sc, 0.15 * sc, this.p3);
      let ax = this.p3.x, ay = this.p3.y, az = this.p3.z;
      const bend = alive ? 0.035 : 0.06;
      for (let i = 0; i < NA; i++) {
        const segL = 0.047 * sc * (1 - i * 0.02);
        const dx = Math.cos(ang) * segL, dy = Math.sin(ang) * segL;
        const zN = az - (alive ? 0.004 : 0.011) * sc;
        const rad = (0.05 - i * 0.0026) * sc;
        writeTRS(Bm, nb, ax + dx * 0.5, ay + dy * 0.5, (az + zN) * 0.5, ang, 0, 0, segL * 1.15, rad, rad);
        { const q = i / (NA - 1); const c = ANT_A; setColor(this.beads, nb, c.r + (ANT_B.r - c.r) * q, c.g + (ANT_B.g - c.g) * q, c.b + (ANT_B.b - c.b) * q); }
        nb++;
        ax += dx; ay += dy; az = Math.max(0.03 * sc, zN);
        ang += sgn * bend + this.sway[side] * 0.02 * sgn * i;
      }
    }
    // cerci: long ultimate legs trailing from the tail tip
    if (L > 0.5 * sc && nSeg > 0) {
      const sT = Math.min(L, sFirst + (nSeg - 1) * pitch);
      tr.chord(sT - 0.1 * sc, sT + 0.1 * sc, this.smp, this.tmp);
      const tx = this.smp.x, ty = this.smp.y, tyaw = Math.atan2(this.smp.ty, this.smp.tx);
      for (let side = 0; side < 2; side++) {
        const sgn = side === 0 ? 1 : -1;
        const target = alive ? 0.1 * Math.sin(this.t * 1.7 + side * 2.4) + this.turnLag * 0.04 : 0.2 * curl;
        this.sway[2 + side] += (target - this.sway[2 + side]) * damp(5, dt);
        let ang = tyaw + Math.PI - sgn * (0.3 + this.sway[2 + side] * sgn);
        basisYawOffset(tx, ty, tyaw, -0.1 * sc, sgn * lastW * 0.3, 0.1 * sc, this.p3);
        let ax = this.p3.x, ay = this.p3.y;
        for (let i = 0; i < 7; i++) {
          const segL = 0.07 * sc;
          const dx = Math.cos(ang) * segL, dy = Math.sin(ang) * segL;
          const rad = (0.062 - i * 0.005) * sc;
          writeTRS(Bm, nb, ax + dx * 0.5, ay + dy * 0.5, (0.09 - i * 0.008) * sc, ang, 0, 0, segL * 1.2, rad, rad * 0.9);
          { const c = i === 6 ? ANT_A : CERC; setColor(this.beads, nb, c.r, c.g * (1 - i * 0.06), c.b); }
          nb++;
          ax += dx; ay += dy;
          ang -= sgn * 0.035;
        }
      }
    }
    commit(this.beads, nb);
    void lastX; void lastY; void lastYaw;
  }
}

/** world position of a local offset (fwd, left, up) from (x,y,0) with heading yaw. */
function basisYawOffset(x: number, y: number, yaw: number, f: number, l: number, u: number, out: { x: number; y: number; z: number }) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out.x = x + c * f - s * l;
  out.y = y + s * f + c * l;
  out.z = u;
  return out;
}

/** Leg colouring: dark coxa, amber femur/tibia, dark claw tip. */
function paintGradMulti(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  const c0 = new THREE.Color('#4a1f08'), c1 = new THREE.Color('#f39a26'), c2 = new THREE.Color('#ffd257'), cj = new THREE.Color('#8a4a12'), c3 = new THREE.Color('#1e0c04');
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0.08) tmp.copy(c0).lerp(c1, y / 0.08);
    else if (y < 0.17) tmp.copy(c1).lerp(c2, (y - 0.08) / 0.09);
    else if (y < 0.26) tmp.copy(c2);
    else tmp.copy(c2).lerp(c3, Math.min(1, (y - 0.26) / 0.05));
    const j = Math.exp(-Math.pow((y - 0.175) / 0.012, 2)) + Math.exp(-Math.pow((y - 0.265) / 0.01, 2));
    tmp.lerp(cj, Math.min(1, j) * 0.85);
    a[i * 3] = tmp.r; a[i * 3 + 1] = tmp.g; a[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  void paint; void basisApply;
}
