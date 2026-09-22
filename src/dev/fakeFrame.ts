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

  constructor(w = 28, h = 18) {
    this.boardW = w;
    this.boardH = h;
  }

  private head(t: number) {
    const W = this.boardW, H = this.boardH;
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
        alive: true, deathT: 0, interest: 0.5, ghost: false, skin: this.skin, length: this.length,
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
      effects: { timeScale: 1, ghost: 0, magnet: 0, double: 0, slow: 0 },
      events: [],
      intensity: 0.3,
      shake: 0,
      paused: false,
    };
  }
}
