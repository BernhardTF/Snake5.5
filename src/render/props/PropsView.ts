// Food, obstacles and power-up pickups: pooled by id, spawn/idle/exit animations, eat bursts.
import * as THREE from 'three';
import type { IPropsView } from '../contract';
import type { BiomeId, GameEvent, PowerupKind, RenderFrame } from '../../types';
import { foodModel, noShadow } from './foods';
import { obstacleGeo } from './obstacles';
import { POWERUP_COLOR, powerupTemplate } from './powerups';
import { glowTexture } from './geo';

type Exit = 'none' | 'pop' | 'fade' | 'shrink';

interface Item {
  key: string;         // pool key (type)
  root: THREE.Group;   // positioned + animated
  inner: THREE.Object3D;
  id: number;
  x: number; y: number;
  seen: boolean;
  exit: Exit;
  exitT: number;
  seed: number;
  born: number;
  // obstacles
  rollQ?: THREE.Quaternion;
  dustT?: number;
  zBase?: number;
  exitS?: THREE.Vector3;
  exitCaptured?: boolean;
  motion?: 'roll' | 'log' | 'walk' | 'hover';
  lift?: number;
  alignYaw?: number;
  yaw?: number;
  spin?: number;
}

const easeOutBack = (t: number) => {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const FOOD_SCALE = 1.45;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ------------------------------------------------------------------ particles
const MAXP = 240;
type BurstSet = 'flake' | 'cube' | 'shard' | 'spark';
interface BurstPhys {
  gravity: number; airDrag: number; flutter: number; spin: number;
  upMin: number; upMax: number; lifeMin: number; lifeMax: number;
  /** Damping of upward speed while airborne (0 = pure ballistic, e.g. vacuum). */
  vzDamp: number;
}
const PHYS: BurstPhys = { gravity: 9, airDrag: 1.6, flutter: 1.5, spin: 18, upMin: 1.2, upMax: 3.4, lifeMin: 0.9, lifeMax: 1.5, vzDamp: 1.2 };

class Burst {
  readonly mesh: THREE.InstancedMesh;
  phys: BurstPhys = { ...PHYS };
  private px = new Float32Array(MAXP * 3);
  private pv = new Float32Array(MAXP * 3);
  private rot = new Float32Array(MAXP * 3);
  private spin = new Float32Array(MAXP * 3);
  private life = new Float32Array(MAXP);
  private maxLife = new Float32Array(MAXP);
  private size = new Float32Array(MAXP);
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(g: THREE.BufferGeometry, mat: THREE.Material) {
    this.mesh = new THREE.InstancedMesh(g, mat, MAXP);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.userData.noShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  }

  emit(x: number, y: number, z: number, cols: THREE.Color[], count: number, speed: number, size: number, glow = 0) {
    const P = this.phys;
    for (let k = 0; k < count; k++) {
      let i = this.n;
      if (i >= MAXP) {
        // replace the oldest (smallest remaining life)
        let best = 0, bl = 1e9;
        for (let j = 0; j < MAXP; j++) if (this.life[j] < bl) { bl = this.life[j]; best = j; }
        i = best;
      } else this.n++;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.45 + Math.random() * 0.8);
      this.px[i * 3] = x; this.px[i * 3 + 1] = y; this.px[i * 3 + 2] = z;
      this.pv[i * 3] = Math.cos(a) * sp; this.pv[i * 3 + 1] = Math.sin(a) * sp; this.pv[i * 3 + 2] = P.upMin + Math.random() * (P.upMax - P.upMin);
      for (let d = 0; d < 3; d++) { this.rot[i * 3 + d] = Math.random() * 6.28; this.spin[i * 3 + d] = (Math.random() - 0.5) * P.spin; }
      this.maxLife[i] = this.life[i] = P.lifeMin + Math.random() * (P.lifeMax - P.lifeMin);
      this.size[i] = size * (0.6 + Math.random() * 0.7);
      this.c.copy(cols[Math.floor(Math.random() * cols.length)]);
      if (glow > 0) this.c.multiplyScalar(1 + glow);
      this.mesh.setColorAt(i, this.c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }

  update(dt: number) {
    if (this.n === 0) { this.mesh.visible = false; return; }
    const P = this.phys;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      // compact
      if (w !== i) {
        for (let d = 0; d < 3; d++) {
          this.px[w * 3 + d] = this.px[i * 3 + d]; this.pv[w * 3 + d] = this.pv[i * 3 + d];
          this.rot[w * 3 + d] = this.rot[i * 3 + d]; this.spin[w * 3 + d] = this.spin[i * 3 + d];
        }
        this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i]; this.size[w] = this.size[i];
        const ic = this.mesh.instanceColor!;
        ic.setXYZ(w, ic.getX(i), ic.getY(i), ic.getZ(i));
        ic.needsUpdate = true;
      }
      const o = w * 3;
      const ground = this.px[o + 2] <= 0.015;
      this.pv[o + 2] -= P.gravity * dt;
      const drag = ground ? Math.exp(-dt * 10) : Math.exp(-dt * P.airDrag);
      this.pv[o] *= drag; this.pv[o + 1] *= drag;
      // flutter
      if (!ground) {
        const f = P.flutter;
        this.pv[o] += Math.sin(this.life[w] * 13 + w) * dt * f; this.pv[o + 1] += Math.cos(this.life[w] * 11 + w) * dt * f;
        this.pv[o + 2] *= Math.exp(-dt * P.vzDamp);
      }
      for (let d = 0; d < 3; d++) this.px[o + d] += this.pv[o + d] * dt;
      if (this.px[o + 2] < 0.012) { this.px[o + 2] = 0.012; this.pv[o + 2] = 0; }
      const spinK = ground ? 0 : 1;
      for (let d = 0; d < 3; d++) this.rot[o + d] += this.spin[o + d] * dt * spinK;
      if (ground) { this.rot[o] *= 1 - Math.min(1, dt * 8); this.rot[o + 1] *= 1 - Math.min(1, dt * 8); }
      const lt = this.life[w] / this.maxLife[w];
      const sc = this.size[w] * Math.min(1, lt * 3);
      this.e.set(this.rot[o], this.rot[o + 1], this.rot[o + 2]);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(this.px[o], this.px[o + 1], this.px[o + 2]), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(w, this.m);
      w++;
    }
    this.n = w;
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; this.mesh.visible = false; }
}

