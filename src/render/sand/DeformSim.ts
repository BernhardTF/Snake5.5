// GPU sand deformation simulation (ping-pong half-float RT).
// R = height offset (groove < 0, berm > 0), G = disturbance (pattern erased), B = biome channel
// (heat / moisture / wet sheen / whiteness / bioluminescence / shard glow), A = foam residue (lagoon) / spare.
import * as THREE from 'three';
import type { BiomeId, RenderFrame } from '../../types';
import { BIOME_COUNT, BIOME_VISUALS, type BiomeVisual } from '../biomeVisuals';
import { WORLDS_GLSL } from '../glsl/worlds';
import { dustDevilPosInto, type DustDevilPos } from '../particles/dustDevils';
import { FullscreenPass, makeRT, passMaterial } from '../fsq';
import { NOISE_GLSL } from '../glsl/noise';

const MAXSEG = 16;
const MARGIN = 1.0;
const COV_RES = 3; // coverage samples per cell
const LAG = 0.5;   // main groove is carved this far behind the head (see ingest)

/** Asymmetric swash cycle 0..1 (quick run-up, slow backwash) for the lapping shores. */
function sw(ph: number) {
  const f = ph - Math.floor(ph);
  const k = f < 0.32 ? f / 0.32 : 1 - (f - 0.32) / 0.68;
  return k * k * (3 - 2 * k);
}

export const SEG_GROOVE = 0, SEG_BUMP = 1, SEG_CRATER = 2, SEG_RING = 3;

