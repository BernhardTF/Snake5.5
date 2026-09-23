// Volt Eel: a slick olive tube with a pale belly, blunt head, small eyes, a long ventral fin ribbon
// rippling along the length, and crackling cyan-white electric arcs that burst on 'eat'.
import * as THREE from 'three';
import type { RenderFrame } from '../../types';
import { LegendBase } from './common/base';
import { Tube } from './common/tube';
import { BoltBatch } from './common/bolts';
import { SpriteBatch, SpriteMode } from './common/sprites';
import { newSample } from './common/track';
import { NOISE, patch } from './common/mats';
import { clamp, damp, lerp, noShadow, Rng, smooth } from './common/util';

const MAXR = 1400;
const MAXB = 28;
const NP = 12;
const FV = 8;
const CYAN = new THREE.Color('#5ff4ff');

export class EelView extends LegendBase {
  readonly id = 'eel' as const;
  private tube = new Tube({ radial: 18, maxRings: MAXR, flank: 0.92, belly: 0.72 });
  private body: THREE.Mesh;
  private bodyMat: THREE.MeshPhysicalMaterial;
  private u = { uFlash: { value: 0 }, uPulse: { value: -10 }, uDead: { value: 0 }, uCrack: { value: 0 }, uT: { value: 0 } };
  // fin ribbon
  private finGeo = new THREE.BufferGeometry();
  private finPos: Float32Array; private finNor: Float32Array; private finUv: Float32Array;
  private finMat: THREE.MeshPhysicalMaterial;
  private fin: THREE.Mesh;
  private eyes: THREE.InstancedMesh;
  private eyeMat: THREE.MeshBasicMaterial;
  private bolts = new BoltBatch(MAXB * NP * 2 + 64, '#f4ffff', '#2ad4ff', 9, 3.4);
  private glow = new SpriteBatch(96, { mode: SpriteMode.Soft, additive: true, renderOrder: 3 });
  private rng = new Rng(77);
  // bolt state (body coordinates: s along the path, lateral offset, z)
  private bAlive = new Uint8Array(MAXB);
  private bAge = new Float32Array(MAXB); private bLife = new Float32Array(MAXB);
  private bKind = new Uint8Array(MAXB); private bI = new Float32Array(MAXB);
  private bS0 = new Float32Array(MAXB); private bS1 = new Float32Array(MAXB);
  private bL0 = new Float32Array(MAXB); private bL1 = new Float32Array(MAXB);
  private bRe = new Float32Array(MAXB);
  private ps = new Float32Array(MAXB * NP); private pl = new Float32Array(MAXB * NP); private pz = new Float32Array(MAXB * NP);
  private spawnAcc = 0;
  private flash = 0;
  private sinceEat = 99;
  private deathBurst = false;
  private finPhase = 0;
  private wavePhase = 0;
  private amp = 0;
  private smp = newSample();

