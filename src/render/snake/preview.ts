// Isolated preview for the snake + props renderers (?dev=snake&...).
//   mode=snake (default) | skins | heads | props
//   skin=obsidian  biome=<any BiomeId>  length=14  zoom=1  ghost=1  dead=<sec>  ff=<frames>  q=low|medium|high|ultra
//   cx,cy = zoom centre (default: snake head)   hc=1 high contrast   w,h board
//   mode=skins: set=all (default) | snakes | legends | new | old, cols=<n>, labels=0 hides names
//   mode=heads: close-up grid of heads (same set/cols options, zoom = head zoom, default 5)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FakeWorld } from '../../dev/fakeFrame';
import { SnakeView } from './SnakeView';
import { PropsView } from '../props/PropsView';
import { LIGHT } from '../lighting';
import type { BiomeId, PowerupKind, QualityLevel, RenderFrame, SkinId } from '../../types';
import { SKINS, type SkinInfo } from '../../skins/skins';
import { BIOME_VISUALS } from '../biomeVisuals';

// Flat preview sand per biome (falls back to the biome's own sand colour, then to neutral).
const SAND: Partial<Record<BiomeId, string>> = {
  karesansui: '#d6cdbd', erg: '#d98f4e', lagoon: '#a88468', svartsandur: '#2a2a2c', salar: '#e8e6e2',
  pinksands: '#ecc3bb', vaadhoo: '#3a3f4a', dallol: '#d8c24a', luna: '#8c8c8e', mars: '#b8683a',
  titan: '#3a2c20', kepler: '#9a86c8',
};
const sandOf = (b: BiomeId) =>
  SAND[b] ?? (BIOME_VISUALS as Partial<Record<BiomeId, { sandA?: string }>>)[b]?.sandA ?? '#d6cdbd';
const BIOMES: BiomeId[] = ['karesansui', 'erg', 'lagoon', 'svartsandur', 'salar'];
const OLD_SKINS = new Set<string>(['obsidian', 'emerald', 'coral', 'krait', 'viper', 'albino', 'rainbow', 'ember']);
function skinSet(name: string | null): SkinInfo[] {
  switch (name) {
    case 'snakes': return SKINS.filter((k) => k.kind === 'snake');
    case 'legends': return SKINS.filter((k) => k.kind === 'legend');
    case 'new': return SKINS.filter((k) => k.kind === 'snake' && !OLD_SKINS.has(k.id));
    case 'old': return SKINS.filter((k) => OLD_SKINS.has(k.id));
    default: return SKINS;
  }
}

