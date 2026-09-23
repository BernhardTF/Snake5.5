// Instanced flat sprites (quads in the XY plane, facing the top-down camera) and a CPU particle pool.
// All glows / particles are flagged noShadow so they stay out of the contact-shadow pass.
import * as THREE from 'three';
import { LIGHT } from '../../lighting';
import { noShadow } from './util';

export const SpriteMode = { Soft: 0, Smoke: 1, Spark: 2, Star: 3, Cloud: 4, Ember: 5 } as const;
export type SpriteModeId = (typeof SpriteMode)[keyof typeof SpriteMode];

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iSize;  // length, width, rotation, seed
attribute vec4 iCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
void main() {
  vec2 c = position.xy;
  float cr = cos(iSize.z), sr = sin(iSize.z);
  vec2 p = vec2(c.x * iSize.x, c.y * iSize.y);
  p = vec2(p.x * cr - p.y * sr, p.x * sr + p.y * cr);
  vec4 wp = modelMatrix * vec4(iPos + vec3(p, 0.0), 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  vUv = c * 2.0;
  vCol = iCol;
  vSeed = iSize.w;
}
`;

const FRAG = /* glsl */ `
uniform float uFade;
uniform float uTime;
uniform vec3 uSunDir, uSunCol, uSkyCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 uv = vUv;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float a = 0.0;
  vec3 c = vCol.rgb;
#if MODE == 0
  // soft round glow
  a = exp(-r2 * 4.0) - 0.0183;
  a = max(a, 0.0) * 1.02;
#elif MODE == 1
  // smoke puff: noisy lumpy disc, lit from the sun side
  vec2 q = uv * 1.6 + vSeed * 17.0;
  float n = vn(q) * 0.55 + vn(q * 2.1 + 3.1) * 0.3 + vn(q * 4.3 - 1.7) * 0.15;
  float edge = 1.0 - r2 * (0.75 + 0.5 * n);
  a = smoothstep(0.0, 0.55, edge);
  vec3 nrm = normalize(vec3(uv * 0.9, sqrt(max(0.05, 1.0 - r2))));
  float lit = clamp(dot(nrm, normalize(uSunDir)), 0.0, 1.0);
  c *= uSkyCol * 0.75 + uSunCol * (0.25 + 0.75 * lit) * 0.9;
  c *= 0.82 + 0.3 * n;
#elif MODE == 2
  // spark streak along +x
  float ax = abs(uv.x);
  a = exp(-uv.y * uv.y * 9.0) * (1.0 - ax * ax) * (0.6 + 0.4 * (1.0 - smoothstep(-1.0, 1.0, uv.x)));
  c *= 1.0 + 1.5 * exp(-uv.y * uv.y * 60.0);
#elif MODE == 3
  // 4-point twinkle star
  float cx = exp(-abs(uv.x) * 14.0) * (1.0 - abs(uv.y));
  float cy = exp(-abs(uv.y) * 14.0) * (1.0 - abs(uv.x));
  a = max(cx, cy) + exp(-r2 * 30.0) * 1.2;
  a *= 1.0 - r2;
#elif MODE == 4
  // stylised cloud wisp: three soft lobes with a bright rim, lit
  vec2 q = uv;
  float l1 = 1.0 - length((q - vec2(-0.35, -0.1)) / vec2(0.55, 0.5));
  float l2 = 1.0 - length((q - vec2(0.25, 0.05)) / vec2(0.62, 0.55));
  float l3 = 1.0 - length((q - vec2(0.0, -0.42)) / vec2(0.8, 0.35));
  float m = max(max(l1, l2), l3);
  float n = vn(uv * 2.5 + vSeed * 11.0);
  m += (n - 0.5) * 0.25;
  a = smoothstep(0.0, 0.08, m) * mix(1.0, 0.75, smoothstep(0.1, 0.5, m));
  // inked outline + inner swirl line, like painted auspicious clouds
  float rim = 1.0 - smoothstep(0.03, 0.09, m);
  float curl = 1.0 - smoothstep(0.0, 0.035, abs(m - 0.24));
  vec3 lit = uSkyCol * 0.6 + uSunCol * 0.6;
  c *= lit * (0.92 + 0.15 * smoothstep(0.0, 0.6, m));
  c = mix(c, c * vec3(0.42, 0.55, 0.62), max(rim, curl * 0.7));
#else
  // ember / hot dot
  a = exp(-r2 * 7.0);
  c *= 1.0 + 2.0 * exp(-r2 * 30.0);
#endif
  a *= vCol.a * uFade;
  if (a < 0.002) discard;
  gl_FragColor = vec4(c, a);
}
`;

function upd(a: THREE.BufferAttribute, n: number) {
  a.clearUpdateRanges(); a.addUpdateRange(0, n); a.needsUpdate = true;
}

export interface SpriteOpts { mode: SpriteModeId; additive?: boolean; toneMapped?: boolean; renderOrder?: number; depthTest?: boolean; }

/** A batch of instanced sprites written each frame via begin/push/end. */
export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private pos: Float32Array;
  private size: Float32Array;
  private colr: Float32Array;
  readonly max: number;
  n = 0;

  constructor(max: number, o: SpriteOpts) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max * 4);
    this.colr = new Float32Array(max * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.colr, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iSize', this.aSize);
    g.setAttribute('iCol', this.aCol);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      defines: { MODE: o.mode },
      uniforms: {
        uFade: { value: 1 }, uTime: LIGHT.time,
        uSunDir: LIGHT.sunDir, uSunCol: LIGHT.sunColor, uSkyCol: LIGHT.skyColor,
      },
      transparent: true, depthWrite: false, depthTest: o.depthTest ?? true,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: o.toneMapped ?? !o.additive,
    });
    this.mesh = noShadow(new THREE.Mesh(g, this.material));
    this.mesh.renderOrder = o.renderOrder ?? 10;
  }

  begin() { this.n = 0; }
  /** len/wid = full quad extents; rot = radians around Z. */
  push(x: number, y: number, z: number, len: number, wid: number, rot: number, r: number, g: number, b: number, a: number, seed = 0) {
    if (this.n >= this.max || a <= 0.0005) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.size[i * 4] = len; this.size[i * 4 + 1] = wid; this.size[i * 4 + 2] = rot; this.size[i * 4 + 3] = seed;
    this.colr[i * 4] = r; this.colr[i * 4 + 1] = g; this.colr[i * 4 + 2] = b; this.colr[i * 4 + 3] = a;
  }
  end() {
    const n = this.n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    upd(this.aPos, n * 3); upd(this.aSize, n * 4); upd(this.aCol, n * 4);
  }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}

export interface PoolOpts extends SpriteOpts {
  drag?: number;       // velocity damping per second
  gravity?: number;    // z acceleration
  floor?: boolean;     // bounce on z = 0
  stretch?: number;    // spark streak length per unit speed
  fadeIn?: number;     // fraction of life
  buoyancy?: number;
}

/** Simple CPU particle pool rendered through a SpriteBatch. Allocation-free after construction. */
export class ParticlePool {
  readonly batch: SpriteBatch;
  private o: Required<Omit<PoolOpts, keyof SpriteOpts>>;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private asp: Float32Array;
  private rot: Float32Array; private spin: Float32Array; private seed: Float32Array;
  private cr: Float32Array; private cg: Float32Array; private cb: Float32Array; private ca: Float32Array;
  n = 0;
  readonly max: number;

  constructor(max: number, o: PoolOpts) {
    this.max = max;
    this.batch = new SpriteBatch(max, o);
    this.o = { drag: o.drag ?? 1, gravity: o.gravity ?? 0, floor: o.floor ?? false, stretch: o.stretch ?? 0, fadeIn: o.fadeIn ?? 0.1, buoyancy: o.buoyancy ?? 0 };
    const F = () => new Float32Array(max);
    this.px = F(); this.py = F(); this.pz = F(); this.vx = F(); this.vy = F(); this.vz = F();
    this.age = F(); this.life = F(); this.s0 = F(); this.s1 = F(); this.asp = F();
    this.rot = F(); this.spin = F(); this.seed = F();
    this.cr = F(); this.cg = F(); this.cb = F(); this.ca = F();
  }
  get mesh() { return this.batch.mesh; }
  get material() { return this.batch.material; }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number,
    size0: number, size1: number, r: number, g: number, b: number, a: number, rot = 0, spin = 0, aspect = 1) {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else {
      // recycle the oldest-relative particle
      let best = 0, bt = -1;
      for (let k = 0; k < this.n; k++) { const t = this.age[k] / this.life[k]; if (t > bt) { bt = t; best = k; } }
      i = best;
    }
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = Math.max(0.01, life); this.s0[i] = size0; this.s1[i] = size1; this.asp[i] = aspect;
    this.rot[i] = rot; this.spin[i] = spin; this.seed[i] = Math.random();
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.ca[i] = a;
  }

  clear() { this.n = 0; }

  step(dt: number) {
    const o = this.o;
    const dragK = Math.exp(-o.drag * dt);
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const j = --this.n;
        this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
        this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
        this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
        this.asp[i] = this.asp[j]; this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.seed[i] = this.seed[j];
        this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j]; this.ca[i] = this.ca[j];
        i--;
        continue;
      }
      this.vx[i] *= dragK; this.vy[i] *= dragK; this.vz[i] = this.vz[i] * dragK + (o.gravity + o.buoyancy) * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (o.floor && this.pz[i] < 0.01) { this.pz[i] = 0.01; this.vz[i] = Math.abs(this.vz[i]) * 0.35; this.vx[i] *= 0.6; this.vy[i] *= 0.6; }
      this.rot[i] += this.spin[i] * dt;
    }
  }

  render() {
    const b = this.batch, o = this.o;
    b.begin();
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      const fin = o.fadeIn > 0 ? Math.min(1, t / o.fadeIn) : 1;
      const fout = 1 - t;
      const a = this.ca[i] * fin * fout * (0.4 + 0.6 * fout);
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      if (o.stretch > 0) {
        const sp = Math.hypot(this.vx[i], this.vy[i]);
        const rot = Math.atan2(this.vy[i], this.vx[i]);
        b.push(this.px[i], this.py[i], this.pz[i], s + sp * o.stretch, s * 0.5, rot, this.cr[i], this.cg[i], this.cb[i], a, this.seed[i]);
      } else {
        b.push(this.px[i], this.py[i], this.pz[i], s * this.asp[i], s, this.rot[i], this.cr[i], this.cg[i], this.cb[i], a, this.seed[i]);
      }
    }
    b.end();
  }
  dispose() { this.batch.dispose(); }
}