function makeBursts(): Record<BurstSet, Burst> {
  // small cupped petal / flake
  const flake = new THREE.CircleGeometry(0.5, 7);
  flake.scale(1, 0.62, 1);
  const pos = flake.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.12 * (pos.getX(i) ** 2 + pos.getY(i) ** 2));
  flake.computeVertexNormals();
  const lit = () => new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide, emissive: new THREE.Color(0x000000) });
  const cube = new THREE.BoxGeometry(0.62, 0.62, 0.62);
  const shard = new THREE.OctahedronGeometry(0.5, 0); shard.scale(0.55, 0.55, 1.2);
  const spark = new THREE.OctahedronGeometry(0.5, 0);
  const glowMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  return {
    flake: new Burst(flake, lit()),
    cube: new Burst(cube, new THREE.MeshStandardMaterial({ roughness: 0.5, flatShading: true })),
    shard: new Burst(shard, new THREE.MeshPhysicalMaterial({ roughness: 0.15, clearcoat: 1, flatShading: true })),
    spark: new Burst(spark, glowMat),
  };
}

interface Emit { set: BurstSet; cols: THREE.Color[]; count: number; speed: number; size: number; glow?: number }
interface BurstFx { eat: Emit[]; gold: Emit[]; phys: Partial<Record<BurstSet, Partial<BurstPhys>>> }
const cl = (...h: string[]) => h.map((x) => new THREE.Color(x));
const GOLD = cl('#ffd35a', '#fff0b0', '#ffb020');
const goldFx = (set: BurstSet, dark = false): Emit[] => dark
  // dim worlds: lit flakes would read brown, so the whole golden burst is emissive sparks
  ? [{ set: 'spark', cols: GOLD, count: 30, speed: 2.6, size: 0.055, glow: 2 }]
  : [
    { set, cols: GOLD, count: 20, speed: 2.8, size: set === 'flake' ? 0.1 : 0.06, glow: 1.2 },
    { set: 'spark', cols: GOLD, count: 12, speed: 2.4, size: 0.05, glow: 2 },
  ];
