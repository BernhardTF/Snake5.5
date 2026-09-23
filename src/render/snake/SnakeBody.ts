// Procedural snake tube, rebuilt in place every frame from the centerline.
import * as THREE from 'three';
import { SCALE_LEN } from './snakeMaterial';

export const RAD = 24;           // radial segments
const VPR = RAD + 1;             // vertices per ring (seam duplicated)
export const MAX_RINGS = 1500;
const TWO_PI = Math.PI * 2;

// Cross-section tables (unit shape). a = 0 belly, pi/2 right flank, pi top.
const CX = new Float32Array(VPR), CZ = new Float32Array(VPR);
const DX = new Float32Array(VPR), DZ = new Float32Array(VPR);
{
  const sx = (a: number) => { const s = Math.sin(a); return Math.sign(s) * Math.pow(Math.abs(s), 0.82); };
  const sz = (a: number) => {
    const c = -Math.cos(a);
    return c >= 0 ? Math.pow(c, 0.95) : -0.62 * Math.pow(-c, 0.55);
  };
  const da = 1e-3;
  for (let j = 0; j < VPR; j++) {
    const a = (j / RAD) * TWO_PI;
    CX[j] = sx(a); CZ[j] = sz(a);
    DX[j] = (sx(a + da) - sx(a - da)) / (2 * da);
    DZ[j] = (sz(a + da) - sz(a - da)) / (2 * da);
  }
}
/** Vertical centre as fraction of top height so the flattened belly rests on z≈0. */
const BELLY = 0.62;

// Radius profile of the head/neck (x = distance from snout tip in body radii, W relative width).
const HX = [0.42, 1.0, 1.75, 2.35, 2.85, 3.35, 4.2, 6.0];
const HW = [0.56, 0.8, 1.06, 1.22, 1.1, 0.88, 0.88, 1.0];
/** Very broad, triangular viper head (gaboon): straight flanks out to wide jaw corners, thin neck. */
const HW_BROAD = [0.66, 0.88, 1.2, 1.46, 1.6, 1.0, 0.76, 1.0];
function profileFrom(W: number[], x: number): number {
  if (x <= 0) return 0;
  if (x < HX[0]) { const t = 1 - x / HX[0]; return W[0] * Math.sqrt(Math.max(0, 1 - t * t)); }
  if (x >= HX[HX.length - 1]) return 1;
  let i = 0;
  while (x > HX[i + 1]) i++;
  const t = (x - HX[i]) / (HX[i + 1] - HX[i]);
  // monotone-ish cubic hermite with finite-difference tangents
  const m = (k: number) => {
    if (k <= 0) return (W[1] - W[0]) / (HX[1] - HX[0]);
    if (k >= HX.length - 1) return 0;
    return ((W[k + 1] - W[k]) / (HX[k + 1] - HX[k]) + (W[k] - W[k - 1]) / (HX[k] - HX[k - 1])) * 0.5;
  };
  const h = HX[i + 1] - HX[i];
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * W[i] + (t3 - 2 * t2 + t) * h * m(i) + (-2 * t3 + 3 * t2) * W[i + 1] + (t3 - t2) * h * m(i + 1);
}
/** Relative half-width at x body radii from the snout tip. broad: 0 = standard head, 1 = gaboon head. */
export function headProfile(x: number, broad = 0): number {
  const a = profileFrom(HW, x);
  return broad > 0 ? a + (profileFrom(HW_BROAD, x) - a) * broad : a;
}
/** Height/width ratio along the head (flat spade head, rounder body). Broad heads are flatter. */
function heightRatio(x: number, broad = 0) {
  let k: number;
  if (x < 2.9) k = 0.62 + 0.04 * Math.min(1, x / 1.0);
  else if (x < 4.5) k = 0.66 + (x - 2.9) / 1.6 * 0.16;
  else k = 0.82;
  if (broad > 0 && x < 4.5) k *= 1 - 0.2 * broad * (1 - smooth(2.9, 4.5, x));
  return k;
}

