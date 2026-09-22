// Visual-only verlet chain used for the brief death writhe.
export class DeathChain {
  x = new Float32Array(0);
  private p = new Float32Array(0);
  private a = new Float32Array(0);   // anchor (frozen path)
  private nrm = new Float32Array(0); // lateral normals at seed time
  count = 0;
  spacing = 0.1;
  private t = 0;
  active = false;

  seed(pts: Float32Array, count: number, spacing: number) {
    if (this.x.length < count * 2) {
      this.x = new Float32Array(count * 2 + 64);
      this.p = new Float32Array(count * 2 + 64);
      this.a = new Float32Array(count * 2 + 64);
      this.nrm = new Float32Array(count * 2 + 64);
    }
    this.count = count; this.spacing = spacing; this.t = 0; this.active = true;
    for (let i = 0; i < count * 2; i++) { this.x[i] = pts[i]; this.p[i] = pts[i]; this.a[i] = pts[i]; }
    for (let i = 0; i < count; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(count - 1, i + 1);
      let tx = pts[i1 * 2] - pts[i0 * 2], ty = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      const l = Math.hypot(tx, ty);
      if (l < 1e-6 || l > 1.5) { tx = 1; ty = 0; } else { tx /= l; ty /= l; }
      this.nrm[i * 2] = -ty; this.nrm[i * 2 + 1] = tx;
    }
  }

  step(dt: number) {
    if (!this.active) return;
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    const t = this.t;
    if (t > 1.6) return; // settled
    const n = this.count, X = this.x, P = this.p, A = this.a, N = this.nrm;
    const sp = this.spacing;
    const env = Math.exp(-t * 3.2) * Math.min(1, t / 0.05);
    const damp = t < 0.8 ? 0.9 : 0.55;
    const dt2 = dt * dt;
    for (let i = 0; i < n; i++) {
      const s = i * sp;
      const along = Math.min(1, s / 1.5) * (0.6 + 0.4 * Math.sin(s * 0.7));
      const f = 85 * env * along * Math.sin(t * 13 - s * 1.8);
      const k = 0.12; // weak pull toward the frozen path
      const ix = i * 2, iy = ix + 1;
      const vx = (X[ix] - P[ix]) * damp, vy = (X[iy] - P[iy]) * damp;
      P[ix] = X[ix]; P[iy] = X[iy];
      X[ix] += vx + (N[ix] * f + (A[ix] - X[ix]) * k * 40) * dt2;
      X[iy] += vy + (N[iy] * f + (A[iy] - X[iy]) * k * 40) * dt2;
    }
    // distance constraints keep the body length
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < n - 1; i++) {
        const ix = i * 2, jx = ix + 2;
        const dx = X[jx] - X[ix], dy = X[jx + 1] - X[ix + 1];
        const d = Math.hypot(dx, dy);
        if (d < 1e-6 || d > 1.5) continue; // gap (teleport) – leave it
        const c = (d - sp) / d * 0.5;
        X[ix] += dx * c; X[ix + 1] += dy * c;
        X[jx] -= dx * c; X[jx + 1] -= dy * c;
      }
    }
  }
}
