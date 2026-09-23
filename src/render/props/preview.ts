// Prop sheet preview for one world (?dev=props&biome=<id>).
//   Row 1: normal food, golden food, a power-up, repeatedly eaten normal + golden (eat bursts),
//          and a moving hazard patrolling back and forth.
//   Row 2: the six single-cell obstacle variants (seed % 6 = 0..5) on a faint cell grid.
//   Row 3: five 2x2 obstacle variants.
//   params: biome=<id>  zoom=<k> (1 = whole sheet)  cx,cy = zoom centre  bloom=0  hc=1  every=<s>
// Lighting mirrors GameRenderer: BIOME_VISUALS sun/sky/ground + the PMREM sky environment.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { PropsView } from './PropsView';
import { Environment } from '../env';
import { BIOME_VISUALS, lin, type BiomeVisual } from '../biomeVisuals';
import type { BiomeId, FoodState, GameEvent, ObstacleState, PowerupPickupState, RenderFrame } from '../../types';

type Look = Pick<BiomeVisual, 'sunDir' | 'sun' | 'sky' | 'ground' | 'sandA' | 'bloom' | 'env'> & { exposure: number };
const n3 = (x: number, y: number, z: number): [number, number, number] => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
const env = (zenith: string, horizon: string, nadir: string, sunGlow: string) => ({ zenith, horizon, nadir, sunGlow });
/** Stand-ins used only until the world's entry exists in BIOME_VISUALS. */
const FALLBACK: Partial<Record<BiomeId, Look>> = {
  pinksands: { sunDir: n3(-0.35, 0.45, 0.82), sun: [1.6, 1.5, 1.35], sky: [0.3, 0.36, 0.46], ground: [0.3, 0.2, 0.2], sandA: '#efc2bc', bloom: { threshold: 1.1, strength: 0.35, radius: 0.7 }, env: env('#5fa8e8', '#e8f4ff', '#d8a8a0', '#fff8e8'), exposure: 0.95 },
  vaadhoo: { sunDir: n3(0.4, 0.6, 0.7), sun: [0.35, 0.45, 0.75], sky: [0.05, 0.08, 0.16], ground: [0.02, 0.03, 0.05], sandA: '#2a2e36', bloom: { threshold: 0.7, strength: 0.9, radius: 0.85 }, env: env('#0a1430', '#1a3a6a', '#05080f', '#c8dcff'), exposure: 1.2 },
  dallol: { sunDir: n3(-0.3, 0.4, 0.87), sun: [1.45, 1.38, 1.15], sky: [0.3, 0.32, 0.3], ground: [0.35, 0.32, 0.15], sandA: '#e0cc3a', bloom: { threshold: 1.15, strength: 0.35, radius: 0.7 }, env: env('#9ab8d8', '#fff6d0', '#c8b040', '#ffffff'), exposure: 0.85 },
  luna: { sunDir: n3(-0.6, 0.35, 0.55), sun: [2.2, 2.15, 2.05], sky: [0.0, 0.0, 0.0], ground: [0.02, 0.02, 0.02], sandA: '#8a8986', bloom: { threshold: 0.9, strength: 0.5, radius: 0.7 }, env: env('#000000', '#101014', '#202022', '#ffffff'), exposure: 1.0 },
  mars: { sunDir: n3(-0.7, 0.3, 0.4), sun: [1.6, 1.15, 0.8], sky: [0.3, 0.2, 0.14], ground: [0.25, 0.12, 0.06], sandA: '#b8683a', bloom: { threshold: 1.05, strength: 0.4, radius: 0.75 }, env: env('#c89a70', '#e8b888', '#6a3018', '#ffe0b0'), exposure: 1.0 },
  titan: { sunDir: n3(-0.4, 0.5, 0.6), sun: [0.9, 0.6, 0.3], sky: [0.35, 0.2, 0.08], ground: [0.12, 0.07, 0.03], sandA: '#3a2818', bloom: { threshold: 0.9, strength: 0.5, radius: 0.8 }, env: env('#a8682a', '#d8903a', '#2a1808', '#ffb060'), exposure: 1.1 },
  kepler: { sunDir: n3(-0.5, 0.4, 0.6), sun: [1.4, 0.9, 0.8], sky: [0.3, 0.25, 0.5], ground: [0.2, 0.12, 0.28], sandA: '#9a7ac8', bloom: { threshold: 0.95, strength: 0.5, radius: 0.8 }, env: env('#4a3a9a', '#e89ac0', '#3a2a5a', '#ffd0e0'), exposure: 1.0 },
};

function look(b: BiomeId): Look {
  const v = (BIOME_VISUALS as Partial<Record<BiomeId, BiomeVisual>>)[b];
  if (v) return { ...v, exposure: v.grade.exposure };
  return FALLBACK[b] ?? FALLBACK.pinksands!;
}

