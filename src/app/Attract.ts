// Simple BFS "demo player" for the title-screen background.
import { Sim, type Dir } from '../game/Sim';
import type { BiomeId, GameConfig, SkinId } from '../types';

const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export class Attract {
  sim: Sim;
  private decidedLeg = -1;
  private legCounter = 0;
  private lastCell = -1;
  private wander = 0;
  age = 0;

  constructor(biome: BiomeId, skin: SkinId, w: number, h: number) {
    const cfg: GameConfig = {
      mode: 'zen', movement: 'grid', biome, skin, seed: (Math.random() * 1e9) | 0, boardW: w, boardH: h,
    };
    this.sim = new Sim(cfg);
    this.sim.lengthCells = 9;
    (this.sim as any).grow = 5;
  }

  update(dt: number) {
    this.age += dt;
    const s = this.sim.debugState();
    const cell = s.cellY * this.sim.W + s.cellX;
    if (cell !== this.lastCell) {
      this.lastCell = cell;
      this.legCounter++;
    }
    if (s.prog > 0.55 && this.decidedLeg !== this.legCounter) {
      this.decidedLeg = this.legCounter;
      const d = this.choose(s);
      if (d !== null && d !== s.dir) this.sim.inputDir(d);
    }
    // keep the demo snake a pleasant length
    this.sim.capLength(26);
    this.sim.update(dt);
  }

  private choose(s: ReturnType<Sim['debugState']>): Dir | null {
    const W = this.sim.W, H = this.sim.H;
    const nx = (s.cellX + DIRS[s.dir][0] + W) % W, ny = (s.cellY + DIRS[s.dir][1] + H) % H;
    const blocked = (x: number, y: number) => s.obstacleCells[y * W + x] > 0 || s.occ[y * W + x] > 0;
    // occasionally wander for organic patterns
    if (this.wander > 0) {
      this.wander--;
      return null;
    }
    if (Math.random() < 0.04) this.wander = 3 + ((Math.random() * 5) | 0);
    // BFS from the next cell to the nearest food
    const targets = new Set(this.sim.foods.map((f) => f.cy * W + f.cx));
    const start = ny * W + nx;
    const prev = new Int32Array(W * H).fill(-1);
    const firstDir = new Int8Array(W * H).fill(-1);
    const q = [start];
    prev[start] = start;
    let found = -1;
    while (q.length) {
      const c = q.shift()!;
      if (targets.has(c)) { found = c; break; }
      const cx = c % W, cy = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        if (c === start && (d + 2) % 4 === s.dir) continue;
        const x = (cx + DIRS[d][0] + W) % W, y = (cy + DIRS[d][1] + H) % H;
        const i = y * W + x;
        if (prev[i] !== -1 || blocked(x, y)) continue;
        prev[i] = c;
        firstDir[i] = c === start ? d : firstDir[c];
        q.push(i);
      }
    }
    if (found >= 0 && firstDir[found] >= 0) return firstDir[found] as Dir;
    // otherwise any free direction, prefer straight
    for (const d of [s.dir, (s.dir + 1) % 4, (s.dir + 3) % 4] as Dir[]) {
      const x = (nx + DIRS[d][0] + W) % W, y = (ny + DIRS[d][1] + H) % H;
      if (!blocked(x, y)) return d;
    }
    return null;
  }
}
