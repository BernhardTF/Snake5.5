// AudioCore: the whole audio graph on an injected (Offline)AudioContext.
// AudioEngine wraps it for the live game; the self-test drives it on an OfflineAudioContext.
import type { BiomeId, GameEvent } from '../types';
import type { UiSound } from './contract';
import { ReverbParams, degToSemi, irGenerator, softClipCurve } from './dsp';
import { PluckKind, Synth } from './instruments';
import { BIOME_KEYS, MusicHost, ScoreRuntime } from './scores';
import { Sfx, SfxHost } from './sfx';
import { Slither } from './slither';
import { VoiceTracker } from './voices';

export type Scene = 'menu' | 'game' | 'paused' | 'over';

const REVERB: Record<BiomeId, ReverbParams & { musicSend: number; sfxSend: number }> = {
  // temple garden: medium, bright, some wall reflections
  karesansui: { t60: 2.3, brightStart: 7000, brightEnd: 2600, predelay: 0.022, early: 0.7, width: 0.8, hp: 120, wet: 0.9, musicSend: 0.42, sfxSend: 0.18 },
  // wide and dry
  erg: { t60: 1.5, brightStart: 5200, brightEnd: 1800, predelay: 0.035, early: 0.25, width: 1, hp: 150, wet: 0.8, musicSend: 0.22, sfxSend: 0.1 },
  // open, airy
  lagoon: { t60: 2.0, brightStart: 9500, brightEnd: 4800, predelay: 0.018, early: 0.15, width: 0.95, hp: 200, wet: 0.85, musicSend: 0.32, sfxSend: 0.14 },
  // huge, cold (lean low end)
  svartsandur: { t60: 5.2, brightStart: 6500, brightEnd: 1500, predelay: 0.045, early: 0.3, width: 1, hp: 320, wet: 1, musicSend: 0.6, sfxSend: 0.25 },
  // vast, bright
  salar: { t60: 3.6, brightStart: 11000, brightEnd: 5500, predelay: 0.06, early: 0.2, width: 1, hp: 220, wet: 0.85, musicSend: 0.36, sfxSend: 0.15 },
};

/** Instruments + ranges pre-rendered per biome. */
const PREWARM: Record<BiomeId, [PluckKind, number, number][]> = {
  karesansui: [['koto', 52, 96], ['kotoBass', 28, 64]],
  erg: [['oud', 38, 88]],
  lagoon: [['slack', 31, 92]],
  svartsandur: [],
  salar: [['charango', 52, 84], ['slack', 40, 64]],
};

type Job = () => boolean; // returns true when finished

interface RevSlot { conv: ConvolverNode; gain: GainNode; biome: BiomeId }

export interface CoreOptions {
  offline?: boolean;
  seed?: number;
}

export class AudioCore implements MusicHost, SfxHost {
  readonly synth: Synth;
  readonly musicVoices: VoiceTracker;
  readonly sfxVoices: VoiceTracker;
  readonly sfxIn: GainNode;
  readonly uiIn: GainNode;
  private master: GainNode;
  private comp: DynamicsCompressorNode;
  private musicIn: GainNode;
  private musicLP: BiquadFilterNode;
  private musicDuck: GainNode;
  private musicVol: GainNode;
  private musicSend: GainNode;
  private sfxVol: GainNode;
  private sfxSend: GainNode;
  private revIn: GainNode;
  private revOut: GainNode;
  private revSlots: RevSlot[] = [];
  private revPending: BiomeId | null = null;
  private runtimes: { rt: ScoreRuntime; disposeAt: number }[] = [];
  private sfx: Sfx;
  private slither: Slither;
  private jobs: Job[] = [];
  private prepared = new Set<string>();
  private seed: number;
  private outNode: AudioNode;
  private analyser: AnalyserNode | null = null;

