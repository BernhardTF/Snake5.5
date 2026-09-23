// Dynamic tube along a PathTrack (rebuilt in place each frame, preallocated).
// The caller lays out rings, fills per-ring width/height/centre-z, then calls build().
import * as THREE from 'three';
import type { PathTrack, Sample } from './track';
import { newSample } from './track';

const TWO_PI = Math.PI * 2;

export interface TubeOpts {
  radial: number;
  maxRings: number;
  /** Exponent shaping the flank (1 = ellipse, <1 = boxier). */
  flank?: number;
  /** Relative belly depth (below centre) vs top height. */
  belly?: number;
}

export class Tube {
  readonly geometry = new THREE.BufferGeometry();
  readonly radial: number;
  readonly maxRings: number;
  private vpr: number;
  private CX: Float32Array; private CZ: Float32Array; private DX: Float32Array; private DZ: Float32Array;
  private pos: Float32Array; private nor: Float32Array; private uv: Float32Array; private info: Float32Array;
  private aPos: THREE.BufferAttribute; private aNor: THREE.BufferAttribute; private aUv: THREE.BufferAttribute; private aInfo: THREE.BufferAttribute;
  // rings
  readonly s: Float32Array; readonly x: Float32Array; readonly y: Float32Array;
  readonly tx: Float32Array; readonly ty: Float32Array;
  /** half width, top height above centre, centre z, lateral offset, free per-ring scalar */
  readonly w: Float32Array; readonly h: Float32Array; readonly zc: Float32Array; readonly off: Float32Array; readonly k: Float32Array;
  rings = 0;
  private smp: Sample = newSample();

  constructor(o: TubeOpts) {
    this.radial = o.radial; this.maxRings = o.maxRings;
    const R = o.radial, V = R + 1;
    this.vpr = V;
    this.CX = new Float32Array(V); this.CZ = new Float32Array(V); this.DX = new Float32Array(V); this.DZ = new Float32Array(V);
    const fl = o.flank ?? 0.85, be = o.belly ?? 0.6;
    const sx = (a: number) => { const s = Math.sin(a); return Math.sign(s) * Math.pow(Math.abs(s), fl); };
    const sz = (a: number) => { const c = -Math.cos(a); return c >= 0 ? Math.pow(c, 0.95) : -be * Math.pow(-c, 0.6); };
    const da = 1e-3;
    for (let j = 0; j < V; j++) {
      const a = (j / R) * TWO_PI;
      this.CX[j] = sx(a); this.CZ[j] = sz(a);
      this.DX[j] = (sx(a + da) - sx(a - da)) / (2 * da);
      this.DZ[j] = (sz(a + da) - sz(a - da)) / (2 * da);
    }
    const M = o.maxRings;
    this.pos = new Float32Array(M * V * 3); this.nor = new Float32Array(M * V * 3);
    this.uv = new Float32Array(M * V * 2); this.info = new Float32Array(M * V * 4);
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNor = new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage);
    const g = this.geometry;
    g.setAttribute('position', this.aPos); g.setAttribute('normal', this.aNor);
    g.setAttribute('uv', this.aUv); g.setAttribute('aInfo', this.aInfo);
    const idx = new Uint32Array((M - 1) * R * 6);
    let q = 0;
    for (let i = 0; i < M - 1; i++) for (let j = 0; j < R; j++) {
      const a = i * V + j, b = a + 1, c = a + V, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.s = new Float32Array(M); this.x = new Float32Array(M); this.y = new Float32Array(M);
    this.tx = new Float32Array(M); this.ty = new Float32Array(M);
    this.w = new Float32Array(M); this.h = new Float32Array(M); this.zc = new Float32Array(M);
    this.off = new Float32Array(M); this.k = new Float32Array(M);
  }

