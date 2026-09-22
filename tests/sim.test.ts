import { describe, expect, it } from 'vitest';
import { Sim } from '../src/game/Sim';
import type { GameConfig, GameModeId, MovementMode } from '../src/types';
import { levelFromXp, xpForLevel } from '../src/game/progression';
import { Rng } from '../src/core/rng';

const cfg = (mode: GameModeId = 'classic', movement: MovementMode = 'grid', seed = 42): GameConfig => ({
  mode, movement, biome: 'karesansui', skin: 'obsidian', seed, boardW: 24, boardH: 18,
});

function run(sim: Sim, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    sim.update(1 / 60);
    if (sim.over) break;
  }
}

describe('Sim grid', () => {
  it('moves right from the start and dies at the right wall', () => {
    const sim = new Sim(cfg());
    // clear obstacles for a deterministic run
    (sim as any).obstacles = [];
    (sim as any).obstacleCells.fill(0);
    const x0 = sim.hx;
    run(sim, 0.5);
    expect(sim.hx).toBeGreaterThan(x0 + 2);
    run(sim, 10);
    expect(sim.alive).toBe(false);
    expect(sim.stats.cause).toBe('wall');
  });

  it('turns only at cell centres and never reverses', () => {
    const sim = new Sim(cfg());
    (sim as any).obstacles = [];
    (sim as any).obstacleCells.fill(0);
    run(sim, 0.3);
    sim.inputDir(3); // reverse (left) must be ignored
    sim.inputDir(0); // up
    run(sim, 0.4);
    expect(sim.debugState().dir).toBe(0);
    expect(Math.abs((sim.hx - 0.5) - Math.round(sim.hx - 0.5))).toBeLessThan(1e-6);
    expect(sim.alive).toBe(true);
  });

  it('eats food, grows and scores', () => {
    const sim = new Sim(cfg());
    (sim as any).obstacles = [];
    (sim as any).obstacleCells.fill(0);
    const s = sim.debugState();
    const f = sim.foods[0];
    f.cx = s.cellX + 3; f.cy = s.cellY; f.x = f.tx = f.cx + 0.5; f.y = f.ty = f.cy + 0.5;
    run(sim, 1);
    expect(sim.stats.foodEaten).toBe(1);
    expect(sim.lengthCells).toBe(5);
    expect(sim.score).toBeGreaterThanOrEqual(10);
    expect(sim.foods.length).toBe(1);
  });

  it('self collision ends the run', () => {
    const sim = new Sim(cfg());
    (sim as any).obstacles = [];
    (sim as any).obstacleCells.fill(0);
    sim.lengthCells = 12; (sim as any).grow = 8;
    run(sim, 1.2);
    // tight square: up, left, down
    sim.inputDir(0); run(sim, 0.2);
    sim.inputDir(3); run(sim, 0.2);
    sim.inputDir(2); run(sim, 2);
    expect(sim.alive).toBe(false);
    expect(sim.stats.cause).toBe('self');
  });

  it('zen mode wraps and never dies', () => {
    const sim = new Sim(cfg('zen'));
    run(sim, 30);
    expect(sim.alive).toBe(true);
    expect(sim.over).toBe(false);
  });

  it('is deterministic for a seed', () => {
    const a = new Sim(cfg('arcade', 'grid', 7));
    const b = new Sim(cfg('arcade', 'grid', 7));
    expect(a.obstacles.map((o) => [o.x, o.y])).toEqual(b.obstacles.map((o) => [o.x, o.y]));
    expect(a.foods.map((o) => [o.x, o.y])).toEqual(b.foods.map((o) => [o.x, o.y]));
  });

  it('time attack penalises hits instead of dying and ends on time up', () => {
    const sim = new Sim(cfg('timeattack'));
    (sim as any).obstacles = [];
    (sim as any).obstacleCells.fill(0);
    run(sim, 5);
    expect(sim.alive).toBe(true);
    expect(sim.timeLeft!).toBeLessThan(110);
    run(sim, 200);
    expect(sim.over).toBe(true);
    expect(sim.stats.cause).toBe('timeup');
  });

  it('render frame has evenly spaced points from the head', () => {
    const sim = new Sim(cfg());
    run(sim, 0.5);
    const f = sim.renderFrame(0, 1 / 60, false, []);
    expect(f.snake.count).toBeGreaterThan(20);
    expect(f.snake.points[0]).toBeCloseTo(sim.hx);
    expect(f.snake.points[1]).toBeCloseTo(sim.hy);
  });
});

describe('Sim glide', () => {
  it('steers continuously', () => {
    const sim = new Sim(cfg('classic', 'glide'));
    (sim as any).obstacles = [];
    sim.inputSteer(-1); // left
    run(sim, 0.4);
    expect(sim.hy).toBeGreaterThan(9.5);
    expect(sim.alive).toBe(true);
  });

  it('circling tightly with a long body collides with itself', () => {
    const sim = new Sim(cfg('classic', 'glide'));
    (sim as any).obstacles = [];
    sim.lengthCells = 20;
    (sim as any).visLen = 20;
    run(sim, 0.5);
    sim.inputSteer(1);
    run(sim, 6);
    expect(sim.alive).toBe(false);
    expect(sim.stats.cause).toBe('self');
  });

  it('target angle turns toward the target', () => {
    const sim = new Sim(cfg('zen', 'glide'));
    sim.inputTargetAngle(Math.PI / 2);
    run(sim, 1);
    expect(sim.hy).toBeGreaterThan(10);
  });
});

describe('progression', () => {
  it('levels are monotonic and invertible', () => {
    for (let l = 1; l < 30; l++) {
      expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
      expect(levelFromXp(xpForLevel(l))).toBe(l);
    }
  });
  it('rng is deterministic', () => {
    const a = new Rng(5), b = new Rng(5);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
});

describe('review regressions', () => {
  it('grid magnet food gets eaten instead of hiding under the head', () => {
    const sim = new Sim(cfg('arcade'));
    (sim as any).obstacles = [];
    (sim as any).obstacleCells.fill(0);
    sim.foods.length = 0;
    const s = sim.debugState();
    (sim as any).foods.push({ id: 99, kind: 'normal', cx: s.cellX + 4, cy: s.cellY + 1, x: s.cellX + 4.5, y: s.cellY + 1.5, tx: s.cellX + 4.5, ty: s.cellY + 1.5, age: 0, ttl: Infinity });
    sim.effects.magnet = 8;
    run(sim, 1.5);
    expect(sim.stats.foodEaten).toBeGreaterThanOrEqual(1);
  });

  it('capLength keeps occupancy consistent', () => {
    const sim = new Sim(cfg('zen'));
    sim.lengthCells = 40; (sim as any).grow = 36;
    run(sim, 3);
    sim.capLength(10);
    const st = sim.debugState();
    const occSum = Array.from(st.occ as Uint16Array).reduce((a, b) => a + b, 0);
    expect(occSum).toBe(st.cells.length);
    expect(st.cells.length + (sim as any).grow).toBe(10);
  });

  it('long zen run stays fast and bounded', () => {
    const sim = new Sim(cfg('zen'));
    sim.lengthCells = 200; (sim as any).grow = 196;
    const t0 = performance.now();
    run(sim, 120);
    expect(performance.now() - t0).toBeLessThan(4000);
    expect((sim as any).px.length).toBeLessThan(8000);
  });
});
