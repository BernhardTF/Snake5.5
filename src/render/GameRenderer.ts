// GameRenderer: orchestrates the sand simulation, biome materials, frame, shadows, particles,
// snake/props views and post-processing. Implements the IGameRenderer contract.
import * as THREE from 'three';
import type { BiomeId, QualityLevel, RenderFrame, SkinId } from '../types';
import type { IGameRenderer, RenderOptions } from './contract';
import { LIGHT } from './lighting';
import { BIOME_COUNT, BIOME_VISUALS, lin, type BiomeVisual } from './biomeVisuals';
import { DeformSim } from './sand/DeformSim';
import { makeSandMaterial, MAX_CENTERS } from './sand/sandShader';
import { makeFrameMaterial } from './frame/frameShader';
import { ContactShadows } from './shadow/ContactShadows';
import { Cookie } from './shadow/Cookie';
import { Environment } from './env';
import { Particles } from './particles/Particles';
import { PostFX } from './post/PostFX';
import { SnakeView } from './snake/SnakeView';
import { PropsView } from './props/PropsView';

/** Frame border width in cells (visible thickness of the culturally themed rim). */
export const FRAME_BORDER = 1.0;
/** World-space z of the frame top (things below it are hidden outside the board). */
export const FRAME_Z = 0.9;

interface QualityPreset {
  simRes: number; shadowRes: number; scale: number; dprCap: number;
  post: boolean; bloom: boolean; dof: boolean; grain: boolean; particles: number; samples: number;
}
const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { simRes: 384, shadowRes: 160, scale: 0.6, dprCap: 2, post: false, bloom: false, dof: false, grain: false, particles: 0.25, samples: 0 },
  medium: { simRes: 512, shadowRes: 200, scale: 0.8, dprCap: 2, post: true, bloom: false, dof: false, grain: false, particles: 0.5, samples: 0 },
  high: { simRes: 768, shadowRes: 256, scale: 1.0, dprCap: 1.5, post: true, bloom: true, dof: false, grain: false, particles: 1.0, samples: 4 },
  ultra: { simRes: 1024, shadowRes: 320, scale: 1.0, dprCap: 2, post: true, bloom: true, dof: true, grain: true, particles: 1.5, samples: 4 },
};

/** Per-biome sand pattern relief (uPatAmp) and frame-lip height (rim shadow on the sand). */
const PAT_AMP: Record<BiomeId, number> = {
  karesansui: 0.055, erg: 0.04, lagoon: 0.05, svartsandur: 0.04, salar: 0.03,
  pinksands: 0.045, vaadhoo: 0.04, dallol: 0.05, luna: 0.03, mars: 0.035, titan: 0.03, kepler: 0.065,
};
const FRAME_H: Record<BiomeId, number> = {
  karesansui: 0.32, erg: 0.36, lagoon: 0.3, svartsandur: 0.42, salar: 0.14,
  pinksands: 0.28, vaadhoo: 0.3, dallol: 0.3, luna: 0.34, mars: 0.36, titan: 0.3, kepler: 0.34,
};

const AURORA = [new THREE.Color(0.1, 0.95, 0.5), new THREE.Color(0.05, 0.75, 0.85), new THREE.Color(0.55, 0.2, 0.95)];

