// Continuous slither loop: filtered noise body + grain crackle, amplitude-modulated at the
// body-undulation rate, extra hiss while turning. Per-biome timbre.
import type { BiomeId } from '../types';
import { crackleGen, runGen } from './dsp';
import type { Synth } from './instruments';

interface SlitherTimbre {
  /** bandpass centre at speed 0 / at speed 10 cells/s */
  f0: number; f1: number; q: number;
  bodyGain: number;
  /** crackle: impulses per second, grain ms, filter */
  density: number; grainMs: number; cType: BiquadFilterType; cf: number; cq: number; cGain: number;
  hissF: number; hissGain: number;
  color: 'pink' | 'brown' | 'white';
}

const TIMBRES: Record<BiomeId, SlitherTimbre> = {
  // fine gravel crunch
  karesansui: { f0: 700, f1: 1700, q: 0.9, bodyGain: 0.5, density: 260, grainMs: 2.5, cType: 'bandpass', cf: 2600, cq: 0.8, cGain: 0.55, hissF: 3500, hissGain: 0.25, color: 'pink' },
  // soft hiss
  erg: { f0: 1100, f1: 2600, q: 0.6, bodyGain: 0.7, density: 90, grainMs: 1.5, cType: 'highpass', cf: 3500, cq: 0.7, cGain: 0.18, hissF: 4200, hissGain: 0.35, color: 'pink' },
  // wet squish
  lagoon: { f0: 280, f1: 700, q: 2.2, bodyGain: 0.8, density: 45, grainMs: 9, cType: 'lowpass', cf: 900, cq: 3, cGain: 0.4, hissF: 2200, hissGain: 0.18, color: 'brown' },
  // gritty crunch
  svartsandur: { f0: 450, f1: 1200, q: 0.8, bodyGain: 0.45, density: 180, grainMs: 4, cType: 'bandpass', cf: 1500, cq: 0.7, cGain: 0.7, hissF: 3000, hissGain: 0.2, color: 'brown' },
  // crystalline crackle
  salar: { f0: 1500, f1: 3500, q: 1.2, bodyGain: 0.35, density: 140, grainMs: 1, cType: 'highpass', cf: 5000, cq: 1, cGain: 0.6, hissF: 6000, hissGain: 0.25, color: 'white' },
  // fine, soft coral sand: silky hiss with a little shell grit
  pinksands: { f0: 1200, f1: 3000, q: 0.7, bodyGain: 0.62, density: 120, grainMs: 1.2, cType: 'highpass', cf: 4200, cq: 0.8, cGain: 0.28, hissF: 4600, hissGain: 0.3, color: 'pink' },
  // dark wet sand: soft squelch
  vaadhoo: { f0: 340, f1: 880, q: 1.8, bodyGain: 0.75, density: 60, grainMs: 7, cType: 'lowpass', cf: 1100, cq: 2.5, cGain: 0.42, hissF: 2500, hissGain: 0.18, color: 'brown' },
  // brittle sulphur crust crunching
  dallol: { f0: 900, f1: 2200, q: 1, bodyGain: 0.4, density: 230, grainMs: 2, cType: 'bandpass', cf: 3200, cq: 1.2, cGain: 0.72, hissF: 5000, hissGain: 0.22, color: 'pink' },
  // regolith, felt through the suit: muted and gritty
  luna: { f0: 480, f1: 1250, q: 0.8, bodyGain: 0.4, density: 200, grainMs: 3, cType: 'bandpass', cf: 1700, cq: 0.8, cGain: 0.6, hissF: 2600, hissGain: 0.12, color: 'brown' },
  // dry rust dust scraping over basalt
  mars: { f0: 800, f1: 2000, q: 0.9, bodyGain: 0.55, density: 150, grainMs: 2.5, cType: 'bandpass', cf: 2400, cq: 0.9, cGain: 0.45, hissF: 3800, hissGain: 0.28, color: 'pink' },
  // damp hydrocarbon grains, muffled by the thick air
  titan: { f0: 240, f1: 640, q: 1.4, bodyGain: 0.8, density: 90, grainMs: 6, cType: 'lowpass', cf: 800, cq: 1.5, cGain: 0.5, hissF: 1500, hissGain: 0.15, color: 'brown' },
  // tinkling surface crystals
  kepler: { f0: 1800, f1: 4200, q: 1.6, bodyGain: 0.3, density: 110, grainMs: 0.8, cType: 'highpass', cf: 6000, cq: 1.5, cGain: 0.65, hissF: 7000, hissGain: 0.25, color: 'white' },
};