/** Eat-scatter look per world. Worlds not listed use the classic flake burst. */
const FX: Partial<Record<BiomeId, BurstFx>> = {
  pinksands: {
    eat: [
      { set: 'flake', cols: cl('#f7a8b4', '#fff2ea', '#ec7a8e'), count: 14, speed: 2.2, size: 0.12 },
      { set: 'cube', cols: cl('#fff4ec', '#e8909c', '#c84a5a'), count: 12, speed: 1.9, size: 0.05 },
    ],
    gold: goldFx('flake'), phys: { cube: { flutter: 0, vzDamp: 0, gravity: 10 } },
  },
  vaadhoo: {
    eat: [
      { set: 'spark', cols: cl('#6fe0ff', '#c8f4ff', '#2e9cff'), count: 26, speed: 1.8, size: 0.06, glow: 2.5 },
      { set: 'flake', cols: cl('#f6eee2', '#c6bcd8'), count: 8, speed: 1.8, size: 0.09 },
    ],
    gold: goldFx('flake', true),
    phys: { spark: { gravity: 1.2, airDrag: 2.2, flutter: 2.5, upMin: 0.6, upMax: 1.6, lifeMin: 1.2, lifeMax: 2.2, vzDamp: 1.5 } },
  },
  dallol: {
    eat: [
      { set: 'cube', cols: cl('#ffffff', '#f4f0e0', '#f2e23a'), count: 20, speed: 2.4, size: 0.07 },
      { set: 'cube', cols: cl('#3ad6b4'), count: 5, speed: 1.6, size: 0.05 },
    ],
    gold: goldFx('cube'), phys: { cube: { gravity: 11, airDrag: 0.8, flutter: 0, spin: 12, vzDamp: 0 } },
  },
  luna: {
    eat: [
      { set: 'cube', cols: cl('#a8a6a0', '#6e6c68', '#8a8884'), count: 14, speed: 0.9, size: 0.05 },
      { set: 'spark', cols: cl('#bfe6ff', '#e8f8ff', '#7ac0ff'), count: 16, speed: 0.9, size: 0.05, glow: 2 },
    ],
    gold: goldFx('cube', true),
    phys: {
      cube: { gravity: 1.62, airDrag: 0, flutter: 0, upMin: 0.8, upMax: 1.6, lifeMin: 1.4, lifeMax: 2.0, vzDamp: 0, spin: 6 },
      spark: { gravity: 1.62, airDrag: 0, flutter: 0, upMin: 0.8, upMax: 1.6, lifeMin: 1.4, lifeMax: 2.0, vzDamp: 0, spin: 6 },
    },
  },
  mars: {
    eat: [
      { set: 'flake', cols: cl('#c0602a', '#e08a4a', '#8a3a1a'), count: 14, speed: 2.0, size: 0.1 },
      { set: 'shard', cols: cl('#f4fbff', '#a9d3ef'), count: 10, speed: 2.2, size: 0.07 },
    ],
    gold: goldFx('shard'),
    phys: { flake: { gravity: 3.7, airDrag: 1.2, flutter: 0.8, lifeMin: 1.2, lifeMax: 1.8 }, shard: { gravity: 3.7, airDrag: 0.6, flutter: 0, vzDamp: 0 } },
  },
  titan: {
    eat: [{ set: 'flake', cols: cl('#f0862e', '#b85a1c', '#ffc070'), count: 22, speed: 1.4, size: 0.11 }],
    gold: goldFx('flake', true),
    phys: { flake: { gravity: 1.35, airDrag: 3.2, flutter: 2.2, upMin: 0.8, upMax: 1.8, lifeMin: 1.8, lifeMax: 2.6, vzDamp: 1.8, spin: 6 } },
  },
  kepler: {
    eat: [
      { set: 'spark', cols: cl('#ff5ae8', '#5af0ff', '#c890ff'), count: 18, speed: 2.0, size: 0.06, glow: 2 },
      { set: 'shard', cols: cl('#b07aff', '#5ae6ff'), count: 10, speed: 2.2, size: 0.07, glow: 0.6 },
    ],
    gold: goldFx('shard'),
    phys: { spark: { gravity: 2, airDrag: 1.5, flutter: 2, lifeMin: 1.2, lifeMax: 2.0 }, shard: { gravity: 7, flutter: 0, vzDamp: 0 } },
  },
};

