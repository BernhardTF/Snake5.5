// Cheap CPU-simulated, GPU-drawn point sprites: ambient biome particles + event bursts.
import * as THREE from 'three';
import type { BiomeId, RenderFrame } from '../../types';
import { BIOME_VISUALS, lin } from '../biomeVisuals';

const MAX = 1400;
export const K_GRAIN = 0, K_PETAL = 1, K_SPARK = 2, K_GLINT = 3, K_FOAM = 4, K_WISP = 5, K_RING = 6, K_DUST = 7;

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aParams; // size(world), kind, rotation, additive
uniform float uPx;
varying vec4 vColor;
varying float vKind;
varying float vRot;
varying float vAdd;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  float s = aParams.x * (1.0 + position.z * 0.12);
  gl_PointSize = clamp(s * uPx, 1.0, 256.0);
  vColor = aColor;
  vKind = aParams.y;
  vRot = aParams.z;
  vAdd = aParams.w;
}
`;
const FRAG = /* glsl */ `
varying vec4 vColor;
varying float vKind;
varying float vRot;
varying float vAdd;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float c = cos(vRot), s = sin(vRot);
  q = mat2(c, -s, s, c) * q;
  float a = 0.0;
  int k = int(vKind + 0.5);
  if (k == 0) { a = 1.0 - smoothstep(0.4, 1.0, length(q)); }
  else if (k == 1) {
    // sakura petal: teardrop with notch
    vec2 pq = q * vec2(1.6, 1.0);
    float d = length(pq - vec2(0.0, -0.1)) - 0.6 + 0.35 * max(0.0, -q.y);
    float notch = 1.0 - smoothstep(0.0, 0.15, length(q - vec2(0.0, 0.62)) - 0.12);
    a = (1.0 - smoothstep(-0.05, 0.08, d)) * (1.0 - notch);
  }
  else if (k == 2) { float r = length(q); a = exp(-r * r * 5.0) + 0.6 * exp(-r * r * 40.0); }
  else if (k == 3) {
    float r = length(q);
    float star = max(exp(-abs(q.x) * 18.0) * exp(-abs(q.y) * 2.5), exp(-abs(q.y) * 18.0) * exp(-abs(q.x) * 2.5));
    a = star + exp(-r * r * 30.0);
  }
  else if (k == 4) { a = 1.0 - smoothstep(0.3, 1.0, length(q)); a *= a; }
  else if (k == 5) { vec2 w = q * vec2(1.0, 7.0); a = (1.0 - smoothstep(0.2, 1.0, length(w))); }
  else if (k == 6) { float r = length(q); a = exp(-pow((r - 0.8) / 0.08, 2.0)) + 0.25 * exp(-r * r * 3.0) * (1.0 - smoothstep(0.7, 0.9, r)); }
  else { float r = length(q); a = exp(-r * r * 2.5) * (1.0 - smoothstep(0.8, 1.0, r)); }
  a *= vColor.a;
  if (a < 0.003) discard;
  vec3 col = vColor.rgb;
  if (k == 1) col *= 0.85 + 0.25 * (1.0 - length(q));
  // premultiplied; additive particles write 0 alpha
  gl_FragColor = vec4(col * a, a * (1.0 - vAdd));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Cfg { rate: number; }