  /**
   * Place rings from s0 to s1: spacing dsFine for the first `fineLen`, then up to dsMax
   * (automatically coarser when the ring budget would overflow).
   */
  layout(track: PathTrack, s0: number, s1: number, dsFine: number, fineLen: number, dsMax: number) {
    const M = this.maxRings - 2;
    const fineRings = Math.ceil(fineLen / dsFine);
    const rest = Math.max(1, M - fineRings);
    const dsBody = Math.max(dsMax, (s1 - s0 - fineLen) / rest);
    let s = s0, n = 0;
    while (n < M) {
      this.s[n++] = s;
      if (s >= s1) break;
      const d = s - s0;
      const ds = d < fineLen ? dsFine : d < fineLen + 0.5 ? dsFine + (dsBody - dsFine) * (d - fineLen) / 0.5 : dsBody;
      s = Math.min(s1, s + ds);
      if (s1 - s < ds * 0.3) s = s1;
    }
    this.rings = n;
    const o = this.smp;
    for (let q = 0; q < n; q++) {
      track.sample(this.s[q], o);
      this.x[q] = o.x; this.y[q] = o.y; this.tx[q] = o.tx; this.ty[q] = o.ty;
      this.off[q] = 0; this.k[q] = 0;
    }
  }

  build() {
    const n = this.rings;
    if (n < 2) { this.geometry.setDrawRange(0, 0); return; }
    const V = this.vpr, R = this.radial;
    const { CX, CZ, DX, DZ, pos, nor, uv, info } = this;
    const S = this.s, W = this.w, H = this.h, Z = this.zc;
    const inv = 1 / R;
    for (let q = 0; q < n; q++) {
      const tx = this.tx[q], ty = this.ty[q];
      const sx = -ty, sy = tx;
      const cx = this.x[q] + sx * this.off[q], cy = this.y[q] + sy * this.off[q];
      const w = W[q], h = H[q], zc = Z[q];
      const qa = q > 0 ? q - 1 : q, qb = q < n - 1 ? q + 1 : q;
      // derivative w.r.t. s toward the tail; our tangent points to the head so flip the sign
      const dsq = (S[qb] - S[qa]) || 1;
      const dw = -(W[qb] - W[qa]) / dsq, dh = -(H[qb] - H[qa]) / dsq, dz = -(Z[qb] - Z[qa]) / dsq;
      const base = q * V;
      for (let j = 0; j < V; j++) {
        const X = CX[j], Zt = CZ[j], Xp = DX[j], Zp = DZ[j];
        const o = (base + j) * 3;
        pos[o] = cx + sx * w * X;
        pos[o + 1] = cy + sy * w * X;
        pos[o + 2] = zc + h * Zt;
        let nt = w * Xp * (dz + dh * Zt) - h * Zp * dw * X;
        let ns = h * Zp;
        let nu = -w * Xp;
        let l2 = nt * nt + ns * ns + nu * nu;
        if (l2 < 1e-18) { nt = 0; ns = X; nu = Zt; l2 = ns * ns + nu * nu || 1; }
        const il = 1 / Math.sqrt(l2);
        nt *= il; ns *= il; nu *= il;
        nor[o] = tx * nt + sx * ns;
        nor[o + 1] = ty * nt + sy * ns;
        nor[o + 2] = nu;
        const o2 = (base + j) * 2;
        uv[o2] = j * inv; uv[o2 + 1] = S[q];
        const o4 = (base + j) * 4;
        info[o4] = S[q]; info[o4 + 1] = this.k[q]; info[o4 + 2] = j * inv; info[o4 + 3] = w;
      }
    }
    const nv = n * V;
    up(this.aPos, nv * 3); up(this.aNor, nv * 3); up(this.aUv, nv * 2); up(this.aInfo, nv * 4);
    this.geometry.setDrawRange(0, (n - 1) * R * 6);
  }

  /** Ring index at/just before arclength s (binary search). */
  ringAt(s: number) {
    let lo = 0, hi = this.rings - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m; }
    return lo;
  }

  dispose() { this.geometry.dispose(); }
}

function up(a: THREE.BufferAttribute, n: number) { a.clearUpdateRanges(); a.addUpdateRange(0, n); a.needsUpdate = true; }
