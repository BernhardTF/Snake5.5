// Scripted RenderFrame generator for developing render modules in isolation (?dev=...).
import type { RenderFrame, SkinId } from '../types';

export class FakeWorld {
  boardW: number;
  boardH: number;
  private hist: number[] = [];
  private t = 0;
  private start = performance.now();
  private last = performance.now();
  skin: SkinId = 'obsidian';
  length = 14;
  private pts = new Float32Array(2 * 600);

  // Optional URL knobs for render QA: &path=grid (grid-like meander with rounded U-turns),
  // &eat=<seconds between eat events>, &die=<time of death in seconds>, &slow=1, &shake=0.5
  private opts = { grid: false, eat: 0, die: 0, slow: false, shake: 0 };
  private gridPath: Float32Array | null = null;
  private gridLen = 0;
  private nextEat = 0;
  private deadAt = -1;
  private deathSent = false;
  private frozen: Float32Array | null = null;
  private frozenCount = 0;

  constructor(w = 28, h = 18) {
    this.boardW = w;
    this.boardH = h;
    try {
      const q = new URLSearchParams(location.search);
      this.opts.grid = q.get('path') === 'grid';
      this.opts.eat = +(q.get('eat') ?? 0);
      this.opts.die = +(q.get('die') ?? 0);
      this.opts.slow = q.get('slow') === '1';
      this.opts.shake = +(q.get('shake') ?? 0);
      this.nextEat = this.opts.eat;
    } catch { /* not in a browser */ }
    if (this.opts.grid) this.buildGrid();
  }

  private buildGrid() {
    // boustrophedon-ish grid walk with a few detours, corners rounded by Chaikin smoothing
    const W = this.boardW, H = this.boardH;
    let pts: number[] = [];
    let y = 2.5, dir = 1;
    pts.push(2.5, y);
    while (y < H - 3) {
      const xEnd = dir > 0 ? W - 2.5 - ((y * 7) % 4) : 2.5 + ((y * 5) % 3);
      pts.push(xEnd, y);
      y += 2 + ((y * 3) % 2);
      pts.push(xEnd, y);
      dir = -dir;
    }
    pts.push(W / 2, y, W / 2, H * 0.45, W * 0.3, H * 0.45, W * 0.3, 2.5);
    pts.push(2.5, 2.5);
    for (let it = 0; it < 3; it++) {
      const o: number[] = [];
      const n = pts.length / 2;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2], ay = pts[i * 2 + 1];
        const bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
        o.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
      }
      pts = o;
    }
    // resample by arc length at 0.05
    const out: number[] = [];
    const n = pts.length / 2;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], ay = pts[i * 2 + 1];
      const bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
      const L = Math.hypot(bx - ax, by - ay);
      while (acc <= L) { const k = acc / (L || 1); out.push(ax + (bx - ax) * k, ay + (by - ay) * k); acc += 0.05; }
      acc -= L;
    }
    this.gridPath = new Float32Array(out);
    this.gridLen = out.length / 2 * 0.05;
  }

  private head(t: number) {
    const W = this.boardW, H = this.boardH;
    if (this.gridPath) {
      const sArc = (((t * 3.2) % this.gridLen) + this.gridLen) % this.gridLen;
      const f = sArc / 0.05;
      const i = Math.floor(f), k = f - i;
      const n = this.gridPath.length / 2;
      const a = i % n, b = (i + 1) % n;
      return [
        this.gridPath[a * 2] + (this.gridPath[b * 2] - this.gridPath[a * 2]) * k,
        this.gridPath[a * 2 + 1] + (this.gridPath[b * 2 + 1] - this.gridPath[a * 2 + 1]) * k,
      ];
    }
    // grid-like meander with rounded corners, similar to the reference
    const x = W * 0.5 + Math.sin(t * 0.23) * W * 0.36 + Math.sin(t * 0.61) * 1.5;
    const y = H * 0.5 + Math.sin(t * 0.37 + 1.2) * H * 0.34;
    return [x, y];
  }

  frame(fixedDt?: number): RenderFrame {
    const now = performance.now();
    const dt = fixedDt ?? Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const spacing = 0.12;
    // resample path by walking backwards in time
    let count = 0;
    let [px, py] = this.head(this.t);
    this.pts[0] = px; this.pts[1] = py; count = 1;
    let tt = this.t;
    let acc = 0;
    const need = Math.floor(this.length / spacing);
    while (count < need && tt > this.t - 60) {
      tt -= 0.004;
      const [x, y] = this.head(tt);
      acc += Math.hypot(x - px, y - py);
      px = x; py = y;
      if (acc >= spacing) {
        this.pts[count * 2] = x; this.pts[count * 2 + 1] = y; count++;
        acc = 0;
      }
    }
    const [hx, hy] = this.head(this.t);
    const [ax, ay] = this.head(this.t - 0.01);
    const dl = Math.hypot(hx - ax, hy - ay) || 1;
    const [bx, by] = this.head(this.t - 0.02);
    const a1 = Math.atan2(hy - ay, hx - ax), a0 = Math.atan2(ay - by, ax - bx);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const phase = (this.t % 6) / 6;
    const events: RenderFrame['events'] = [];
    let alive = true, deathT = 0;
    if (this.opts.eat > 0 && this.t >= this.nextEat) {
      this.nextEat += this.opts.eat;
      events.push({ type: 'eat', x: hx, y: hy, kind: 'normal', combo: 1, points: 10, length: this.length });
    }
    if (this.opts.die > 0 && this.t >= this.opts.die) {
      if (!this.deathSent) {
        this.deathSent = true;
        this.deadAt = this.t;
        this.frozen = this.pts.slice();
        this.frozenCount = count;
        events.push({ type: 'death', x: hx, y: hy, cause: 'self' });
      }
      alive = false;
      deathT = this.t - this.deadAt;
      this.pts.set(this.frozen!);
      count = this.frozenCount;
    }
    return {
      time: (now - this.start) / 1000,
      dt,
      boardW: this.boardW,
      boardH: this.boardH,
      snake: {
        points: this.pts, count, spacing, radius: 0.34,
        dirX: (hx - ax) / dl, dirY: (hy - ay) / dl,
        speed: dl / 0.01, turnRate: da / 0.01,
        bulges: [{ s: phase * this.length, amount: 1 - phase }],
        alive, deathT, interest: 0.5, ghost: false, skin: this.skin, length: this.length,
      },
      foods: [
        { id: 1, kind: 'normal', x: this.boardW * 0.8, y: this.boardH * 0.3, age: this.t, ttl: Infinity },
        { id: 2, kind: 'golden', x: this.boardW * 0.2, y: this.boardH * 0.75, age: this.t, ttl: 5 },
      ],
      obstacles: [
        { id: 1, x: this.boardW * 0.25, y: this.boardH * 0.3, r: 0.9, cells: [], seed: 3, vx: 0, vy: 0 },
        { id: 2, x: this.boardW * 0.7, y: this.boardH * 0.72, r: 1.2, cells: [], seed: 7, vx: 0, vy: 0 },
      ],
      powerups: [{ id: 1, kind: 'magnet', x: this.boardW * 0.5, y: this.boardH * 0.85, age: this.t, ttl: 8 }],
      effects: { timeScale: this.opts.slow ? 0.5 : 1, ghost: 0, magnet: 0, double: 0, slow: this.opts.slow ? 3 : 0 },
      events,
      intensity: 0.3,
      shake: this.opts.shake,
      paused: false,
    };
  }
}