const SIM_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform vec4 uRegion;
uniform float uDt, uDiffK, uTalus, uRelax, uErode, uSmear, uBDecay, uHeatSet, uTime;
uniform vec2 uWind;
uniform vec4 uWave;
uniform vec4 uSegA[${MAXSEG}];
uniform vec4 uSegP[${MAXSEG}];
uniform int uSegCount;
uniform vec4 uSegBox; // world bbox of this pass' stamps (early-out)
uniform float uSharp;   // 0 = soft groove profile, 1 = crisp (luna)
uniform vec4 uDevil[2]; // mars dust devils: x, y, radius, strength
uniform vec2 uBoard;
${NOISE_GLSL}
float sq(float x) { return x * x; }
${WORLDS_GLSL}
void main() {
  vec2 uv = vUv;
  vec4 c = texture2D(uPrev, uv);
  vec2 p = uRegion.xy + uv * uRegion.zw;
  if (uRelax > 0.5) {
    vec4 n = texture2D(uPrev, uv + vec2(0.0, uTexel.y));
    vec4 s = texture2D(uPrev, uv - vec2(0.0, uTexel.y));
    vec4 e = texture2D(uPrev, uv + vec2(uTexel.x, 0.0));
    vec4 w = texture2D(uPrev, uv - vec2(uTexel.x, 0.0));
    float avg = 0.25 * (n.r + s.r + e.r + w.r);
    float r0 = c.r;
    c.r += (avg - r0) * uDiffK;
    // angle-of-repose avalanche
    float fl = 0.0;
    float d;
    d = n.r - r0; fl += sign(d) * max(abs(d) - uTalus, 0.0);
    d = s.r - r0; fl += sign(d) * max(abs(d) - uTalus, 0.0);
    d = e.r - r0; fl += sign(d) * max(abs(d) - uTalus, 0.0);
    d = w.r - r0; fl += sign(d) * max(abs(d) - uTalus, 0.0);
    c.r += fl * 0.12;
    // soften disturbance edges very slightly so the pattern doesn't alias at trail borders
    c.g = max(c.g, mix(c.g, 0.25 * (n.g + s.g + e.g + w.g), 0.02));
#if BIOME == 1
    // wind: smear downwind, slowly restore pattern
    vec4 up = texture2D(uPrev, uv - uWind * uTexel * 1.5);
    c = mix(c, up, uSmear);
    c.g = max(c.g - uErode * uDt, 0.0);
    c.r *= max(0.0, 1.0 - uErode * uDt * 1.6);
#endif
    c.b = max(c.b - uBDecay * uDt, 0.0);
#if BIOME == 2
    float wet = step(uWave.x, p.y);
    if (uWave.y > 0.5 && wet > 0.5) {
      c.g = max(c.g - 5.0 * uDt, 0.0);
      c.r *= exp(-5.0 * uDt);
      c.b = 1.0;
    }
    c.a = max(c.a - uDt * 0.35, 0.0);
    if (uWave.y > 0.5) {
      float lace = 0.6 + 0.4 * vnoise(p * vec2(3.0, 9.0) + uTime);
      c.a = max(c.a, exp(-sq((p.y - uWave.x) / 0.18)) * lace);
    }
#endif
#if BIOME == 5 || BIOME == 6
    // calm lapping shore (top side): the shallows slowly smooth trails; the swash line wets
    {
      float eN = lapEdgeN(p, uWave.x, uTime);
      float under = smoothstep(0.0, 0.5, eN);
      c.g = max(c.g - 0.3 * uDt * under, 0.0);
      c.r *= exp(-0.45 * uDt * under);
#if BIOME == 6
      // bioluminescence: plankton light up where the moving swash line runs over the sand
      float lace = 0.55 + 0.45 * vnoise(p * vec2(2.2, 7.0) + uTime * 0.7);
      c.b = max(c.b, exp(-sq((eN - 0.05) / 0.2)) * uWave.w * lace);
#else
      // pale revealed sand gets rewetted and blends back faster under water
      c.b = max(c.b - 0.15 * uDt * under, 0.0);
#endif
    }
#endif
#if BIOME == 9
    // dust devils: vortex winds sweep dust back into the scraped trails (partial refill)
    for (int i = 0; i < 2; i++) {
      vec4 dv = uDevil[i];
      float dd = length(p - dv.xy);
      float k = (1.0 - smoothstep(dv.z * 0.35, dv.z * 1.25, dd)) * dv.w;
      c.g = max(c.g - 0.55 * k * uDt, 0.0);
      c.r *= exp(-0.6 * k * uDt);
    }
#endif
#if BIOME == 10
    // methane lake: liquid, nothing holds a shape
    float lake = titanLake(p, uBoard);
    if (lake > 0.0) {
      c.r *= exp(-4.0 * uDt);
      c.g = max(c.g - 3.0 * uDt, 0.0);
    }
    // drizzle: drops that fell during (uTime - uDt, uTime] make tiny dimples, damp spots (B),
    // and locally relax the sand so trails soften over time
    {
      vec2 cell = floor(p / DRIZ_C);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec3 dr = drizzleDrop(cell + vec2(float(i), float(j)), uTime);
        if (dr.z >= uDt) continue;
        float dd = length(p - dr.xy);
        if (dd > 0.2) continue;
        float fall = 1.0 - smoothstep(0.05, 0.2, dd);
        c.r = mix(c.r, avg, 0.7 * fall);
        c.r += -0.1 * (1.0 - smoothstep(0.0, 0.09, dd)) + 0.035 * exp(-sq((dd - 0.12) / 0.03));
        c.g = max(c.g - 0.12 * fall, 0.0);
        c.b = max(c.b, 1.0 - smoothstep(0.04, 0.16, dd));
      }
    }
#endif
  }
  bool inBox = p.x >= uSegBox.x && p.y >= uSegBox.y && p.x <= uSegBox.z && p.y <= uSegBox.w;
  for (int i = 0; i < ${MAXSEG}; i++) {
    if (i >= uSegCount || !inBox) break;
    vec4 A = uSegA[i];
    vec4 P = uSegP[i];
    int type = int(P.w + 0.5);
    if (type == 0) {
      vec2 a = A.xy, b = A.zw;
      vec2 ab = b - a;
      float L2 = max(dot(ab, ab), 1e-6);
      float tu = dot(p - a, ab) / L2;
      vec2 q = a + ab * clamp(tu, 0.0, 1.0);
      float dist = length(p - q);
      float w = P.x;
      if (dist > w * 2.2) continue;
      float rough = P.z;
      float nz = rough > 0.0 ? (vnoise(p * 4.3 + 17.0) - 0.5) * 2.0 : 0.0;
      float depth = P.y * (1.0 + rough * nz * 0.6);
      w *= 1.0 + rough * 0.25 * nz;
      float dn = dist / w;
      float g = -depth * (1.0 - smoothstep(mix(0.5, 0.8, uSharp), mix(0.95, 0.9, uSharp), dn));
      float bw = mix(0.3, 0.1, uSharp);
      float berm = tu >= 0.0 ? depth * mix(0.45, 0.3, uSharp) * exp(-sq((dn - mix(1.12, 1.0, uSharp)) / bw)) : 0.0;
      float prof = g + berm;
      // carve where the profile is below grade; only raise sand that isn't already a groove
      if (prof < 0.0) c.r = min(c.r, prof);
      else if (c.r > -0.05) c.r = max(c.r, prof);
      c.g = max(c.g, 1.0 - smoothstep(1.12, 1.5, dn));
      c.b = max(c.b, uHeatSet * (1.0 - smoothstep(0.55, 1.05, dn)));
    } else if (type == 1) {
      // bow wave: only in front of the head (A.zw = heading), never refills the fresh groove
      vec2 rel = p - A.xy;
      float fwd = dot(rel, A.zw);
      if (fwd < 0.0) continue;
      float dist = length(rel);
      float dn = dist / P.x;
      if (dn > 2.5) continue;
      float wf = smoothstep(0.0, P.x * 0.6, fwd);
      if (c.r > -0.05) c.r = max(c.r, P.y * exp(-dn * dn * 2.0) * wf);
      c.g = max(c.g, (1.0 - smoothstep(0.8, 1.4, dn)) * wf);
    } else if (type == 2) {
      float dist = length(p - A.xy);
      float dn = dist / P.x;
      if (dn > 2.5) continue;
      float depth = P.y * (1.0 + 0.25 * (vnoise(p * 6.0) - 0.5));
      if (dn < 1.0) c.r = min(c.r, -depth * (1.0 - smoothstep(0.25, 1.0, dn)));
      float rim = depth * 0.5 * exp(-sq((dn - 1.15) / 0.35));
      if (c.r > -0.05) c.r = max(c.r, rim);
      c.g = max(c.g, 1.0 - smoothstep(1.3, 1.8, dn));
      c.b = max(c.b, uHeatSet * (1.0 - smoothstep(0.6, 1.1, dn)));
    } else {
      float dist = length(p - A.xy);
      float rr = P.x;
      if (dist > rr + 0.45) continue;
      float ring = exp(-sq((dist - rr) / 0.07)) + 0.6 * exp(-sq((dist - rr * 0.68) / 0.06));
      if (c.r > -0.05) c.r = max(c.r, P.y * ring);
      c.g = max(c.g, 0.9 * (1.0 - smoothstep(rr - 0.1, rr + 0.25, dist)) * smoothstep(0.0, rr * 0.4, dist));
    }
  }
  gl_FragColor = c;
}
`;

const CLEAR_FRAG = /* glsl */ `
varying vec2 vUv;
void main() { gl_FragColor = vec4(0.0); }
`;

export class DeformSim {
  private rts: THREE.WebGLRenderTarget[] = [];
  private cur = 0;
  private fsq = new FullscreenPass();
  private mats: THREE.ShaderMaterial[] = [];
  private clearMat = passMaterial(CLEAR_FRAG, {});
  private segA: THREE.Vector4[] = [];
  private segP: THREE.Vector4[] = [];
  private segBox = new THREE.Vector4();
  private queue: number[] = []; // flat 8 floats per seg
  private biome: BiomeVisual = BIOME_VISUALS.karesansui;
  private res = 512;
  boardW = 28; boardH = 18;
  /** World rect covered by the texture: x0, y0, w, h. */
  readonly region = new THREE.Vector4();
  readonly texel = new THREE.Vector2();
  private texW = 1; private texH = 1;
  private prevHead: [number, number] | null = null;
  private needsClear = true;
  // coverage
  private cov = new Uint8Array(1);
  private covW = 1; private covH = 1;
  private covCount = 0;
  // lagoon waves
  private waveClock = 0;
  private nextWave = 6;
  private wavePhase = -1;
  /** x = edge y (world), y = advancing(1/0), z = sheet alpha, w = foam strength */
  readonly wave = new THREE.Vector4(1e3, 0, 0, 0);
  private simTime = 0;
  private prevEdge = 1e3;
  /** Mars dust devils (x, y, radius, strength); shared with the sand shader as uniforms. */
  readonly devils = [new THREE.Vector4(-100, -100, 0, 0), new THREE.Vector4(-100, -100, 0, 0)];
  private devilTmp: DustDevilPos = { x: 0, y: 0, r: 0 };
  private boardV = new THREE.Vector2(28, 18);

  constructor() {
    for (let i = 0; i < MAXSEG; i++) { this.segA.push(new THREE.Vector4()); this.segP.push(new THREE.Vector4()); }
    for (let b = 0; b < BIOME_COUNT; b++) {
      this.mats.push(passMaterial(SIM_FRAG, {
        uSharp: { value: 0 }, uDevil: { value: this.devils }, uBoard: { value: this.boardV },
        uPrev: { value: null }, uTexel: { value: this.texel }, uRegion: { value: this.region },
        uDt: { value: 0 }, uDiffK: { value: 0 }, uTalus: { value: 1 }, uRelax: { value: 1 },
        uErode: { value: 0 }, uSmear: { value: 0 }, uBDecay: { value: 0 }, uHeatSet: { value: 0 },
        uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uWave: { value: this.wave },
        uSegA: { value: this.segA }, uSegP: { value: this.segP }, uSegCount: { value: 0 }, uSegBox: { value: this.segBox },
      }, { BIOME: b }));
    }
  }

  get texture(): THREE.Texture { return this.rts[this.cur]?.texture ?? null!; }

  compile(r: THREE.WebGLRenderer) {
    for (const m of this.mats) this.fsq.compile(r, m);
  }

  setBiome(id: BiomeId) {
    this.biome = BIOME_VISUALS[id];
    this.wave.set(1e3, 0, 0, 0);
    this.prevEdge = 1e3;
    this.wavePhase = -1;
    this.nextWave = 5;
    this.waveClock = 0;
    this.clear();
  }

  /** Change sim resolution (quality). Existing trails are resampled into the new targets. */
  setResolution(res: number, r?: THREE.WebGLRenderer) {
    if (res === this.res && this.rts.length) return;
    this.res = res;
    const old = this.rts[this.cur];
    const keep = !!(r && old && !this.needsClear);
    this.alloc(keep ? old : null);
    if (keep && r) {
      this.copyMat.uniforms.uTex.value = old.texture;
      for (const rt of this.rts) this.fsq.render(r, this.copyMat, rt);
      r.setRenderTarget(null);
      this.needsClear = false;
    }
    old?.dispose();
  }
  private copyMat = passMaterial(/* glsl */`varying vec2 vUv; uniform sampler2D uTex; void main(){ gl_FragColor = texture2D(uTex, vUv); }`, { uTex: { value: null } });

  setBoard(w: number, h: number) {
    this.boardW = w; this.boardH = h;
    this.boardV.set(w, h);
    this.alloc();
  }

  private alloc(spare: THREE.WebGLRenderTarget | null = null) {
    const W = this.boardW + MARGIN * 2, H = this.boardH + MARGIN * 2;
    const texel = Math.max(W, H) / this.res;
    this.texW = Math.max(2, Math.round(W / texel));
    this.texH = Math.max(2, Math.round(H / texel));
    const rw = this.texW * texel, rh = this.texH * texel;
    this.region.set(this.boardW / 2 - rw / 2, this.boardH / 2 - rh / 2, rw, rh);
    this.texel.set(1 / this.texW, 1 / this.texH);
    for (const rt of this.rts) if (rt !== spare) rt.dispose();
    this.rts = [makeRT(this.texW, this.texH), makeRT(this.texW, this.texH)];
    this.cur = 0;
    if (spare) return; // resolution change only: keep coverage + head tracking
    this.covW = Math.ceil(this.boardW * COV_RES);
    this.covH = Math.ceil(this.boardH * COV_RES);
    this.cov = new Uint8Array(this.covW * this.covH);
    this.clear();
  }

  clear() {
    this.needsClear = true;
    this.prevHead = null;
    this.queue.length = 0;
    this.cov.fill(0);
    this.covCount = 0;
  }

  coverage() { return this.covCount / Math.max(1, this.cov.length); }
  /** Number of queued stamp segments. */
  get pending() { return this.queue.length / 8; }

  private push(ax: number, ay: number, bx: number, by: number, w: number, depth: number, rough: number, type: number) {
    this.queue.push(ax, ay, bx, by, w, depth, rough, type);
    if (type === SEG_GROOVE || type === SEG_CRATER) this.markCoverage(ax, ay, type === SEG_CRATER ? ax : bx, type === SEG_CRATER ? ay : by, w * 1.2);
  }

  private markCoverage(ax: number, ay: number, bx: number, by: number, rad: number) {
    const k = COV_RES;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - rad) * k));
    const x1 = Math.min(this.covW - 1, Math.ceil((Math.max(ax, bx) + rad) * k));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - rad) * k));
    const y1 = Math.min(this.covH - 1, Math.ceil((Math.max(ay, by) + rad) * k));
    const abx = bx - ax, aby = by - ay;
    const L2 = Math.max(1e-6, abx * abx + aby * aby);
    const r2 = rad * rad;
    for (let y = y0; y <= y1; y++) {
      const py = (y + 0.5) / k;
      for (let x = x0; x <= x1; x++) {
        const i = y * this.covW + x;
        if (this.cov[i]) continue;
        const px = (x + 0.5) / k;
        let t = ((px - ax) * abx + (py - ay) * aby) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
        if (dx * dx + dy * dy <= r2) { this.cov[i] = 1; this.covCount++; }
      }
    }
  }

  /** Queue stamps for this frame from the snake + events. */
  ingest(f: RenderFrame) {
    const s = f.snake;
    const halfW = s.radius * 1.25;
    const depth = 1.0;
    for (const e of f.events) {
      if (e.type === 'start' || e.type === 'wrap') this.prevHead = null;
      else if (e.type === 'eat') {
        this.push(e.x, e.y, 0, 0, 0.55, 0.9, 0, SEG_CRATER);
        this.push(e.x, e.y, 0, 0, 1.05, 0.28, 0, SEG_RING);
      } else if (e.type === 'death' || e.type === 'hit') {
        const pts = s.points;
        for (let i = 0; i + 2 < s.count; i += 2) {
          const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[i * 2 + 4], by = pts[i * 2 + 5];
          if (Math.hypot(bx - ax, by - ay) > 1) continue;
          const taper = Math.max(0.35, 1 - i / Math.max(1, s.count));
          this.push(ax, ay, bx, by, halfW * (0.8 + 0.35 * taper), depth * (0.9 + 0.3 * taper), 1.0, SEG_GROOVE);
        }
        this.prevHead = null;
      }
    }
    if (!s.alive || s.count < 2) { this.prevHead = null; return; }
    const hx = s.points[0], hy = s.points[1];
    if (this.prevHead) {
      const [px, py] = this.prevHead;
      const moved = Math.hypot(hx - px, hy - py);
      if (moved > 2) {
        // teleport (wrap / respawn) — do not stamp across it
      } else if (moved > 1e-5) {
        // bow wave just ahead of the head (pushed first so the grooves below carve over it)
        const dl = Math.hypot(s.dirX, s.dirY) || 1;
        const dx = s.dirX / dl, dy = s.dirY / dl;
        this.push(hx + dx * halfW * 0.9, hy + dy * halfW * 0.9, dx, dy, halfW * 0.8, 0.3, 0, SEG_BUMP);
        // The sim keeps the first few body points exact (sharp grid turns at the head), while the
        // rest of the path is corner-smoothed. So the main groove is carved LAG units behind the
        // head: the arc range [LAG, LAG + moved] (what passed the lag point this frame).
        this.stampRange(s, LAG, LAG + moved + 0.04, halfW, depth);
        // narrow, shallow head indentation from the head back to the lag point (the head visibly
        // pushes in; small enough to stay inside the rounded groove at corners)
        this.stampRange(s, 0, LAG + 0.02, halfW * 0.5, depth * 0.5);
      }
    }
    this.prevHead = [hx, hy];
  }

  /** Stamp groove capsules along the body polyline between arc distances s0..s1 from the head. */
  private stampRange(s: RenderFrame['snake'], s0: number, s1: number, w: number, depth: number) {
    const pts = s.points, n = s.count;
    if (n < 2 || s1 <= s0) return;
    const tmp = this.tmpPath;
    let k = 0;
    let acc = 0;
    let started = false;
    for (let i = 0; i + 1 < n && k < tmp.length - 4; i++) {
      const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[i * 2 + 2], by = pts[i * 2 + 3];
      const L = Math.hypot(bx - ax, by - ay);
      if (L > 1) { if (started) break; else { acc += L; continue; } } // wrap gap
      const a0 = acc, a1 = acc + L;
      acc = a1;
      if (a1 < s0) continue;
      if (!started) {
        const t = L > 0 ? (s0 - a0) / L : 0;
        tmp[k++] = ax + (bx - ax) * t; tmp[k++] = ay + (by - ay) * t;
        started = true;
      }
      if (a1 >= s1) {
        const t = L > 0 ? (s1 - a0) / L : 1;
        tmp[k++] = ax + (bx - ax) * t; tmp[k++] = ay + (by - ay) * t;
        break;
      }
      tmp[k++] = bx; tmp[k++] = by;
    }
    // emit oldest (farthest from head) -> newest so fresh carves win
    for (let j = k - 2; j >= 2; j -= 2) {
      const ax = tmp[j], ay = tmp[j + 1], bx = tmp[j - 2], by = tmp[j - 1];
      if (Math.hypot(bx - ax, by - ay) < 1e-5 && k > 4) continue;
      this.push(ax, ay, bx, by, w, depth, 0, SEG_GROOVE);
    }
  }
  private tmpPath = new Float32Array(40);

  private updateWaves(dt: number) {
    const lap = this.biome.sim.lap;
    if (lap) {
      // calm lapping swash: quick run-up, slow backwash, two incommensurate periods (no surges)
      const t = this.simTime;
      const base = this.boardH - lap.edge;
      const edge = base - lap.amp * (0.62 * sw(t / 7.3) + 0.38 * sw(t / 4.1 + 0.37));
      const v = dt > 1e-4 && this.prevEdge < 1e2 ? (edge - this.prevEdge) / dt : 0;
      this.prevEdge = edge;
      // x = waterline y, y = highest swash line, z = sheet alpha, w = foam/glow (advancing swash)
      const foam = Math.min(1, Math.max(0, -v) * 2.2 + 0.12);
      this.wave.set(edge, base - lap.amp, 1, this.wave.w + (foam - this.wave.w) * Math.min(1, dt * 6));
      return;
    }
    if (!this.biome.sim.waves) { this.wave.set(1e3, 0, 0, 0); return; }
    const H = this.boardH;
    this.waveClock += dt;
    const idle = H + 0.35 + 0.18 * Math.sin(this.simTime * 0.9) + 0.08 * Math.sin(this.simTime * 2.3);
    if (this.wavePhase < 0 && this.waveClock >= this.nextWave) {
      this.wavePhase = 0;
      this.waveClock = 0;
      this.nextWave = 10 + Math.random() * 4;
      this.waveBand = 0.3 + Math.random() * 0.15;
    }
    if (this.wavePhase >= 0) {
      this.wavePhase += dt;
      const t = this.wavePhase;
      const lowest = H * (1 - this.waveBand);
      const TA = 2.2, TR = 4.5;
      if (t < TA) {
        const k = t / TA;
        const e = 1 - Math.pow(1 - k, 2.6);
        this.wave.set(idle + (lowest - idle) * e, 1, 1, 1);
      } else if (t < TA + TR) {
        const k = (t - TA) / TR;
        const e = k * k * (3 - 2 * k);
        this.wave.set(lowest + (idle - lowest) * e, 0, 1 - 0.75 * e, 1 - e);
      } else {
        this.wavePhase = -1;
      }
    }
    if (this.wavePhase < 0) this.wave.set(idle, 0, 0.25, 0.4);
  }
  private waveBand = 0.38;

  /** Run the simulation step (stamps + relax + biome rule). */
  step(r: THREE.WebGLRenderer, dt: number, time: number) {
    if (!this.rts.length) return;
    if (this.needsClear) {
      for (const rt of this.rts) this.fsq.render(r, this.clearMat, rt);
      this.needsClear = false;
    }
    this.simTime = time;
    dt = Math.min(dt, 0.5);
    this.updateWaves(dt);
    const b = this.biome;
    const m = this.mats[b.index];
    const u = m.uniforms;
    this.updateDevils(time);
    u.uSharp.value = b.sim.sharp ?? 0;
    const texelWorld = this.region.z / this.texW;
    u.uDt.value = dt;
    u.uTime.value = time;
    u.uDiffK.value = Math.min(0.2, (b.sim.diffusion * dt) / (texelWorld * texelWorld));
    u.uTalus.value = b.sim.talus * texelWorld;
    u.uErode.value = b.sim.erode;
    u.uSmear.value = Math.min(0.5, b.sim.smear * dt);
    (u.uWind.value as THREE.Vector2).set(b.sim.windX, b.sim.windY);
    u.uBDecay.value = b.sim.bDecay;
    u.uHeatSet.value = b.sim.heatSet;
    let first = true;
    const q = this.queue;
    let qi = 0;
    do {
      const n = Math.min(MAXSEG, (q.length - qi) / 8);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < n; i++) {
        const o = qi + i * 8;
        this.segA[i].set(q[o], q[o + 1], q[o + 2], q[o + 3]);
        this.segP[i].set(q[o + 4], q[o + 5], q[o + 6], q[o + 7]);
        // conservative reach of the stamp: groove 2.2w, bump/crater 2.5r, ring r + 0.45
        const t = q[o + 7], w = q[o + 4];
        const reach = t === SEG_GROOVE ? w * 2.6 : t === SEG_RING ? w + 0.5 : w * 2.6;
        const bx = t === SEG_GROOVE ? q[o + 2] : q[o], by = t === SEG_GROOVE ? q[o + 3] : q[o + 1];
        x0 = Math.min(x0, q[o] - reach, bx - reach); y0 = Math.min(y0, q[o + 1] - reach, by - reach);
        x1 = Math.max(x1, q[o] + reach, bx + reach); y1 = Math.max(y1, q[o + 1] + reach, by + reach);
      }
      this.segBox.set(x0, y0, x1, y1);
      qi += n * 8;
      u.uSegCount.value = n;
      u.uRelax.value = first ? 1 : 0;
      u.uPrev.value = this.rts[this.cur].texture;
      this.fsq.render(r, m, this.rts[1 - this.cur]);
      this.cur = 1 - this.cur;
      first = false;
    } while (qi < q.length);
    q.length = 0;
    r.setRenderTarget(null);
  }

  /** Dust devil positions (shared with the dresser's particle columns via dustDevilPosInto). */
  updateDevils(time: number) {
    const on = !!this.biome.sim.devils;
    for (let i = 0; i < 2; i++) {
      if (!on) { this.devils[i].set(-100, -100, 0, 0); continue; }
      const d = dustDevilPosInto(this.devilTmp, time, i, this.boardW, this.boardH);
      this.devils[i].set(d.x, d.y, d.r, 1);
    }
  }

  dispose() {
    for (const rt of this.rts) rt.dispose();
    for (const m of this.mats) m.dispose();
    this.clearMat.dispose();
    this.copyMat.dispose();
    this.fsq.dispose();
  }
}