export interface BodyInput {
  /** Path xy (head first). */
  px: Float32Array;
  count: number;
  spacing: number;
  radius: number;
  fwdX: number; fwdY: number;
  bulges: { s: number; amount: number }[];
  /** Undulation */
  waveAmp: number;
  wavePhase: number;
  waveLen: number;
  headLead: number;
  /** Optional head shape: 0 = standard (default), 1 = very broad triangular viper head. */
  headWidth?: number;
}

/** Frame at an arbitrary arclength, used to attach head parts. */
export interface RingFrame { x: number; y: number; z: number; tx: number; ty: number; w: number; h: number; zc: number; }

export class SnakeBody {
  readonly geometry = new THREE.BufferGeometry();
  private pos = new Float32Array(MAX_RINGS * VPR * 3);
  private nor = new Float32Array(MAX_RINGS * VPR * 3);
  private tan = new Float32Array(MAX_RINGS * VPR * 2);
  private info = new Float32Array(MAX_RINGS * VPR * 4);
  private suv = new Float32Array(MAX_RINGS * VPR * 2);
  private aPos: THREE.BufferAttribute;
  private aNor: THREE.BufferAttribute;
  private aTan: THREE.BufferAttribute;
  private aInfo: THREE.BufferAttribute;
  private aSuv: THREE.BufferAttribute;
  // per ring scratch
  private rS = new Float32Array(MAX_RINGS);
  private rX = new Float32Array(MAX_RINGS);
  private rY = new Float32Array(MAX_RINGS);
  private rTx = new Float32Array(MAX_RINGS);
  private rTy = new Float32Array(MAX_RINGS);
  private rW = new Float32Array(MAX_RINGS);
  private rW0 = new Float32Array(MAX_RINGS);
  private rH = new Float32Array(MAX_RINGS);
  private rV = new Float32Array(MAX_RINGS);
  private rVoid = new Uint8Array(MAX_RINGS);
  // path scratch
  private sm = new Float32Array(1200 * 2);
  private tmp = new Float32Array(1200 * 2);
  private pre = new Float64Array(1201 * 2);
  private gapA: number[] = [];
  rings = 0;
  /** Tail end arclength and snout tip offset from last build. */
  tipS = 0;
  endS = 0;

