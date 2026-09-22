// Deterministic game simulation. No DOM, no three.js.
import { Rng } from '../core/rng';
import type {
  ActiveEffects, DeathCause, FoodKind, FoodState, GameConfig, GameEvent, HudState, ObstacleState,
  PowerupKind, PowerupPickupState, RenderFrame, RunStats, SnakeRenderState,
} from '../types';
import { MODES, type ModeRules } from './modes';

export const STEP = 1 / 120;
const SPACING = 0.125;
const RADIUS = 0.34;
const MAX_POINTS = 4000;
const START_LEN = 4;
const NECK = 1.6; // world units of body right behind the head ignored for self collision (glide)
const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // up right down left
export type Dir = 0 | 1 | 2 | 3;

const POWERUP_DUR: Record<Exclude<PowerupKind, 'shed'>, number> = { slow: 6, ghost: 6, magnet: 8, double: 10 };

interface Food extends FoodState {
  cx: number; // grid cell
  cy: number;
  tx: number; // target position (magnet hops in grid)
  ty: number;
}

export class Sim {
  readonly cfg: GameConfig;
  readonly rules: ModeRules;
  readonly W: number;
  readonly H: number;
  private rng: Rng;

  // path history (head positions), oldest first
  private px: number[] = [];
  private py: number[] = [];

  // head state
  hx = 0;
  hy = 0;
  private heading = 0; // glide radians
  private dir: Dir = 1;
  private cellX = 0; // grid: cell centre the current leg started from
  private cellY = 0;
  private prog = 0; // 0..1 along current leg
  private entered = false; // passed 0.5 on this leg
  private peeked = false;
  private queue: Dir[] = [];
  private turnedThisLeg = false;
  private legHistLen = 0;

  // body occupancy for grid mode
  private cells: number[] = []; // head first, cell index y*W+x
  private occ: Uint16Array;
  private grow = 0;

  // glide input
  private steer = 0;
  private targetAngle: number | null = null;

  lengthCells = START_LEN; // logical length in cells
  private visLen = START_LEN - 0.4;
  private turnRate = 0;
  private lastHeadingForRate = 0;

  foods: Food[] = [];
  obstacles: ObstacleState[] = [];
  private obstacleCells: Uint8Array;
  powerups: PowerupPickupState[] = [];
  effects: ActiveEffects = { timeScale: 1, ghost: 0, magnet: 0, double: 0, slow: 0 };
  private bulges: { s: number; amount: number }[] = [];

  score = 0;
  best = 0;
  combo = 0;
  comboT = 0; // seconds remaining in window
  private comboWindow = 4;
  timeLeft: number | null;
  time = 0;
  alive = true;
  deathT = 0;
  over = false;
  private overDelay = 1.6;
  stats: RunStats;
  private events: GameEvent[] = [];
  private idCounter = 1;
  private powerupTimer = 10;
  private nearCooldown = new Map<string, number>();
  private ghostPassCooldown = 0;
  private hazardsSpawned = 0;
  private lastWarn = 99;
  private shake = 0;
  private acc = 0;
  private nextMilestone = 10;
  private foodSinceGolden = 0;
  private respawnGrace = 0;

  constructor(cfg: GameConfig, best = 0) {
    this.cfg = cfg;
    this.rules = MODES[cfg.mode];
    this.W = cfg.boardW;
    this.H = cfg.boardH;
    this.rng = new Rng(cfg.seed);
    this.best = best;
    this.occ = new Uint16Array(this.W * this.H);
    this.obstacleCells = new Uint8Array(this.W * this.H);
    this.timeLeft = this.rules.timeLimit;
    this.stats = {
      score: 0, length: START_LEN, maxCombo: 0, nearMisses: 0, foodEaten: 0, goldenEaten: 0,
      powerups: 0, ghostPasses: 0, time: 0, pattern: 0, cause: 'quit',
    };
    this.placeObstacles();
    this.resetSnake();
    for (let i = 0; i < this.rules.foodCount; i++) this.spawnFood('normal');
    this.events.push({ type: 'start' });
  }

  // ------------------------------------------------------------------ input

  /** Grid: absolute direction. In glide mode it sets a target heading. */
  inputDir(d: Dir) {
    if (!this.alive) return;
    if (this.cfg.movement === 'glide') {
      this.targetAngle = Math.atan2(DIRS[d][1], DIRS[d][0]);
      return;
    }
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if (d === last || (d + 2) % 4 === last) return;
    // corner forgiveness: a turn pressed just after passing a centre is applied retroactively
    if (this.queue.length === 0 && !this.turnedThisLeg && this.prog < 0.2 && !this.peeked) {
      if (this.tryTurnNow(d)) return;
    }
    if (this.queue.length < 2) this.queue.push(d);
  }

  /** Grid: relative turn (-1 = left / counter-clockwise, +1 = right). */
  inputTurn(side: -1 | 1) {
    if (this.cfg.movement === 'glide') return;
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    this.inputDir((((last + side) % 4) + 4) % 4 as Dir);
  }