export class GameRenderer implements IGameRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private sim = new DeformSim();
  private shadows = new ContactShadows();
  private cookie = new Cookie();
  private env: Environment;
  private particles = new Particles();
  private post = new PostFX();
  private snakeView: SnakeView;
  private propsView: PropsView;
  private sandMesh: THREE.Mesh;
  private frameMesh: THREE.Mesh;
  private sandMats: THREE.ShaderMaterial[] = [];
  private frameMats: THREE.ShaderMaterial[] = [];
  private sandU: Record<string, THREE.IUniform>;
  private frameU: Record<string, THREE.IUniform>;
  private centers: THREE.Vector4[] = [];
  private biome: BiomeVisual = BIOME_VISUALS.karesansui;
  private opts: RenderOptions = {
    quality: 'high', renderScale: 1, bloom: true, dof: true, particles: true, reducedMotion: false, highContrastFood: false,
  };
  private preset: QualityPreset = PRESETS.high;
  private W = 28; private H = 18;
  private cssW = 1; private cssH = 1; private dpr = 1;
  private ppu = 40; // css px per world unit
  private view = { left: 0, right: 1, top: 1, bottom: 0 };
  private lastSkin: SkinId | null = null;
  private lastFrame: RenderFrame | null = null;
  private lastNow = 0;
  private _frameMs = 16.7;
  private postTargetCompiled: boolean | null = null;
  private auroraC = new THREE.Color();
  private baseSky = new THREE.Color();
  private deathFade = 0;
  private disposed = false;
  private drewThisTask = false;
  private simDt = 0;
  private biomeReady = false;
  private boardReady = false;
  private resetTask = () => { this.drewThisTask = false; };

  get frameMs() { return this._frameMs; }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
      preserveDrawingBuffer: false, stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x14100c, 1);
    this.renderer.autoClear = true;

    this.camera.up.set(0, 1, 0);
    this.camera.position.set(0, 0, 50);
    this.camera.lookAt(0, 0, 0);

    for (let i = 0; i < MAX_CENTERS; i++) this.centers.push(new THREE.Vector4());

    const common = {
      uSunDir: LIGHT.sunDir, uSunColor: LIGHT.sunColor, uSkyColor: LIGHT.skyColor, uGroundColor: LIGHT.groundColor,
      uSun2Dir: LIGHT.sun2Dir, uSun2Color: LIGHT.sun2Color,
      uTime: LIGHT.time,
      uCookie: { value: this.cookie.texture }, uCookieRegion: { value: this.cookie.region },
      uBoard: { value: new THREE.Vector2(this.W, this.H) },
      uWave: { value: this.sim.wave },
      uFrameH: { value: 0.3 },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    };
    this.sandU = {
      ...common,
      uDeform: { value: null }, uRegion: { value: this.sim.region }, uTexel: { value: this.sim.texel },
      uShadow: { value: this.shadows.texture },
      uDepth: { value: 0.17 }, uPatAmp: { value: 0.045 },
      uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uColC: { value: new THREE.Color() },
      uCenters: { value: this.centers }, uCenterCount: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uAurora: { value: new THREE.Color(0, 0, 0) },
      uDevils: { value: this.sim.devils },
      uShadowK: { value: 0.82 },
      uDebug: { value: 0 },
    };
    this.frameU = { ...common, uBorder: { value: FRAME_BORDER } };
    for (let b = 0; b < BIOME_COUNT; b++) {
      this.sandMats.push(makeSandMaterial(b, this.sandU));
      this.frameMats.push(makeFrameMaterial(b, this.frameU));
    }
    this.sandMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.sandMats[0]);
    this.sandMesh.frustumCulled = false;
    this.sandMesh.renderOrder = 5; // drawn after snake/props/frame so early-z skips hidden sand
    this.frameMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.frameMats[0]);
    this.frameMesh.position.z = FRAME_Z;
    this.frameMesh.frustumCulled = false;
    this.frameMesh.renderOrder = 4;
    this.scene.add(this.sandMesh, this.frameMesh);

    this.env = new Environment(this.renderer, this.scene);
    this.snakeView = new SnakeView();
    this.propsView = new PropsView();
    this.scene.add(this.snakeView.object, this.propsView.object, this.particles.object);
    this.shadows.setRoots(this.snakeView.object, this.propsView.object);

    this.applyQuality();
    this.setBoard(this.W, this.H);
    this.setBiome('karesansui');
    this.resize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, Math.min(2, devicePixelRatio || 1));
  }

  // ------------------------------------------------------------------ contract

  setOptions(o: RenderOptions) {
    const qChanged = o.quality !== this.opts.quality;
    this.opts = { ...o };
    this.applyQuality(qChanged);
    this.propsView.setHighContrast(o.highContrastFood);
    this.resize(this.cssW, this.cssH, this.dpr);
  }

  setBiome(id: BiomeId) {
    if (this.biomeReady && id === this.biome.id) { this.clearSand(); return; }
    this.biomeReady = true;
    const v = BIOME_VISUALS[id];
    this.biome = v;
    this.sandMesh.material = this.sandMats[v.index];
    this.frameMesh.material = this.frameMats[v.index];
    LIGHT.sunDir.value.set(...v.sunDir).normalize();
    LIGHT.sunColor.value.setRGB(...v.sun);
    LIGHT.skyColor.value.setRGB(...v.sky);
    LIGHT.groundColor.value.setRGB(...v.ground);
    if (v.sun2 && v.sun2Dir) {
      LIGHT.sun2Dir.value.set(...v.sun2Dir).normalize();
      LIGHT.sun2Color.value.setRGB(...v.sun2);
    } else LIGHT.sun2Color.value.setRGB(0, 0, 0);
    this.shadows.softness = v.shadow?.soft ?? 1;
    this.baseSky.copy(LIGHT.skyColor.value);
    const u = this.sandU;
    (u.uColA.value as THREE.Color).copy(lin(v.sandA));
    (u.uColB.value as THREE.Color).copy(lin(v.sandB));
    (u.uColC.value as THREE.Color).copy(lin(v.sandC));
    (u.uZenith.value as THREE.Color).copy(lin(v.env.zenith));
    (u.uHorizon.value as THREE.Color).copy(lin(v.env.horizon));
    (u.uWind.value as THREE.Vector2).set(v.sim.windX || 1, v.sim.windY || 0);
    u.uDepth.value = v.depthScale;
    u.uPatAmp.value = PAT_AMP[id];
    u.uShadowK.value = v.shadow?.dark ?? 0.82;
    this.frameU.uFrameH.value = FRAME_H[id];
    this.sim.setBiome(id);
    this.propsView.setBiome(id);
    this.particles.setBiome(id);
    this.env.setBiome(v, this.scene);
    this.cookie.build(this.renderer, v.index, this.W, this.H);
    this.renderer.setClearColor(0x14100c, 1);
  }

  setBoard(w: number, h: number) {
    if (this.boardReady && w === this.W && h === this.H) { this.clearSand(); this.fitCamera(); return; }
    this.boardReady = true;
    this.W = w; this.H = h;
    this.sim.setBoard(w, h);
    this.shadows.configure(this.sim.region, this.preset.shadowRes);
    (this.sandU.uBoard.value as THREE.Vector2).set(w, h);
    this.sandMesh.scale.set(w, h, 1);
    this.sandMesh.position.set(w / 2, h / 2, 0);
    this.particles.setBoard(w, h);
    this.particles.clear();
    this.cookie.build(this.renderer, this.biome.index, w, h);
    this.fitCamera();
  }

  clearSand() {
    this.sim.clear();
    this.particles.clear();
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = Math.max(1, cssW); this.cssH = Math.max(1, cssH); this.dpr = dpr;
    const pr = Math.min(dpr, this.preset.dprCap) * this.opts.renderScale * this.preset.scale;
    this.renderer.setPixelRatio(Math.max(0.25, pr));
    this.renderer.setSize(this.cssW, this.cssH, true);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
    this.fitCamera();
    // resizing clears the drawing buffer: redraw the last frame right away (no black flash)
    if (this.lastFrame && !this.disposed) this.draw(this.lastFrame, true);
  }

  boardRect() {
    return {
      x: (0 - this.view.left) * this.ppu,
      y: (this.view.top - this.H) * this.ppu,
      w: this.W * this.ppu,
      h: this.H * this.ppu,
    };
  }

  screenToWorld(px: number, py: number) {
    return { x: this.view.left + px / this.ppu, y: this.view.top - py / this.ppu };
  }

  patternCoverage() { return this.sim.coverage(); }

  snapshot(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (this.lastFrame) this.draw(this.lastFrame, true);
      try { this.canvas.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); }
    });
  }

  render(frame: RenderFrame) {
    if (this.disposed) return;
    if (!this.drewThisTask) {
      // frame-to-frame CPU time (catch-up calls within one task are not frames)
      const now = performance.now();
      if (this.lastNow) {
        const d = Math.min(250, now - this.lastNow);
        this._frameMs = this._frameMs * 0.94 + d * 0.06;
      }
      this.lastNow = now;
    }
    if (frame.boardW !== this.W || frame.boardH !== this.H) this.setBoard(frame.boardW, frame.boardH);
    this.lastFrame = frame;
    // Several render() calls inside one task (catch-up / fast-forward) only need one visible draw:
    // the extra calls still advance the sand simulation and views.
    const skipDraw = this.drewThisTask;
    if (!this.drewThisTask) {
      this.drewThisTask = true;
      queueMicrotask(this.resetTask);
    }
    this.draw(frame, false, skipDraw);
  }

  dispose() {
    this.disposed = true;
    this.sim.dispose(); this.shadows.dispose(); this.cookie.dispose(); this.env.dispose();
    this.particles.dispose(); this.post.dispose();
    this.snakeView.dispose(); this.propsView.dispose();
    for (const m of [...this.sandMats, ...this.frameMats]) m.dispose();
    this.sandMesh.geometry.dispose(); this.frameMesh.geometry.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ internals

  private applyQuality(force = false) {
    const p = PRESETS[this.opts.quality] ?? PRESETS.high;
    const changed = p !== this.preset || force;
    this.preset = p;
    this.sim.setResolution(p.simRes, this.renderer);
    if (changed) this.shadows.configure(this.sim.region, p.shadowRes);
    this.post.configure(p.post, p.post && p.bloom && this.opts.bloom, p.post && p.dof && this.opts.dof, p.post && p.grain, p.samples);
    this.particles.enabled = this.opts.particles;
    this.particles.multiplier = p.particles;
    this.precompile();
  }

  /** Compile all biome materials for the current render path so biome switches never hitch. */
  private precompile() {
    const usePost = this.post.enabled;
    if (this.postTargetCompiled === usePost) return;
    this.postTargetCompiled = usePost;
    const r = this.renderer;
    const sm = this.sandMesh.material, fm = this.frameMesh.material;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(this.post.target);
    for (let b = 0; b < BIOME_COUNT; b++) {
      this.sandMesh.material = this.sandMats[b];
      this.frameMesh.material = this.frameMats[b];
      r.compile(this.scene, this.camera);
    }
    r.setRenderTarget(prevTarget);
    this.sandMesh.material = sm; this.frameMesh.material = fm;
    this.sim.compile(r);
    this.post.compile(r);
  }

  private fitCamera() {
    const b = FRAME_BORDER;
    const W = this.W, H = this.H;
    this.ppu = Math.min(this.cssW / (W + 2 * b), this.cssH / (H + 2 * b));
    const hw = this.cssW / this.ppu / 2, hh = this.cssH / this.ppu / 2;
    this.view.left = W / 2 - hw; this.view.right = W / 2 + hw;
    this.view.top = H / 2 + hh; this.view.bottom = H / 2 - hh;
    this.camera.left = -hw; this.camera.right = hw; this.camera.top = hh; this.camera.bottom = -hh;
    this.camera.position.set(W / 2, H / 2, 50);
    this.camera.updateProjectionMatrix();
    this.frameMesh.scale.set(hw * 2 + 4, hh * 2 + 4, 1);
    this.frameMesh.position.set(W / 2, H / 2, FRAME_Z);
    this.particles.setPixelsPerUnit(this.ppu * this.renderer.getPixelRatio());
  }

  private updateCenters(f: RenderFrame) {
    let n = 0;
    for (const o of f.obstacles) {
      if (n >= MAX_CENTERS) break;
      this.centers[n++].set(o.x, o.y, o.r * 0.95, 4);
    }
    for (const fd of f.foods) {
      if (n >= MAX_CENTERS) break;
      const grow = Math.min(1, Math.max(0, fd.age / 1.4));
      this.centers[n++].set(fd.x, fd.y, 0.3, 3 * (1 - Math.pow(1 - grow, 3)));
    }
    this.sandU.uCenterCount.value = n;
  }

  private draw(f: RenderFrame, snapshot: boolean, simOnly = false) {
    const r = this.renderer;
    const dt = snapshot ? 0 : Math.min(0.1, Math.max(0, f.dt));
    LIGHT.time.value = f.time;
    const s = f.snake;
    if (!s.alive) this.deathFade = Math.min(1, s.deathT / 1.0);
    else this.deathFade = Math.max(0, this.deathFade - dt * 1.5);
    LIGHT.deathFade.value = this.deathFade;

    // biome-animated light (aurora)
    if (this.biome.id === 'svartsandur') {
      const k = (f.time / 12) % 3;
      const i0 = Math.floor(k), fr = k - i0;
      this.auroraC.copy(AURORA[i0]).lerp(AURORA[(i0 + 1) % 3], fr * fr * (3 - 2 * fr));
      (this.sandU.uAurora.value as THREE.Color).copy(this.auroraC).multiplyScalar(0.16);
      LIGHT.skyColor.value.copy(this.baseSky).lerp(this.auroraC, 0.18);
    }
    this.env.sync(LIGHT.sunDir.value, LIGHT.sunColor.value, LIGHT.skyColor.value, LIGHT.groundColor.value, this.W / 2, this.H / 2);

    if (s.skin !== this.lastSkin) { this.lastSkin = s.skin; this.snakeView.setSkin(s.skin); }
    this.snakeView.update(f);
    this.propsView.update(f);
    this.updateCenters(f);

    if (!snapshot && !f.paused) {
      this.sim.ingest(f);
      this.simDt += dt;
      // catch-up frames (several render() calls in one task) batch their stamps into fewer passes
      if (!simOnly || this.sim.pending >= 12 || this.simDt >= 0.3) {
        this.sim.step(r, this.simDt, f.time);
        this.simDt = 0;
      }
    }
    this.sandU.uDeform.value = this.sim.texture;
    if (simOnly) {
      this.particles.update(f, dt, this.sim.wave.x, this.sim.wave.w);
      return;
    }

    this.shadows.render(r, this.scene, [this.sandMesh, this.frameMesh, this.particles.object]);
    this.sandU.uShadow.value = this.shadows.texture;
    this.sandU.uCookie.value = this.cookie.texture;
    this.frameU.uCookie.value = this.cookie.texture;

    if (!snapshot) this.particles.update(f, dt, this.sim.wave.x, this.sim.wave.w);

    // camera shake
    let sx = 0, sy = 0;
    if (!this.opts.reducedMotion && f.shake > 0) {
      const t = f.time;
      const a = f.shake * 0.35;
      sx = (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 23.1 + 1.7) * 0.4) * a;
      sy = (Math.sin(t * 41.7 + 0.5) * 0.6 + Math.sin(t * 29.3 + 2.9) * 0.4) * a;
    }
    this.camera.position.set(this.W / 2 + sx, this.H / 2 + sy, 50);

    // render
    const target = this.post.target;
    r.setRenderTarget(target);
    r.clear();
    r.render(this.scene, this.camera);
    if (this.post.enabled) {
      const g = this.biome.grade;
      const bl = this.biome.bloom;
      this.post.apply(r, {
        exposure: g.exposure, sat: g.sat, contrast: g.contrast, vignette: g.vignette,
        lift: g.lift, gamma: g.gamma, gain: g.gain,
        bloomThreshold: bl.threshold, bloomStrength: bl.strength, bloomRadius: bl.radius,
        death: this.deathFade * 0.9,
        pulse: !s.alive && s.deathT < 1.2 ? Math.sin(Math.PI * s.deathT / 1.2) : 0,
        slow: f.effects.timeScale < 1 ? Math.min(1, (1 - f.effects.timeScale) * 2) : 0,
        time: f.time,
      });
    }
    r.setRenderTarget(null);
  }
}