export class Slither {
  private out: GainNode;
  private bodyF!: BiquadFilterNode;
  private bodyG!: GainNode;
  private crackF!: BiquadFilterNode;
  private crackG!: GainNode;
  private hissG!: GainNode;
  private hissF!: BiquadFilterNode;
  private am!: GainNode;
  private lfo!: OscillatorNode;
  private lfoG!: GainNode;
  private srcs: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private crackleSrc: AudioBufferSourceNode | null = null;
  private crackles = new Map<BiomeId, AudioBuffer>();
  private timbre: SlitherTimbre = TIMBRES.karesansui;
  private biome: BiomeId | null = null;
  private started = false;
  private pending: BiomeId | null = null;
  private speed = 0;
  private turn = 0;
  gate = 1;

  constructor(private synth: Synth, dest: AudioNode) {
    const ctx = synth.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  private build() {
    const ctx = this.synth.ctx;
    const t = ctx.currentTime;
    const n = (x: AudioNode) => { this.nodes.push(x); return x; };
    this.am = n(ctx.createGain()) as GainNode;
    this.am.gain.value = 0.7;
    this.am.connect(this.out);
    this.lfo = n(ctx.createOscillator()) as OscillatorNode;
    this.lfo.frequency.value = 1;
    this.lfoG = n(ctx.createGain()) as GainNode;
    this.lfoG.gain.value = 0.3;
    this.lfo.connect(this.lfoG).connect(this.am.gain);
    this.lfo.start(t);
    this.srcs.push(this.lfo);
    // body
    const body = ctx.createBufferSource();
    body.buffer = this.synth.noise('pink');
    body.loop = true;
    this.bodyF = n(ctx.createBiquadFilter()) as BiquadFilterNode;
    this.bodyF.type = 'bandpass';
    this.bodyG = n(ctx.createGain()) as GainNode;
    this.bodyG.gain.value = 0;
    body.connect(this.bodyF).connect(this.bodyG).connect(this.am);
    body.start(t, 0.37);
    this.srcs.push(body); this.nodes.push(body);
    // hiss (turning)
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.synth.noise('white');
    hiss.loop = true;
    this.hissF = n(ctx.createBiquadFilter()) as BiquadFilterNode;
    this.hissF.type = 'bandpass';
    this.hissF.Q.value = 0.8;
    this.hissG = n(ctx.createGain()) as GainNode;
    this.hissG.gain.value = 0;
    hiss.connect(this.hissF).connect(this.hissG).connect(this.out);
    hiss.start(t, 1.1);
    this.srcs.push(hiss); this.nodes.push(hiss);
    // crackle
    this.crackF = n(ctx.createBiquadFilter()) as BiquadFilterNode;
    this.crackG = n(ctx.createGain()) as GainNode;
    this.crackG.gain.value = 0;
    this.crackF.connect(this.crackG).connect(this.am);
    this.started = true;
  }

  /** Cached crackle loop; realtime returns null until the idle job has rendered it. */
  private crackle(b: BiomeId): AudioBuffer | null {
    return this.crackles.get(b) ?? (this.synth.sync ? runGen(this.crackleTask(b)) : null);
  }
  private crackleWant: BiomeId | null = null;

  /** Called from the scheduler tick: swaps in a crackle loop once its job has finished. */
  poll() {
    const b = this.crackleWant;
    if (b && this.started && this.crackles.has(b)) this.swapCrackle(b);
  }

  private swapCrackle(b: BiomeId) {
    const buf = this.crackle(b);
    if (!buf) { this.crackleWant = b; return; }
    this.crackleWant = null;
    const ctx = this.synth.ctx;
    const t = ctx.currentTime;
    const old = this.crackleSrc;
    if (old) { try { old.stop(t + 0.3); } catch { /* */ } old.onended = () => { try { old.disconnect(); } catch { /* */ } }; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.crackF);
    src.start(t);
    this.crackleSrc = src;
    this.apply();
  }

  /** Chunked job pre-rendering a biome's crackle loop. */
  *crackleTask(b: BiomeId): Generator<void, AudioBuffer, unknown> {
    const have = this.crackles.get(b);
    if (have) return have;
    const tm = TIMBRES[b];
    const sr = this.synth.ctx.sampleRate;
    const data = yield* crackleGen(sr, 2.2, tm.density, tm.grainMs, b.length * 17 + 5);
    const buf = this.synth.ctx.createBuffer(2, data[0].length, sr);
    buf.copyToChannel(data[0] as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(data[1] as Float32Array<ArrayBuffer>, 1);
    this.crackles.set(b, buf);
    return buf;
  }

  /** Build the graph once noise loops exist (called from an idle job). */
  init() {
    if (this.started || !this.pending) return;
    if (!this.synth.noiseReady('pink') || !this.synth.noiseReady('white')) return;
    this.build();
    const b = this.pending;
    this.pending = null;
    this.biome = null;
    this.setBiome(b);
  }

  setBiome(b: BiomeId) {
    if (!this.started) {
      this.pending = b;
      if (this.synth.sync) this.init();
      return;
    }
    if (b === this.biome) return;
    this.biome = b;
    this.timbre = TIMBRES[b];
    const ctx = this.synth.ctx;
    const t = ctx.currentTime;
    const tm = this.timbre;
    this.bodyF.Q.setTargetAtTime(tm.q, t, 0.2);
    this.hissF.frequency.setTargetAtTime(tm.hissF, t, 0.2);
    this.crackF.type = tm.cType;
    this.crackF.frequency.setTargetAtTime(tm.cf, t, 0.2);
    this.crackF.Q.setTargetAtTime(tm.cq, t, 0.2);
    this.swapCrackle(b);
    this.apply();
  }

  set(speed: number, turnRate: number) {
    this.speed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    this.turn = Number.isFinite(turnRate) ? Math.abs(turnRate) : 0;
    this.apply();
  }

  setGate(g: number) { if (g === this.gate) return; this.gate = g; this.apply(); }

  private apply() {
    if (!this.started) return;
    const t = this.synth.ctx.currentTime;
    const tm = this.timbre;
    const sp = Math.min(this.speed, 16);
    const u = Math.min(1, sp / 10);
    const on = sp > 0.05 ? 1 : 0;
    const level = on * this.gate * (0.35 + 0.65 * u);
    this.out.gain.setTargetAtTime(level * 0.24, t, on ? 0.06 : 0.12);
    this.bodyF.frequency.setTargetAtTime(tm.f0 + (tm.f1 - tm.f0) * u, t, 0.1);
    this.bodyG.gain.setTargetAtTime(tm.bodyGain, t, 0.1);
    this.crackG.gain.setTargetAtTime(tm.cGain * (0.4 + 0.6 * u), t, 0.1);
    if (this.crackleSrc) this.crackleSrc.playbackRate.setTargetAtTime(0.7 + 0.5 * u, t, 0.2);
    // undulation: ~0.9 cycles per cell travelled (sideways S-wave) → subtle rhythmic AM
    this.lfo.frequency.setTargetAtTime(Math.max(0.3, sp * 0.45), t, 0.2);
    const tr = Math.min(1, this.turn / 6);
    this.hissG.gain.setTargetAtTime(tm.hissGain * tr * (0.3 + 0.7 * u), t, 0.05);
  }

  dispose() {
    for (const s of this.srcs) { try { s.stop(); } catch { /* */ } }
    if (this.crackleSrc) { try { this.crackleSrc.stop(); this.crackleSrc.disconnect(); } catch { /* */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* */ } }
    try { this.out.disconnect(); } catch { /* */ }
  }
}