export function runPropsPreview(params: URLSearchParams) {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.style.margin = '0';
  canvas.style.display = 'block';

  const biome = (params.get('biome') as BiomeId) ?? 'pinksands';
  const L = look(biome);
  renderer.toneMappingExposure = L.exposure;
  const scene = new THREE.Scene();
  scene.background = lin(L.env.nadir);
  const environment = new Environment(renderer, scene);
  environment.setBiome({ id: biome, sunDir: L.sunDir, env: L.env } as BiomeVisual, scene);
  const W = 17, H = 11;
  environment.sync(new THREE.Vector3(...L.sunDir), new THREE.Color(...L.sun), new THREE.Color(...L.sky), new THREE.Color(...L.ground), W / 2, H / 2);

  const sand = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: lin(L.sandA), roughness: 0.95 }));
  sand.position.set(W / 2, H / 2, 0);
  scene.add(sand);
  // faint cell grid under the obstacle rows (to judge the <= 94 % footprint)
  const lp: number[] = [];
  for (let x = 0; x <= W; x++) lp.push(x, 0, 0.002, x, 8, 0.002);
  for (let y = 0; y <= 8; y++) lp.push(0, y, 0.002, W, y, 0.002);
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
  scene.add(grid);

  const pv = new PropsView();
  pv.setBiome(biome);
  pv.setHighContrast(params.get('hc') === '1');
  scene.add(pv.object);

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  cam.up.set(0, 1, 0);
  const zoom = +(params.get('zoom') ?? 1);
  const centre = new THREE.Vector2(params.has('cx') ? +params.get('cx')! : W / 2, params.has('cy') ? +params.get('cy')! : H / 2);
  const bloomOn = params.get('bloom') !== '0';
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), L.bloom.strength, L.bloom.radius * 0.5, L.bloom.threshold);
  if (bloomOn) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fit = () => {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    const aspect = innerWidth / innerHeight;
    let vw = W / zoom, vh = H / zoom;
    if (vw / vh > aspect) vh = vw / aspect; else vw = vh * aspect;
    cam.left = -vw / 2; cam.right = vw / 2; cam.top = vh / 2; cam.bottom = -vh / 2;
    cam.updateProjectionMatrix();
    cam.position.set(centre.x, centre.y, 40);
    cam.lookAt(centre.x, centre.y, 0);
  };
  addEventListener('resize', fit);
  fit();

  // ---------------------------------------------------------------- scripted frame
  const every = +(params.get('every') ?? 1.6);
  const obstacles: ObstacleState[] = [];
  const cell = (id: number, cx: number, cy: number, size: number, seed: number): ObstacleState => {
    const cells: [number, number][] = [];
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) cells.push([cx + dx, cy + dy]);
    return { id, x: cx + size / 2, y: cy + size / 2, r: size === 2 ? 1.05 : 0.5, cells, seed, vx: 0, vy: 0 };
  };
  for (let v = 0; v < 6; v++) obstacles.push(cell(10 + v, 1 + v * 2.5 | 0, 6, 1, v + 6 * (3 + v)));
  for (let k = 0; k < 5; k++) obstacles.push(cell(20 + k, 1 + k * 3, 1, 2, k + 6 * (11 + k)));
  const hazard: ObstacleState = { id: 99, x: 11, y: 9.5, r: 0.42, cells: [], seed: 5, vx: 1.6, vy: 0 };
  obstacles.push(hazard);
  const pu: PowerupPickupState = { id: 1, kind: 'magnet', x: 4.5, y: 9.5, age: 10, ttl: 8 };
  let eatK = -1;
  let last = performance.now();
  const t0 = last;
  let tSim = 0;
  const frame = (dt: number): RenderFrame => {
    tSim += dt;
    const events: GameEvent[] = [];
    const k = Math.floor(tSim / every);
    const ph = tSim - k * every;
    if (k !== eatK && tSim > 0.8) {
      eatK = k;
      events.push({ type: 'eat', x: 6.5, y: 9.5, kind: 'normal', combo: 1, points: 10, length: 5 });
      events.push({ type: 'eat', x: 8.5, y: 9.5, kind: 'golden', combo: 1, points: 50, length: 5 });
    }
    hazard.x += hazard.vx * dt;
    if (hazard.x > 16.2) hazard.vx = -Math.abs(hazard.vx);
    if (hazard.x < 10.2) hazard.vx = Math.abs(hazard.vx);
    const foods: FoodState[] = [
      { id: 1, kind: 'normal', x: 1.5, y: 9.5, age: 10 + tSim, ttl: Infinity },
      { id: 2, kind: 'golden', x: 3.0, y: 9.5, age: 10 + tSim, ttl: 6 },
    ];
    if (ph > 0.25 || tSim < 0.8) {
      foods.push({ id: 100 + k * 2, kind: 'normal', x: 6.5, y: 9.5, age: tSim < 0.8 ? 10 : ph - 0.25, ttl: Infinity });
      foods.push({ id: 101 + k * 2, kind: 'golden', x: 8.5, y: 9.5, age: tSim < 0.8 ? 10 : ph - 0.25, ttl: 6 });
    }
    pu.age += dt;
    return {
      time: (performance.now() - t0) / 1000, dt, boardW: W, boardH: H,
      snake: { points: new Float32Array(4), count: 0, spacing: 0.12, radius: 0.34, dirX: 1, dirY: 0, speed: 0, turnRate: 0, bulges: [], alive: true, deathT: 0, interest: 0, ghost: false, skin: 'obsidian', length: 0 },
      foods, obstacles, powerups: [pu],
      effects: { timeScale: 1, ghost: 0, magnet: 0, double: 0, slow: 0 },
      events, intensity: 0, shake: 0, paused: false,
    };
  };
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    pv.update(frame(dt));
    composer.render();
    requestAnimationFrame(loop);
  };
  loop();
  (window as any).__props = { pv, scene, renderer };
}