  biome: BiomeId = 'karesansui';
  scene: Scene = 'menu';
  private intensity = 0;
  private l2 = false;
  private l3 = false;
  private timeScale = 1;
  private deathDuck = false;
  private biomeSet = false;
  /** Called when idle jobs are queued (realtime engine schedules them). */
  onJobs: (() => void) | null = null;
  errors = 0;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode = ctx.destination, private opts: CoreOptions = {}) {
    this.seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    this.synth = new Synth(ctx, this.seed);
    this.synth.sync = !!opts.offline;
    this.musicVoices = new VoiceTracker(ctx, 72);
    this.sfxVoices = new VoiceTracker(ctx, 24);
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    // master chain: master → compressor → soft clip → dest
    this.master = g(1);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    const pre = g(0.5);
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve() as Float32Array<ArrayBuffer>;
    this.master.connect(this.comp).connect(pre).connect(shaper).connect(dest);
    this.outNode = shaper;

    // reverb
    this.revIn = g(1);
    this.revOut = g(1);
    this.revOut.connect(this.master);

    // music
    this.musicIn = g(0.9);
    this.musicLP = ctx.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 20000;
    this.musicLP.Q.value = 0.5;
    this.musicDuck = g(0.85);
    this.musicVol = g(0.49);
    this.musicSend = g(0.35);
    this.musicIn.connect(this.musicLP).connect(this.musicDuck).connect(this.musicVol).connect(this.master);
    this.musicVol.connect(this.musicSend).connect(this.revIn);

    // sfx + ui
    this.sfxIn = g(1);
    this.uiIn = g(0.8);
    this.uiIn.connect(this.sfxIn);
    this.sfxVol = g(0.81);
    this.sfxSend = g(0.15);
    this.sfxIn.connect(this.sfxVol).connect(this.master);
    this.sfxVol.connect(this.sfxSend).connect(this.revIn);

    this.sfx = new Sfx(this);
    this.slither = new Slither(this.synth, this.sfxIn);
  }

  now() { return this.ctx.currentTime; }

  // ---------------------------------------------------------------- jobs

  private queueGen(g: Generator<unknown, unknown, unknown>) {
    this.queue(() => g.next().done === true);
  }
  private queue(job: Job) {
    if (this.opts.offline) { let guard = 0; while (!job() && guard++ < 1e6); return; }
    this.jobs.push(job);
    this.onJobs?.();
  }
  get hasJobs() { return this.jobs.length > 0; }
  /** Run queued pre-render jobs for up to `budgetMs`. */
  runJobs(budgetMs: number) {
    const t0 = performance.now();
    let last = 0;
    while (this.jobs.length) {
      const el = performance.now() - t0;
      if (el + last > budgetMs && el > 0) break;
      const j = this.jobs[0];
      const s = performance.now();
      let done = true;
      try { done = j(); } catch (e) { this.errors++; console.warn('[audio] job error', e); }
      last = performance.now() - s;
      if (done) this.jobs.shift();
    }
  }

  private prewarmNoise() {
    if (this.prepared.has('noise')) return;
    this.prepared.add('noise');
    this.queueGen(this.synth.noiseTask('white'));
    this.queueGen(this.synth.noiseTask('pink'));
    this.queueGen(this.synth.noiseTask('brown'));
  }

  private prewarm(b: BiomeId) {
    if (this.prepared.has(b)) return;
    this.prepared.add(b);
    this.queueGen(this.slither.crackleTask(b));
    this.queue(() => { this.slither.init(); return true; });
    const key = BIOME_KEYS[b];
    const list: [PluckKind, number][] = [];
    const inScale = (m: number) => key.scale.includes((((m - key.root) % 12) + 12) % 12);
    for (const [kind, lo, hi] of PREWARM[b]) for (let m = lo; m <= hi; m++) if (inScale(m)) list.push([kind, m]);
    if (key.lead !== 'bell') for (let d = 0; d < 12; d++) list.push([key.lead, key.sfxRoot + degToSemi(key.scale, d)]);
    // SFX lead notes first, then the score's range
    list.reverse();
    for (const [k, m] of list) this.queueGen(this.synth.ksTask(k, m));
  }

  // ---------------------------------------------------------------- reverb

  private setReverb(b: BiomeId) {
    const p = REVERB[b];
    const t = this.now();
    this.musicSend.gain.setTargetAtTime(p.musicSend, t, 0.5);
    this.sfxSend.gain.setTargetAtTime(p.sfxSend, t, 0.5);
    const existing = this.revSlots.find((s) => s.biome === b);
    if (existing) { this.fadeReverbTo(existing); return; }
    if (this.revPending === b) return;
    this.revPending = b;
    const sr = this.ctx.sampleRate;
    const len = Math.floor(Math.min(p.t60 * 1.1, 4) * sr);
    const data: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
    const gen = irGenerator(sr, p, b.length * 101 + 7, data);
    this.queue(() => {
      if (!gen.next().done) return false;
      if (this.revPending !== b) return true; // superseded
      this.revPending = null;
      const buf = this.ctx.createBuffer(2, len, sr);
      buf.copyToChannel(data[0] as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(data[1] as Float32Array<ArrayBuffer>, 1);
      const conv = this.ctx.createConvolver();
      conv.normalize = true;
      conv.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      this.revIn.connect(conv).connect(gain).connect(this.revOut);
      const slot = { conv, gain, biome: b };
      this.revSlots.push(slot);
      // keep at most two convolvers alive
      while (this.revSlots.length > 2) {
        const old = this.revSlots.shift()!;
        try { old.gain.disconnect(); old.conv.disconnect(); } catch { /* */ }
      }
      this.fadeReverbTo(slot);
      return true;
    });
  }

  private fadeReverbTo(slot: RevSlot) {
    const t = this.now();
    for (const s of this.revSlots) s.gain.gain.setTargetAtTime(s === slot ? REVERB[s.biome].wet : 0, t, 0.5);
  }

  // ---------------------------------------------------------------- public controls

  setVolumes(master: number, music: number, sfx: number, muted: boolean) {
    const c = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);
    const t = this.now();
    this.master.gain.setTargetAtTime(muted ? 0 : c(master) ** 2, t, 0.05);
    this.musicVol.gain.setTargetAtTime(c(music) ** 2, t, 0.05);
    this.sfxVol.gain.setTargetAtTime(c(sfx) ** 2, t, 0.05);
  }

  setBiome(id: BiomeId, fade = 1.5) {
    if (!(id in BIOME_KEYS)) return;
    if (this.biomeSet && id === this.biome && this.runtimes.length) return;
    this.biomeSet = true;
    this.biome = id;
    const t = this.now();
    this.prewarmNoise();
    this.setReverb(id);
    this.prewarm(id);
    this.slither.setBiome(id);
    for (const r of this.runtimes) if (!r.rt.stopped) { r.rt.stop(t, fade); r.disposeAt = t + fade + 3.5; }
    const rt = new ScoreRuntime(this, id, this.musicIn, t, this.runtimes.length ? fade : 0.5, this.seed + id.length * 1013);
    this.runtimes.push({ rt, disposeAt: Infinity });
    this.applyMusicState(true);
  }

  private get active(): ScoreRuntime | null {
    const r = this.runtimes[this.runtimes.length - 1];
    return r && !r.rt.stopped ? r.rt : null;
  }

  setScene(s: Scene) {
    if (!['menu', 'game', 'paused', 'over'].includes(s)) return;
    const prev = this.scene;
    if (prev === s) return;
    this.scene = s;
    const t = this.now();
    const rt = this.active;
    if (s === 'over' && (prev === 'game' || prev === 'paused')) rt?.restart(t, true);
    if (s === 'game' && (prev === 'menu' || prev === 'over')) { this.deathDuck = false; rt?.restart(t); }
    if (s === 'menu') this.deathDuck = false;
    this.applyMusicState();
  }

  setIntensity(v: number) {
    if (!Number.isFinite(v)) return;
    this.intensity = Math.max(0, Math.min(1, v));
    this.applyMusicState();
  }

  setTimeScale(v: number) {
    if (!Number.isFinite(v)) return;
    this.timeScale = Math.max(0.1, Math.min(1, v));
    this.synth.detune = -(1 - this.timeScale) * 120;
    this.applyMusicState();
  }

  setSlither(speed: number, turnRate: number) { this.slither.set(speed, turnRate); }

  handleEvents(events: GameEvent[]) {
    if (!Array.isArray(events)) return;
    for (const e of events) {
      try { this.sfx.handle(e); } catch (err) { this.errors++; if (this.errors < 10) console.warn('[audio] sfx error', err); }
    }
  }

  ui(sound: UiSound) {
    try { this.sfx.ui(sound); } catch (err) { this.errors++; if (this.errors < 10) console.warn('[audio] ui error', err); }
  }

  onDeath() { this.deathDuck = true; this.applyMusicState(); }
  onStart() { this.deathDuck = false; this.applyMusicState(); }

  private layerLevels(): number[] {
    const i = this.intensity;
    this.l2 = this.l2 ? i > 0.25 : i > 0.3;
    this.l3 = this.l3 ? i > 0.58 : i > 0.65;
    switch (this.scene) {
      case 'menu': return [1, 0.7, 0, 0];
      case 'over': return [1, 0.8, 0, 0];
      default: return [1, 1, this.l2 ? 1 : 0, this.l3 ? 1 : 0];
    }
  }

  private applyMusicState(immediate = false) {
    const t = this.now();
    const levels = this.layerLevels();
    const slow = this.timeScale < 0.999;
    const tempo = slow ? 1 - (1 - this.timeScale) * 0.8 : 1;
    for (const r of this.runtimes) {
      if (r.rt.stopped) continue;
      r.rt.setLayers(levels, t);
      r.rt.setTempo(tempo, t);
      r.rt.sparse = this.scene === 'menu' || this.scene === 'over';
    }
    let lp = 20000;
    if (slow) lp = Math.min(lp, 900);
    if (this.scene === 'paused') lp = Math.min(lp, 650);
    this.musicLP.frequency.setTargetAtTime(lp, t, immediate ? 0.01 : 0.25);
    let duck = 1;
    if (this.scene === 'menu') duck = 0.85;
    if (this.scene === 'paused') duck = 0.4;
    if (this.deathDuck) duck = Math.min(duck, this.scene === 'over' ? 0.7 : 0.2);
    this.musicDuck.gain.setTargetAtTime(duck, t, this.deathDuck && this.scene !== 'over' ? 0.08 : 0.6);
    this.slither.setGate(this.scene === 'game' ? 1 : 0);
  }

  /** Scheduler tick: schedule notes up to now + lookahead. */
  tick(lookahead = 0.16) {
    const now = this.now();
    for (const r of this.runtimes) r.rt.pump(now, now + lookahead);
    for (let i = this.runtimes.length - 1; i >= 0; i--) {
      const r = this.runtimes[i];
      if (r.rt.stopped && now > r.disposeAt) { r.rt.dispose(); this.runtimes.splice(i, 1); }
    }
  }

  /** Output RMS in dBFS (dev metering; creates an analyser tap on first call). */
  level(): number {
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.outNode.connect(this.analyser);
    }
    const d = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(d);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return Math.round(10 * Math.log10(s / d.length + 1e-12) * 10) / 10;
  }

  /** Diagnostics for the dev bench. */
  stats() {
    return {
      level: this.level(),
      musicVoices: this.musicVoices.count, sfxVoices: this.sfxVoices.count, stolen: this.sfxVoices.stolen,
      runtimes: this.runtimes.length, jobs: this.jobs.length, errors: this.errors + this.runtimes.reduce((a, r) => a + r.rt.errors, 0),
      bpm: this.active?.bpm ?? 0, scene: this.scene, biome: this.biome, intensity: this.intensity,
    };
  }

  dispose() {
    for (const r of this.runtimes) { r.rt.stop(this.now(), 0.05); r.rt.dispose(); }
    this.runtimes.length = 0;
    this.slither.dispose();
    try { this.master.disconnect(); } catch { /* */ }
  }
}