  constructor() {
    const g = this.geometry;
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNor = new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage);
    this.aTan = new THREE.BufferAttribute(this.tan, 2).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSuv = new THREE.BufferAttribute(this.suv, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('normal', this.aNor);
    g.setAttribute('aTan', this.aTan);
    g.setAttribute('aInfo', this.aInfo);
    g.setAttribute('aSUv', this.aSuv);
    const idx = new Uint32Array((MAX_RINGS - 1) * RAD * 6);
    let k = 0;
    for (let i = 0; i < MAX_RINGS - 1; i++) for (let j = 0; j < RAD; j++) {
      const a = i * VPR + j, b = a + 1, c = a + VPR, d = c + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  }

  private ensure(n: number) {
    if (this.sm.length >= n * 2) return;
    this.sm = new Float32Array(n * 2 + 256);
    this.tmp = new Float32Array(n * 2 + 256);
    this.pre = new Float64Array(n * 2 + 258);
  }

  /** Box-filter a path segment [a,b] in place (src->dst), window shrinks toward ends so ends stay fixed. */
  private boxPass(src: Float32Array, dst: Float32Array, a: number, b: number, k: number) {
    const pre = this.pre;
    pre[a * 2] = 0; pre[a * 2 + 1] = 0;
    // prefix sums offset by one: pre[(i+1)] = sum_{a..i}
    let sx = 0, sy = 0;
    for (let i = a; i <= b; i++) { sx += src[i * 2]; sy += src[i * 2 + 1]; pre[(i + 1) * 2] = sx; pre[(i + 1) * 2 + 1] = sy; }
    pre[a * 2] = 0; pre[a * 2 + 1] = 0;
    for (let i = a; i <= b; i++) {
      const kk = Math.min(k, b - i, i - a);
      if (kk <= 0) { dst[i * 2] = src[i * 2]; dst[i * 2 + 1] = src[i * 2 + 1]; continue; }
      const lo = i - kk, hi = i + kk + 1;
      const loX = lo === a ? 0 : pre[lo * 2], loY = lo === a ? 0 : pre[lo * 2 + 1];
      const n = hi - lo;
      dst[i * 2] = (pre[hi * 2] - loX) / n;
      dst[i * 2 + 1] = (pre[hi * 2 + 1] - loY) / n;
    }
  }

  build(inp: BodyInput) {
    const n = inp.count;
    if (n < 2) { this.geometry.setDrawRange(0, 0); this.rings = 0; return; }
    this.ensure(n);
    const P = inp.px, sp = inp.spacing, r0 = inp.radius;
    // ---- gaps (teleports)
    const gapTh = Math.max(1.0, sp * 4);
    const gaps = this.gapA; gaps.length = 0;
    for (let i = 0; i < n - 1; i++) {
      const dx = P[i * 2 + 2] - P[i * 2], dy = P[i * 2 + 3] - P[i * 2 + 1];
      if (dx * dx + dy * dy > gapTh * gapTh) gaps.push(i);
    }
    // ---- smoothing per contiguous segment
    const k = Math.max(1, Math.round(0.3 / sp));
    let a = 0;
    for (let gi = 0; gi <= gaps.length; gi++) {
      const b = gi < gaps.length ? gaps[gi] : n - 1;
      this.boxPass(P, this.tmp, a, b, k);
      this.boxPass(this.tmp, this.sm, a, b, k);
      a = b + 1;
    }
    const S = this.sm;

    // ---- ring distribution
    const L = (n - 1) * sp;
    const tipExt = r0 * 0.35;
    const s0 = -tipExt;
    const headZone = r0 * 7.5;
    const dsHead = Math.max(0.022, r0 * 0.075);
    const budget = MAX_RINGS - Math.ceil((headZone + tipExt) / dsHead) - 8;
    const dsBody = Math.max(0.055, Math.min(0.25, Math.max((L - headZone) / Math.max(50, budget), L / 750)));
    const totalLen = L - s0;
    const taperLen = Math.max(Math.min(totalLen * 0.32, 2.2 + totalLen * 0.2), Math.min(1.1, totalLen * 0.4));
    const taperStart = L - taperLen;

    let nr = 0;
    let s = s0;
    const rS = this.rS;
    while (nr < MAX_RINGS - 1) {
      rS[nr++] = s;
      if (s >= L) break;
      const sT = s - s0;
      const ds = sT < headZone ? dsHead : sT < headZone + 1 ? dsHead + (dsBody - dsHead) * (sT - headZone) : dsBody;
      s = Math.min(L, s + ds);
      if (L - s < ds * 0.3 && s < L) s = L;
    }
    this.rings = nr;
    this.tipS = s0; this.endS = L;

    // ---- positions along path + undulation
    const rX = this.rX, rY = this.rY, rW = this.rW, rW0 = this.rW0, rH = this.rH, rVoid = this.rVoid;
    let fx = inp.fwdX, fy = inp.fwdY;
    {
      const hx = S[0] - S[2], hy = S[1] - S[3];
      const hl = Math.hypot(hx, hy);
      if (hl > 1e-5 && hl < gapTh) { fx = fx * 0.5 + (hx / hl) * 0.5; fy = fy * 0.5 + (hy / hl) * 0.5; }
      const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
    }
    const kw = TWO_PI / inp.waveLen;
    const broad = inp.headWidth ?? 0;
    for (let q = 0; q < nr; q++) {
      const sq = rS[q];
      let x: number, y: number, tx: number, ty: number;
      rVoid[q] = 0;
      if (sq <= 0) {
        x = S[0] + fx * -sq; y = S[1] + fy * -sq; tx = -fx; ty = -fy;
      } else {
        const f = sq / sp;
        let i = Math.floor(f);
        if (i > n - 2) i = n - 2;
        const t = f - i;
        const x0 = S[i * 2], y0 = S[i * 2 + 1], x1 = S[i * 2 + 2], y1 = S[i * 2 + 3];
        let isGap = false;
        for (let g = 0; g < gaps.length; g++) if (gaps[g] === i) { isGap = true; break; }
        if (isGap) {
          rVoid[q] = 1;
          if (t < 0.5) { x = x0; y = y0; } else { x = x1; y = y1; }
          tx = 1; ty = 0;
        } else {
          x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t;
          tx = x1 - x0; ty = y1 - y0;
          const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        }
      }
      // radius profile
      const xr = (sq - s0) / r0;
      let W = headProfile(xr, broad);
      if (sq > taperStart) {
        const tt = Math.min(1, (sq - taperStart) / taperLen);
        W *= Math.pow(Math.max(0, 1 - Math.pow(tt, 1.35)), 0.85);
        if (tt >= 1) W = 0;
      }
      rW0[q] = W;
      let bul = 1;
      for (let b = 0; b < inp.bulges.length; b++) {
        const bb = inp.bulges[b];
        const d = (sq - bb.s) / 0.42;
        if (d > -3 && d < 3) bul += 0.45 * Math.min(1, Math.max(0, bb.amount)) * Math.exp(-d * d);
      }
      // gap caps
      let cap = 1;
      if (gaps.length) {
        for (let g = 0; g < gaps.length; g++) {
          const ga = gaps[g] * sp, gb = (gaps[g] + 1) * sp;
          const dg = sq < ga ? ga - sq : sq > gb ? sq - gb : 0;
          const capLen = r0 * 0.9;
          if (dg < capLen) { const tt = 1 - dg / capLen; cap = Math.min(cap, Math.sqrt(Math.max(0, 1 - tt * tt))); }
        }
      }
      if (rVoid[q]) cap = 0;
      rW[q] = W * bul * cap;
      rH[q] = heightRatio(xr, broad) * (1 + (bul - 1) * 0.8);
      // lateral undulation (0 at head, grows backwards)
      const sT = sq - s0;
      const grow = smooth(0.55, 3.2, sT) * (0.75 + 0.25 * Math.min(1, sT / 14));
      const tailK = sq > taperStart ? 1 - 0.5 * Math.min(1, (sq - taperStart) / taperLen) : 1;
      let off = inp.waveAmp * grow * tailK * Math.sin(kw * sT - inp.wavePhase);
      // head leads into turns
      off += inp.headLead * (1 - smooth(0, 1.4, sT)) * smooth(-0.1, 0.35, sT);
      if (rVoid[q]) off = 0;
      rX[q] = x + -ty * off;
      rY[q] = y + tx * off;
      this.rTx[q] = tx; this.rTy[q] = ty;
    }
    // ---- tangents from final centres; scale v coordinate
    const rTx = this.rTx, rTy = this.rTy, rV = this.rV;
    let v = 0;
    for (let q = 0; q < nr; q++) {
      if (!rVoid[q]) {
        const qa = Math.max(0, q - 1), qb = Math.min(nr - 1, q + 1);
        const okA = !rVoid[qa], okB = !rVoid[qb];
        const ia = okA ? qa : q, ib = okB ? qb : q;
        const dx = rX[ib] - rX[ia], dy = rY[ib] - rY[ia];
        const l = Math.hypot(dx, dy);
        if (l > 1e-6 && l < gapTh) { rTx[q] = dx / l; rTy[q] = dy / l; }
      }
      if (q > 0) v += (rS[q] - rS[q - 1]) / (SCALE_LEN * Math.max(0.42, rW0[q]));
      rV[q] = v;
    }

    // ---- vertices
    const pos = this.pos, nor = this.nor, tan = this.tan, info = this.info, suv = this.suv;
    const sinv = 1 / RAD;
    for (let q = 0; q < nr; q++) {
      const tx = rTx[q], ty = rTy[q];
      const sx = -ty, sy = tx; // side
      const w = r0 * rW[q];
      const h = w * rH[q];
      const zc = h * BELLY - 0.004;
      // derivatives along s
      const qa = Math.max(0, q - 1), qb = Math.min(nr - 1, q + 1);
      const dsq = rS[qb] - rS[qa] || 1;
      const wA = r0 * rW[qa], wB = r0 * rW[qb];
      const hA = wA * rH[qa], hB = wB * rH[qb];
      const dw = (wB - wA) / dsq, dh = (hB - hA) / dsq, dzc = dh * BELLY;
      const sT = rS[q] - s0;
      const tailT = rS[q] > taperStart ? (rS[q] - taperStart) / taperLen : 0;
      const base = q * VPR;
      for (let j = 0; j < VPR; j++) {
        const X = CX[j], Z = CZ[j], Xp = DX[j], Zp = DZ[j];
        const o = (base + j) * 3;
        pos[o] = rX[q] + sx * w * X;
        pos[o + 1] = rY[q] + sy * w * X;
        pos[o + 2] = zc + h * Z;
        // N = T*(wX'(zc'+h'Z) - hZ'w'X) + side*(hZ') + up*(-wX')
        let nt = w * Xp * (dzc + dh * Z) - h * Zp * dw * X;
        let ns = h * Zp;
        let nu = -w * Xp;
        let l2 = nt * nt + ns * ns + nu * nu;
        if (l2 < 1e-18) { nt = 0; ns = X; nu = Z; l2 = ns * ns + nu * nu || 1; }
        const il = 1 / Math.sqrt(l2);
        nt *= il; ns *= il; nu *= il;
        nor[o] = tx * nt + sx * ns;
        nor[o + 1] = ty * nt + sy * ns;
        nor[o + 2] = nu;
        const o2 = (base + j) * 2;
        tan[o2] = tx; tan[o2 + 1] = ty;
        suv[o2] = j * sinv; suv[o2 + 1] = rV[q];
        const o4 = (base + j) * 4;
        info[o4] = sT; info[o4 + 1] = rS[q]; info[o4 + 2] = rW[q]; info[o4 + 3] = tailT;
      }
    }
    const nv = nr * VPR;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, nv * 3); this.aPos.needsUpdate = true;
    this.aNor.clearUpdateRanges(); this.aNor.addUpdateRange(0, nv * 3); this.aNor.needsUpdate = true;
    this.aTan.clearUpdateRanges(); this.aTan.addUpdateRange(0, nv * 2); this.aTan.needsUpdate = true;
    this.aInfo.clearUpdateRanges(); this.aInfo.addUpdateRange(0, nv * 4); this.aInfo.needsUpdate = true;
    this.aSuv.clearUpdateRanges(); this.aSuv.addUpdateRange(0, nv * 2); this.aSuv.needsUpdate = true;
    this.geometry.setDrawRange(0, (nr - 1) * RAD * 6);
  }

  /** Interpolated frame at arclength s (from head point; negative = toward snout tip). */
  frameAt(s: number, r0: number, out: RingFrame): RingFrame {
    const nr = this.rings;
    const rS = this.rS;
    if (nr < 2) { out.x = out.y = out.z = 0; out.tx = 1; out.ty = 0; out.w = out.h = out.zc = 0; return out; }
    let q = 0;
    while (q < nr - 2 && rS[q + 1] < s) q++;
    const t = Math.min(1, Math.max(0, (s - rS[q]) / ((rS[q + 1] - rS[q]) || 1)));
    const lerp = (A: Float32Array) => A[q] + (A[q + 1] - A[q]) * t;
    out.x = lerp(this.rX); out.y = lerp(this.rY);
    let tx = lerp(this.rTx), ty = lerp(this.rTy);
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    out.tx = tx; out.ty = ty;
    out.w = r0 * lerp(this.rW);
    out.h = out.w * lerp(this.rH);
    out.zc = out.h * BELLY - 0.004;
    out.z = out.zc;
    return out;
  }
}

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
