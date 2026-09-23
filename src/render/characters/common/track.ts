// Shared centreline sampler for Legend characters.
// Smooths the raw head→tail path per contiguous piece, detects wrap gaps (jump > 1.2 cells) and
// lets characters sample position/tangent at any arclength s (0 = head point, grows toward the tail,
// negative = extrapolated ahead of the head). Everything is preallocated; no per-frame allocations.

export const MAX_POINTS = 4000;
export const GAP_JUMP = 1.2;

export interface Sample { x: number; y: number; tx: number; ty: number; }
export const newSample = (): Sample => ({ x: 0, y: 0, tx: 1, ty: 0 });

export class PathTrack {
  readonly x = new Float32Array(MAX_POINTS);
  readonly y = new Float32Array(MAX_POINTS);
  readonly tx = new Float32Array(MAX_POINTS);
  readonly ty = new Float32Array(MAX_POINTS);
  /** gap[i] = 1 when the segment i→i+1 is a wrap jump. */
  readonly gap = new Uint8Array(MAX_POINTS);
  /** Arclength of each cut (midpoint of a gap segment). */
  readonly cuts = new Float32Array(64);
  nCuts = 0;
  n = 0;
  sp = 0.125;
  /** Arclength of the last point. */
  L = 0;
  private tmpX = new Float32Array(MAX_POINTS);
  private tmpY = new Float32Array(MAX_POINTS);
  private pre = new Float64Array((MAX_POINTS + 1) * 2);
  private rawX = new Float32Array(MAX_POINTS);
  private rawY = new Float32Array(MAX_POINTS);

