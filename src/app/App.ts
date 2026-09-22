// Application glue: state machine, main loop, persistence of results.
import { GameRenderer } from '../render/GameRenderer';
import type { RenderOptions } from '../render/contract';
import { AudioEngine } from '../audio/AudioEngine';
import { UI } from '../ui/UI';
import type { StartRequest, UIHost } from '../ui/contract';
import type { UiSound } from '../audio/contract';
import { Input, haptic } from '../input/Input';
import { Sim, type Dir } from '../game/Sim';
import { Attract } from './Attract';
import { store, bestKey, todayKey, type Settings } from '../core/storage';
import { hashString } from '../core/rng';
import { ACHIEVEMENTS } from '../game/achievements';
import { levelFromXp, levelProgress, unlocksBetween } from '../game/progression';
import { SKINS } from '../skins/skins';
import type { BiomeId, GameConfig, GameEvent, QualityLevel, RunResult, SkinId } from '../types';

type State = 'menu' | 'countdown' | 'playing' | 'paused' | 'over';
const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const IS_TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const POWERUP_LABEL: Record<string, string> = {
  slow: 'SLOW TIME', ghost: 'GHOST', magnet: 'MAGNET', double: 'DOUBLE SCORE', shed: 'SHED SKIN',
};

export class App implements UIHost {
  private canvas = document.getElementById('game') as HTMLCanvasElement;
  private renderer: GameRenderer;
  private audio = new AudioEngine();
  private ui: UI;
  private input: Input;

  private state: State = 'menu';
  private sim: Sim | null = null;
  private attract: Attract;
  private lastReq: StartRequest | null = null;
  private biome: BiomeId;
  private previewSkinId: SkinId;
  private boardW = 28;
  private boardH = 18;

  private autoQuality: QualityLevel;
  private slowFor = 0;
  private fastFor = 0;
  private runTime = 0;
  private fpsTimer = 0;
  private lastT = performance.now();
  private startT = performance.now();
  private hudPattern = 0;
  private patternTimer = 0;
  private pendingEvents: GameEvent[] = [];

