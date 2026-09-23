// Cheap CPU-simulated, GPU-drawn point sprites: ambient biome particles + event bursts.
import * as THREE from 'three';
import type { BiomeId, RenderFrame } from '../../types';
import { BIOME_VISUALS, lin } from '../biomeVisuals';
import { dustDevilPosInto, dustDevilStrength, type DustDevilPos } from './dustDevils';

const MAX = 1400;
export const K_GRAIN = 0, K_PETAL = 1, K_SPARK = 2, K_GLINT = 3, K_FOAM = 4, K_WISP = 5, K_RING = 6, K_DUST = 7;
/** Soft bird silhouette (shadow), heading +y in sprite space. */
export const K_BIRD = 8;
/** Faceted crystal / salt shard. */
export const K_SHARD = 9;

// per-particle behaviours (on top of the generic drag/gravity integration)
const B_NONE = 0, B_BLINK = 1, B_DEVIL = 2, B_STEAM = 3, B_STICK = 4, B_DRIFT = 5, B_SPLASH = 6;

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
  else if (k == 7) { float r = length(q); a = exp(-r * r * 2.5) * (1.0 - smoothstep(0.8, 1.0, r)); }
  else if (k == 8) {
    // gull seen from below: swept, slightly cranked wings, slim body, short tail
    float ax = abs(q.x);
    float wy = 0.1 + 0.2 * ax - 0.38 * ax * ax;
    float ww = 0.13 * (1.0 - pow(min(ax / 0.95, 1.0), 1.6)) + 0.015;
    float wing = (1.0 - smoothstep(ww - 0.05, ww + 0.05, abs(q.y - wy))) * (1.0 - smoothstep(0.88, 0.98, ax));
    float body = 1.0 - smoothstep(0.05, 0.11, length(q * vec2(1.0, 0.26) - vec2(0.0, 0.0)));
    float tail = (1.0 - smoothstep(0.08, 0.14, ax + (q.y + 0.35) * 0.25)) * step(q.y, -0.2) * step(-0.52, q.y);
    a = max(max(wing, body), tail);
  }
  else {
    // shard: elongated faceted diamond, lit half brighter
    float dm = abs(q.x) / 0.34 + abs(q.y);
    a = 1.0 - smoothstep(0.82, 1.0, dm);
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  vec3 col = vColor.rgb;
  if (k == 1) col *= 0.85 + 0.25 * (1.0 - length(q));
  if (k == 9) col *= q.x > 0.0 ? 1.25 : 0.7;
  // premultiplied; additive particles write 0 alpha
  gl_FragColor = vec4(col * a, a * (1.0 - vAdd));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Ambient spawn rate per second at multiplier 1. */
const RATES: Record<BiomeId, number> = {
  karesansui: 1.3, erg: 10, lagoon: 7, svartsandur: 9, salar: 6,
  pinksands: 5, vaadhoo: 7, dallol: 5, luna: 0.25, mars: 5, titan: 24, kepler: 4.5,
};
/** Eat-burst palettes for the expansion worlds (sRGB). Older worlds use BiomeVisual.burst. */
const NEW_BURST: Partial<Record<BiomeId, string[]>> = {
  pinksands: ['#ff8fb8', '#ffd3e2', '#e8456f', '#fff4ea'],
  vaadhoo: ['#5ff6ff', '#2fb8ff', '#b8fff6'],
  dallol: ['#fffdf2', '#f6f2b0', '#ffd23a', '#5fe3c6'],
  luna: ['#dff3ff', '#9fd8ff', '#ffffff'],
  mars: ['#eaf6ff', '#bfe3ff', '#ffffff'],
  titan: ['#ff9b3d', '#c86a2a', '#ffcf8a'],
  kepler: ['#ff4fd8', '#4ff0ff', '#b98cff', '#ffffff'],
};
const DUST_DEVILS = 2;

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
  private beh = new Uint8Array(MAX);        // behaviour id (B_*)
  private aux = new Float32Array(MAX * 2);  // behaviour params (blink phase/rate, devil index/angle...)
  private alive = 0; // number of active (packed at front)
  private biome: BiomeId = 'karesansui';
  private W = 28; private H = 18;
  private acc = 0;
  enabled = true;
  multiplier = 1;
  private tmpC = new THREE.Color();
  private burstCols: THREE.Color[] = [];
  private sandCol = new THREE.Color();
  private dustCol = new THREE.Color();
  private devilCol = lin('#c68a5e');
  private devil: DustDevilPos = { x: 0, y: 0, r: 1 };
  private birdT = 4;
  private fogT = 0;
  private devAcc = new Float32Array(DUST_DEVILS);
  private devX = new Float32Array(DUST_DEVILS);
  private devY = new Float32Array(DUST_DEVILS);
  private devR = new Float32Array(DUST_DEVILS);

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
    const v = BIOME_VISUALS[id] ?? BIOME_VISUALS.karesansui;
    this.burstCols = (NEW_BURST[id] ?? v.burst).map((h) => lin(h));
    this.sandCol.copy(lin(v.sandB));
    this.dustCol.copy(lin(v.sandA));
    this.alive = 0;
    this.birdT = 3 + Math.random() * 4;
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
    this.beh[i] = B_NONE;
    const q = i * 4;
    this.col[q] = c.r; this.col[q + 1] = c.g; this.col[q + 2] = c.b; this.col[q + 3] = 0;
  }
  /** A random point on the recent snake trail (fresh cracks / wake), or -1 if the snake is too short. */
  private trailPoint(f: RenderFrame, fresh: number): number {
    const s = f.snake;
    if (s.count <= 10) return -1;
    return Math.floor(Math.random() * Math.min(s.count - 1, fresh));
  }
  /** Give the most recently spawned particle a behaviour (and optionally a fixed rotation). */
  private tag(b: number, a0 = 0, a1 = 0, rot?: number) {
    const i = this.alive - 1;
    if (i < 0) return;
    this.beh[i] = b; this.aux[i * 2] = a0; this.aux[i * 2 + 1] = a1;
    if (rot !== undefined) { this.par[i * 4 + 2] = rot; this.rotV[i] = 0; }
  }

  private kill(i: number) {
    const j = --this.alive;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.base.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.par.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.col.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.rotV[i] = this.rotV[j];
    this.baseA[i] = this.baseA[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.grow[i] = this.grow[j];
    this.beh[i] = this.beh[j]; this.aux[i * 2] = this.aux[j * 2]; this.aux[i * 2 + 1] = this.aux[j * 2 + 1];
  }

  private ambient(dt: number, f: RenderFrame, waveEdge: number, waveFoam: number) {
    const W = this.W, H = this.H;
    const R = Math.random;
    this.acc += dt * RATES[this.biome] * this.multiplier;
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
        case 'pinksands': {
          // shell grit and quartz catching the tropical sun
          c.setRGB(1, 0.94, 0.96).multiplyScalar(2.2);
          this.spawn(R() * W, R() * H, 0.02, 0, 0, 0, 0.3 + R() * 0.45, 0.09 + R() * 0.1, K_GLINT, c, 1, 1, 0, 0);
          break;
        }
        case 'vaadhoo': {
          // bioluminescent motes: stirred up in the snake's wake, or drifting anywhere
          const k = R() < 0.45 ? this.trailPoint(f, 220) : -1;
          const s = f.snake;
          const x = k >= 0 ? s.points[k * 2] + (R() - 0.5) * 0.9 : -0.5 + R() * (W + 1);
          const y = k >= 0 ? s.points[k * 2 + 1] + (R() - 0.5) * 0.9 : -0.5 + R() * (H + 1);
          c.setRGB(0.12, 0.72 + 0.25 * R(), 1.0).multiplyScalar(2.0 + R() * 1.6);
          this.spawn(x, y, 0.03 + R() * 0.3, (R() - 0.5) * 0.15, (R() - 0.5) * 0.15, 0.02, 3 + R() * 4,
            0.05 + R() * 0.07, K_SPARK, c, 1, 1, 0, 0.3);
          this.tag(B_BLINK, R() * 6.28, 1.2 + R() * 2.4);
          break;
        }
        case 'dallol': {
          // steam wisps: from fresh cracks behind the snake and a few vents that move every ~25 s
          const r = R();
          const k = r < 0.4 ? this.trailPoint(f, 60) : -1;
          let x: number, y: number;
          if (k >= 0) { x = f.snake.points[k * 2] + (R() - 0.5) * 0.4; y = f.snake.points[k * 2 + 1] + (R() - 0.5) * 0.4; }
          else if (r < 0.8) {
            const vi = Math.floor(R() * 4), sd = Math.floor(f.time / 25) * 4 + vi;
            const hx = Math.sin(sd * 12.9898) * 43758.5453, hy = Math.sin(sd * 78.233) * 43758.5453;
            x = (hx - Math.floor(hx)) * W + (R() - 0.5) * 0.3; y = (hy - Math.floor(hy)) * H + (R() - 0.5) * 0.3;
          } else { x = R() * W; y = R() * H; }
          c.setRGB(1, 1, 1);
          this.spawn(x, y, 0.05, 0.12 + (R() - 0.5) * 0.1, 0.05 + (R() - 0.5) * 0.1, 0.35 + R() * 0.3, 2.6 + R() * 1.8,
            0.4 + R() * 0.3, K_DUST, c, 0.26 + R() * 0.1, 0, -0.05, 0.4, 0.7);
          this.tag(B_STEAM, R() * 6.28, 0);
          break;
        }
        case 'luna': {
          // ultra-sparse glints of glass beads in the regolith; nothing moves on the airless surface
          c.setRGB(1, 1, 1).multiplyScalar(2.0);
          this.spawn(R() * W, R() * H, 0.02, 0, 0, 0, 0.2 + R() * 0.25, 0.1 + R() * 0.05, K_GLINT, c, 1, 1, 0, 0);
          break;
        }
        case 'mars': {
          // fine dust drifting on the thin wind
          c.copy(this.dustCol).multiplyScalar(1.2);
          this.spawn(-2 + R() * (W + 3), -1 + R() * (H + 2), 0.1 + R() * 0.5, 1.0 + R() * 0.6, 0.3 + R() * 0.3, 0,
            4 + R() * 3, 0.5 + R() * 0.7, K_DUST, c, 0.06 + R() * 0.05, 0, 0, 0, 0.1);
          this.tag(B_DRIFT, R() * 6.28, 0);
          break;
        }
        case 'titan': {
          // slow methane drizzle falling at a slant; each drop ends in a tiny splash ring
          const vx = 0.5, vy = -0.32, vz = -2.3;
          const z = 1.6 + R() * 2.0;
          c.setRGB(0.62, 0.46, 0.3);
          this.spawn(-1 + R() * (W + 2), -1 + R() * (H + 2), z, vx, vy, vz, z / -vz + 0.1,
            0.3 + R() * 0.12, K_WISP, c, 0.28, 0, 0, 0, 0);
          this.tag(B_SPLASH, 0, 0, Math.atan2(vy, vx));
          break;
        }
        case 'kepler': {
          // glowing spores rising slowly from the flora
          const pick = R();
          if (pick < 0.4) c.setRGB(1.0, 0.3, 0.85); else if (pick < 0.75) c.setRGB(0.3, 0.95, 1.0); else c.setRGB(0.7, 1.0, 0.4);
          c.multiplyScalar(1.8 + R() * 1.2);
          this.spawn(-1 + R() * (W + 2), -1 + R() * (H + 2), 0.2 + R() * 1.0, (R() - 0.5) * 0.2, (R() - 0.5) * 0.2,
            0.05 + R() * 0.08, 5 + R() * 4, 0.07 + R() * 0.06, K_SPARK, c, 1, 1, 0, 0.2);
          this.tag(B_BLINK, R() * 6.28, 0.6 + R() * 0.9);
          break;
        }
      }
    }
  }

  /** Timed ambient features that are not simple per-second spawns: bird shadows, fog banks, dust devils. */
  private extras(dt: number, f: RenderFrame) {
    const W = this.W, H = this.H, R = Math.random, c = this.tmpC, m = this.multiplier;
    if (this.biome === 'pinksands') {
      this.birdT -= dt;
      if (this.birdT <= 0) {
        this.birdT = 9 + R() * 10;
        // a seabird (sometimes a loose pair or trio) gliding over: only its shadow is seen
        const ang = R() * 6.2832, dx = Math.cos(ang), dy = Math.sin(ang);
        const half = Math.hypot(W, H) * 0.5 + 3;
        const off = (R() - 0.5) * Math.min(W, H) * 0.7;
        const sp = 3 + R() * 1;
        const n = R() < 0.6 ? 1 : 2 + Math.floor(R() * 2);
        c.setRGB(0, 0, 0);
        for (let k = 0; k < n; k++) {
          const back = k * (1.2 + R() * 0.6), side = k === 0 ? 0 : (k % 2 ? 1 : -1) * (0.9 + R() * 0.5);
          const x = W / 2 - dx * (half + back) - dy * (off + side), y = H / 2 - dy * (half + back) + dx * (off + side);
          this.spawn(x, y, 1.3, dx * sp, dy * sp, 0, (2 * half + back) / sp, 1.4 + R() * 0.3, K_BIRD, c, 0.2, 0, 0, 0, 0);
          this.tag(B_NONE, 0, 0, Math.atan2(-dx, dy));
        }
      }
    } else if (this.biome === 'titan') {
      this.fogT -= dt * Math.max(0.3, m);
      if (this.fogT <= 0) {
        this.fogT = 1.4 + R() * 1.2;
        // slow orange fog banks drifting over the board
        c.setRGB(0.6, 0.34, 0.12);
        this.spawn(-4 + R() * (W + 4), -2 + R() * (H + 4), 1.2 + R(), 0.22 + R() * 0.1, 0.06, 0, 12 + R() * 6,
          3.5 + R() * 2.5, K_DUST, c, 0.06 + R() * 0.03, 0, 0, 0, 0.12);
        this.tag(B_DRIFT, R() * 6.28, 0);
      }
    } else if (this.biome === 'mars') {
      // dust devil columns, at the same spots the sand swirls use (dustDevilPos)
      c.copy(this.devilCol);
      for (let i = 0; i < DUST_DEVILS; i++) {
        const str = dustDevilStrength(f.time, i);
        if (str < 0.04) { this.devAcc[i] = 0; continue; }
        this.devAcc[i] += dt * 22 * str * Math.max(0.35, m);
        while (this.devAcc[i] >= 1) {
          this.devAcc[i] -= 1;
          const ang = R() * 6.2832, rr = this.devR[i] * (0.25 + 0.3 * R());
          this.spawn(this.devX[i] + Math.cos(ang) * rr, this.devY[i] + Math.sin(ang) * rr, 0.05 + R() * 0.2, 0, 0,
            0.7 + R() * 0.6, 2.0 + R() * 1.2, 0.3 + R() * 0.35, K_DUST, c, (0.26 + 0.12 * R()) * str, 0, 0, 0, 0.3);
          this.tag(B_DEVIL, i, ang);
        }
      }
    }
  }

  private events(f: RenderFrame) {
    const c = this.tmpC;
    const m = Math.max(0.3, this.multiplier);
    for (const e of f.events) {
      if (e.type === 'eat') {
        this.eatBurst(e.x, e.y, e.kind === 'golden', m);
      } else if (e.type === 'death' || e.type === 'hit') {
        this.deathBurst(f, e.x, e.y, m);
      } else if (e.type === 'powerup') {
        c.setRGB(0.6, 0.9, 1.4).multiplyScalar(2);
        this.spawn(e.x, e.y, 0.1, 0, 0, 0, 0.7, 0.6, K_RING, c, 1, 1, 0, 0, 9);
        this.spawn(e.x, e.y, 0.1, 0, 0, 0, 0.45, 0.4, K_RING, c, 0.8, 1, 0, 0, 5);
      }
    }
  }

  private eatBurst(x: number, y: number, golden: boolean, m: number) {
    const R = Math.random, c = this.tmpC, b = this.biome;
    const cols = this.burstCols;
    // 1) grains thrown out of the sand
    const n = Math.round(22 * m);
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283;
      c.copy(this.sandCol).multiplyScalar(0.8 + R() * 0.4);
      if (b === 'luna') {
        // ballistic, drag-free, low gravity: slow high arcs that stop dead where they land
        const sp = 0.6 + R() * 1.6;
        this.spawn(x, y, 0.1, Math.cos(a) * sp, Math.sin(a) * sp, 1.6 + R() * 2.2, 3.2, 0.05 + R() * 0.04, K_GRAIN, c, 1, 0, 1.62, 0);
        this.tag(B_STICK);
      } else if (b === 'titan') {
        const sp = 0.3 + R() * 0.8;
        this.spawn(x, y, 0.1, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + R() * 0.8, 2.4 + R(), 0.06 + R() * 0.05, K_GRAIN, c, 1, 0, 1.35, 1.8);
      } else if (b === 'mars') {
        const sp = 0.6 + R() * 1.8;
        this.spawn(x, y, 0.1, Math.cos(a) * sp, Math.sin(a) * sp, 1.5 + R() * 2.2, 1.2 + R() * 0.6, 0.05 + R() * 0.05, K_GRAIN, c, 1, 0, 3.7, 0.8);
      } else {
        const sp = 0.6 + R() * 1.8;
        this.spawn(x, y, 0.1, Math.cos(a) * sp, Math.sin(a) * sp, 1.5 + R() * 2.5, 0.8 + R() * 0.6, 0.05 + R() * 0.05, K_GRAIN, c, 1, 0, 9, 1.2);
      }
    }
    // 2) world-specific accent
    const k = Math.round(10 * m);
    switch (b) {
      case 'vaadhoo':
        // plankton flare: blue-green sparks skittering over the wet sand, blinking out
        for (let i = 0; i < k + 6; i++) {
          const a = R() * 6.283, sp = 0.3 + R() * 1.5;
          c.copy(cols[i % cols.length]).multiplyScalar(2.5 + R() * 1.5);
          this.spawn(x, y, 0.05 + R() * 0.2, Math.cos(a) * sp, Math.sin(a) * sp, 0.1 + R() * 0.3, 1.6 + R() * 1.4, 0.07 + R() * 0.05, K_SPARK, c, 1, 1, 0, 1.4);
          this.tag(B_BLINK, R() * 6.28, 5 + R() * 5);
        }
        break;
      case 'kepler':
      case 'dallol':
      case 'mars': {
        // crystal shards (kepler: glowing, dallol: salt, mars: water ice)
        // solid (not additive) so they read on bright sand; kepler's are emissive-bright
        const glow = b === 'kepler' ? 1.8 : 1;
        for (let i = 0; i < k + 2; i++) {
          const a = R() * 6.283, sp = 0.8 + R() * 1.6;
          c.copy(cols[i % cols.length]).multiplyScalar(glow);
          this.spawn(x, y, 0.3, Math.cos(a) * sp, Math.sin(a) * sp, 1.5 + R() * 1.8, 1.1 + R() * 0.7, 0.2 + R() * 0.12, K_SHARD, c, 1, 0,
            b === 'mars' ? 3.7 : 6, 0.6);
          this.rotV[this.alive - 1] = (R() - 0.5) * 30;
        }
        if (b !== 'kepler') {
          c.setRGB(1, 1, 1).multiplyScalar(2.4);
          for (let i = 0; i < 5; i++) {
            const a = R() * 6.283, sp = 0.3 + R() * 0.8;
            this.spawn(x, y, 0.2, Math.cos(a) * sp, Math.sin(a) * sp, 0.4, 0.5 + R() * 0.4, 0.22, K_GLINT, c, 1, 1, 0, 1.5);
          }
        }
        if (b === 'mars') {
          // a puff of rust dust lingering in the thin air
          c.copy(this.dustCol).multiplyScalar(1.1);
          for (let i = 0; i < 5; i++) {
            const a = R() * 6.283, sp = 0.2 + R() * 0.4;
            this.spawn(x, y, 0.2, Math.cos(a) * sp + 0.3, Math.sin(a) * sp, 0.2, 2 + R(), 0.4, K_DUST, c, 0.2, 0, 0, 0.6, 0.5);
          }
        }
        break;
      }
      case 'luna':
        // helium-3 glints following the same slow ballistic arcs
        for (let i = 0; i < k; i++) {
          const a = R() * 6.283, sp = 0.4 + R() * 1.0;
          c.copy(cols[i % cols.length]).multiplyScalar(2.4);
          this.spawn(x, y, 0.2, Math.cos(a) * sp, Math.sin(a) * sp, 1.2 + R() * 1.5, 2.6, 0.12, K_SPARK, c, 1, 1, 1.62, 0);
          this.tag(B_STICK);
        }
        break;
      case 'titan':
        // tholin flakes: heavy drag, low gravity, they sink like snow in syrup
        for (let i = 0; i < k; i++) {
          const a = R() * 6.283, sp = 0.3 + R() * 0.6;
          c.copy(cols[i % cols.length]);
          this.spawn(x, y, 0.3, Math.cos(a) * sp, Math.sin(a) * sp, 0.8 + R() * 0.8, 2.8 + R(), 0.16, K_PETAL, c, 1, 0, 0.6, 1.6);
        }
        break;
      default: {
        const kind = b === 'karesansui' || b === 'lagoon' || b === 'salar' || b === 'pinksands' ? K_PETAL : K_SPARK;
        const add = kind === K_SPARK ? 1 : 0;
        for (let i = 0; i < k; i++) {
          const a = R() * 6.283, sp = 0.4 + R() * 1.2;
          c.copy(cols[i % cols.length]);
          if (add) c.multiplyScalar(3);
          this.spawn(x, y, 0.3, Math.cos(a) * sp, Math.sin(a) * sp, 1.2 + R() * 1.5, 1.4 + R() * 0.8, kind === K_PETAL ? 0.22 : 0.1, kind, c, 1, add, 2.5, 0.8);
        }
      }
    }
    // 3) shock ring
    c.copy(cols[0]).multiplyScalar(golden ? 2.5 : 1.2);
    this.spawn(x, y, 0.05, 0, 0, 0, 0.5, 0.6, K_RING, c, 0.8, 1, 0, 0, 5);
  }

  private deathBurst(f: RenderFrame, ex: number, ey: number, m: number) {
    const R = Math.random, c = this.tmpC, b = this.biome, s = f.snake;
    const n = Math.round(40 * m);
    for (let i = 0; i < n; i++) {
      const k = Math.floor(R() * Math.max(1, s.count));
      const x = s.points[k * 2] ?? ex, y = s.points[k * 2 + 1] ?? ey;
      const a = R() * 6.283;
      if (b === 'luna') {
        // regolith spray: no air, so no cloud; every grain flies a slow clean arc and stops dead
        const sp = 0.3 + R() * 1.0;
        c.copy(this.sandCol).multiplyScalar(0.7 + R() * 0.4);
        this.spawn(x, y, 0.15, Math.cos(a) * sp, Math.sin(a) * sp, 0.8 + R() * 1.8, 3.5, 0.05 + R() * 0.05, K_GRAIN, c, 1, 0, 1.62, 0);
        this.tag(B_STICK);
        continue;
      }
      const sp = 0.2 + R() * 0.6;
      c.copy(this.sandCol).multiplyScalar(0.7 + R() * 0.2);
      if (b === 'mars') {
        c.copy(this.dustCol).multiplyScalar(1.1);
        this.spawn(x, y, 0.2, Math.cos(a) * sp + 0.4, Math.sin(a) * sp + 0.1, 0.35, 3.2 + R() * 2, 0.5 + R() * 0.6, K_DUST, c, 0.24, 0, 0, 0.5, 0.6);
      } else if (b === 'titan') {
        this.spawn(x, y, 0.2, Math.cos(a) * sp * 0.6, Math.sin(a) * sp * 0.6, 0.15, 3.5 + R() * 2, 0.5 + R() * 0.5, K_DUST, c, 0.22, 0, 0, 1.5, 0.35);
      } else {
        this.spawn(x, y, 0.2, Math.cos(a) * sp, Math.sin(a) * sp, 0.3, 2.2 + R() * 1.5, 0.45 + R() * 0.5, K_DUST, c, 0.22, 0, 0, 0.8, 0.5);
      }
      if (i % 2 === 0) {
        if (b === 'vaadhoo') {
          c.copy(this.burstCols[i % this.burstCols.length]).multiplyScalar(2.2);
          this.spawn(x, y, 0.05, Math.cos(a) * sp, Math.sin(a) * sp, 0.05, 2 + R() * 1.5, 0.07, K_SPARK, c, 1, 1, 0, 1.2);
          this.tag(B_BLINK, R() * 6.28, 4 + R() * 4);
        } else if (b === 'kepler') {
          c.copy(this.burstCols[i % this.burstCols.length]).multiplyScalar(1.8);
          this.spawn(x, y, 0.2, Math.cos(a) * sp * 2, Math.sin(a) * sp * 2, 1 + R(), 1.2 + R() * 0.6, 0.16, K_SHARD, c, 1, 0, 6, 0.6);
          this.rotV[this.alive - 1] = (R() - 0.5) * 24;
        }
      }
    }
  }

  update(f: RenderFrame, dt: number, waveEdge: number, waveFoam: number) {
    if (this.enabled) {
      this.events(f);
      if (this.biome === 'mars') {
        for (let i = 0; i < DUST_DEVILS; i++) {
          dustDevilPosInto(this.devil, f.time, i, this.W, this.H);
          this.devX[i] = this.devil.x; this.devY[i] = this.devil.y; this.devR[i] = this.devil.r;
        }
      }
      if (!f.paused) { this.ambient(dt, f, waveEdge, waveFoam); this.extras(dt, f); }
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
        const bh = this.beh[i];
        if (bh === B_BLINK || bh === B_DRIFT) {
          const ph = this.aux[i * 2];
          this.vel[o] += Math.sin(t * 0.7 + ph) * 0.12 * dt;
          this.vel[o + 1] += Math.cos(t * 0.53 + ph * 1.3) * 0.12 * dt;
        } else if (bh === B_STEAM) {
          this.vel[o] += Math.sin(t * 1.3 + this.aux[i * 2]) * 0.3 * dt;
        }
        if (bh === B_DEVIL) {
          // orbit the devil's moving centre, widening as the dust climbs
          const di = this.aux[i * 2] | 0;
          const an = (this.aux[i * 2 + 1] += dt * (3.4 - this.pos[o + 2] * 0.6));
          this.pos[o + 2] += this.vel[o + 2] * dt;
          const rr = this.devR[di] * (0.25 + 0.45 * Math.min(1.6, this.pos[o + 2]));
          this.pos[o] = this.devX[di] + Math.cos(an) * rr;
          this.pos[o + 1] = this.devY[di] + Math.sin(an) * rr;
        } else {
          this.pos[o] += this.vel[o] * dt;
          this.pos[o + 1] += this.vel[o + 1] * dt;
          this.pos[o + 2] += this.vel[o + 2] * dt;
        }
        if (this.pos[o + 2] < 0.01) {
          if (bh === B_SPLASH) {
            // drizzle drop lands: tiny expanding ring
            const x = this.pos[o], y = this.pos[o + 1];
            this.kill(i);
            this.tmpC.setRGB(0.55, 0.42, 0.3);
            this.spawn(x, y, 0.02, 0, 0, 0, 0.4, 0.1, K_RING, this.tmpC, 0.35, 0, 0, 0, 0.7);
            continue;
          }
          this.pos[o + 2] = 0.01;
          this.vel[o + 2] = 0;
          if (bh === B_STICK) { this.vel[o] = 0; this.vel[o + 1] = 0; }
          else { this.vel[o] *= 0.8; this.vel[o + 1] *= 0.8; }
          if (kind === K_PETAL) this.rotV[i] *= 0.9;
        }
        this.par[i * 4 + 2] += this.rotV[i] * dt * (kind === K_PETAL || kind === K_SHARD ? 1 : 0.2);
        if (this.grow[i] > 0) this.par[i * 4] += this.grow[i] * dt * (1 - L / ml);
        // fade in/out
        const fin = Math.min(1, L / Math.min(0.3, ml * 0.2));
        const fout = Math.min(1, (ml - L) / Math.min(1.2, ml * 0.4));
        let a = this.baseA[i] * fin * fout;
        if (kind === K_GLINT) a *= Math.sin(Math.PI * L / ml);
        if (bh === B_BLINK) {
          const bl = Math.max(0, Math.sin(t * this.aux[i * 2 + 1] + this.aux[i * 2]));
          a *= 0.2 + 0.8 * bl * bl;
        } else if (kind === K_SPARK) a *= 0.75 + 0.25 * Math.sin(t * 20 + i);
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