  constructor() {
    super();
    this.object.name = 'legend-eel';
    this.smoothLen = 0.22;
    const u = this.u;
    this.bodyMat = patch(new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.45, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22,
      emissive: 0xffffff, emissiveIntensity: 1,
    }), {
      uniforms: u,
      vertDecl: 'attribute vec4 aInfo; varying vec4 vInfo;',
      vert: 'vInfo = aInfo;',
      fragDecl: `varying vec4 vInfo; uniform float uFlash, uPulse, uDead, uCrack, uT;\n${NOISE}`,
      color: /* glsl */ `
        float s = vInfo.x;
        float d = 1.0 - abs(vInfo.z - 0.5) * 2.0;    // 1 = spine, 0 = belly
        vec3 back = vec3(0.045, 0.06, 0.018), flank = vec3(0.14, 0.15, 0.05), belly = vec3(0.8, 0.55, 0.22);
        vec3 c = mix(belly, flank, smoothstep(0.18, 0.42, d));
        c = mix(c, back, smoothstep(0.5, 0.82, d));
        // soft darker mottling along the back
        float m = lvn(vec2(s * 5.0, vInfo.z * 22.0)) * 0.6 + lvn(vec2(s * 13.0, vInfo.z * 50.0)) * 0.4;
        c *= 0.78 + 0.45 * m;
        // lateral-line pores: rows of pale dots on the flanks, denser on the head
        float head = 1.0 - smoothstep(0.25, 0.55, s);
        float rows = abs(d - 0.52) < 0.11 ? 1.0 : 0.0;
        float rowsH = (abs(d - 0.75) < 0.12 && head > 0.0) ? 1.0 : 0.0;
        vec2 g = vec2(s / mix(0.085, 0.045, head), d * 14.0);
        vec2 f = fract(g) - 0.5;
        float dot1 = (1.0 - smoothstep(0.12, 0.26, length(f * vec2(1.0, 1.3)))) * max(rows, rowsH);
        c = mix(c, vec3(0.8, 0.72, 0.42), dot1 * 0.7);
        // mouth crease + pale lip at the blunt snout
        float sn = s - vInfo.y;
        float mouth = (1.0 - smoothstep(0.035, 0.075, sn)) * (1.0 - smoothstep(0.28, 0.5, d));
        c = mix(c, vec3(0.01, 0.006, 0.004), mouth * 0.9);
        c = mix(c, c * vec3(0.55, 0.58, 0.62), uDead);
        diffuseColor.rgb = c;
      `,
      rough: 'roughnessFactor = clamp(roughnessFactor + uDead * 0.35, 0.05, 1.0);',
      emissive: /* glsl */ `
        {
          float s = vInfo.x;
          float d = 1.0 - abs(vInfo.z - 0.5) * 2.0;
          float band = smoothstep(0.2, 0.36, d) * (1.0 - smoothstep(0.62, 0.8, d));
          // electrocyte stripes (vertical bands along the organ)
          float st = smoothstep(0.35, 0.9, lvn(vec2(s * 9.0, d * 3.0 + uT * 0.5)) * (0.6 + 0.4 * sin(s * 40.0)));
          float pulse = exp(-pow((s - uPulse) / 0.75, 2.0));
          float crack = uCrack * (0.5 + 0.5 * sin(uT * 37.0 + s * 9.0)) * lvn(vec2(s * 4.0 - uT * 6.0, uT * 3.0));
          float e = band * (st * (uFlash * (0.15 + 2.4 * pulse) + crack * 0.5) + uFlash * pulse * 0.6);
          totalEmissiveRadiance = vec3(0.3, 0.95, 1.0) * e * (1.0 - uDead);
        }
      `,
    });
    this.body = new THREE.Mesh(this.tube.geometry, this.bodyMat);
    this.body.castShadow = true; this.body.receiveShadow = true; this.body.frustumCulled = false;

    // fin skirt: 2 sides x 4 vertices across (root under the belly → rippling free edge)
    const nv = MAXR * FV;
    this.finPos = new Float32Array(nv * 3); this.finNor = new Float32Array(nv * 3); this.finUv = new Float32Array(nv * 2);
    this.finGeo.setAttribute('position', new THREE.BufferAttribute(this.finPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.finGeo.setAttribute('normal', new THREE.BufferAttribute(this.finNor, 3).setUsage(THREE.DynamicDrawUsage));
    this.finGeo.setAttribute('uv', new THREE.BufferAttribute(this.finUv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array((MAXR - 1) * 6 * 6);
    let q = 0;
    for (let i = 0; i < MAXR - 1; i++) for (let sd = 0; sd < 2; sd++) for (let j = 0; j < 3; j++) {
      const a = i * FV + sd * 4 + j, b = a + 1, c = a + FV, d = c + 1;
      if (sd === 1) { idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
      else { idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }
    }
    this.finGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.finGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.finMat = patch(new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      clearcoat: 0.35, clearcoatRoughness: 0.3, iridescence: 0.5, iridescenceIOR: 1.35, depthWrite: true,
    }), {
      uniforms: { uFlash: u.uFlash, uDead: u.uDead },
      vertDecl: 'varying vec2 vFin;', vert: 'vFin = uv;',
      fragDecl: 'varying vec2 vFin; uniform float uFlash, uDead;',
      color: /* glsl */ `
        float across = vFin.x;      // 0 root → 1 edge
        float rays = 0.5 + 0.5 * cos(vFin.y * 150.0);
        vec3 c = mix(vec3(0.025, 0.03, 0.016), vec3(0.075, 0.07, 0.035), across);
        c *= 0.7 + 0.5 * rays;
        c = mix(c, vec3(0.3, 0.2, 0.07), smoothstep(0.85, 1.0, across) * 0.7);
        diffuseColor.rgb = c;
        diffuseColor.a *= mix(1.0, 0.6, across) * (0.7 + 0.3 * rays);
      `,
      emissive: 'totalEmissiveRadiance = vec3(0.2, 0.8, 1.0) * uFlash * 0.5 * smoothstep(0.7, 1.0, vFin.x) * (1.0 - uDead);',
    });
    this.finMat.userData.baseOpacity = 0.9;
    this.fin = new THREE.Mesh(this.finGeo, this.finMat);
    this.fin.frustumCulled = false; this.fin.castShadow = true;

    const eyeGeo = new THREE.SphereGeometry(1, 12, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9ff8ff').multiplyScalar(2.2), toneMapped: false });
    this.eyeMat = eyeMat;
    this.eyes = new THREE.InstancedMesh(eyeGeo, eyeMat, 2);
    this.eyes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.eyes.frustumCulled = false;
    this.solids.push(this.bodyMat, this.finMat);

    this.object.add(this.fin, this.body, this.eyes, noShadow(this.bolts.mesh), this.glow.mesh);
  }

  /** Half width, height ratio of the body at arclength s (no bulge / gaps). */
  private widthAt(s: number, s0: number, L: number, sc: number) {
    const d = s - s0;
    const cap = 0.2 * sc;
    let w = lerp(0.255, 0.3, smooth(0.0, 0.9 * sc, d)) * sc;
    if (d < cap) { const t = 1 - d / cap; w *= Math.sqrt(Math.max(0, 1 - t * t)) * 0.85 + 0.15 * (1 - t); }
    const tailStart = Math.max(1.2 * sc, (L - s0) * 0.45 + s0);
    if (s > tailStart) {
      const t = clamp((s - tailStart) / Math.max(0.1, L - tailStart), 0, 1);
      w *= Math.pow(1 - t, 0.85) * 0.94 + 0.06 * (1 - t);
    }
    return Math.max(0, w);
  }

  protected draw(f: RenderFrame) {
    const sn = f.snake, tr = this.track, tube = this.tube, dt = this.dt;
    const sc = this.r / 0.34;
    const L = tr.L;
    const alive = sn.alive;
    const td = alive ? 0 : sn.deathT;
    const u = this.u;
    u.uT.value = this.t;
    u.uDead.value = alive ? 0 : smooth(0.8, 2.6, td) * 0.8;

    // events: eat → flash + pulse down the body + burst of arcs
    if (this.eats) { this.sinceEat = 0; this.flash = 1; this.burst(10 + 4 * this.eats, L, sc, true); }
    if (this.justDied) { this.deathBurst = true; this.flash = 1.3; this.sinceEat = 0; this.burst(MAXB, L, sc, true); }
    if (alive) this.deathBurst = false;
    this.sinceEat += dt;
    this.flash *= Math.exp(-dt * (alive ? 2.6 : 1.6));
    u.uFlash.value = this.flash * this.glowFade;
    u.uPulse.value = this.sinceEat * 16 - 0.3;
    const crackle = alive ? 0.35 + 0.5 * sn.interest : Math.max(0, 1 - td / 2.5) * 0.8;
    u.uCrack.value = crackle * this.glowFade;

    // gentle swimming undulation (visual only, stays inside the footprint)
    const spd = Math.abs(sn.speed);
    const tAmp = alive ? Math.min(0.05, 0.006 + spd * 0.005) * sc : 0;
    this.amp += (tAmp - this.amp) * damp(3, dt);
    this.wavePhase += dt * (2 + spd * 1.6);
    this.finPhase += dt * (alive ? 9 + spd * 1.2 : Math.max(0, 6 - td * 3));

    // ------------- body tube
    const s0 = -0.13 * sc;
    tube.layout(tr, s0, L, 0.025 * sc, 0.6 * sc, 0.06 * sc);
    const n = tube.rings;
    for (let q = 0; q < n; q++) {
      const s = tube.s[q];
      let w = this.widthAt(s, s0, L, sc);
      const b = this.bulgeAt(f, s, 0.42 * sc);
      w *= 1 + 0.42 * Math.min(1.2, b);
      w *= tr.gapCap(s, 0.28 * sc);
      const d = s - s0;
      const tailT = clamp((s - Math.max(1.2 * sc, (L - s0) * 0.45 + s0)) / Math.max(0.1, L - (L - s0) * 0.45 - s0), 0, 1);
      const hr = lerp(0.72, 0.9, smooth(0.05 * sc, 0.7 * sc, d)) * (1 + 0.35 * tailT);
      const h = w * hr * (1 + 0.2 * Math.min(1, b));
      tube.w[q] = w; tube.h[q] = h; tube.zc[q] = h * 0.74 + 0.004;
      tube.k[q] = s0;
      const grow = smooth(0.4 * sc, 2.5 * sc, d);
      tube.off[q] = this.amp * grow * Math.sin(d * 2.4 / sc - this.wavePhase);
    }
    tube.build();

    // ------------- eyes (small, set wide on the blunt head)
    {
      const se = 0.035 * sc;
      const qi = tube.ringAt(se);
      const tx = tube.tx[qi], ty = tube.ty[qi], w = tube.w[qi], h = tube.h[qi], z = tube.zc[qi];
      const cx = tube.x[qi] - ty * tube.off[qi], cy = tube.y[qi] + tx * tube.off[qi];
      const m = this.eyes.instanceMatrix.array as Float32Array;
      const er = 0.034 * sc;
      for (let e = 0; e < 2; e++) {
        const sg = e === 0 ? 1 : -1;
        const lat = sg * w * 0.62;
        const o = e * 16;
        m.fill(0, o, o + 16);
        m[o] = er; m[o + 5] = er; m[o + 10] = er * 0.8; m[o + 15] = 1;
        m[o + 12] = cx - ty * lat; m[o + 13] = cy + tx * lat; m[o + 14] = z + h * 0.62;
      }
      this.eyes.instanceMatrix.needsUpdate = true;
      const eg = (alive ? 1.2 + 0.5 * Math.sin(this.t * 31) * crackle + 3 * this.flash : 1.5 * Math.max(0, 1 - td / 1.2)) * this.glowFade;
      this.eyeMat.color.setRGB(0.35 * eg + 0.02, 0.95 * eg + 0.02, 1.0 * eg + 0.02);
    }

    // ------------- ventral fin ribbon (rippling travelling wave, peeks out on alternate sides)
    this.buildFin(L, sc, alive, td);

    // ------------- electric arcs
    this.updateBolts(f, L, sc, alive, td);
  }

  private buildFin(L: number, sc: number, alive: boolean, td: number) {
    const tube = this.tube;
    const n = tube.rings;
    const sStart = 0.5 * sc;
    const P = this.finPos, N = this.finNor, U = this.finUv;
    let m = 0;
    const ampK = alive ? 1 : Math.max(0.1, 1 - td * 0.45);
    for (let q = 0; q < n && m < MAXR; q++) {
      const s = tube.s[q];
      if (s < sStart) continue;
      const w = tube.w[q];
      const tx = tube.tx[q], ty = tube.ty[q];
      const sx = -ty, sy = tx;
      const cx = tube.x[q] + sx * tube.off[q], cy = tube.y[q] + sy * tube.off[q];
      // skirt ramps in behind the head, runs to the tail tip
      const env = smooth(sStart, sStart + 0.9 * sc, s) * (1 - smooth(L - 0.12 * sc, L, s)) * this.track.gapCap(s, 0.3 * sc);
      const zr = tube.zc[q] * 0.5;
      for (let sd = 0; sd < 2; sd++) {
        const sg = sd === 0 ? 1 : -1;
        const ph = (s / sc) * 9.0 - this.finPhase + sd * 1.7;
        const rip = Math.sin(ph) * ampK;
        const ext = (0.1 + 0.025 * Math.cos(ph * 0.5 + sd)) * sc * env;
        for (let k = 0; k < 4; k++) {
          const a = k / 3;
          const lat = sg * (w * 0.72 + (w * 0.28 + ext) * a) * (env > 0 ? 1 : 0);
          const z = lerp(zr, 0.035 * sc + rip * 0.045 * sc * env, a * a) + a * (1 - a) * 0.02 * sc;
          const o = (m * FV + sd * 4 + k) * 3;
          P[o] = cx + sx * lat; P[o + 1] = cy + sy * lat; P[o + 2] = z;
          // sheet normal: mostly up, tilted by the ripple slope along s and across
          const dzds = Math.cos(ph) * ampK * 0.045 * 9.0 * env * a * a;
          let nl = -sg * (0.035 * sc - zr) * 0.6, nt = -dzds, nz = 1.0;
          const il = 1 / Math.hypot(nl, nt, nz);
          nl *= il; nt *= il; nz *= il;
          N[o] = sx * nl + tx * nt; N[o + 1] = sy * nl + ty * nt; N[o + 2] = nz;
          U[(m * FV + sd * 4 + k) * 2] = a; U[(m * FV + sd * 4 + k) * 2 + 1] = s;
        }
      }
      m++;
    }
    const g = this.finGeo;
    for (let i = 0; i < FIN_ATTRS.length; i++) {
      const a = g.getAttribute(FIN_ATTRS[i]) as THREE.BufferAttribute;
      a.clearUpdateRanges(); a.addUpdateRange(0, m * FV * a.itemSize); a.needsUpdate = true;
    }
    g.setDrawRange(0, Math.max(0, m - 1) * 36);
  }

  /** Spawn `k` bolts; `hot` = bright eat/death discharge including radial leaps. */
  private burst(k: number, L: number, sc: number, hot: boolean) {
    for (let i = 0; i < k; i++) {
      const kind = hot ? (i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0) : 0;
      this.spawnBolt(kind, L, sc, hot ? 1.4 + this.rng.next() * 0.6 : 1);
    }
  }

  private spawnBolt(kind: number, L: number, sc: number, I: number) {
    let b = -1;
    for (let i = 0; i < MAXB; i++) if (!this.bAlive[i]) { b = i; break; }
    if (b < 0) { let oldest = 0; for (let i = 1; i < MAXB; i++) if (this.bAge[i] / this.bLife[i] > this.bAge[oldest] / this.bLife[oldest]) oldest = i; b = oldest; }
    const r = this.rng;
    this.bAlive[b] = 1; this.bAge[b] = 0; this.bKind[b] = kind; this.bI[b] = I;
    const span = Math.max(0.3 * sc, L - 0.3 * sc);
    if (kind === 2) {
      // radial discharge from the head into the sand ahead / to the sides
      this.bS0[b] = 0.05 * sc; this.bS1[b] = -r.range(0.1, 0.45) * sc;
      this.bL0[b] = r.range(-0.1, 0.1) * sc; this.bL1[b] = r.sign() * r.range(0.25, 0.6) * sc;
      this.bLife[b] = r.range(0.12, 0.3);
    } else if (kind === 1) {
      // leap from the flank down to the sand
      const s = r.range(0.2 * sc, span);
      this.bS0[b] = s; this.bS1[b] = s + r.range(-0.25, 0.25) * sc;
      const sg = r.sign();
      this.bL0[b] = sg * 0.6; this.bL1[b] = sg * r.range(1.5, 2.1);
      this.bLife[b] = r.range(0.1, 0.24);
    } else {
      // crawl along the back
      const len = r.range(0.5, 1.6) * sc;
      const s = r.range(0.05 * sc, Math.max(0.1 * sc, L - len * 0.5));
      this.bS0[b] = s; this.bS1[b] = Math.min(L, s + len);
      this.bL0[b] = r.range(-0.7, 0.7); this.bL1[b] = r.range(-0.7, 0.7);
      this.bLife[b] = r.range(0.12, 0.34);
    }
    this.bRe[b] = 0;
  }

  private jag(b: number, sc: number, L: number) {
    const r = this.rng, kind = this.bKind[b];
    const s0v = this.tube.s[0];
    for (let i = 0; i < NP; i++) {
      const t = i / (NP - 1);
      const env = Math.sin(Math.PI * t) + 0.15;
      const o = b * NP + i;
      let s = lerp(this.bS0[b], this.bS1[b], t);
      if (kind === 2) {
        this.ps[o] = s + (r.next() - 0.5) * 0.06 * sc * env;
        this.pl[o] = lerp(this.bL0[b], this.bL1[b], t) + (r.next() - 0.5) * 0.12 * sc * env;
        this.pz[o] = lerp(0.3, 0.02, t) * sc;
      } else {
        s += (r.next() - 0.5) * 0.05 * sc * env;
        this.ps[o] = clamp(s, s0v, L);
        const l = lerp(this.bL0[b], this.bL1[b], kind === 1 ? t * t : t) + (r.next() - 0.5) * (kind === 1 ? 0.25 : 0.55) * env;
        this.pl[o] = l; // relative to local half width
        this.pz[o] = kind === 1 ? t : r.next();
      }
    }
  }

  private updateBolts(f: RenderFrame, L: number, sc: number, alive: boolean, td: number) {
    const dt = this.dt, r = this.rng, tr = this.track;
    // ambient crackle spawn rate
    let rate: number;
    if (alive) rate = 9 + 9 * f.snake.interest + 40 * this.flash;
    else rate = td < 3 ? 14 * Math.max(0, 1 - td / 3) * (r.next() < 0.5 ? 1 : 0.2) : 0;
    rate *= Math.min(3, 0.4 + L / (12 * sc));
    this.spawnAcc += dt * rate;
    while (this.spawnAcc > 1) {
      this.spawnAcc -= 1;
      this.spawnBolt(r.next() < (alive ? 0.22 : 0.4) ? 1 : 0, L, sc, alive ? 0.7 + r.next() * 0.5 : 0.9);
    }
    const bolts = this.bolts, glow = this.glow;
    bolts.begin(); glow.begin();
    const fade = this.glowFade;
    const o = this.smp;
    const tube = this.tube;
    for (let b = 0; b < MAXB; b++) {
      if (!this.bAlive[b]) continue;
      this.bAge[b] += dt;
      if (this.bAge[b] >= this.bLife[b] || (this.bKind[b] !== 2 && this.bS0[b] > L)) { this.bAlive[b] = 0; continue; }
      this.bRe[b] -= dt;
      if (this.bRe[b] <= 0) { this.jag(b, sc, L); this.bRe[b] = 0.028 + r.next() * 0.03; }
      const tt = this.bAge[b] / this.bLife[b];
      const I = this.bI[b] * (tt < 0.15 ? tt / 0.15 : 1 - (tt - 0.15) / 0.85 * 0.7) * (0.6 + 0.4 * r.next()) * fade;
      bolts.start();
      let mx = 0, my = 0;
      for (let i = 0; i < NP; i++) {
        const k = b * NP + i;
        const s = this.ps[k];
        tr.sample(s, o);
        let lat: number, z: number;
        if (this.bKind[b] === 2) { lat = this.pl[k]; z = this.pz[k]; }
        else {
          const qi = tube.ringAt(clamp(s, tube.s[0], L));
          const w = tube.w[qi] + 0.001, h = tube.h[qi], zc = tube.zc[qi];
          const off = tube.off[qi];
          const rl = this.pl[k];
          if (this.bKind[b] === 1) {
            lat = off + rl * w;
            const a = this.pz[k];
            z = lerp(zc + h * 0.8, 0.012, a);
          } else {
            const cl = clamp(rl, -0.95, 0.95);
            lat = off + cl * w;
            z = zc + h * Math.sqrt(Math.max(0, 1 - cl * cl)) + (0.02 + this.pz[k] * 0.025) * sc;
          }
        }
        const x = o.x - o.ty * lat, y = o.y + o.tx * lat;
        bolts.point(x, y, z);
        if (i === (NP >> 1)) { mx = x; my = y; }
      }
      bolts.flush(0.02 * sc, 0.17 * sc, I);
      glow.push(mx, my, 0.012, 1.1 * sc, 1.1 * sc, 0, CYAN.r, CYAN.g, CYAN.b, 0.32 * I);
    }
    // sand glow along the body during a flash
    if (this.flash > 0.05 && L > 0) {
      const step = Math.max(0.5 * sc, L / 40);
      for (let s = 0; s < L; s += step) {
        const pulse = Math.exp(-Math.pow((s - (this.sinceEat * 16 - 0.3)) / 1.2, 2));
        const a = this.flash * (0.12 + 0.5 * pulse) * fade;
        if (a < 0.02) continue;
        tr.sample(s, o);
        glow.push(o.x, o.y, 0.011, 1.5 * sc, 1.5 * sc, 0, CYAN.r, CYAN.g, CYAN.b, a);
      }
    }
    bolts.end(); glow.end();
  }
}

const FIN_ATTRS = ['position', 'normal', 'uv'] as const;