// ------------------------------------------------------------------ dust puffs for rolling hazards
class Dust {
  readonly group = new THREE.Group();
  private items: { m: THREE.Mesh; t: number; life: number; vx: number; vy: number }[] = [];
  private mat: THREE.MeshBasicMaterial;
  constructor() {
    this.mat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xd8c8b0, transparent: true, depthWrite: false, opacity: 0.35 });
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 48; i++) {
      const m = noShadow(new THREE.Mesh(geo, this.mat.clone()));
      m.visible = false;
      this.group.add(m);
      this.items.push({ m, t: 0, life: 0, vx: 0, vy: 0 });
    }
  }
  setColor(c: THREE.Color) { for (const it of this.items) (it.m.material as THREE.MeshBasicMaterial).color.copy(c); }
  puff(x: number, y: number, vx: number, vy: number) {
    const it = this.items.find((i) => i.life <= 0);
    if (!it) return;
    it.t = 0; it.life = 0.9 + Math.random() * 0.4;
    it.vx = vx + (Math.random() - 0.5) * 0.4; it.vy = vy + (Math.random() - 0.5) * 0.4;
    it.m.position.set(x, y, 0.04);
    it.m.visible = true;
  }
  update(dt: number) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) { it.life = 0; it.m.visible = false; continue; }
      it.m.position.x += it.vx * dt; it.m.position.y += it.vy * dt;
      it.vx *= Math.exp(-dt * 3); it.vy *= Math.exp(-dt * 3);
      it.m.scale.setScalar(0.25 + k * 0.7);
      (it.m.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - k) * Math.min(1, k * 6);
    }
  }
  clear() { for (const it of this.items) { it.life = 0; it.m.visible = false; } }
}

// ------------------------------------------------------------------ view
const DUST: Record<BiomeId, string> = {
  karesansui: '#e6ddcc', erg: '#e8a868', lagoon: '#c9a585', svartsandur: '#58585c', salar: '#ffffff',
  pinksands: '#f6cccc', vaadhoo: '#4a6a80', dallol: '#f4ecb0', luna: '#a09e98', mars: '#c87a4a',
  titan: '#6a4428', kepler: '#c8a0ff',
};
const wrapPi = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

export class PropsView implements IPropsView {
  readonly object = new THREE.Group();
  private biome: BiomeId = 'karesansui';
  private highContrast = false;
  private foods = new Map<number, Item>();
  private obstacles = new Map<number, Item>();
  private pickups = new Map<number, Item>();
  private free = new Map<string, Item[]>();
  private bursts = makeBursts();
  private burstList = Object.values(this.bursts);
  private fx: BurstFx | null = null;
  private dust = new Dust();
  private hcRing: THREE.RingGeometry;
  private hcMat: THREE.MeshBasicMaterial;
  private hcDark: THREE.MeshBasicMaterial;
  private _v = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private time = 0;

  constructor() {
    this.object.name = 'props';
    for (const b of Object.values(this.bursts)) this.object.add(b.mesh);
    this.object.add(this.dust.group);
    this.hcRing = new THREE.RingGeometry(0.43, 0.5, 48);
    this.hcMat = new THREE.MeshBasicMaterial({ color: 0x3af0ff, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false });
    this.hcDark = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
    this.setBiome('karesansui');
  }

  setBiome(id: BiomeId) {
    if (id === this.biome && this.foods.size + this.obstacles.size + this.pickups.size > 0) return;
    this.biome = id;
    this.clearAll();
    this.free.clear();
    this.dust.setColor(new THREE.Color(DUST[id] ?? '#cccccc'));
    this.fx = FX[id] ?? null;
    for (const k of Object.keys(this.bursts) as BurstSet[]) this.bursts[k].phys = { ...PHYS, ...(this.fx?.phys[k] ?? {}) };
  }

  setHighContrast(on: boolean) {
    this.highContrast = on;
    for (const it of this.foods.values()) { const r = it.root.getObjectByName('hc'); if (r) r.visible = on; }
  }

  private clearAll() {
    for (const m of [this.foods, this.obstacles, this.pickups]) {
      for (const it of m.values()) this.object.remove(it.root);
      m.clear();
    }
    for (const list of this.free.values()) for (const it of list) this.object.remove(it.root);
    for (const b of Object.values(this.bursts)) b.clear();
    this.dust.clear();
  }