  /**
   * @param smoothLen box half-window in world units (two passes).
   * @param fwdX,fwdY head heading used to extrapolate ahead of point 0.
   */
  update(points: Float32Array, count: number, spacing: number, smoothLen: number, fwdX: number, fwdY: number) {
    const n = Math.max(0, Math.min(count, MAX_POINTS, points.length >> 1));
    this.n = n;
    this.sp = spacing > 1e-4 ? spacing : 0.125;
    this.L = n > 1 ? (n - 1) * this.sp : 0;
    this.nCuts = 0;
    if (n === 0) return;
    const rx = this.rawX, ry = this.rawY, gap = this.gap;
    for (let i = 0; i < n; i++) { rx[i] = points[i * 2]; ry[i] = points[i * 2 + 1]; gap[i] = 0; }
    const th2 = GAP_JUMP * GAP_JUMP;
    for (let i = 0; i < n - 1; i++) {
      const dx = rx[i + 1] - rx[i], dy = ry[i + 1] - ry[i];
      if (dx * dx + dy * dy > th2) {
        gap[i] = 1;
        if (this.nCuts < this.cuts.length) this.cuts[this.nCuts++] = (i + 0.5) * this.sp;
      }
    }
    const k = Math.max(0, Math.round(smoothLen / this.sp));
    let a = 0;
    for (let i = 0; i < n; i++) {
      if (i === n - 1 || gap[i]) {
        this.box(rx, ry, this.tmpX, this.tmpY, a, i, k);
        this.box(this.tmpX, this.tmpY, this.x, this.y, a, i, k);
        a = i + 1;
      }
    }
    // tangents (toward the head), central difference over ±2 points inside a piece
    const X = this.x, Y = this.y;
    let pa = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0 && gap[i - 1]) pa = i;
      let pb = i;
      while (pb < n - 1 && !gap[pb] && pb - i < 2) pb++;
      let ia = i;
      while (ia > pa && i - ia < 2) ia--;
      let dx = X[ia] - X[pb], dy = Y[ia] - Y[pb];
      let l = Math.hypot(dx, dy);
      if (l < 1e-6) { dx = i === 0 ? fwdX : this.tx[i - 1]; dy = i === 0 ? fwdY : this.ty[i - 1]; l = Math.hypot(dx, dy) || 1; }
      this.tx[i] = dx / l; this.ty[i] = dy / l;
    }
    // blend the head tangent with the provided heading for a responsive nose
    const fl = Math.hypot(fwdX, fwdY);
    if (fl > 1e-4) {
      let hx = this.tx[0] * 0.5 + (fwdX / fl) * 0.5, hy = this.ty[0] * 0.5 + (fwdY / fl) * 0.5;
      const hl = Math.hypot(hx, hy) || 1; hx /= hl; hy /= hl;
      this.tx[0] = hx; this.ty[0] = hy;
    }
  }

  private box(sx: Float32Array, sy: Float32Array, dx: Float32Array, dy: Float32Array, a: number, b: number, k: number) {
    if (k <= 0 || b - a < 2) { for (let i = a; i <= b; i++) { dx[i] = sx[i]; dy[i] = sy[i]; } return; }
    const pre = this.pre;
    let ax = 0, ay = 0;
    pre[a * 2] = 0; pre[a * 2 + 1] = 0;
    for (let i = a; i <= b; i++) { ax += sx[i]; ay += sy[i]; pre[(i + 1) * 2] = ax; pre[(i + 1) * 2 + 1] = ay; }
    for (let i = a; i <= b; i++) {
      const kk = Math.min(k, b - i, i - a);
      if (kk <= 0) { dx[i] = sx[i]; dy[i] = sy[i]; continue; }
      const lo = i - kk, hi = i + kk + 1;
      const inv = 1 / (hi - lo);
      dx[i] = (pre[hi * 2] - pre[lo * 2]) * inv;
      dy[i] = (pre[hi * 2 + 1] - pre[lo * 2 + 1]) * inv;
    }
  }

  /** Position + unit tangent (pointing toward the head) at arclength s. */
  sample(s: number, o: Sample): Sample {
    const n = this.n;
    if (n === 0) { o.x = 0; o.y = 0; o.tx = 1; o.ty = 0; return o; }
    if (s <= 0 || n === 1) {
      const e = s < 0 ? -s : 0;
      o.tx = this.tx[0]; o.ty = this.ty[0];
      o.x = this.x[0] + o.tx * e; o.y = this.y[0] + o.ty * e;
      return o;
    }
    if (s >= this.L) {
      const e = s - this.L, j = n - 1;
      o.tx = this.tx[j]; o.ty = this.ty[j];
      o.x = this.x[j] - o.tx * e; o.y = this.y[j] - o.ty * e;
      return o;
    }
    const f = s / this.sp;
    const i = Math.min(n - 2, Math.floor(f));
    const t = f - i;
    if (this.gap[i]) {
      const j = t < 0.5 ? i : i + 1;
      o.x = this.x[j]; o.y = this.y[j]; o.tx = this.tx[j]; o.ty = this.ty[j];
      return o;
    }
    o.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    o.y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    let tx = this.tx[i] + (this.tx[i + 1] - this.tx[i]) * t;
    let ty = this.ty[i] + (this.ty[i + 1] - this.ty[i]) * t;
    const l = Math.hypot(tx, ty) || 1;
    o.tx = tx / l; o.ty = ty / l;
    return o;
  }

  /** Distance from s to the nearest wrap cut (Infinity if none). */
  gapDist(s: number): number {
    let d = Infinity;
    for (let c = 0; c < this.nCuts; c++) { const e = Math.abs(s - this.cuts[c]); if (e < d) d = e; }
    return d;
  }

  /** True when [s0, s1] straddles a wrap cut. */
  crossesGap(s0: number, s1: number): boolean {
    for (let c = 0; c < this.nCuts; c++) { const q = this.cuts[c]; if (q > s0 && q < s1) return true; }
    return false;
  }

  /**
   * Rigid body between two arclengths (front sF < rear sR), like a car on a track:
   * position = midpoint of the two bogies, tangent = rear→front chord.
   */
  chord(sF: number, sR: number, o: Sample, tmp: Sample): Sample {
    this.sample(sR, tmp);
    const rx = tmp.x, ry = tmp.y, rtx = tmp.tx, rty = tmp.ty;
    this.sample(sF, o);
    let dx = o.x - rx, dy = o.y - ry;
    const l = Math.hypot(dx, dy);
    if (l < 1e-5 || l > GAP_JUMP) { dx = o.tx + rtx; dy = o.ty + rty; }
    const ll = Math.hypot(dx, dy) || 1;
    o.x = (o.x + rx) * 0.5; o.y = (o.y + ry) * 0.5;
    o.tx = dx / ll; o.ty = dy / ll;
    return o;
  }
}