export function runPreview(params: URLSearchParams) {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.style.margin = '0';
  canvas.style.display = 'block';

  const mode = params.get('mode') ?? 'snake';
  const biome = (params.get('biome') as BiomeId) ?? 'karesansui';
  const quality = (params.get('q') as QualityLevel) ?? 'high';
  const W = +(params.get('w') ?? 28), H = +(params.get('h') ?? 18);
  const zoom = +(params.get('zoom') ?? 1);
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.background = new THREE.Color('#222');

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.copy(LIGHT.sunDir.value).multiplyScalar(30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 0.1; sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x8a7a66, 0.9));

  // ground=checker: a checkered ground to judge refraction (crystal) and transparency
  let groundTex: THREE.Texture | null = null;
  if (params.get('ground') === 'checker') {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#ffffff' : '#8a8a8a'; g.fillRect(x * 8, y * 8, 8, 8); }
    groundTex = new THREE.CanvasTexture(c);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.magFilter = THREE.NearestFilter;
  }
  const plane = (w: number, h: number, color: string, x: number, y: number) => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    if (groundTex) { const t = groundTex.clone(); t.repeat.set(w / 4, h / 4); t.needsUpdate = true; mat.map = t; }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, 0);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  cam.position.set(W / 2, H / 2, 40);
  cam.up.set(0, 1, 0);
  let viewW = W, viewH = H, centre = new THREE.Vector2(W / 2, H / 2);
  const fit = () => {
    renderer.setSize(innerWidth, innerHeight);
    const aspect = innerWidth / innerHeight;
    let vh = viewH / zoom, vw = viewW / zoom;
    if (vw / vh > aspect) vh = vw / aspect; else vw = vh * aspect;
    cam.left = -vw / 2; cam.right = vw / 2; cam.top = vh / 2; cam.bottom = -vh / 2;
    cam.updateProjectionMatrix();
  };
  addEventListener('resize', fit);

  const tick: ((dt: number, t: number) => void)[] = [];
  // heads mode: one viewport per cell, each camera follows that cell's snake head
  const cells: { x: number; y: number; head: () => { x: number; y: number } }[] = [];
  let headZoom = 0, gridCols = 1, gridRows = 1;
  let follow: (() => { x: number; y: number }) | null = null;

  if (mode === 'snake') {
    plane(W + 4, H + 4, sandOf(biome), W / 2, H / 2);
    const world = new FakeWorld(W, H);
    world.skin = (params.get('skin') as SkinId) ?? 'obsidian';
    world.length = +(params.get('length') ?? 14);
    const sv = new SnakeView();
    sv.setQuality(quality);
    sv.debugTongue = params.get('tongue') === '1';
    scene.add(sv.object);
    const pv = new PropsView();
    try { pv.setBiome(biome); } catch { pv.setBiome('karesansui'); }
    pv.setHighContrast(params.get('hc') === '1');
    scene.add(pv.object);
    const ghost = params.get('ghost') === '1';
    const deadAt = params.has('dead') ? +params.get('dead')! : -1;
    const noProps = params.get('props') === '0';
    const cycle = params.get('cycle') === '1';
    let firedK = -1;
    const wrapOff = +(params.get('wrap') ?? 0);
    let wrapBuf: Float32Array | null = null;
    let frozen: Float32Array | null = null; let frozenCount = 0; let deathT = 0;
    let elapsed = 0;
    const step = (dt?: number) => {
      const f = world.frame(dt);
      elapsed += f.dt;
      f.snake.ghost = ghost;
      if (deadAt >= 0 && elapsed > deadAt) {
        if (!frozen) { frozen = new Float32Array(f.snake.points); frozenCount = f.snake.count; }
        deathT += f.dt;
        f.snake.points = frozen; f.snake.count = frozenCount;
        f.snake.alive = false; f.snake.deathT = deathT; f.snake.speed = 0; f.snake.turnRate = 0;
        f.snake.bulges = [];
      }
      if (noProps) { f.foods = []; f.obstacles = []; f.powerups = []; }
      if (wrapOff) {
        const P = f.snake.points;
        if (!wrapBuf || wrapBuf.length < P.length) wrapBuf = new Float32Array(P.length);
        for (let i = 0; i < f.snake.count; i++) {
          wrapBuf[i * 2] = (((P[i * 2] + wrapOff) % W) + W) % W; wrapBuf[i * 2 + 1] = P[i * 2 + 1];
        }
        f.snake.points = wrapBuf;
      }
      if (cycle) {
        // food 1: lives 2.2 s then is eaten; golden 2: expires; powerup: picked up
        const period = 3.0;
        const k = Math.floor(elapsed / period), ph = elapsed - k * period;
        const fd = f.foods[0], gd = f.foods[1], pu = f.powerups[0];
        if (fd) { fd.id = 100 + k; fd.age = ph; }
        if (gd) { gd.id = 500 + k; gd.age = ph; gd.ttl = 2.4 - ph; }
        if (pu) { pu.id = 900 + k; pu.age = ph; pu.ttl = 2.4 - ph; }
        if (ph > 2.4) {
          if (firedK === k) { f.foods = []; f.powerups = []; } else firedK = k;
        }
        if (ph > 2.4 && f.foods.length) {
          if (fd) f.events.push({ type: 'eat', x: fd.x, y: fd.y, kind: 'normal', combo: 1, points: 10, length: 10 });
          if (gd) f.events.push({ type: 'foodExpired', x: gd.x, y: gd.y });
          if (pu) f.events.push({ type: 'powerup', x: pu.x, y: pu.y, kind: pu.kind });
          f.foods = []; f.powerups = [];
        }
      }
      sv.update(f);
      pv.update(f);
      return f;
    };
    const ff = +(params.get('ff') ?? 0);
    for (let i = 0; i < ff; i++) step(1 / 30);
    let lastF: RenderFrame | null = null;
    tick.push(() => { lastF = step(); });
    follow = zoom > 1 && !params.has('cx') ? () => ({ x: lastF ? lastF.snake.points[0] : W / 2, y: lastF ? lastF.snake.points[1] : H / 2 }) : null;
    (window as any).__prev = { world, sv, pv };
  } else if (mode === 'skins' || mode === 'heads') {
    const list = skinSet(params.get('set'));
    const heads = mode === 'heads';
    const cols = +(params.get('cols') ?? (list.length > 16 ? 6 : 4));
    const rows = Math.ceil(list.length / cols);
    const bw = 14, bh = 9;
    viewW = cols * bw; viewH = rows * bh;
    centre.set(viewW / 2, viewH / 2);
    const labels = params.get('labels') !== '0';
    const labelBox = document.createElement('div');
    labelBox.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:600 13px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000';
    document.body.appendChild(labelBox);
    list.forEach((sk, i) => {
      const cx = (i % cols) * bw, cy = (rows - 1 - Math.floor(i / cols)) * bh;
      plane(bw - 0.2, bh - 0.2, sandOf(biome), cx + bw / 2, cy + bh / 2);
      const world = new FakeWorld(bw, bh);
      world.skin = sk.id;
      world.length = +(params.get('length') ?? 9);
      const sv = new SnakeView();
      sv.setQuality(quality);
      sv.object.position.set(cx, cy, 0);
      scene.add(sv.object);
      const warm = +(params.get('ff') ?? (40 + i * 13));
      let lastF: RenderFrame | null = null;
      for (let k = 0; k < warm; k++) { lastF = world.frame(1 / 30); sv.update(lastF); }
      const gridGhost = params.get('ghost') === '1';
      tick.push(() => { const f = world.frame(); f.foods = []; f.snake.ghost = gridGhost; lastF = f; sv.update(f); });
      if (labels) {
        const el = document.createElement('div');
        el.textContent = sk.name + (sk.kind === 'legend' ? ' (legend)' : '');
        el.style.position = 'absolute';
        el.style.left = `${((i % cols) / cols) * 100}%`;
        el.style.top = `${(Math.floor(i / cols) / rows) * 100}%`;
        el.style.padding = '6px 8px';
        labelBox.appendChild(el);
      }
      cells.push({ x: cx, y: cy, head: () => (lastF ? { x: cx + lastF.snake.points[0], y: cy + lastF.snake.points[1] } : { x: cx + bw / 2, y: cy + bh / 2 }) });
    });
    if (heads) {
      headZoom = +(params.get('zoom') ?? 5);
      gridCols = cols; gridRows = rows;
    }
  } else if (mode === 'props') {
    const rowH = 3.2, cols = 12;
    viewW = cols * 1.6 + 1; viewH = BIOMES.length * rowH;
    centre.set(viewW / 2, viewH / 2);
    const kinds: PowerupKind[] = ['slow', 'ghost', 'magnet', 'double', 'shed'];
    BIOMES.forEach((b, bi) => {
      const y0 = (BIOMES.length - 1 - bi) * rowH;
      plane(viewW, rowH - 0.1, sandOf(b), viewW / 2, y0 + rowH / 2);
      const pv = new PropsView();
      pv.setBiome(b);
      pv.setHighContrast(params.get('hc') === '1');
      scene.add(pv.object);
      const cy = y0 + rowH / 2;
      let t0 = 0;
      tick.push((dt, t) => {
        t0 += dt;
        const f = {
          time: t, dt, boardW: viewW, boardH: viewH,
          snake: { points: new Float32Array(4), count: 0, spacing: 0.1, radius: 0.34, dirX: 1, dirY: 0, speed: 0, turnRate: 0, bulges: [], alive: true, deathT: 0, interest: 0, ghost: false, skin: 'obsidian', length: 0 },
          foods: [
            { id: 1, kind: 'normal', x: 1.2, y: cy, age: t0, ttl: Infinity },
            { id: 2, kind: 'golden', x: 2.8, y: cy, age: t0, ttl: params.get('blink') === '1' ? 1.5 : 6 },
          ],
          obstacles: [
            { id: 1, x: 4.7, y: cy, r: 0.5, cells: [[4, Math.floor(cy)]], seed: 11 + bi, vx: 0, vy: 0 },
            { id: 2, x: 7.0, y: cy, r: 1.05, cells: [[6, Math.floor(cy) - 1], [7, Math.floor(cy) - 1], [6, Math.floor(cy)], [7, Math.floor(cy)]], seed: 29 + bi * 3, vx: 0, vy: 0 },
            { id: 3, x: 9.2, y: cy, r: 0.42, cells: [], seed: 5 + bi, vx: 2.2, vy: 0 },
          ],
          powerups: kinds.map((k, i) => ({ id: 10 + i, kind: k, x: 10.8 + i * 1.6, y: cy, age: t0, ttl: 8 })),
          effects: { timeScale: 1, ghost: 0, magnet: 0, double: 0, slow: 0 },
          events: [], intensity: 0, shake: 0, paused: false,
        } as unknown as RenderFrame;
        f.obstacles[2].x = 9.2; // stays in place but "rolls" (vx) for the preview
        pv.update(f);
      });
    });
    viewW = 10.8 + 5 * 1.6 + 0.2;
    centre.set(viewW / 2, viewH / 2);
  }

  if (params.has('cx')) centre.set(+params.get('cx')!, +params.get('cy')!);
  fit();
  let last = performance.now();
  const t0 = last;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const fn of tick) fn(dt, (now - t0) / 1000);
    if (headZoom > 0) {
      // grid of head close-ups
      const cw = innerWidth / gridCols, ch = innerHeight / gridRows;
      const hh = 9 / headZoom / 2, hw = hh * (cw / ch);
      renderer.setScissorTest(true);
      renderer.setClearColor('#111');
      renderer.clear();
      cells.forEach((cell, i) => {
        const col = i % gridCols, row = Math.floor(i / gridCols);
        const vx = col * cw, vy = (gridRows - 1 - row) * ch;
        renderer.setViewport(vx + 1, vy + 1, cw - 2, ch - 2);
        renderer.setScissor(vx + 1, vy + 1, cw - 2, ch - 2);
        const h = cell.head();
        cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
        cam.updateProjectionMatrix();
        cam.position.set(h.x, h.y, 40);
        cam.lookAt(h.x, h.y, 0);
        sun.target.position.set(h.x, h.y, 0);
        sun.position.set(h.x, h.y, 0).addScaledVector(LIGHT.sunDir.value, 30);
        renderer.render(scene, cam);
      });
      renderer.setScissorTest(false);
      requestAnimationFrame(loop);
      return;
    }
    const c = follow ? follow() : centre;
    cam.position.set(c.x, c.y, 40);
    cam.lookAt(c.x, c.y, 0);
    sun.target.position.set(c.x, c.y, 0);
    sun.position.set(c.x, c.y, 0).addScaledVector(LIGHT.sunDir.value, 30);
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
}