  private take(key: string, make: () => Item): Item {
    const list = this.free.get(key);
    const it = list && list.length ? list.pop()! : make();
    it.root.visible = true;
    it.exit = 'none'; it.exitT = 0; it.seen = true; it.exitCaptured = false;
    it.root.position.z = 0;
    it.root.scale.setScalar(0.0001);
    if (!it.root.parent) this.object.add(it.root);
    return it;
  }
  private release(it: Item) {
    it.root.visible = false;
    let list = this.free.get(it.key);
    if (!list) { list = []; this.free.set(it.key, list); }
    list.push(it);
  }

  // ---------------------------------------------------------------- builders
  private makeFood(golden: boolean): Item {
    const fm = foodModel(this.biome);
    const root = new THREE.Group();
    const inner = (golden ? fm.golden : fm.normal).clone(true);
    root.add(inner);
    const dark = noShadow(new THREE.Mesh(this.hcRing, this.hcDark));
    dark.scale.setScalar(1.12); dark.position.z = 0.006;
    const ring = noShadow(new THREE.Mesh(this.hcRing, this.hcMat));
    ring.position.z = 0.008;
    const hc = new THREE.Group(); hc.name = 'hc'; hc.add(dark, ring); hc.visible = this.highContrast;
    root.add(hc);
    return { key: golden ? 'fg' : 'fn', root, inner, id: 0, x: 0, y: 0, seen: true, exit: 'none', exitT: 0, seed: Math.random() * 100, born: 0 };
  }

  private makeObstacle(seed: number, big: boolean, rolling: boolean): Item {
    const og = obstacleGeo(this.biome, seed, big, rolling);
    const root = new THREE.Group();
    const inner = new THREE.Group();
    const m = new THREE.Mesh(og.geo, og.mat);
    m.castShadow = true; m.receiveShadow = true;
    inner.add(m);
    for (const e of og.extra ?? []) {
      const x = new THREE.Mesh(e.geo, e.mat);
      if (e.noShadow) noShadow(x); else { x.castShadow = true; x.receiveShadow = true; }
      inner.add(x);
    }
    root.add(inner);
    return {
      key: `o:${seed % 6}:${big ? 1 : 0}:${rolling ? 1 : 0}`, root, inner, id: 0, x: 0, y: 0, seen: true, exit: 'none', exitT: 0, seed, born: 0,
      rollQ: new THREE.Quaternion(), dustT: 0, motion: og.motion ?? 'roll', lift: og.lift ?? 1, alignYaw: og.alignYaw, yaw: 0, spin: 0,
    };
  }

  private makePickup(kind: PowerupKind): Item {
    const t = powerupTemplate(kind).clone(true);
    // unique materials for ring/halo so blinking is per pickup
    for (const n of ['ring', 'halo']) {
      const o = t.getObjectByName(n) as THREE.Mesh;
      o.material = (o.material as THREE.Material).clone();
    }
    const root = new THREE.Group();
    root.add(t);
    return { key: 'p:' + kind, root, inner: t, id: 0, x: 0, y: 0, seen: true, exit: 'none', exitT: 0, seed: Math.random() * 100, born: 0 };
  }

