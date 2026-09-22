// Public audio engine for the game. Lazily creates the AudioContext on unlock() (user gesture),
// forwards everything to AudioCore, runs the lookahead scheduler + idle pre-render jobs.
// Every method is a safe no-op before unlock and never throws.
import type { BiomeId, GameEvent } from '../types';
import type { IAudioEngine, UiSound } from './contract';
import { AudioCore, Scene } from './core';

type AC = typeof AudioContext;

export class AudioEngine implements IAudioEngine {
  private ctx: AudioContext | null = null;
  private core: AudioCore | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private idleHandle = 0;
  private idlePending = false;
  private suspended = false;
  // state mirrored before unlock
  private vol: [number, number, number, boolean] = [1, 0.7, 0.9, false];
  private biome: BiomeId = 'karesansui';
  private scene: Scene = 'menu';
  private intensity = 0;
  private timeScale = 1;

  /** Exposed for the dev bench. */
  get audioCore(): AudioCore | null { return this.core; }
  get context(): AudioContext | null { return this.ctx; }

  unlock(): void {
    try {
      if (!this.ctx) {
        const w = window as unknown as { AudioContext?: AC; webkitAudioContext?: AC };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.core = new AudioCore(this.ctx);
        this.core.onJobs = () => this.scheduleIdle();
        const c = this.core;
        c.setVolumes(...this.vol);
        c.setTimeScale(this.timeScale);
        c.setIntensity(this.intensity);
        c.setScene(this.scene);
        c.setBiome(this.biome);
        this.timer = setInterval(() => this.tick(), 25);
        this.ctx.addEventListener?.('statechange', () => this.tick());
      }
      const ctx = this.ctx;
      if (ctx.state !== 'running' && !this.suspended) {
        void ctx.resume().catch(() => {});
      }
      // iOS: play a silent buffer inside the gesture
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      s.onended = () => { try { s.disconnect(); } catch { /* */ } };
    } catch (e) {
      console.warn('[audio] unlock failed', e);
    }
  }

  private tick() {
    const c = this.core, ctx = this.ctx;
    if (!c || !ctx || ctx.state !== 'running') return;
    try { c.tick(); } catch (e) { console.warn('[audio] tick', e); }
  }

  private scheduleIdle() {
    if (this.idlePending || !this.core) return;
    this.idlePending = true;
    const run = (deadline?: IdleDeadline) => {
      this.idlePending = false;
      const c = this.core;
      if (!c) return;
      const budget = deadline ? Math.max(2, Math.min(8, deadline.timeRemaining())) : 6;
      c.runJobs(budget);
      if (c.hasJobs) this.scheduleIdle();
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) this.idleHandle = ric(run, { timeout: 120 });
    else this.idleHandle = window.setTimeout(() => run(), 16) as unknown as number;
  }

  private safe(fn: (c: AudioCore) => void) {
    const c = this.core;
    if (!c) return;
    try { fn(c); } catch (e) { console.warn('[audio]', e); }
  }

  setVolumes(master: number, music: number, sfx: number, muted: boolean): void {
    this.vol = [master, music, sfx, !!muted];
    this.safe((c) => c.setVolumes(master, music, sfx, !!muted));
  }
  setBiome(id: BiomeId): void {
    this.biome = id;
    this.safe((c) => c.setBiome(id));
  }
  setScene(scene: Scene): void {
    this.scene = scene;
    this.safe((c) => c.setScene(scene));
  }
  setIntensity(v: number): void {
    if (Number.isFinite(v)) this.intensity = v;
    this.safe((c) => c.setIntensity(v));
  }
  setTimeScale(v: number): void {
    if (Number.isFinite(v)) this.timeScale = v;
    this.safe((c) => c.setTimeScale(v));
  }
  setSlither(speed: number, turnRate: number): void {
    this.safe((c) => c.setSlither(speed, turnRate));
  }
  handleEvents(events: GameEvent[]): void {
    if (!events || !events.length) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.safe((c) => c.handleEvents(events));
  }
  ui(sound: UiSound): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.safe((c) => c.ui(sound));
  }
  suspend(): void {
    this.suspended = true;
    try { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => {}); } catch { /* */ }
  }
  resume(): void {
    this.suspended = false;
    try { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') void this.ctx.resume().catch(() => {}); } catch { /* */ }
  }
}