  constructor() {
    const s = store.settings;
    this.biome = s.lastBiome;
    this.previewSkinId = s.skin;
    this.autoQuality = IS_TOUCH ? 'medium' : 'high';
    this.renderer = new GameRenderer(this.canvas);
    this.renderer.setOptions(this.renderOptions());
    this.computeBoard();
    this.renderer.setBiome(this.biome);
    this.renderer.setBoard(this.boardW, this.boardH);
    this.ui = new UI(document.getElementById('ui')!, this);
    this.input = new Input(
      this.canvas,
      {
        dir: (d: Dir) => this.sim?.inputDir(d),
        steer: (v) => this.sim?.inputSteer(v),
        target: (a) => this.sim?.inputTargetAngle(a),
        pointer: (px, py) => this.pointerSteer(px, py),
        pause: () => {
          if (this.state === 'playing') this.pause();
          else if (this.state === 'paused') this.resume();
        },
      },
      () => store.settings,
      () => this.state !== 'playing',
    );
    this.attract = new Attract(this.biome, this.previewSkinId, this.boardW, this.boardH);
    this.applyAudioSettings();
    this.audio.setBiome(this.biome);
    this.audio.setScene('menu');

    // unlock/recover audio on every gesture (iOS can interrupt the context)
    const unlock = () => this.audio.unlock();
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
    addEventListener('resize', this.onResize);
    addEventListener('orientationchange', this.onResize);
    this.onResize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing' || this.state === 'countdown') this.pause();
        this.audio.suspend();
      } else this.audio.resume();
    });

    this.ui.show('title');
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ settings

  private currentQuality(): QualityLevel {
    const q = store.settings.quality;
    return q === 'auto' ? this.autoQuality : q;
  }

  private renderOptions(): RenderOptions {
    const s = store.settings;
    return {
      quality: this.currentQuality(),
      renderScale: s.renderScale,
      bloom: s.bloom,
      dof: s.dof,
      particles: s.particles,
      reducedMotion: s.reducedMotion,
      highContrastFood: s.highContrastFood,
    };
  }

  private applyAudioSettings() {
    const s = store.settings;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume, s.muted);
  }

  settingsChanged(_s: Settings) {
    this.renderer.setOptions(this.renderOptions());
    this.applyAudioSettings();
    this.updateTouchControls();
    if (!store.settings.showFps) this.ui.setFps(null);
  }

  private computeBoard() {
    const w = innerWidth, h = innerHeight;
    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
    const short = 18;
    const long = Math.max(short, Math.min(34, Math.round(short * aspect * 0.96)));
    if (w >= h) {
      this.boardW = long;
      this.boardH = short;
    } else {
      this.boardW = short;
      this.boardH = long;
    }
  }

  private onResize = () => {
    this.renderer.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
    // In menus the board follows the screen orientation; during a run it stays fixed.
    if (this.state === 'menu') {
      const [w, h] = [this.boardW, this.boardH];
      this.computeBoard();
      if (w !== this.boardW || h !== this.boardH) {
        this.renderer.setBoard(this.boardW, this.boardH);
        this.attract = new Attract(this.biome, this.previewSkinId, this.boardW, this.boardH);
      }
    }
  };

  // ------------------------------------------------------------------ UIHost

  userGesture() {
    this.audio.unlock();
    this.applyAudioSettings();
  }

  sound(s: UiSound) {
    this.audio.ui(s);
  }

  previewBiome(id: BiomeId) {
    if (id === this.biome) return;
    this.biome = id;
    this.renderer.setBiome(id);
    this.audio.setBiome(id);
    this.attract = new Attract(id, this.previewSkinId, this.boardW, this.boardH);
  }

  previewSkin(id: SkinId) {
    this.previewSkinId = id;
  }

  startGame(req: StartRequest) {
    this.lastReq = { ...req };
    store.saveSettings({ lastMode: req.mode, lastMovement: req.movement, lastBiome: req.biome, skin: req.skin });
    this.computeBoard();
    const daily = req.mode === 'daily';
    const cfg: GameConfig = {
      mode: req.mode,
      movement: req.movement,
      biome: daily ? this.dailyBiome() : req.biome,
      skin: req.skin,
      seed: daily ? hashString('serpent-sands:' + todayKey()) : (Math.random() * 2 ** 31) | 0,
      boardW: this.boardW,
      boardH: this.boardH,
    };
    // daily seed boards use a fixed size so everybody gets the same layout
    if (daily) {
      cfg.boardW = innerWidth >= innerHeight ? 30 : 18;
      cfg.boardH = innerWidth >= innerHeight ? 18 : 30;
    }
    const best = daily
      ? store.profile.daily[todayKey()] ?? 0
      : store.profile.bests[bestKey(cfg.mode, cfg.biome, cfg.movement)] ?? 0;
    this.sim = new Sim(cfg, best);
    this.previewSkinId = req.skin;
    if (cfg.biome !== this.biome) {
      this.biome = cfg.biome;
      this.audio.setBiome(cfg.biome);
    }
    this.renderer.setBiome(cfg.biome);
    this.renderer.setBoard(cfg.boardW, cfg.boardH);
    this.renderer.clearSand();
    this.input.movement = cfg.movement;
    this.input.reset();
    this.runTime = 0;
    this.hudPattern = 0;
    this.pendingEvents = [];
    this.state = 'countdown';
    this.audio.setScene('game');
    this.audio.setIntensity(0);
    this.audio.setTimeScale(1);
    this.ui.show('hud');
    this.ui.updateHud(this.sim.hud(0));
    this.updateTouchControls();
    const sim = this.sim;
    this.ui.countdown().then(() => {
      if (this.sim === sim && this.state === 'countdown') {
        this.state = 'playing';
        this.input.enabled = true;
      }
    });
  }

  private dailyBiome(): BiomeId {
    const ids: BiomeId[] = ['karesansui', 'erg', 'lagoon', 'svartsandur', 'salar'];
    return ids[hashString(todayKey()) % ids.length];
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.audio.setScene('paused');
    this.audio.setSlither(0, 0);
    this.ui.setTouchControls(null);
    this.ui.show('pause');
  }

  resume() {
    if (this.state !== 'paused' || !this.sim) return;
    this.ui.show('hud');
    this.updateTouchControls();
    this.audio.setScene('game');
    this.state = 'countdown';
    const sim = this.sim;
    this.ui.countdown().then(() => {
      if (this.sim === sim && this.state === 'countdown') {
        this.state = 'playing';
        this.input.enabled = true;
        this.input.reset();
      }
    });
  }

  restart() {
    if (this.lastReq) this.startGame(this.lastReq);
  }

  quitToMenu() {
    if (this.sim && this.sim.cfg.mode === 'zen' && (this.state === 'paused' || this.state === 'playing') && this.runTime > 10) {
      this.sim.stats.cause = 'quit';
      this.finishRun();
      return;
    }
    this.toMenu();
  }

  private toMenu() {
    this.state = 'menu';
    this.sim = null;
    this.input.enabled = false;
    this.ui.setTouchControls(null);
    this.audio.setScene('menu');
    this.audio.setSlither(0, 0);
    this.computeBoard();
    this.renderer.setBoard(this.boardW, this.boardH);
    this.renderer.setBiome(this.biome);
    this.attract = new Attract(this.biome, this.previewSkinId, this.boardW, this.boardH);
    this.ui.show('title');
  }

  async savePicture() {
    const blob = await this.renderer.snapshot();
    if (!blob) return;
    const name = `serpent-sands-${this.biome}-${Date.now()}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    try {
      if (IS_TOUCH && nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Serpent Sands garden' });
        return;
      }
    } catch {
      /* fall back to download */
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    this.ui.toast('Picture saved', name, '🖼');
  }

  private updateTouchControls() {
    if (!this.sim || (this.state !== 'playing' && this.state !== 'countdown')) return this.ui.setTouchControls(null);
    const s = store.settings;
    if (!IS_TOUCH) return this.ui.setTouchControls(null);
    if (this.sim.cfg.movement === 'grid') this.ui.setTouchControls(s.gridTouch === 'dpad' ? 'dpad' : null);
    else this.ui.setTouchControls(s.glideTouch === 'halves' ? 'halves' : null);
  }

  private pointerSteer(px: number, py: number) {
    if (!this.sim) return;
    const w = this.renderer.screenToWorld(px, py);
    const dx = w.x - this.sim.hx, dy = w.y - this.sim.hy;
    if (Math.hypot(dx, dy) > 0.4) this.sim.inputTargetAngle(Math.atan2(dy, dx));
  }

  // ------------------------------------------------------------------ results

  private finishRun() {
    const sim = this.sim!;
    const cfg = sim.cfg;
    const stats = sim.stats;
    stats.time = this.runTime;
    stats.pattern = this.renderer.patternCoverage();
    stats.length = Math.max(stats.length, sim.lengthCells);
    const p = store.profile;

    // best scores
    const key = bestKey(cfg.mode, cfg.biome, cfg.movement);
    const prevBest = cfg.mode === 'daily' ? p.daily[todayKey()] ?? 0 : p.bests[key] ?? 0;
    const newBest = stats.score > prevBest && stats.score > 0;
    if (cfg.mode === 'daily') p.daily[todayKey()] = Math.max(prevBest, stats.score);
    p.bests[key] = Math.max(p.bests[key] ?? 0, stats.score);

    // lifetime stats
    const L = p.stats;
    L.runs++;
    L.foodEaten += stats.foodEaten;
    L.goldenEaten += stats.goldenEaten;
    L.totalLength += stats.length;
    L.playTime += stats.time;
    L.nearMisses += stats.nearMisses;
    if (stats.cause === 'wall') L.deathsWall++;
    if (stats.cause === 'self') L.deathsSelf++;
    if (stats.cause === 'obstacle') L.deathsObstacle++;
    L.bestLength = Math.max(L.bestLength, stats.length);
    L.bestCombo = Math.max(L.bestCombo, stats.maxCombo);
    if (cfg.mode === 'zen') L.zenTime += stats.time;
    if (!L.biomesPlayed.includes(cfg.biome)) L.biomesPlayed.push(cfg.biome);

    // xp
    const levelBefore = levelFromXp(p.xp);
    const modeMult = cfg.mode === 'zen' ? 0.5 : cfg.mode === 'daily' ? 1.5 : 1;
    const xpGained = Math.round((stats.score / 10 + stats.foodEaten * 1 + stats.pattern * 30 + 5) * modeMult);
    p.xp += xpGained;
    const levelAfter = levelFromXp(p.xp);
    const prog = levelProgress(p.xp);

    // achievements
    const earned: string[] = [];
    for (const a of ACHIEVEMENTS) {
      if (p.achievements[a.id]) continue;
      if (a.check(stats, cfg, p)) {
        p.achievements[a.id] = Date.now();
        earned.push(a.id);
      }
    }
    const unlocks = unlocksBetween(levelBefore, levelAfter);
    for (const id of earned) {
      const skin = SKINS.find((s) => s.unlockAchievement === id);
      if (skin) unlocks.push(`Snake unlocked: ${skin.name}`);
    }
    store.saveProfile();

    const result: RunResult = {
      config: cfg,
      stats: { ...stats },
      best: Math.max(prevBest, stats.score),
      newBest,
      xpGained,
      levelBefore,
      levelAfter,
      xpIntoLevel: prog.into,
      xpForLevel: prog.need,
      unlocks,
      achievements: earned,
    };
    this.state = 'over';
    this.input.enabled = false;
    this.ui.setTouchControls(null);
    this.audio.setScene('over');
    this.audio.setSlither(0, 0);
    this.ui.showResult(result);
    let delay = 900;
    for (const id of earned) {
      const a = ACHIEVEMENTS.find((x) => x.id === id)!;
      setTimeout(() => {
        this.ui.toast(a.name, a.description, a.icon);
        this.audio.ui('achievement');
      }, delay);
      delay += 1200;
    }
    for (const u of unlocks) {
      setTimeout(() => {
        this.ui.toast(u, undefined, '✦');
        this.audio.ui('unlock');
      }, delay);
      delay += 1200;
    }
  }

  // ------------------------------------------------------------------ loop

  private worldToScreen(x: number, y: number, W: number, H: number) {
    const r = this.renderer.boardRect();
    return { px: r.x + (x / W) * r.w, py: r.y + (1 - y / H) * r.h };
  }

  private handleGameEvents(events: GameEvent[], sim: Sim) {
    const W = sim.W, H = sim.H;
    for (const e of events) {
      switch (e.type) {
        case 'eat': {
          const s = this.worldToScreen(e.x, e.y, W, H);
          this.ui.popup(`+${e.points}`, s.px, s.py, 'score');
          haptic(store.settings, e.kind === 'golden' ? [12, 40, 12] : 10);
          break;
        }
        case 'combo': {
          const s = this.worldToScreen(sim.hx, sim.hy, W, H);
          this.ui.popup(`×${e.combo}`, s.px, s.py - 36, 'combo');
          break;
        }
        case 'nearMiss': {
          const s = this.worldToScreen(e.x, e.y, W, H);
          this.ui.popup(`NEAR MISS +${e.points}`, s.px, s.py - 30, 'near');
          break;
        }
        case 'milestone': {
          const s = this.worldToScreen(sim.hx, sim.hy, W, H);
          this.ui.popup(`LENGTH ${e.length}  +${e.points}`, s.px, s.py - 50, 'bonus');
          break;
        }
        case 'powerup': {
          const s = this.worldToScreen(e.x, e.y, W, H);
          this.ui.popup(POWERUP_LABEL[e.kind], s.px, s.py - 30, 'bonus');
          haptic(store.settings, 15);
          break;
        }
        case 'hit': {
          const s = this.worldToScreen(e.x, e.y, W, H);
          this.ui.popup('−10s', s.px, s.py - 30, 'warn');
          haptic(store.settings, [30, 30, 30]);
          break;
        }
        case 'death':
          haptic(store.settings, [40, 50, 80]);
          break;
      }
    }
  }

  private autoTune(dt: number) {
    if (store.settings.quality !== 'auto') return;
    const allowed = this.state === 'menu' || (this.state === 'playing' && this.runTime < 5) || this.state === 'countdown';
    if (!allowed) return;
    const ms = this.renderer.frameMs;
    if (ms > 20) { this.slowFor += dt; this.fastFor = 0; }
    else if (ms < 12) { this.fastFor += dt; this.slowFor = 0; }
    else { this.slowFor = 0; this.fastFor = 0; }
    const i = QUALITY_ORDER.indexOf(this.autoQuality);
    if (this.slowFor > 3 && i > 0) {
      this.autoQuality = QUALITY_ORDER[i - 1];
      this.slowFor = 0;
      this.renderer.setOptions(this.renderOptions());
    } else if (this.fastFor > 10 && i < 2) {
      this.autoQuality = QUALITY_ORDER[i + 1];
      this.fastFor = 0;
      this.renderer.setOptions(this.renderOptions());
    }
  }

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    const time = (now - this.startT) / 1000;
    this.input.poll();

    let sim: Sim;
    if (this.sim && this.state !== 'menu') {
      sim = this.sim;
      if (this.state === 'playing') {
        sim.update(dt);
        this.runTime += dt;
      }
    } else {
      sim = this.attract.sim;
      this.attract.update(dt);
      if (this.attract.age > 180) this.attract = new Attract(this.biome, this.previewSkinId, this.boardW, this.boardH);
    }

    const events = sim.drainEvents();
    const frame = sim.renderFrame(time, dt, this.state === 'paused', events);
    if (sim === this.attract.sim) frame.snake.skin = this.previewSkinId;
    if (store.settings.reducedMotion) frame.shake = 0;
    this.renderer.render(frame);

    const inGame = sim === this.sim;
    if (inGame) {
      this.audio.handleEvents(events);
      this.handleGameEvents(events, sim);
      this.audio.setIntensity(sim.intensity());
      this.audio.setTimeScale(sim.effects.timeScale);
      this.audio.setSlither(this.state === 'playing' ? frame.snake.speed : 0, frame.snake.turnRate);
      this.patternTimer -= dt;
      if (this.patternTimer <= 0) {
        this.patternTimer = 0.5;
        this.hudPattern = this.renderer.patternCoverage();
      }
      this.ui.updateHud(sim.hud(this.hudPattern));
      if (sim.over && this.state === 'playing') this.finishRun();
    } else {
      this.audio.setSlither(frame.snake.speed * 0.25, frame.snake.turnRate);
    }

    this.autoTune(dt);
    if (store.settings.showFps) {
      this.fpsTimer -= dt;
      if (this.fpsTimer <= 0) {
        this.fpsTimer = 0.5;
        this.ui.setFps(Math.round(1000 / Math.max(1, this.renderer.frameMs)));
      }
    }
  };
}

export function boot() {
  const app = new App();
  (window as any).__app = app;
}