  /** Glide: continuous steer -1..1 (+1 = right/clockwise). Clears target heading when non-zero. */
  inputSteer(v: number) {
    this.steer = Math.max(-1, Math.min(1, v));
    if (v !== 0) this.targetAngle = null;
  }

  /** Glide: absolute target heading in radians (null = none). */
  inputTargetAngle(a: number | null) {
    this.targetAngle = a;
  }

  // ------------------------------------------------------------------ setup

  private cellFree(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    const i = y * this.W + x;
    return this.occ[i] === 0 && this.obstacleCells[i] === 0;
  }

  private placeObstacles() {
    const area = this.W * this.H;
    const n = Math.round((area / 100) * this.rules.obstacleDensity);
    const sx = Math.floor(this.W * 0.25), sy = Math.floor(this.H / 2);
    let tries = 0;
    while (this.obstacles.length < n && tries++ < 400) {
      const big = this.rng.chance(0.35);
      const size = big ? 2 : 1;
      const x = this.rng.int(2, this.W - 2 - size);
      const y = this.rng.int(2, this.H - 2 - size);
      // keep the start lane clear
      if (Math.abs(y - sy) <= 2 && x <= sx + 6) continue;
      // spacing from other obstacles (no enclosed pockets)
      let ok = true;
      for (const o of this.obstacles) {
        for (const [cx, cy] of o.cells) {
          if (Math.abs(cx - x) < size + 3 && Math.abs(cy - y) < size + 3) ok = false;
        }
      }
      if (!ok) continue;
      const cells: [number, number][] = [];
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) cells.push([x + dx, y + dy]);
      for (const [cx, cy] of cells) this.obstacleCells[cy * this.W + cx] = 1;
      this.obstacles.push({
        id: this.idCounter++, x: x + size / 2, y: y + size / 2, r: big ? 1.05 : 0.5,
        cells, seed: this.rng.int(0, 1 << 30), vx: 0, vy: 0,
      });
    }
  }

  private resetSnake() {
    const sx = Math.floor(this.W * 0.25), sy = Math.floor(this.H / 2);
    for (const c of this.cells) this.occ[c] = Math.max(0, this.occ[c] - 1);
    this.cells = [];
    this.lengthCells = START_LEN;
    this.visLen = START_LEN - 0.4;
    this.grow = 0;
    this.queue = [];
    this.dir = 1;
    this.heading = 0;
    this.targetAngle = null;
    this.cellX = sx;
    this.cellY = sy;
    this.prog = 0;
    this.entered = false;
    this.peeked = false;
    this.turnedThisLeg = false;
    this.px = [];
    this.py = [];
    for (let i = START_LEN; i >= 0; i--) {
      this.px.push(sx + 0.5 - i);
      this.py.push(sy + 0.5);
    }
    for (let i = 0; i < START_LEN; i++) {
      const c = sy * this.W + (sx - i);
      this.cells.push(c);
      this.occ[c]++;
    }
    this.hx = sx + 0.5;
    this.hy = sy + 0.5;
    this.legHistLen = this.px.length;
    this.lastHeadingForRate = 0;
  }

  private randomFreeCell(minHeadDist = 3): [number, number] | null {
    for (let t = 0; t < 300; t++) {
      const x = this.rng.int(0, this.W), y = this.rng.int(0, this.H);
      if (!this.cellFree(x, y)) continue;
      if (Math.hypot(x + 0.5 - this.hx, y + 0.5 - this.hy) < minHeadDist) continue;
      if (this.foods.some((f) => f.cx === x && f.cy === y)) continue;
      if (this.powerups.some((p) => Math.floor(p.x) === x && Math.floor(p.y) === y)) continue;
      if (this.cfg.movement === 'glide' && this.bodyDistance(x + 0.5, y + 0.5, 0) < 1.0) continue;
      return [x, y];
    }
    return null;
  }

  private spawnFood(kind: FoodKind) {
    const c = this.randomFreeCell(kind === 'golden' ? 5 : 3);
    if (!c) return;
    const f: Food = {
      id: this.idCounter++, kind, x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1], tx: c[0] + 0.5, ty: c[1] + 0.5,
      age: 0, ttl: kind === 'golden' ? 6.5 : Infinity,
    };
    this.foods.push(f);
    this.events.push({ type: 'spawnFood', x: f.x, y: f.y, kind });
  }

  private spawnPowerup() {
    const c = this.randomFreeCell(4);
    if (!c) return;
    const kinds: PowerupKind[] = ['slow', 'ghost', 'magnet', 'double', 'shed'];
    const kind = this.lengthCells < 12 ? this.rng.pick(kinds.slice(0, 4)) : this.rng.pick(kinds);
    const p: PowerupPickupState = { id: this.idCounter++, kind, x: c[0] + 0.5, y: c[1] + 0.5, age: 0, ttl: 9 };
    this.powerups.push(p);
    this.events.push({ type: 'powerupSpawn', x: p.x, y: p.y, kind });
  }

  private spawnHazard() {
    // rolling stone travelling along a row or column, bouncing off walls
    for (let t = 0; t < 50; t++) {
      const horizontal = this.rng.chance(0.5);
      const x = horizontal ? (this.rng.chance(0.5) ? 0.6 : this.W - 0.6) : this.rng.int(2, this.W - 2) + 0.5;
      const y = horizontal ? this.rng.int(2, this.H - 2) + 0.5 : (this.rng.chance(0.5) ? 0.6 : this.H - 0.6);
      if (Math.hypot(x - this.hx, y - this.hy) < 6) continue;
      const sp = 2.2;
      const vx = horizontal ? (x < 1 ? sp : -sp) : 0;
      const vy = horizontal ? 0 : (y < 1 ? sp : -sp);
      this.obstacles.push({ id: this.idCounter++, x, y, r: 0.42, cells: [], seed: this.rng.int(0, 1 << 30), vx, vy });
      this.hazardsSpawned++;
      return;
    }
  }

  // ------------------------------------------------------------------ stepping

  /** Advance by real seconds. */
  update(realDt: number) {
    this.acc += Math.min(realDt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.fixedStep(STEP);
    }
  }

  private speed() {
    const m = this.cfg.movement;
    const r = this.rules;
    return Math.min(r.speedMax[m], r.speedBase[m] + r.speedPerLen[m] * (this.lengthCells - START_LEN));
  }

  private fixedStep(dt: number) {
    if (this.over) return;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);

    if (!this.alive) {
      this.deathT += dt;
      if (this.deathT >= this.overDelay) this.over = true;
      return;
    }

    // timers (real time)
    this.updateEffects(dt);
    const wdt = dt * this.effects.timeScale; // world dt
    this.respawnGrace = Math.max(0, this.respawnGrace - dt);

    if (this.timeLeft !== null) {
      this.timeLeft -= dt;
      const s = Math.ceil(this.timeLeft);
      if (s <= 10 && s < this.lastWarn && s > 0) {
        this.lastWarn = s;
        this.events.push({ type: 'timeWarning', secondsLeft: s });
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.events.push({ type: 'timeUp' });
        this.stats.cause = 'timeup';
        this.alive = false;
        this.overDelay = 0.8;
        return;
      }
    }

    if (this.rules.combo && this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        if (this.combo >= 2) this.events.push({ type: 'comboBreak', combo: this.combo });
        this.combo = 0;
        this.comboT = 0;
      }
    }

    const v = this.speed() * wdt;
    if (this.cfg.movement === 'grid') this.stepGrid(v);
    else this.stepGlide(v, wdt);
    if (!this.alive) return;

    // visual length follows logical length
    const target = this.cfg.movement === 'grid' ? this.lengthCells - 0.35 : this.lengthCells;
    this.visLen += Math.sign(target - this.visLen) * Math.min(Math.abs(target - this.visLen), dt * 4);

    this.updateHazards(wdt);
    this.updateFood(dt, wdt);
    this.updatePowerups(dt);
    this.checkNearMiss(dt);

    for (const b of this.bulges) {
      b.s += dt * 2.2;
      b.amount *= 1 - dt * 0.15;
    }
    for (let i = this.bulges.length - 1; i >= 0; i--) if (this.bulges[i].s >= this.visLen) this.bulges.splice(i, 1);

    // trim path history
    this.trimPath();
  }

  private pushPath(x: number, y: number) {
    // Keep path points spaced >= ~0.05 while the newest point always tracks the head exactly.
    const n = this.px.length;
    if (n >= 2 && n - 1 > this.legHistLen) {
      const dx = x - this.px[n - 2], dy = y - this.py[n - 2];
      if (dx * dx + dy * dy < 0.0025) {
        this.px[n - 1] = x;
        this.py[n - 1] = y;
        return;
      }
    }
    this.px.push(x);
    this.py.push(y);
  }

  private trimCounter = 0;
  private trimPath() {
    if (++this.trimCounter < 30 || this.px.length < 600) return;
    this.trimCounter = 0;
    // keep enough for the body
    let d = 0;
    for (let i = this.px.length - 1; i > 0; i--) {
      const seg = Math.hypot(this.px[i] - this.px[i - 1], this.py[i] - this.py[i - 1]);
      if (seg < 1.5) d += seg;
      if (d > this.visLen + 4) {
        const cut = i - 1;
        if (cut > 200) {
          this.px.splice(0, cut);
          this.py.splice(0, cut);
          this.legHistLen = Math.max(0, this.legHistLen - cut);
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------- grid

  private tryTurnNow(d: Dir): boolean {
    // Re-decide the direction of the current leg (only valid shortly after the centre).
    const nx = this.cellX + DIRS[d][0], ny = this.cellY + DIRS[d][1];
    if (!this.rules.wrap && (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H)) return false;
    this.dir = d;
    this.turnedThisLeg = true;
    this.px.length = this.legHistLen;
    this.py.length = this.legHistLen;
    this.hx = this.cellX + 0.5 + DIRS[d][0] * this.prog;
    this.hy = this.cellY + 0.5 + DIRS[d][1] * this.prog;
    this.pushPath(this.hx, this.hy);
    this.events.push({ type: 'turn', x: this.cellX + 0.5, y: this.cellY + 0.5 });
    return true;
  }

  private stepGrid(dist: number) {
    let remaining = dist;
    while (remaining > 0 && this.alive) {
      const toMark = !this.peeked ? 0.25 - this.prog : !this.entered ? 0.5 - this.prog : 1 - this.prog;
      const adv = Math.min(remaining, Math.max(0, toMark));
      this.prog += adv;
      remaining -= adv;
      const [dx, dy] = DIRS[this.dir];
      this.hx = this.cellX + 0.5 + dx * this.prog;
      this.hy = this.cellY + 0.5 + dy * this.prog;
      this.pushPath(this.hx, this.hy);

      if (!this.peeked && this.prog >= 0.25 - 1e-9) {
        this.peeked = true;
        this.peekCollision();
      } else if (this.peeked && !this.entered && this.prog >= 0.5 - 1e-9) {
        this.entered = true;
        this.enterCell();
      } else if (this.prog >= 1 - 1e-9) {
        this.arriveCentre();
      }
      if (adv === 0 && toMark > 0) break;
    }
  }

  private nextCell(): [number, number, boolean] {
    let nx = this.cellX + DIRS[this.dir][0], ny = this.cellY + DIRS[this.dir][1];
    let out = nx < 0 || ny < 0 || nx >= this.W || ny >= this.H;
    if (out && this.rules.wrap) {
      nx = (nx + this.W) % this.W;
      ny = (ny + this.H) % this.H;
      out = false;
    }
    return [nx, ny, out];
  }

  private peekCollision() {
    const [nx, ny, out] = this.nextCell();
    if (out) return this.collide('wall');
    const i = ny * this.W + nx;
    if (this.obstacleCells[i]) {
      if (!this.rules.death) return this.zenDeflect();
      return this.collide('obstacle');
    }
    // body: the tail cell will vacate when we enter (unless growing)
    const tail = this.cells[this.cells.length - 1];
    const selfHit = this.occ[i] > 0 && !(i === tail && this.grow === 0 && this.occ[i] === 1);
    if (selfHit) {
      if (this.effects.ghost > 0 || this.rules.selfPass) {
        if (this.effects.ghost > 0 && this.ghostPassCooldown <= 0) {
          this.stats.ghostPasses++;
          this.ghostPassCooldown = 0.5;
        }
        return;
      }
      if (this.respawnGrace > 0) return;
      return this.collide('self');
    }
  }

  private zenDeflect() {
    // Zen: flow around stones – pick a free perpendicular direction.
    const options: Dir[] = [((this.dir + 1) % 4) as Dir, ((this.dir + 3) % 4) as Dir];
    if (this.rng.chance(0.5)) options.reverse();
    for (const d of options) {
      let nx = this.cellX + DIRS[d][0], ny = this.cellY + DIRS[d][1];
      nx = (nx + this.W) % this.W;
      ny = (ny + this.H) % this.H;
      if (!this.obstacleCells[ny * this.W + nx]) {
        this.prog = 0;
        this.peeked = false;
        this.entered = false;
        this.px.length = this.legHistLen;
        this.py.length = this.legHistLen;
        this.hx = this.cellX + 0.5;
        this.hy = this.cellY + 0.5;
        this.dir = d;
        this.queue = [];
        return;
      }
    }
  }

  private enterCell() {
    const [nx, ny] = this.nextCell();
    const i = ny * this.W + nx;
    this.cells.unshift(i);
    this.occ[i]++;
    if (this.grow > 0) this.grow--;
    else {
      const t = this.cells.pop()!;
      this.occ[t]--;
    }
    // food
    for (const f of this.foods) {
      if (f.cx === nx && f.cy === ny) {
        this.eat(f);
        break;
      }
    }
    for (const p of this.powerups) {
      if (Math.floor(p.x) === nx && Math.floor(p.y) === ny) {
        this.collectPowerup(p);
        break;
      }
    }
  }

  private arriveCentre() {
    const [nx, ny] = this.nextCell();
    const wrapped = Math.abs(nx - this.cellX) > 1 || Math.abs(ny - this.cellY) > 1;
    this.cellX = nx;
    this.cellY = ny;
    this.prog = 0;
    this.peeked = false;
    this.entered = false;
    this.turnedThisLeg = false;
    this.hx = nx + 0.5;
    this.hy = ny + 0.5;
    if (wrapped) this.events.push({ type: 'wrap', x: this.hx, y: this.hy });
    this.pushPath(this.hx, this.hy);
    // apply queued turn
    while (this.queue.length) {
      const d = this.queue.shift()!;
      if (d !== this.dir && (d + 2) % 4 !== this.dir) {
        this.dir = d;
        this.turnedThisLeg = true;
        this.events.push({ type: 'turn', x: this.hx, y: this.hy });
        break;
      }
    }
    this.legHistLen = this.px.length;
    // Leg progress after the centre starts at 0; the 0.5 "enter" of this leg
    // concerns the *next* cell, so mark entered=false and peeked=false above.
  }

  // ---------------------------------------------------------------- glide

  private stepGlide(dist: number, wdt: number) {
    const maxTurn = 3.4 + 0.12 * this.speed(); // rad/s
    let turn = 0;
    if (this.targetAngle !== null) {
      let da = this.targetAngle - this.heading;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      turn = Math.max(-1, Math.min(1, da * 4));
      if (Math.abs(da) < 0.01) turn = 0;
    } else {
      turn = -this.steer;
    }
    const prevHeading = this.heading;
    // sub-step for accuracy at high speed
    const n = Math.max(1, Math.ceil(dist / 0.08));
    const sd = dist / n;
    for (let k = 0; k < n && this.alive; k++) {
      this.heading += turn * maxTurn * (wdt / n);
      this.hx += Math.cos(this.heading) * sd;
      this.hy += Math.sin(this.heading) * sd;
      // walls
      if (this.hx < RADIUS || this.hy < RADIUS || this.hx > this.W - RADIUS || this.hy > this.H - RADIUS) {
        if (this.rules.wrap) {
          const ox = this.hx, oy = this.hy;
          this.hx = (this.hx + this.W) % this.W;
          this.hy = (this.hy + this.H) % this.H;
          if (ox !== this.hx || oy !== this.hy) this.events.push({ type: 'wrap', x: this.hx, y: this.hy });
        } else {
          this.hx = Math.max(RADIUS, Math.min(this.W - RADIUS, this.hx));
          this.hy = Math.max(RADIUS, Math.min(this.H - RADIUS, this.hy));
          this.pushPath(this.hx, this.hy);
          if (this.respawnGrace <= 0) return this.collide('wall');
          // during respawn grace: slide along the wall
          this.heading = Math.atan2(this.H / 2 - this.hy, this.W / 2 - this.hx);
          continue;
        }
      }
      this.pushPath(this.hx, this.hy);
      // obstacles
      for (const o of this.obstacles) {
        const d = Math.hypot(o.x - this.hx, o.y - this.hy);
        const rr = o.r * 0.92 + RADIUS * 0.8;
        if (d < rr) {
          if (!this.rules.death) {
            // slide around the stone
            const nx = (this.hx - o.x) / d, ny = (this.hy - o.y) / d;
            this.hx = o.x + nx * rr;
            this.hy = o.y + ny * rr;
            const tang = Math.atan2(nx, -ny);
            const alt = tang + Math.PI;
            const pick = Math.cos(tang - this.heading) > Math.cos(alt - this.heading) ? tang : alt;
            this.heading = pick;
            this.targetAngle = null;
          } else if (this.respawnGrace <= 0) {
            return this.collide('obstacle');
          }
        }
      }
      // self
      if (!this.rules.selfPass) {
        const d = this.bodyDistance(this.hx, this.hy, NECK + 0.4);
        if (d < RADIUS * 1.55) {
          if (this.effects.ghost > 0) {
            if (this.ghostPassCooldown <= 0) {
              this.stats.ghostPasses++;
              this.ghostPassCooldown = 0.5;
            }
          } else if (this.respawnGrace <= 0) {
            return this.collide('self');
          }
        }
      }
    }
    let dh = this.heading - prevHeading;
    this.turnRate = wdt > 0 ? dh / wdt : 0;
    // food
    for (const f of this.foods) {
      if (Math.hypot(f.x - this.hx, f.y - this.hy) < 0.72) {
        this.eat(f);
        break;
      }
    }
    for (const p of this.powerups) {
      if (Math.hypot(p.x - this.hx, p.y - this.hy) < 0.75) {
        this.collectPowerup(p);
        break;
      }
    }
    this.grow = 0;
  }

  /** Min distance from (x,y) to the body, skipping the first `skip` world units behind the head. */
  private bodyDistance(x: number, y: number, skip: number): number {
    let best = Infinity;
    let d = 0;
    const len = this.visLen;
    for (let i = this.px.length - 1; i > 0; i--) {
      const ax = this.px[i], ay = this.py[i], bx = this.px[i - 1], by = this.py[i - 1];
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg > 1.5) continue; // wrap jump
      d += seg;
      if (d > len) break;
      if (d < skip) continue;
      const dd = Math.hypot(bx - x, by - y);
      if (dd < best) best = dd;
    }
    return best;
  }

  // ---------------------------------------------------------------- shared

  private collide(cause: DeathCause) {
    if (this.rules.timeLimit !== null) {
      // time attack: penalty + respawn
      this.timeLeft = Math.max(0, (this.timeLeft ?? 0) - 10);
      this.events.push({ type: 'hit', x: this.hx, y: this.hy, cause });
      this.shake = 0.8;
      this.combo = 0;
      this.comboT = 0;
      const keep = this.lengthCells;
      this.resetSnake();
      this.grow = Math.max(0, keep - START_LEN);
      this.lengthCells = keep;
      this.respawnGrace = 1.2;
      return;
    }
    if (!this.rules.death) return;
    this.alive = false;
    this.deathT = 0;
    this.stats.cause = cause;
    this.shake = 1;
    this.events.push({ type: 'death', x: this.hx, y: this.hy, cause });
  }

  private eat(f: Food) {
    this.foods.splice(this.foods.indexOf(f), 1);
    const golden = f.kind === 'golden';
    if (this.rules.combo) {
      if (this.combo > 0 && this.comboT > 0) this.combo = Math.min(8, this.combo + 1);
      else this.combo = 1;
      this.comboWindow = Math.max(2.2, 4 - 0.25 * (this.combo - 1));
      this.comboT = this.comboWindow;
      if (this.combo >= 2) this.events.push({ type: 'combo', combo: this.combo });
    }
    const mult = Math.max(1, this.combo) * (this.effects.double > 0 ? 2 : 1);
    const points = (golden ? 50 : 10) * mult;
    this.addScore(points);
    const gain = golden ? 2 : 1;
    this.lengthCells += gain;
    this.grow += gain;
    this.stats.foodEaten++;
    if (golden) {
      this.stats.goldenEaten++;
      if (this.timeLeft !== null) this.timeLeft += 5;
    }
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    this.stats.length = Math.max(this.stats.length, this.lengthCells);
    this.bulges.push({ s: 0.4, amount: golden ? 1 : 0.8 });
    this.events.push({ type: 'eat', x: f.x, y: f.y, kind: f.kind, combo: this.combo, points, length: this.lengthCells });
    if (this.lengthCells >= this.nextMilestone) {
      const pts = 25 * (this.nextMilestone / 10);
      this.addScore(pts);
      this.events.push({ type: 'milestone', length: this.nextMilestone, points: pts });
      this.nextMilestone += 10;
    }
    if (!golden) {
      this.spawnFood('normal');
      this.foodSinceGolden++;
      if (this.rules.golden && !this.foods.some((x) => x.kind === 'golden')) {
        if (this.foodSinceGolden >= 7 || this.rng.chance(0.12)) {
          this.spawnFood('golden');
          this.foodSinceGolden = 0;
        }
      }
    }
    // arcade hazards ramp
    if (this.rules.hazards) {
      const want = this.lengthCells >= 30 ? 2 : this.lengthCells >= 15 ? 1 : 0;
      if (this.hazardsSpawned < want) this.spawnHazard();
    }
  }

  private addScore(p: number) {
    this.score += p;
    this.stats.score = this.score;
  }

  private collectPowerup(p: PowerupPickupState) {
    this.powerups.splice(this.powerups.indexOf(p), 1);
    this.stats.powerups++;
    this.events.push({ type: 'powerup', x: p.x, y: p.y, kind: p.kind });
    if (p.kind === 'shed') {
      const cut = Math.floor((this.lengthCells - START_LEN) * 0.3);
      if (cut > 0) {
        this.lengthCells -= cut;
        if (this.cfg.movement === 'grid') {
          for (let k = 0; k < cut; k++) {
            if (this.grow > 0) { this.grow--; continue; }
            const t = this.cells.pop();
            if (t !== undefined) this.occ[t]--;
          }
        }
        this.visLen = Math.min(this.visLen, this.lengthCells);
      }
      return;
    }
    this.effects[p.kind] = POWERUP_DUR[p.kind];
  }

  private updateEffects(dt: number) {
    this.ghostPassCooldown = Math.max(0, this.ghostPassCooldown - dt);
    for (const k of ['slow', 'ghost', 'magnet', 'double'] as const) {
      if (this.effects[k] > 0) {
        this.effects[k] = Math.max(0, this.effects[k] - dt);
        if (this.effects[k] === 0) this.events.push({ type: 'powerupEnd', kind: k });
      }
    }
    const target = this.effects.slow > 0 ? 0.5 : 1;
    this.effects.timeScale += (target - this.effects.timeScale) * Math.min(1, dt * 6);
    if (Math.abs(this.effects.timeScale - target) < 0.002) this.effects.timeScale = target;
  }

  private updateHazards(wdt: number) {
    for (const o of this.obstacles) {
      if (!o.vx && !o.vy) continue;
      o.x += o.vx * wdt;
      o.y += o.vy * wdt;
      if (o.x < o.r || o.x > this.W - o.r) o.vx = -o.vx;
      if (o.y < o.r || o.y > this.H - o.r) o.vy = -o.vy;
      o.x = Math.max(o.r, Math.min(this.W - o.r, o.x));
      o.y = Math.max(o.r, Math.min(this.H - o.r, o.y));
      if (this.cfg.movement === 'grid' && this.alive && this.respawnGrace <= 0) {
        if (Math.hypot(o.x - this.hx, o.y - this.hy) < o.r + RADIUS * 0.9) this.collide('obstacle');
      }
      // hazards also hit the body → only head matters for fairness
    }
  }

  private updateFood(dt: number, wdt: number) {
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      f.age += dt;
      if (f.kind === 'golden') {
        f.ttl -= dt;
        if (f.ttl <= 0) {
          this.foods.splice(i, 1);
          this.events.push({ type: 'foodExpired', x: f.x, y: f.y });
          continue;
        }
      }
      if (this.effects.magnet > 0) {
        const dx = this.hx - f.x, dy = this.hy - f.y;
        const d = Math.hypot(dx, dy);
        if (d < 6 && d > 0.01) {
          if (this.cfg.movement === 'glide') {
            const s = Math.min(d, 3.5 * wdt);
            f.x += (dx / d) * s;
            f.y += (dy / d) * s;
          } else {
            // grid: food flies into the cell just ahead of the head (not yet entered) and is eaten there
            const ax = Math.floor(this.hx + DIRS[this.dir][0]), ay = Math.floor(this.hy + DIRS[this.dir][1]);
            if ((ax !== f.cx || ay !== f.cy) && Math.abs(ax - f.cx) + Math.abs(ay - f.cy) <= 5) {
              const taken = this.foods.some((o) => o !== f && o.cx === ax && o.cy === ay);
              if (!taken && this.cellFree(ax, ay)) {
                f.cx = ax;
                f.cy = ay;
                f.tx = ax + 0.5;
                f.ty = ay + 0.5;
              }
            }
          }
        }
      }
      if (this.cfg.movement === 'grid') {
        const k = Math.min(1, dt * 10);
        f.x += (f.tx - f.x) * k;
        f.y += (f.ty - f.y) * k;
      }
    }
    let normals = 0;
    for (const f of this.foods) if (f.kind === 'normal') normals++;
    for (; normals < this.rules.foodCount; normals++) {
      const before = this.foods.length;
      this.spawnFood('normal');
      if (this.foods.length === before) break;
    }
  }

  private updatePowerups(dt: number) {
    if (!this.rules.powerups) return;
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      p.age += dt;
      p.ttl -= dt;
      if (p.ttl <= 0) this.powerups.splice(i, 1);
    }
    this.powerupTimer -= dt;
    if (this.powerupTimer <= 0) {
      if (this.powerups.length === 0) this.spawnPowerup();
      this.powerupTimer = this.rng.range(11, 17);
    }
  }

  private checkNearMiss(dt: number) {
    if (!this.rules.death && this.rules.timeLimit === null) return;
    for (const [k, v] of this.nearCooldown) {
      if (v - dt <= 0) this.nearCooldown.delete(k);
      else this.nearCooldown.set(k, v - dt);
    }
    const hx = this.hx, hy = this.hy;
    const trigger = (key: string) => {
      if (this.nearCooldown.has(key)) return;
      this.nearCooldown.set(key, 1.2);
      const pts = 5 * Math.max(1, this.combo);
      this.addScore(pts);
      this.stats.nearMisses++;
      this.events.push({ type: 'nearMiss', x: hx, y: hy, points: pts });
    };
    const speed = this.speed();
    if (speed < 5) return;
    for (const o of this.obstacles) {
      const d = Math.hypot(o.x - hx, o.y - hy) - o.r;
      if (d < 0.62 && d > 0.2) trigger('o' + o.id);
    }
    if (this.effects.ghost > 0) return;
    // body: sample segments well behind the head
    if (this.cfg.movement === 'grid') {
      // adjacent (side) cells of the head occupied by body parts at least 5 cells back
      const [dx, dy] = DIRS[this.dir];
      const sides = [[-dy, dx], [dy, -dx]];
      const cx = Math.floor(hx), cy = Math.floor(hy);
      if (this.prog < 0.35 || this.prog > 0.65) return;
      for (const [sx, sy] of sides) {
        const nx = cx + sx, ny = cy + sy;
        if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue;
        const i = ny * this.W + nx;
        if (this.occ[i] > 0) {
          const idx = this.cells.indexOf(i);
          if (idx >= 5) trigger('b' + Math.floor(idx / 4));
        }
      }
    } else {
      const d = this.bodyDistance(hx, hy, NECK + 2.5);
      if (d < 1.0 && d > RADIUS * 1.6) trigger('body');
    }
  }

  // ------------------------------------------------------------------ outputs

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private pts = new Float32Array(MAX_POINTS * 2);
  private tmp = new Float32Array(MAX_POINTS * 2);

  /** Resample the path from the head backwards into evenly spaced points (with corner smoothing). */
  private samplePath(): number {
    const out = this.tmp;
    let count = 0;
    const n = this.px.length;
    if (n === 0) return 0;
    const len = Math.max(0.5, this.visLen);
    const need = Math.min(MAX_POINTS, Math.floor(len / SPACING) + 1);
    out[0] = this.hx;
    out[1] = this.hy;
    count = 1;
    let carry = 0; // distance along current segment already consumed
    let i = n - 1;
    let ax = this.hx, ay = this.hy;
    let bxIdx = i;
    // start from the head position (which equals last path point)
    while (count < need && bxIdx >= 0) {
      const bx = this.px[bxIdx], by = this.py[bxIdx];
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg > 1.5) {
        // wrap jump: continue on the other side without interpolating
        ax = bx;
        ay = by;
        out[count * 2] = bx;
        out[count * 2 + 1] = by;
        count++;
        carry = 0;
        bxIdx--;
        continue;
      }
      if (carry + seg >= SPACING) {
        const t = (SPACING - carry) / seg;
        ax = ax + (bx - ax) * t;
        ay = ay + (by - ay) * t;
        out[count * 2] = ax;
        out[count * 2 + 1] = ay;
        count++;
        carry = 0;
      } else {
        carry += seg;
        ax = bx;
        ay = by;
        bxIdx--;
      }
    }
    // extend straight if the path is shorter than the body (start of run)
    while (count < need && count >= 2) {
      const dx = out[(count - 1) * 2] - out[(count - 2) * 2];
      const dy = out[(count - 1) * 2 + 1] - out[(count - 2) * 2 + 1];
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) break;
      out[count * 2] = out[(count - 1) * 2] + dx;
      out[count * 2 + 1] = out[(count - 1) * 2 + 1] + dy;
      count++;
    }
    // smoothing (two passes of a 7-tap box filter), skipping across wrap jumps; head fixed
    const src = out, dst = this.pts;
    const passes = this.cfg.movement === 'grid' ? 2 : 1;
    let a = src, b = dst;
    for (let p = 0; p < passes; p++) {
      for (let k = 0; k < count; k++) {
        const w = Math.min(3, k, count - 1 - k);
        let sx = 0, sy = 0, c = 0;
        const cx = a[k * 2], cy = a[k * 2 + 1];
        for (let j = -w; j <= w; j++) {
          const x = a[(k + j) * 2], y = a[(k + j) * 2 + 1];
          if (Math.abs(x - cx) > 1.5 || Math.abs(y - cy) > 1.5) continue;
          sx += x; sy += y; c++;
        }
        b[k * 2] = sx / c;
        b[k * 2 + 1] = sy / c;
      }
      const t = a; a = b; b = t;
    }
    if (a !== this.pts) this.pts.set(a.subarray(0, count * 2));
    return count;
  }

  renderFrame(time: number, dt: number, paused: boolean, events: GameEvent[]): RenderFrame {
    const count = this.samplePath();
    let dirX: number, dirY: number;
    if (this.cfg.movement === 'grid') {
      dirX = DIRS[this.dir][0];
      dirY = DIRS[this.dir][1];
      // use the smoothed tangent near the head for visual continuity
      if (count > 3) {
        const dx = this.pts[0] - this.pts[4], dy = this.pts[1] - this.pts[5];
        const l = Math.hypot(dx, dy);
        if (l > 0.05 && l < 1.5) { dirX = dx / l; dirY = dy / l; }
      }
      const h = Math.atan2(dirY, dirX);
      let dh = h - this.lastHeadingForRate;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.turnRate = dt > 0 ? dh / dt : 0;
      this.lastHeadingForRate = h;
    } else {
      dirX = Math.cos(this.heading);
      dirY = Math.sin(this.heading);
    }
    let nearest = Infinity;
    for (const f of this.foods) nearest = Math.min(nearest, Math.hypot(f.x - this.hx, f.y - this.hy));
    const snake: SnakeRenderState = {
      points: this.pts,
      count,
      spacing: SPACING,
      radius: RADIUS,
      dirX,
      dirY,
      speed: this.alive ? this.speed() * this.effects.timeScale : 0,
      turnRate: this.turnRate,
      bulges: this.bulges,
      alive: this.alive,
      deathT: this.deathT,
      interest: Math.max(0, Math.min(1, 1 - nearest / 5)),
      ghost: this.effects.ghost > 0,
      skin: this.cfg.skin,
      length: this.visLen,
    };
    return {
      time,
      dt,
      boardW: this.W,
      boardH: this.H,
      snake,
      foods: this.foods,
      obstacles: this.obstacles,
      powerups: this.powerups,
      effects: this.effects,
      events,
      intensity: this.intensity(),
      shake: this.shake,
      paused,
    };
  }

  intensity() {
    return Math.max(0, Math.min(1, (this.combo / 8) * 0.6 + Math.min(1, (this.lengthCells - START_LEN) / 50) * 0.5));
  }

  hud(pattern: number): HudState {
    return {
      score: this.score,
      best: Math.max(this.best, this.score),
      combo: this.combo,
      comboT: this.combo > 0 ? this.comboT / this.comboWindow : 0,
      length: this.lengthCells,
      effects: this.effects,
      timeLeft: this.timeLeft,
      mode: this.cfg.mode,
      pattern,
    };
  }

  /** Clamp the logical length (attract mode), trimming pending growth and grid cells. */
  capLength(n: number) {
    if (this.lengthCells <= n) return;
    const excess = this.lengthCells - n;
    this.lengthCells = n;
    let rem = excess;
    const g = Math.min(this.grow, rem);
    this.grow -= g;
    rem -= g;
    while (rem-- > 0 && this.cells.length > 1) this.occ[this.cells.pop()!]--;
  }

  /** For the attract-mode AI and tests. */
  debugState() {
    return {
      cellX: this.cellX, cellY: this.cellY, dir: this.dir, prog: this.prog, cells: this.cells.slice(),
      heading: this.heading, obstacleCells: this.obstacleCells, occ: this.occ,
    };
  }
}
