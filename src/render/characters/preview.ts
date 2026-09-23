// Isolated preview for the Legend characters (?dev=legend&...).
//   id=centipede|eel|dragon|mecha|train|comet|all   length=14  zoom=1  ghost=1  dead=<sec>
//   eat=<sec between eat events>  ff=<frames>  biome=<id>  wrap=<x offset>  bloom=0  cx,cy  w,h
//   paused=1 (freeze after ff)  props=0
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FakeWorld } from '../../dev/fakeFrame';
import { LIGHT } from '../lighting';
import { createCharacter } from './index';
import type { ICharacterView } from './contract';
import type { CharacterId, RenderFrame } from '../../types';

const SAND: Record<string, string> = {
  karesansui: '#d6cdbd', erg: '#d98f4e', lagoon: '#a88468', svartsandur: '#2a2a2c', salar: '#e8e6e2',
  pinksands: '#e9c3bd', vaadhoo: '#3a3f4a', dallol: '#d8c84a', luna: '#8d8d8d', mars: '#b8683a', titan: '#4a3525', kepler: '#9a86c0',
};
const IDS: CharacterId[] = ['centipede', 'eel', 'dragon', 'mecha', 'train', 'comet'];

export function runLegendPreview(params: URLSearchParams) {
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

  const id = (params.get('id') ?? 'centipede') as CharacterId | 'all';
  const biome = params.get('biome') ?? 'karesansui';
  const zoom = +(params.get('zoom') ?? 1);
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.background = new THREE.Color('#222');

  const night = biome === 'vaadhoo' || params.get('night') === '1';
  const sun = new THREE.DirectionalLight(night ? 0x9fb4ff : 0xfff1dc, night ? 0.7 : 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 0.1, far: 80 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(night ? 0x405080 : 0xb8c4d8, night ? 0x202030 : 0x8a7a66, night ? 0.35 : 0.9));
  if (night) { LIGHT.sunColor.value.setRGB(0.35, 0.42, 0.7); LIGHT.skyColor.value.setRGB(0.12, 0.16, 0.3); }

  const views: { v: ICharacterView; world: FakeWorld; ox: number; oy: number }[] = [];
  const W = +(params.get('w') ?? 28), H = +(params.get('h') ?? 18);
  let viewW = W, viewH = H;
  const centre = new THREE.Vector2(W / 2, H / 2);
  const plane = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: SAND[biome] ?? '#d6cdbd', roughness: 0.95 }));
    m.position.set(x, y, 0); m.receiveShadow = true; scene.add(m);
  };
  const list = id === 'all' ? IDS : [id];
  const cols = id === 'all' ? 3 : 1;
  const bw = id === 'all' ? 14 : W, bh = id === 'all' ? 9 : H;
  if (id === 'all') { viewW = cols * bw; viewH = 2 * bh; centre.set(viewW / 2, viewH / 2); }
  list.forEach((cid, i) => {
    const ox = (i % cols) * bw, oy = id === 'all' ? (1 - Math.floor(i / cols)) * bh : 0;
    plane(bw - (id === 'all' ? 0.2 : -4), bh - (id === 'all' ? 0.2 : -4), ox + bw / 2, oy + bh / 2);
    const world = new FakeWorld(bw, bh);
    world.skin = cid;
    world.length = +(params.get('length') ?? (id === 'all' ? 9 : 14));
    const v = createCharacter(cid);
    if (!v) return;
    v.object.position.set(ox, oy, 0);
    scene.add(v.object);
    views.push({ v, world, ox, oy });
  });

  const ghost = params.get('ghost') === '1';
  const deadAt = params.has('dead') ? +params.get('dead')! : -1;
  const wrapOff = +(params.get('wrap') ?? 0);
  const noProps = params.get('props') !== '1';
  const state = views.map(() => ({ frozen: null as Float32Array | null, count: 0, deathT: 0, elapsed: 0, wrapBuf: null as Float32Array | null }));
  let last: RenderFrame | null = null;
  const step = (dt?: number) => {
    views.forEach(({ v, world }, i) => {
      const st = state[i];
      const f = world.frame(dt);
      st.elapsed += f.dt;
      f.snake.ghost = ghost;
      if (deadAt >= 0 && st.elapsed > deadAt) {
        if (!st.frozen) { st.frozen = new Float32Array(f.snake.points); st.count = f.snake.count; f.events.push({ type: 'death', x: 0, y: 0, cause: 'self' }); }
        st.deathT += f.dt;
        f.snake.points = st.frozen; f.snake.count = st.count;
        f.snake.alive = false; f.snake.deathT = st.deathT; f.snake.speed = 0; f.snake.turnRate = 0;
        f.snake.bulges = [];
      }
      if (wrapOff) {
        const P = f.snake.points;
        if (!st.wrapBuf || st.wrapBuf.length < P.length) st.wrapBuf = new Float32Array(P.length);
        for (let k = 0; k < f.snake.count; k++) {
          st.wrapBuf[k * 2] = (((P[k * 2] + wrapOff) % bw) + bw) % bw; st.wrapBuf[k * 2 + 1] = P[k * 2 + 1];
        }
        f.snake.points = st.wrapBuf;
      }
      if (noProps) { f.foods = []; f.obstacles = []; f.powerups = []; }
      v.update(f);
      if (i === 0) last = f;
    });
  };
  const ff = +(params.get('ff') ?? 0);
  for (let i = 0; i < ff; i++) step(1 / 30);
  const paused = params.get('paused') === '1';

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  cam.up.set(0, 1, 0);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const useBloom = params.get('bloom') !== '0';
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.6, 1.0);
  if (useBloom) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fit = () => {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    const aspect = innerWidth / innerHeight;
    let vh = viewH / zoom, vw = viewW / zoom;
    if (vw / vh > aspect) vh = vw / aspect; else vw = vh * aspect;
    cam.left = -vw / 2; cam.right = vw / 2; cam.top = vh / 2; cam.bottom = -vh / 2;
    cam.updateProjectionMatrix();
  };
  addEventListener('resize', fit);
  if (params.has('cx')) centre.set(+params.get('cx')!, +params.get('cy')!);
  fit();
  const follow = zoom > 1 && !params.has('cx') && id !== 'all';
  // optional look-ahead offset for close-ups: &ahead=cells behind the head to centre on
  const ahead = +(params.get('ahead') ?? 0);
  let lastT = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    LIGHT.time.value += dt;
    if (!paused) step();
    let cx = centre.x, cy = centre.y;
    const lf = last as RenderFrame | null;
    if (follow && lf) {
      const P = lf.snake.points;
      const k = Math.min(lf.snake.count - 1, Math.round(ahead / lf.snake.spacing));
      cx = P[k * 2]; cy = P[k * 2 + 1];
    }
    cam.position.set(cx, cy, 40); cam.lookAt(cx, cy, 0);
    sun.target.position.set(cx, cy, 0);
    sun.position.set(cx, cy, 0).addScaledVector(LIGHT.sunDir.value, 30);
    composer.render();
    requestAnimationFrame(loop);
  };
  loop();
  (window as any).__legend = { views, scene, renderer };
}