export class Particles {
  readonly object: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private par = new Float32Array(MAX * 4);
  // sim state
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private rotV = new Float32Array(MAX);
  private baseA = new Float32Array(MAX);
  private grow = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private base = new Float32Array(MAX * 3); // base colour
  private alive = 0; // number of active (packed at front)
  private biome: BiomeId = 'karesansui';
  private W = 28; private H = 18;
  private acc = 0;
  enabled = true;
  multiplier = 1;
  private tmpC = new THREE.Color();
  private burstCols: THREE.Color[] = [];
  private sandCol = new THREE.Color();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aParams', new THREE.BufferAttribute(this.par, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uPx: { value: 40 } },
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      toneMapped: true,
    });
    this.object = new THREE.Points(this.geo, this.mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
    this.object.userData.noShadow = true;
    this.setBiome('karesansui');
  }

  setPixelsPerUnit(px: number) { this.mat.uniforms.uPx.value = px; }
  setBoard(w: number, h: number) { this.W = w; this.H = h; }
  setBiome(id: BiomeId) {
    this.biome = id;
    const v = BIOME_VISUALS[id];
    this.burstCols = v.burst.map((h) => lin(h));
    this.sandCol.copy(lin(v.sandB));
    this.alive = 0;
  }
  clear() { this.alive = 0; }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number,
    size: number, kind: number, c: THREE.Color, a: number, additive = 0, grav = 0, drag = 0.5, grow = 0) {
    if (this.alive >= MAX) return;
    const i = this.alive++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life;
    this.par[i * 4] = size; this.par[i * 4 + 1] = kind; this.par[i * 4 + 2] = Math.random() * 6.28; this.par[i * 4 + 3] = additive;
    this.rotV[i] = (Math.random() - 0.5) * 3;
    this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b;
    this.baseA[i] = a; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }

  private kill(i: number) {
    const j = --this.alive;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.base.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.par.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.rotV[i] = this.rotV[j];
    this.baseA[i] = this.baseA[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.grow[i] = this.grow[j];
  }

  private ambient(dt: number, f: RenderFrame, waveEdge: number, waveFoam: number) {
    const W = this.W, H = this.H;
    const R = Math.random;
    const rates: Record<BiomeId, number> = { karesansui: 1.3, erg: 10, lagoon: 7, svartsandur: 9, salar: 6 };
    this.acc += dt * rates[this.biome] * this.multiplier;
    const c = this.tmpC;
    while (this.acc >= 1) {
      this.acc -= 1;
      switch (this.biome) {
        case 'karesansui': {
          // petals drift from the maple/sakura corner (top-right) toward lower-left
          const x = W * (0.45 + R() * 0.7), y = H + 0.5 + R() * 1.5;
          c.copy(this.burstCols[Math.floor(R() * this.burstCols.length)]);
          this.spawn(x, y, 1.8 + R(), -0.35 - R() * 0.35, -0.45 - R() * 0.3, -0.18 - R() * 0.1, 14 + R() * 6,
            0.26 + R() * 0.1, K_PETAL, c, 0.95, 0, 0, 0.0);
          break;
        }
        case 'erg': {
          const x = -1 + R() * (W + 2), y = -1 + R() * (H + 2);
          c.copy(this.sandCol).multiplyScalar(1.1);
          this.spawn(x, y, 0.05 + R() * 0.25, 3.2 + R() * 1.5, -2.4 - R() * 1.2, 0, 1.4 + R() * 1.5,
            0.45 + R() * 0.5, K_WISP, c, 0.18 + R() * 0.12, 0, 0, 0.0);
          break;
        }
        case 'lagoon': {
          const x = R() * W;
          const y = Math.min(H + 0.6, waveEdge) + (R() - 0.3) * 0.5;
          c.setRGB(1, 0.98, 0.95);
          this.spawn(x, y, 0.1 + R() * 0.2, (R() - 0.5) * 0.4, -0.3 - R() * 0.6 * (waveFoam + 0.2), 0.8 + R() * 1.2, 0.8 + R() * 0.8,
            0.06 + R() * 0.08, K_FOAM, c, 0.8, 0, 3.0, 0.3);
          break;
        }
        case 'svartsandur': {
          // embers rise from the recent trail (still hot) and random vents
          const s = f.snake;
          let x: number, y: number;
          if (s.count > 10 && R() < 0.75) {
            const k = Math.floor(R() * Math.min(s.count - 1, 260));
            x = s.points[k * 2] + (R() - 0.5) * 0.6; y = s.points[k * 2 + 1] + (R() - 0.5) * 0.6;
          } else { x = R() * W; y = R() * H; }
          c.setRGB(1.0, 0.45 + R() * 0.3, 0.12).multiplyScalar(3.5);
          this.spawn(x, y, 0.05, (R() - 0.5) * 0.3 + 0.1, (R() - 0.5) * 0.3 + 0.15, 0.7 + R() * 0.8, 1.8 + R() * 1.8,
            0.07 + R() * 0.06, K_SPARK, c, 1, 1, -0.2, 0.2);
          break;
        }
        case 'salar': {
          const x = R() * W, y = R() * H;
          c.setRGB(1, 1, 1).multiplyScalar(2.5);
          this.spawn(x, y, 0.02, 0, 0, 0, 0.5 + R() * 0.7, 0.25 + R() * 0.2, K_GLINT, c, 1, 1, 0, 0);
          break;
        }
      }
    }
  }

  private events(f: RenderFrame) {
    const R = Math.random;
    const c = this.tmpC;
    const m = Math.max(0.3, this.multiplier);
    for (const e of f.events) {
      if (e.type === 'eat') {
        const n = Math.round(22 * m);
        for (let i = 0; i < n; i++) {
          const a = R() * 6.283, sp = 0.6 + R() * 1.8;
          c.copy(this.sandCol).multiplyScalar(0.8 + R() * 0.4);
          this.spawn(e.x, e.y, 0.1, Math.cos(a) * sp, Math.sin(a) * sp, 1.5 + R() * 2.5, 0.8 + R() * 0.6, 0.05 + R() * 0.05, K_GRAIN, c, 1, 0, 9, 1.2);
        }
        const kind = this.biome === 'karesansui' || this.biome === 'lagoon' || this.biome === 'salar' ? K_PETAL : K_SPARK;
        const add = kind === K_SPARK ? 1 : 0;
        for (let i = 0; i < Math.round(10 * m); i++) {
          const a = R() * 6.283, sp = 0.4 + R() * 1.2;
          c.copy(this.burstCols[i % this.burstCols.length]);
          if (add) c.multiplyScalar(3);
          this.spawn(e.x, e.y, 0.3, Math.cos(a) * sp, Math.sin(a) * sp, 1.2 + R() * 1.5, 1.4 + R() * 0.8, kind === K_PETAL ? 0.22 : 0.1, kind, c, 1, add, 2.5, 0.8);
        }
        c.copy(this.burstCols[0]).multiplyScalar(e.kind === 'golden' ? 2.5 : 1.2);
        this.spawn(e.x, e.y, 0.05, 0, 0, 0, 0.5, 0.6, K_RING, c, 0.8, 1, 0, 0, 5);
      } else if (e.type === 'death' || e.type === 'hit') {
        const s = f.snake;
        const n = Math.round(40 * m);
        for (let i = 0; i < n; i++) {
          const k = Math.floor(R() * Math.max(1, s.count));
          const x = s.points[k * 2] ?? e.x, y = s.points[k * 2 + 1] ?? e.y;
          const a = R() * 6.283, sp = 0.2 + R() * 0.6;
          c.copy(this.sandCol).multiplyScalar(0.7 + R() * 0.2);
          this.spawn(x, y, 0.2, Math.cos(a) * sp, Math.sin(a) * sp, 0.3, 2.2 + R() * 1.5, 0.5 + R() * 0.6, K_DUST, c, 0.4, 0, 0, 0.8, 0.6);
        }
      } else if (e.type === 'powerup') {
        c.setRGB(0.6, 0.9, 1.4).multiplyScalar(2);
        this.spawn(e.x, e.y, 0.1, 0, 0, 0, 0.7, 0.6, K_RING, c, 1, 1, 0, 0, 9);
        this.spawn(e.x, e.y, 0.1, 0, 0, 0, 0.45, 0.4, K_RING, c, 0.8, 1, 0, 0, 5);
      }
    }
  }

  update(f: RenderFrame, dt: number, waveEdge: number, waveFoam: number) {
    if (this.enabled) {
      this.events(f);
      if (!f.paused) this.ambient(dt, f, waveEdge, waveFoam);
    } else this.alive = 0;
    if (!f.paused) {
      const t = f.time;
      for (let i = this.alive - 1; i >= 0; i--) {
        const L = (this.life[i] += dt);
        const ml = this.maxLife[i];
        if (L >= ml) { this.kill(i); continue; }
        const o = i * 3;
        const kind = this.par[i * 4 + 1];
        const dr = Math.exp(-this.drag[i] * dt);
        this.vel[o] *= dr; this.vel[o + 1] *= dr;
        this.vel[o + 2] -= this.grav[i] * dt;
        if (kind === K_PETAL) {
          // flutter
          this.vel[o] += Math.sin(t * 1.7 + i) * 0.4 * dt;
          this.vel[o + 1] += Math.cos(t * 1.3 + i * 0.7) * 0.3 * dt;
        } else if (kind === K_SPARK) {
          this.vel[o] += Math.sin(t * 3 + i) * 0.5 * dt;
        }
        this.pos[o] += this.vel[o] * dt;
        this.pos[o + 1] += this.vel[o + 1] * dt;
        this.pos[o + 2] += this.vel[o + 2] * dt;
        if (this.pos[o + 2] < 0.01) {
          this.pos[o + 2] = 0.01;
          this.vel[o + 2] = 0; this.vel[o] *= 0.8; this.vel[o + 1] *= 0.8;
          if (kind === K_PETAL) this.rotV[i] *= 0.9;
        }
        this.par[i * 4 + 2] += this.rotV[i] * dt * (kind === K_PETAL ? 1 : 0.2);
        if (this.grow[i] > 0) this.par[i * 4] += this.grow[i] * dt * (1 - L / ml);
        // fade in/out
        const fin = Math.min(1, L / Math.min(0.3, ml * 0.2));
        const fout = Math.min(1, (ml - L) / Math.min(1.2, ml * 0.4));
        let a = this.baseA[i] * fin * fout;
        if (kind === K_GLINT) a *= Math.sin(Math.PI * L / ml);
        if (kind === K_SPARK) a *= 0.75 + 0.25 * Math.sin(t * 20 + i);
        const q = i * 4;
        this.col[q] = this.base[o]; this.col[q + 1] = this.base[o + 1]; this.col[q + 2] = this.base[o + 2]; this.col[q + 3] = a;
      }
    }
    this.geo.setDrawRange(0, this.alive);
    const n = this.alive;
    const pa = this.geo.attributes.position as THREE.BufferAttribute;
    const ca = this.geo.attributes.aColor as THREE.BufferAttribute;
    const ra = this.geo.attributes.aParams as THREE.BufferAttribute;
    pa.clearUpdateRanges(); pa.addUpdateRange(0, n * 3); pa.needsUpdate = true;
    ca.clearUpdateRanges(); ca.addUpdateRange(0, n * 4); ca.needsUpdate = true;
    ra.clearUpdateRanges(); ra.addUpdateRange(0, n * 4); ra.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); }
}