  // ---------------------------------------------------------------- update
  update(f: RenderFrame) {
    const dt = f.paused ? 0 : Math.min(0.1, f.dt);
    const t = f.time;
    this.time = t;
    const fm = foodModel(this.biome);

    // events -> exits + bursts
    const eats: GameEvent[] = [], expires: GameEvent[] = [], picks: GameEvent[] = [];
    for (const e of f.events) {
      if (e.type === 'eat') {
        eats.push(e);
        const gold = e.kind === 'golden';
        if (this.fx) {
          for (const em of gold ? this.fx.gold : this.fx.eat) this.bursts[em.set].emit(e.x, e.y, 0.15, em.cols, em.count, em.speed, em.size, em.glow ?? 0);
        } else {
          this.bursts.flake.emit(e.x, e.y, 0.15, gold ? GOLD : fm.burst, gold ? 30 : 22, gold ? 2.8 : 2.2, gold ? 0.1 : 0.13, gold ? 1.2 : this.biome === 'svartsandur' ? 1.5 : 0);
        }
      } else if (e.type === 'foodExpired') expires.push(e);
      else if (e.type === 'powerup') {
        picks.push(e);
        const c = new THREE.Color(POWERUP_COLOR[e.kind]);
        this.bursts.flake.emit(e.x, e.y, 0.35, [c, c.clone().lerp(new THREE.Color(1, 1, 1), 0.5)], 18, 2.2, 0.07, 1.5);
      }
    }
    const near = (list: GameEvent[], x: number, y: number) =>
      list.some((e) => 'x' in e && Math.abs((e as any).x - x) < 0.9 && Math.abs((e as any).y - y) < 0.9);

    // ------------------------------------------------ foods
    for (const it of this.foods.values()) it.seen = false;
    for (const fd of f.foods) {
      const golden = fd.kind === 'golden';
      let it = this.foods.get(fd.id);
      if (it && it.key !== (golden ? 'fg' : 'fn')) { this.release(it); this.foods.delete(fd.id); it = undefined; }
      if (!it) {
        it = this.take(golden ? 'fg' : 'fn', () => this.makeFood(golden));
        it.id = fd.id; it.born = t - fd.age;
        it.root.rotation.z = (fd.id * 2.399) % (Math.PI * 2);
        (it.root.getObjectByName('hc') as THREE.Object3D).visible = this.highContrast;
        this.foods.set(fd.id, it);
      }
      it.seen = true;
      it.x = fd.x; it.y = fd.y;
      const age = Math.max(0, fd.age);
      const sp = easeOutBack(clamp01(age / 0.5));
      const breathe = 1 + 0.035 * Math.sin(t * 2.4 + it.seed);
      it.root.position.set(fd.x, fd.y, 0);
      it.root.scale.setScalar(Math.max(0.0001, sp * breathe * FOOD_SCALE));
      it.inner.position.z = 0.015 + 0.012 * Math.sin(t * 1.7 + it.seed);
      it.inner.rotation.z = Math.sin(t * 0.6 + it.seed) * 0.12;
      if (golden) {
        it.inner.rotation.z = t * 0.8;
        let vis = true;
        if (fd.ttl < 2) vis = Math.sin(t * Math.PI * 2 * (4 + (2 - fd.ttl) * 3)) > -0.35;
        it.inner.visible = vis;
        this.animateSparkles(it.inner, t);
      }
      const hc = it.root.getObjectByName('hc');
      if (hc && hc.visible) { hc.scale.setScalar(1 + 0.08 * Math.sin(t * 5)); }
    }
    for (const [id, it] of this.foods) {
      if (it.seen) continue;
      if (it.exit === 'none') {
        it.exit = near(eats, it.x, it.y) ? 'pop' : near(expires, it.x, it.y) ? 'fade' : 'shrink';
        it.exitT = 0;
        if (it.exit === 'fade') (this.fx ? this.bursts[this.fx.eat[0].set] : this.bursts.flake).emit(it.x, it.y, 0.05, fm.burst, 5, 0.5, 0.07);
      }
      it.exitT += dt;
      const done = this.animateExit(it);
      if (done) { this.release(it); this.foods.delete(id); }
    }

    // ------------------------------------------------ obstacles
    for (const it of this.obstacles.values()) it.seen = false;
    for (const ob of f.obstacles) {
      const rolling = ob.vx !== 0 || ob.vy !== 0;
      let hx = ob.r, hy = ob.r;
      if (ob.cells.length) {
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const [cx, cy] of ob.cells) { x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy); }
        hx = (x1 - x0 + 1) / 2; hy = (y1 - y0 + 1) / 2;
      }
      const big = Math.max(hx, hy) > 0.75;
      let it = this.obstacles.get(ob.id);
      if (!it) {
        const key = `o:${ob.seed % 6}:${big ? 1 : 0}:${rolling ? 1 : 0}`;
        it = this.take(key, () => this.makeObstacle(ob.seed, big, rolling));
        it.id = ob.id; it.born = t;
        const jit = (ob.seed * 0.618) % 1;
        it.root.rotation.z = rolling ? 0 : it.alignYaw !== undefined ? it.alignYaw + (jit - 0.5) * 0.4 : jit * Math.PI * 2;
        it.rollQ!.identity();
        it.yaw = Math.atan2(ob.vy, ob.vx); it.spin = 0;
        it.inner.rotation.set(0, 0, 0); it.inner.position.set(0, 0, 0);
        this.obstacles.set(ob.id, it);
      }
      it.seen = true;
      it.x = ob.x; it.y = ob.y;
      const age = t - it.born;
      const sp = easeOutBack(clamp01(age / 0.6));
      if (rolling) {
        this.moveHazard(it, ob.vx, ob.vy, ob.r * 0.95, sp, dt, t);
      } else {
        // footprint: stay slightly inside the occupied cells
        const sx = hx * 0.94, sy = hy * 0.94;
        const s = Math.min(sx, sy);
        it.root.position.set(ob.x, ob.y, 0);
        it.root.scale.set(Math.max(0.0001, sx * sp), Math.max(0.0001, sy * sp), Math.max(0.0001, s * sp * (big ? 0.85 : 1)));
      }
    }
    for (const [id, it] of this.obstacles) {
      if (it.seen) continue;
      if (it.exit === 'none') { it.exit = 'shrink'; it.exitT = 0; }
      it.exitT += dt;
      if (this.animateExit(it)) { this.release(it); this.obstacles.delete(id); }
    }

    // ------------------------------------------------ power-ups
    for (const it of this.pickups.values()) it.seen = false;
    for (const pu of f.powerups) {
      let it = this.pickups.get(pu.id);
      if (!it) {
        it = this.take('p:' + pu.kind, () => this.makePickup(pu.kind));
        it.id = pu.id; it.born = t - pu.age;
        this.pickups.set(pu.id, it);
      }
      it.seen = true;
      it.x = pu.x; it.y = pu.y;
      const sp = easeOutBack(clamp01(pu.age / 0.5));
      it.root.position.set(pu.x, pu.y, 0);
      it.root.scale.setScalar(Math.max(0.0001, sp));
      const glyph = it.inner.getObjectByName('glyph')!;
      glyph.position.z = 0.42 + 0.06 * Math.sin(t * 2.2 + it.seed);
      glyph.rotation.z = Math.sin(t * 1.3 + it.seed) * 0.35;
      glyph.rotation.x = Math.sin(t * 1.7 + it.seed) * 0.18;
      const ring = it.inner.getObjectByName('ring') as THREE.Mesh;
      ring.rotation.z = t * 1.2;
      ring.scale.setScalar(1 + 0.05 * Math.sin(t * 3 + it.seed));
      const halo = it.inner.getObjectByName('halo') as THREE.Mesh;
      let vis = 1;
      if (pu.ttl < 2) vis = Math.sin(t * Math.PI * 2 * (4 + (2 - pu.ttl) * 3)) > -0.3 ? 1 : 0.15;
      (halo.material as THREE.MeshBasicMaterial).opacity = (0.55 + 0.2 * Math.sin(t * 4 + it.seed)) * vis;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * vis;
      glyph.visible = vis > 0.5;
    }
    for (const [id, it] of this.pickups) {
      if (it.seen) continue;
      if (it.exit === 'none') { it.exit = near(picks, it.x, it.y) ? 'pop' : 'shrink'; it.exitT = 0; }
      it.exitT += dt;
      if (this.animateExit(it)) { this.release(it); this.pickups.delete(id); }
    }

    for (const b of this.burstList) b.update(dt);
    this.dust.update(dt);
  }

  private puff(it: Item, vx: number, vy: number, v: number, rad: number, dt: number, every: number, back: number, spread: number) {
    it.dustT! -= dt;
    if (it.dustT! <= 0 && v > 0) {
      it.dustT = every;
      this.dust.puff(it.x - (vx / v) * rad * back, it.y - (vy / v) * rad * back, -vx * spread, -vy * spread);
    }
  }

  /** Moving hazards: roll, roll-as-log, walk (faces its heading and bobs) or hover. */
  private moveHazard(it: Item, vx: number, vy: number, rad: number, sp: number, dt: number, t: number) {
    const v = Math.hypot(vx, vy);
    const heading = Math.atan2(vy, vx);
    switch (it.motion) {
      case 'log': {
        // align the log across the travel direction (either way round), roll about its axis
        if (v > 0) {
          let d = wrapPi(heading - it.yaw!);
          if (d > Math.PI / 2) d -= Math.PI; else if (d < -Math.PI / 2) d += Math.PI;
          it.yaw! += d * Math.min(1, dt * 10);
          const sign = Math.cos(it.yaw! - heading) >= 0 ? 1 : -1;
          it.spin! += (sign * v * dt) / (rad * it.lift!);
          if (dt > 0) this.puff(it, vx, vy, v, rad, dt, 0.06, it.lift!, 0.15);
        }
        it.root.rotation.z = it.yaw!;
        it.inner.rotation.set(0, it.spin!, 0);
        it.root.position.set(it.x, it.y, rad * it.lift! * sp);
        it.root.scale.setScalar(Math.max(0.0001, rad * sp));
        break;
      }
      case 'walk': {
        if (v > 0) it.yaw! += wrapPi(heading - it.yaw!) * Math.min(1, dt * 7);
        it.spin! += v * dt * 11;
        it.root.rotation.z = it.yaw!;
        it.inner.position.z = Math.abs(Math.sin(it.spin!)) * 0.07;
        it.inner.rotation.set(Math.sin(it.spin!) * 0.07, 0, Math.sin(it.spin! * 0.5) * 0.06);
        it.root.position.set(it.x, it.y, 0);
        it.root.scale.setScalar(Math.max(0.0001, rad * 1.15 * sp));
        if (dt > 0) this.puff(it, vx, vy, v, rad, dt, 0.1, 0.9, 0.1);
        break;
      }
      case 'hover': {
        it.spin! += dt * 1.7;
        it.inner.rotation.set(Math.sin(t * 1.3 + it.seed) * 0.12, Math.cos(t * 1.1 + it.seed) * 0.12, it.spin!);
        it.root.rotation.z = 0;
        it.root.position.set(it.x, it.y, rad * (1.3 + 0.12 * Math.sin(t * 2.3 + it.seed)) * sp);
        it.root.scale.setScalar(Math.max(0.0001, rad * sp));
        break;
      }
      default: {
        if (v > 0 && dt > 0) {
          this._v.set(-vy, vx, 0).normalize();
          this._q.setFromAxisAngle(this._v, (v * dt) / rad);
          it.rollQ!.premultiply(this._q);
          this.puff(it, vx, vy, v, rad, dt, 0.07, 0.8, 0.15);
        }
        it.inner.quaternion.copy(it.rollQ!);
        it.inner.position.set(0, 0, 0);
        it.root.position.set(it.x, it.y, rad * sp);
        it.root.scale.setScalar(Math.max(0.0001, rad * sp));
      }
    }
  }

  private animateSparkles(o: THREE.Object3D, t: number) {
    for (const c of o.children) {
      if (c.userData.role !== 'sparkle') continue;
      const ph = c.userData.phase as number;
      const k = Math.max(0, Math.sin(t * 3.1 + ph * 2.3));
      c.scale.setScalar(0.001 + 0.07 * Math.pow(k, 3));
      c.rotation.z = t * 2 + ph;
    }
  }

  /** Returns true when finished. */
  private animateExit(it: Item): boolean {
    const k = it.exitT;
    if (!it.exitS) it.exitS = new THREE.Vector3();
    if (!it.exitCaptured) { it.exitS.copy(it.root.scale); it.exitCaptured = true; }
    const S = it.exitS;
    let f = 1;
    if (it.exit === 'pop') {
      const d = 0.2;
      if (k >= d) return true;
      const u = k / d;
      f = u < 0.35 ? 1 + (u / 0.35) * 0.35 : 1.35 * (1 - (u - 0.35) / 0.65);
    } else if (it.exit === 'fade') {
      const d = 0.6;
      if (k >= d) return true;
      const u = k / d;
      f = (1 - u) * (1 - u);
      it.root.position.z = -u * 0.1;
      it.inner.rotation.z += 0.05;
    } else {
      const d = 0.3;
      if (k >= d) return true;
      f = 1 - k / d;
    }
    it.root.scale.set(Math.max(1e-4, S.x * f), Math.max(1e-4, S.y * f), Math.max(1e-4, S.z * f));
    return false;
  }

  dispose() {
    this.clearAll();
  }
}

