// Synthesised instruments. Each function renders one note into a Voice at time `t`.
import { KsParams, NoiseColor, Rng, clamp, ksGen, mtof, mulberry32, noiseGen, runGen } from './dsp';
import type { Voice } from './voices';

export type PluckKind = 'koto' | 'oud' | 'slack' | 'charango' | 'kotoBass' | 'krar' | 'guitar' | 'bassGtr';
/** Oscillator-synth lead voices (no pre-render needed). */
export type SynthLead = 'bell' | 'pan' | 'mallet' | 'theremin' | 'analog' | 'crystal' | 'sonar';
export type LeadKind = PluckKind | SynthLead;
const PLUCK_KINDS = new Set<string>(['koto', 'oud', 'slack', 'charango', 'kotoBass', 'krar', 'guitar', 'bassGtr']);
export const isPluck = (k: LeadKind): k is PluckKind => PLUCK_KINDS.has(k);

interface PluckDef { ks: KsParams; sr: number; stereo?: boolean }

const PLUCKS: Record<PluckKind, PluckDef> = {
  koto: {
    sr: 32000,
    ks: { t60: 2.6, bright: 0.6, damp: 0.17, pos: 0.12, len: 2.3, body: [[420, 1.2, 4], [1900, 2, 2], [3400, 3, 1]], lp: 7000 },
  },
  kotoBass: {
    sr: 24000,
    ks: { t60: 3.2, bright: 0.45, damp: 0.22, pos: 0.18, len: 2.8, body: [[180, 1, 4], [650, 1.5, 2]] },
  },
  oud: {
    sr: 24000,
    ks: { t60: 1.25, bright: 0.42, damp: 0.3, pos: 0.2, buzz: 0.35, len: 1.35, body: [[260, 1.1, 5], [1100, 1.4, 2]], lp: 5200 },
  },
  slack: {
    sr: 24000,
    ks: { t60: 3.6, bright: 0.33, damp: 0.34, pos: 0.26, len: 3.0, body: [[110, 1, 3], [220, 1.2, 4], [2400, 1, -3]], lp: 4200 },
  },
  charango: {
    sr: 32000, stereo: true,
    ks: { t60: 1.6, bright: 0.85, damp: 0.12, pos: 0.1, len: 1.6, body: [[520, 1.4, 3], [2600, 2, 3]] },
  },
  // Ethiopian lyre: gut strings, bright attack, a little leather-buzz
  krar: {
    sr: 32000,
    ks: { t60: 2.1, bright: 0.72, damp: 0.14, pos: 0.13, buzz: 0.18, len: 2.0, body: [[310, 1.2, 4], [1450, 1.8, 3], [3100, 2.2, 1.5]], lp: 7600 },
  },
  // calypso nylon/cuatro rhythm guitar
  guitar: {
    sr: 24000,
    ks: { t60: 1.5, bright: 0.5, damp: 0.22, pos: 0.16, len: 1.5, body: [[210, 1.1, 4], [1250, 1.6, 2]], lp: 5600 },
  },
  // round electric bass
  bassGtr: {
    sr: 16000,
    ks: { t60: 1.7, bright: 0.28, damp: 0.42, pos: 0.22, len: 1.6, body: [[95, 1, 3], [720, 1, -3]], lp: 1600 },
  },
};

export class Synth {
  /** Global pitch offset for newly scheduled notes (slow-time). */
  detune = 0;
  private ksCache = new Map<string, AudioBuffer>();
  private ksOrder: string[] = [];
  private noises: Partial<Record<NoiseColor, AudioBuffer>> = {};
  private quick: AudioBuffer | null = null;
  readonly rng: Rng;
  /** When true (offline rendering) missing buffers are rendered synchronously. */
  sync = false;
  constructor(readonly ctx: BaseAudioContext, seed = 1) {
    this.rng = mulberry32(seed);
  }

  noiseReady(c: NoiseColor) { return !!this.noises[c]; }

  /** Chunked job that renders a noise loop. */
  *noiseTask(c: NoiseColor): Generator<void, void, unknown> {
    if (this.noises[c]) return;
    const data = yield* noiseGen(this.ctx.sampleRate, 3, c, c === 'white' ? 11 : c === 'pink' ? 23 : 37);
    if (this.noises[c]) return;
    const b = this.ctx.createBuffer(2, data[0].length, this.ctx.sampleRate);
    b.copyToChannel(data[0] as Float32Array<ArrayBuffer>, 0);
    b.copyToChannel(data[1] as Float32Array<ArrayBuffer>, 1);
    this.noises[c] = b;
  }

  /** Noise loop buffer; before the full loop is rendered a tiny white-noise fallback is used. */
  noise(c: NoiseColor): AudioBuffer {
    const b = this.noises[c];
    if (b) return b;
    if (this.sync) { runGen(this.noiseTask(c)); return this.noises[c]!; }
    if (!this.quick) {
      const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.35);
      this.quick = this.ctx.createBuffer(1, len, sr);
      const d = this.quick.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (this.rng() * 2 - 1) * 0.5;
    }
    return this.quick;
  }
  hasKs(kind: PluckKind, midi: number) { return this.ksCache.has(kind + ':' + Math.round(midi)); }

  /** Get (or render and cache) a KS note buffer. */
  ks(kind: PluckKind, midi: number): AudioBuffer {
    midi = Math.round(midi);
    const hit = this.ksCache.get(kind + ':' + midi);
    if (hit) return hit;
    return runGen(this.ksTask(kind, midi));
  }

  /** Chunked job rendering one KS note into the cache. */
  *ksTask(kind: PluckKind, midi: number): Generator<void, AudioBuffer, unknown> {
    midi = Math.round(midi);
    const key = kind + ':' + midi;
    const hit = this.ksCache.get(key);
    if (hit) return hit;
    const def = PLUCKS[kind];
    const r = mulberry32(midi * 131 + kind.length * 7);
    const f = mtof(midi);
    // high notes decay faster
    const k = clamp(Math.pow(2, -(midi - 60) / 24), 0.85, 1.6);
    const ks = { ...def.ks, t60: def.ks.t60 * k };
    let buf: AudioBuffer;
    if (def.stereo) {
      const a = yield* ksGen(f, def.sr, { ...ks, cents: -5 }, r);
      const b = yield* ksGen(f, def.sr, { ...ks, cents: 5, pos: ks.pos * 1.3 }, r);
      const len = Math.min(a.length, b.length);
      buf = this.ctx.createBuffer(2, len, def.sr);
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      for (let i = 0; i < len; i++) { L[i] = (a[i] + 0.45 * b[i]) * 0.72; R[i] = (b[i] + 0.45 * a[i]) * 0.72; }
    } else {
      const a = yield* ksGen(f, def.sr, ks, r);
      buf = this.ctx.createBuffer(1, a.length, def.sr);
      buf.getChannelData(0).set(a);
    }
    const again = this.ksCache.get(key);
    if (again) return again;
    this.ksCache.set(key, buf);
    this.ksOrder.push(key);
    while (this.ksOrder.length > 56) this.ksCache.delete(this.ksOrder.shift()!);
    return buf;
  }

  private rate(extraCents = 0) {
    return Math.pow(2, (this.detune + extraCents) / 1200);
  }

  // ---------------------------------------------------------------- plucked strings

  pluck(v: Voice, t: number, kind: PluckKind, midi: number, dur: number, vel: number,
    o: { bend?: number; bendAt?: number; bendBack?: boolean; pan?: number; cents?: number; slide?: number } = {}) {
    const buf = this.ks(kind, midi);
    const src = v.buffer(buf);
    const r = this.rate(o.cents ?? 0);
    src.playbackRate.setValueAtTime(r, t);
    if (o.slide) {
      // hammer-on style: start below, snap up
      src.playbackRate.setValueAtTime(r * Math.pow(2, -o.slide / 12), t);
      src.playbackRate.setTargetAtTime(r, t + 0.07, 0.012);
    }
    if (o.bend) {
      const bt = t + (o.bendAt ?? 0.25);
      src.playbackRate.setValueAtTime(r, bt);
      src.playbackRate.setTargetAtTime(r * Math.pow(2, o.bend / 12), bt, 0.06);
      if (o.bendBack) src.playbackRate.setTargetAtTime(r, bt + 0.45, 0.1);
    }
    const g = v.gain(0);
    g.gain.setValueAtTime(vel, t);
    const len = buf.duration / r;
    let stop = t + len + 0.02;
    if (dur < len) {
      g.gain.setTargetAtTime(0, t + dur, 0.09);
      stop = Math.min(stop, t + dur + 0.6);
    }
    src.connect(g);
    g.connect(o.pan !== undefined ? this.panTo(v, o.pan) : v.out);
    v.play(src, t, stop);
  }

  private panTo(v: Voice, p: number): AudioNode {
    const pn = v.pan(p);
    pn.connect(v.out);
    return pn;
  }

  // ---------------------------------------------------------------- flutes

  flute(v: Voice, t: number, kind: 'shakuhachi' | 'quena' | 'siku' | 'ney' | 'washint', midi: number, dur: number, vel: number,
    o: { fall?: boolean; pan?: number; scoop?: boolean } = {}) {
    const f = mtof(midi) * this.rate();
    const cfg = {
      shakuhachi: { tri: 0.18, h2: 0.05, breath: 0.55, bq: 1.6, att: 0.14, vib: 0.007, vr: 4.6 },
      quena: { tri: 0.3, h2: 0.12, breath: 0.28, bq: 2.2, att: 0.06, vib: 0.006, vr: 5.4 },
      siku: { tri: 0.12, h2: 0.03, breath: 0.7, bq: 1.3, att: 0.05, vib: 0.002, vr: 5 },
      ney: { tri: 0.22, h2: 0.06, breath: 0.6, bq: 1.4, att: 0.12, vib: 0.006, vr: 5.2 },
      washint: { tri: 0.26, h2: 0.09, breath: 0.45, bq: 1.8, att: 0.05, vib: 0.009, vr: 6.1 },
    }[kind];
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const amp = v.gain(0);
    amp.connect(dest);
    const end = t + dur;
    // amplitude envelope
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + cfg.att);
    amp.gain.setTargetAtTime(vel * 0.82, t + cfg.att, dur * 0.4 + 0.05);
    amp.gain.setTargetAtTime(0, end, 0.09);
    const o1 = v.osc('sine', f);
    const o2 = v.osc('triangle', f);
    const o3 = v.osc('sine', f * 2);
    const g2 = v.gain(cfg.tri), g3 = v.gain(cfg.h2);
    o1.connect(amp); o2.connect(g2).connect(amp); o3.connect(g3).connect(amp);
    // vibrato (delayed onset)
    const lfo = v.osc('sine', cfg.vr + this.rng() * 0.6);
    const lg = v.gain(0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * cfg.vib, t + Math.min(0.7, dur * 0.6));
    lfo.connect(lg);
    lg.connect(o1.frequency); lg.connect(o2.frequency);
    const lg2 = v.gain(2); lg.connect(lg2); lg2.connect(o3.frequency);
    if (o.scoop) {
      for (const [os, m] of [[o1, 1], [o2, 1], [o3, 2]] as const) {
        os.frequency.setValueAtTime(f * m * 0.965, t);
        os.frequency.setTargetAtTime(f * m, t, 0.06);
      }
    }
    if (o.fall && dur > 0.5) {
      const ft = end - Math.min(0.35, dur * 0.3);
      for (const [os, m] of [[o1, 1], [o2, 1], [o3, 2]] as const) {
        os.frequency.setValueAtTime(f * m, ft);
        os.frequency.setTargetAtTime(f * m * 0.93, ft, 0.12);
      }
    }
    // breath noise
    const nz = v.buffer(this.noise('white'), true);
    const bp = v.filter('bandpass', Math.min(9000, f * 2.2), cfg.bq);
    const ng = v.gain(0);
    const bv = vel * cfg.breath;
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(bv * 1.6, t + cfg.att * 0.6);
    ng.gain.setTargetAtTime(bv * 0.45, t + cfg.att, 0.08);
    ng.gain.setTargetAtTime(0, end, 0.07);
    nz.connect(bp).connect(ng).connect(dest);
    const stop = end + 0.6;
    v.play(o1, t, stop); v.play(o2, t, stop); v.play(o3, t, stop); v.play(lfo, t, stop);
    v.play(nz, t, stop, this.rng() * 2);
  }

  // ---------------------------------------------------------------- bowed drone

  drone(v: Voice, t: number, midi: number, dur: number, vel: number, o: { bright?: number; pan?: number } = {}) {
    const f = mtof(midi) * this.rate();
    const amp = v.gain(0);
    amp.connect(o.pan !== undefined ? this.panTo(v, o.pan) : v.out);
    const lp = v.filter('lowpass', 300, 1.2);
    lp.connect(amp);
    const br = o.bright ?? 1;
    lp.frequency.setValueAtTime(f * 1.2, t);
    lp.frequency.linearRampToValueAtTime(Math.min(4000, f * 4.5 * br), t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(f * 1.5, t + dur);
    const att = Math.min(dur * 0.4, 3);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + att);
    amp.gain.setValueAtTime(vel, t + dur - att * 0.9);
    amp.gain.linearRampToValueAtTime(0, t + dur);
    const pans = [-0.6, 0.6];
    for (let i = 0; i < 2; i++) {
      const s = v.osc('sawtooth', f);
      s.detune.value = i ? 7 : -7;
      const p = v.pan(pans[i]);
      const g = v.gain(0.5);
      s.connect(g).connect(p).connect(lp);
      // slow bow-pressure wobble
      const w = v.osc('sine', 0.21 + i * 0.13);
      const wg = v.gain(4);
      w.connect(wg).connect(s.detune);
      v.play(s, t, t + dur + 0.05);
      v.play(w, t, t + dur + 0.05);
    }
  }

  // ---------------------------------------------------------------- FM bells

  bell(v: Voice, t: number, midi: number, dur: number, vel: number,
    o: { ratio?: number; index?: number; pan?: number; glass?: boolean } = {}) {
    const nyq = this.ctx.sampleRate * 0.45;
    let f = mtof(midi) * this.rate();
    while (f > 5000) f /= 2;
    let ratio = o.ratio ?? (o.glass ? 3.5 : 1.4);
    if (f * ratio > nyq) ratio = Math.max(1, nyq / f);
    const idx = o.index ?? (o.glass ? 0.8 : 2.2);
    const amp = v.gain(0);
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    amp.connect(dest);
    const car = v.osc('sine', f);
    const mod = v.osc('sine', f * ratio);
    const mg = v.gain(0);
    mg.gain.setValueAtTime(f * idx, t);
    mg.gain.setTargetAtTime(f * idx * 0.15, t, dur * 0.18 + 0.02);
    mod.connect(mg).connect(car.frequency);
    car.connect(amp);
    // inharmonic upper partial
    const p2 = v.osc('sine', Math.min(nyq, f * (o.glass ? 2.0 : 2.76)));
    const p2g = v.gain(0);
    p2g.gain.setValueAtTime(vel * 0.25, t + 0.002);
    p2g.gain.setTargetAtTime(0, t + 0.002, dur * 0.12 + 0.01);
    p2.connect(p2g).connect(dest);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.004);
    amp.gain.setTargetAtTime(0, t + 0.004, dur / 4.5);
    const stop = t + dur + 0.1;
    v.play(car, t, stop); v.play(mod, t, stop); v.play(p2, t, t + dur * 0.8 + 0.05);
  }

  // ---------------------------------------------------------------- pad

  pad(v: Voice, t: number, midis: number[], dur: number, vel: number, o: { cutoff?: number; sweep?: number; q?: number; pan?: number } = {}) {
    const amp = v.gain(0);
    amp.connect(o.pan !== undefined ? this.panTo(v, o.pan) : v.out);
    const cut = o.cutoff ?? 900;
    const lp = v.filter('lowpass', cut, o.q ?? 0.8);
    if (o.sweep) {
      lp.frequency.setValueAtTime(cut, t);
      lp.frequency.linearRampToValueAtTime(cut * o.sweep, t + dur * 0.55);
      lp.frequency.linearRampToValueAtTime(cut, t + dur);
    }
    lp.connect(amp);
    const att = Math.min(1.4, dur * 0.35);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + att);
    amp.gain.setValueAtTime(vel, t + dur - att);
    amp.gain.linearRampToValueAtTime(0, t + dur);
    const r = this.rate();
    midis.forEach((m, i) => {
      const f = mtof(m) * r;
      const a = v.osc('triangle', f);
      const b = v.osc('sawtooth', f);
      b.detune.value = i % 2 ? 9 : -9;
      const bg = v.gain(0.22);
      const p = v.pan(((i % 3) - 1) * 0.5);
      const ng = v.gain(1 / midis.length);
      a.connect(ng); b.connect(bg).connect(ng);
      ng.connect(p).connect(lp);
      v.play(a, t, t + dur + 0.05);
      v.play(b, t, t + dur + 0.05);
    });
  }

  // ---------------------------------------------------------------- percussion

  /** Membrane: pitched sine with pitch drop + noise skin. */
  membrane(v: Voice, t: number, f0: number, f1: number, decay: number, vel: number, noiseF = 400, noiseAmt = 0.3, pan = 0) {
    const dest = pan ? this.panTo(v, pan) : v.out;
    const o = v.osc('sine', f0);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.setTargetAtTime(f1, t, 0.03);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, decay);
    o.connect(g).connect(dest);
    v.play(o, t, t + decay * 7 + 0.05);
    if (noiseAmt > 0) {
      const n = v.buffer(this.noise('white'));
      const lp = v.filter('lowpass', noiseF, 0.8);
      const ng = v.gain(0);
      ng.gain.setValueAtTime(vel * noiseAmt, t);
      ng.gain.setTargetAtTime(0, t, 0.018);
      n.connect(lp).connect(ng).connect(dest);
      v.play(n, t, t + 0.2, this.rng() * 2);
    }
  }

  /** Bendir frame drum: dum (low) / tak (rim slap) / ghost. */
  bendir(v: Voice, t: number, kind: 'dum' | 'tak' | 'ghost', vel: number, pan = 0) {
    if (kind === 'dum') { this.membrane(v, t, 120, 68, 0.16, vel, 500, 0.35, pan); return; }
    const dest = pan ? this.panTo(v, pan) : v.out;
    const n = v.buffer(this.noise('white'));
    const bp = v.filter('bandpass', kind === 'tak' ? 2300 : 3000, 1.3);
    const g = v.gain(0);
    const a = kind === 'tak' ? vel : vel * 0.4;
    g.gain.setValueAtTime(a, t);
    g.gain.setTargetAtTime(0, t, kind === 'tak' ? 0.035 : 0.02);
    n.connect(bp).connect(g).connect(dest);
    v.play(n, t, t + 0.3, this.rng() * 2);
    const o = v.osc('triangle', kind === 'tak' ? 340 : 400);
    const og = v.gain(0);
    og.gain.setValueAtTime(a * 0.5, t);
    og.gain.setTargetAtTime(0, t, 0.02);
    o.connect(og).connect(dest);
    v.play(o, t, t + 0.2);
  }

  /** Hollow log drum / to'ere / wood block. */
  wood(v: Voice, t: number, f: number, vel: number, decay = 0.07, pan = 0) {
    const dest = pan ? this.panTo(v, pan) : v.out;
    const g = v.gain(0);
    g.connect(dest);
    const o1 = v.osc('sine', f * 1.03);
    o1.frequency.setTargetAtTime(f, t, 0.01);
    const o2 = v.osc('sine', f * 2.71);
    const g1 = v.gain(0), g2 = v.gain(0);
    g1.gain.setValueAtTime(vel, t);
    g1.gain.setTargetAtTime(0, t, decay);
    g2.gain.setValueAtTime(vel * 0.35, t);
    g2.gain.setTargetAtTime(0, t, decay * 0.4);
    o1.connect(g1).connect(g); o2.connect(g2).connect(g);
    g.gain.value = 1;
    const n = v.buffer(this.noise('white'));
    const bp = v.filter('bandpass', Math.min(8000, f * 5), 2);
    const ng = v.gain(0);
    ng.gain.setValueAtTime(vel * 0.5, t);
    ng.gain.setTargetAtTime(0, t, 0.004);
    n.connect(bp).connect(ng).connect(g);
    const stop = t + decay * 8 + 0.03;
    v.play(o1, t, stop); v.play(o2, t, stop); v.play(n, t, t + 0.06, this.rng() * 2);
  }

  /** Filtered-noise shaker. */
  shaker(v: Voice, t: number, vel: number, len = 0.06, hp = 5500, pan = 0) {
    const dest = pan ? this.panTo(v, pan) : v.out;
    const n = v.buffer(this.noise('white'));
    const f = v.filter('highpass', hp, 0.9);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + len * 0.35);
    g.gain.setTargetAtTime(0, t + len * 0.35, len * 0.4);
    n.connect(f).connect(g).connect(dest);
    v.play(n, t, t + len * 3 + 0.05, this.rng() * 2);
  }

  /** Noise swoosh through a sweeping bandpass. */
  whoosh(v: Voice, t: number, dur: number, vel: number, f0: number, f1: number, q = 1.2, o: { reverse?: boolean; pan?: number; color?: 'white' | 'pink' } = {}) {
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const n = v.buffer(this.noise(o.color ?? 'white'), true);
    const bp = v.filter('bandpass', f0, q);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    if (o.reverse) {
      g.gain.linearRampToValueAtTime(vel * 0.15, t + dur * 0.5);
      g.gain.linearRampToValueAtTime(vel, t + dur * 0.97);
      g.gain.linearRampToValueAtTime(0, t + dur);
    } else {
      g.gain.linearRampToValueAtTime(vel, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
    }
    n.connect(bp).connect(g).connect(dest);
    v.play(n, t, t + dur + 0.02, this.rng() * 2);
  }

  /** Simple enveloped oscillator (blips, buzz, tape-stop). */
  tone(v: Voice, t: number, type: OscillatorType, f0: number, f1: number, dur: number, vel: number,
    o: { lp?: number; glide?: number; attack?: number; pan?: number } = {}) {
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const os = v.osc(type, f0 * this.rate());
    if (f1 !== f0) os.frequency.setTargetAtTime(f1 * this.rate(), t, o.glide ?? dur / 3);
    const g = v.gain(0);
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + a);
    g.gain.setTargetAtTime(0, t + Math.max(a, dur * 0.6), dur * 0.2 + 0.005);
    if (o.lp) {
      const lp = v.filter('lowpass', o.lp, 1);
      os.connect(lp).connect(g);
    } else os.connect(g);
    g.connect(dest);
    v.play(os, t, t + dur * 1.6 + 0.05);
  }

  // ---------------------------------------------------------------- lead dispatcher

  /** Any lead voice (plucked or synthesised) at a comparable loudness. */
  lead(v: Voice, t: number, kind: LeadKind, midi: number, dur: number, vel: number, o: { pan?: number; cents?: number } = {}) {
    const m = midi + (o.cents ?? 0) / 100;
    switch (kind) {
      case 'bell': this.bell(v, t, m, Math.max(1.2, dur), vel * 0.45, { pan: o.pan }); break;
      case 'pan': this.steelPan(v, t, m, Math.max(0.9, dur), vel * 0.5, { pan: o.pan }); break;
      case 'mallet': this.mallet(v, t, m, Math.max(1.2, dur), vel * 0.5, { pan: o.pan }); break;
      case 'theremin': this.theremin(v, t, m, Math.min(1.2, Math.max(0.5, dur)), vel * 0.3, { pan: o.pan }); break;
      case 'analog': this.analog(v, t, m, Math.min(0.9, Math.max(0.35, dur)), vel * 0.36, { pan: o.pan, cutoff: 900, env: 5, q: 4 }); break;
      case 'crystal': this.crystal(v, t, m, Math.max(1.4, dur), vel * 0.4, { pan: o.pan }); break;
      case 'sonar': this.sonar(v, t, m, Math.max(1.4, dur), vel * 0.6, { pan: o.pan }); break;
      default: this.pluck(v, t, kind, midi, dur, vel, o);
    }
  }

  // ---------------------------------------------------------------- tuned percussion / synth voices

  /** Steel pan: tuned fundamental + octave + twelfth, the octave blooming just after the strike. */
  steelPan(v: Voice, t: number, midi: number, dur: number, vel: number, o: { pan?: number } = {}) {
    const f = mtof(midi) * this.rate();
    const nyq = this.ctx.sampleRate * 0.45;
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const out = v.gain(1);
    out.connect(dest);
    const parts: [number, number, number, number][] = [
      // ratio, level, attack, decay tau
      [1, 1, 0.003, dur * 0.3 + 0.05],
      [2, 0.55, 0.025, dur * 0.2 + 0.03],
      [3, 0.2, 0.004, dur * 0.09 + 0.02],
      [4.02, 0.07, 0.002, 0.04],
    ];
    for (const [r, l, a, d] of parts) {
      if (f * r > nyq) continue;
      const os = v.osc('sine', f * r);
      // tiny downward settle on strike (the "boing")
      os.frequency.setValueAtTime(f * r * 1.012, t);
      os.frequency.setTargetAtTime(f * r, t, 0.02);
      const g = v.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel * l, t + a);
      g.gain.setTargetAtTime(0, t + a, d);
      os.connect(g).connect(out);
      v.play(os, t, t + a + d * 7 + 0.05);
    }
    // stick transient
    const n = v.buffer(this.noise('white'));
    const bp = v.filter('bandpass', Math.min(9000, f * 5), 1.5);
    const ng = v.gain(0);
    ng.gain.setValueAtTime(vel * 0.35, t);
    ng.gain.setTargetAtTime(0, t, 0.004);
    n.connect(bp).connect(ng).connect(out);
    v.play(n, t, t + 0.05, this.rng() * 2);
  }

  /** Soft vibraphone-like mallet with slow tremolo. */
  mallet(v: Voice, t: number, midi: number, dur: number, vel: number, o: { pan?: number; trem?: number } = {}) {
    const f = mtof(midi) * this.rate();
    const nyq = this.ctx.sampleRate * 0.45;
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const amp = v.gain(1);
    amp.connect(dest);
    const tr = o.trem ?? 0.25;
    if (tr > 0) {
      const l = v.osc('sine', 4.6 + this.rng() * 0.6);
      const lg = v.gain(tr);
      l.connect(lg).connect(amp.gain);
      amp.gain.value = 1 - tr * 0.5;
      v.play(l, t, t + dur + 0.1);
    }
    const o1 = v.osc('sine', f);
    const g1 = v.gain(0);
    g1.gain.setValueAtTime(0, t);
    g1.gain.linearRampToValueAtTime(vel, t + 0.004);
    g1.gain.setTargetAtTime(0, t + 0.004, dur / 4);
    o1.connect(g1).connect(amp);
    v.play(o1, t, t + dur + 0.1);
    if (f * 4 < nyq) {
      const o2 = v.osc('sine', f * 4);
      const g2 = v.gain(0);
      g2.gain.setValueAtTime(vel * 0.22, t);
      g2.gain.setTargetAtTime(0, t, 0.06);
      o2.connect(g2).connect(amp);
      v.play(o2, t, t + 0.5);
    }
  }

  /** Theremin: sine + soft 2nd harmonic, delayed vibrato, optional portamento. */
  theremin(v: Voice, t: number, midi: number, dur: number, vel: number, o: { pan?: number; from?: number } = {}) {
    const f = mtof(midi) * this.rate();
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const amp = v.gain(0);
    amp.connect(dest);
    const att = Math.min(0.18, dur * 0.3);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + att);
    amp.gain.setTargetAtTime(vel * 0.8, t + att, dur * 0.5 + 0.05);
    amp.gain.setTargetAtTime(0, t + dur, 0.12);
    const o1 = v.osc('sine', f);
    const o2 = v.osc('sine', f * 2);
    const g2 = v.gain(0.12);
    o1.connect(amp); o2.connect(g2).connect(amp);
    if (o.from) {
      const f0 = mtof(o.from) * this.rate();
      o1.frequency.setValueAtTime(f0, t); o1.frequency.setTargetAtTime(f, t, 0.07);
      o2.frequency.setValueAtTime(f0 * 2, t); o2.frequency.setTargetAtTime(f * 2, t, 0.07);
    }
    const lfo = v.osc('sine', 5.6 + this.rng() * 0.6);
    const lg = v.gain(0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.8, dur * 0.6));
    const lg2 = v.gain(2);
    lfo.connect(lg); lg.connect(o1.frequency); lg.connect(lg2).connect(o2.frequency);
    const stop = t + dur + 0.8;
    v.play(o1, t, stop); v.play(o2, t, stop); v.play(lfo, t, stop);
  }

  /** Analog-style synth: detuned saws through an enveloped resonant lowpass. */
  analog(v: Voice, t: number, midi: number, dur: number, vel: number,
    o: { pan?: number; cutoff?: number; env?: number; q?: number; decay?: number; sub?: boolean; from?: number; square?: boolean } = {}) {
    const f = mtof(midi) * this.rate();
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const amp = v.gain(0);
    amp.connect(dest);
    const cut = o.cutoff ?? 800;
    const lp = v.filter('lowpass', cut, o.q ?? 3);
    lp.connect(amp);
    const peak = Math.min(12000, cut * (o.env ?? 4));
    const dec = o.decay ?? Math.min(0.5, dur * 0.5);
    lp.frequency.setValueAtTime(cut, t);
    lp.frequency.linearRampToValueAtTime(peak, t + 0.006);
    lp.frequency.setTargetAtTime(cut, t + 0.006, dec * 0.4);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.006);
    amp.gain.setTargetAtTime(vel * 0.6, t + 0.006, dec);
    amp.gain.setTargetAtTime(0, t + dur, 0.06);
    const stop = t + dur + 0.4;
    for (const dt of [-8, 8]) {
      const s = v.osc(o.square ? 'square' : 'sawtooth', f);
      s.detune.value = dt;
      if (o.from) { s.frequency.setValueAtTime(mtof(o.from) * this.rate(), t); s.frequency.setTargetAtTime(f, t, 0.05); }
      const g = v.gain(0.5);
      s.connect(g).connect(lp);
      v.play(s, t, stop);
    }
    if (o.sub) {
      const s = v.osc('square', f / 2);
      const g = v.gain(0.35);
      s.connect(g).connect(lp);
      v.play(s, t, stop);
    }
  }

  /** Crystal: glassy FM with a beating twin partial (shimmer). */
  crystal(v: Voice, t: number, midi: number, dur: number, vel: number, o: { pan?: number } = {}) {
    const nyq = this.ctx.sampleRate * 0.45;
    let f = mtof(midi) * this.rate();
    while (f > 4500) f /= 2;
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const amp = v.gain(0);
    amp.connect(dest);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.006);
    amp.gain.setTargetAtTime(0, t + 0.006, dur / 4.5);
    const car = v.osc('sine', f);
    const twin = v.osc('sine', f * 1.0045);
    const tg = v.gain(0.6);
    const mod = v.osc('sine', Math.min(nyq, f * 3.01));
    const mg = v.gain(0);
    mg.gain.setValueAtTime(f * 0.9, t);
    mg.gain.setTargetAtTime(f * 0.08, t, dur * 0.12 + 0.02);
    mod.connect(mg); mg.connect(car.frequency); mg.connect(twin.frequency);
    car.connect(amp); twin.connect(tg).connect(amp);
    const stop = t + dur + 0.1;
    v.play(car, t, stop); v.play(twin, t, stop); v.play(mod, t, stop);
  }

  /** Sonar: submerged sine ping, muffled, with a slow downward drift. */
  sonar(v: Voice, t: number, midi: number, dur: number, vel: number, o: { pan?: number } = {}) {
    const f = mtof(midi) * this.rate();
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const amp = v.gain(0);
    amp.connect(dest);
    const lp = v.filter('lowpass', Math.min(5000, f * 3), 0.9);
    lp.connect(amp);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.012);
    amp.gain.setTargetAtTime(0, t + 0.012, dur / 4);
    const stop = t + dur + 0.1;
    for (const c of [-6, 6]) {
      const s = v.osc('triangle', f);
      s.detune.setValueAtTime(c, t);
      s.detune.linearRampToValueAtTime(c - 25, t + dur);
      const g = v.gain(0.5);
      s.connect(g).connect(lp);
      v.play(s, t, stop);
    }
    const w = v.osc('sine', 2.7);
    const wg = v.gain(f * 0.004);
    w.connect(wg);
    v.play(w, t, stop);
  }

  /** Formant "choir": detuned saws per note through three vowel formants (morphing a→o or custom). */
  choir(v: Voice, t: number, midis: number[], dur: number, vel: number,
    o: { from?: [number, number, number]; to?: [number, number, number]; pan?: number; vib?: number } = {}) {
    const dest = o.pan !== undefined ? this.panTo(v, o.pan) : v.out;
    const amp = v.gain(0);
    amp.connect(dest);
    const att = Math.min(1.6, dur * 0.35);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + att);
    amp.gain.setValueAtTime(vel, t + dur - att);
    amp.gain.linearRampToValueAtTime(0, t + dur);
    const A = o.from ?? [800, 1150, 2900];
    const B = o.to ?? [450, 800, 2830];
    const sum = v.gain(1 / Math.max(1, midis.length));
    const fg = [1, 0.5, 0.18];
    for (let k = 0; k < 3; k++) {
      const bp = v.filter('bandpass', A[k], 6 + k * 3);
      bp.frequency.setValueAtTime(A[k], t);
      bp.frequency.linearRampToValueAtTime(B[k], t + dur * 0.9);
      const g = v.gain(fg[k] * 3);
      sum.connect(bp).connect(g).connect(amp);
    }
    const r = this.rate();
    const vib = v.osc('sine', 4.8 + this.rng());
    const vg = v.gain(o.vib ?? 6);
    vib.connect(vg);
    const stop = t + dur + 0.05;
    midis.forEach((m, i) => {
      const f = mtof(m) * r;
      for (const c of [-9, 7]) {
        const s = v.osc('sawtooth', f);
        s.detune.value = c + i * 2;
        vg.connect(s.detune);
        s.connect(sum);
        v.play(s, t, stop);
      }
    });
    v.play(vib, t, stop);
  }

  /** Two-tone cowbell / agogo. */
  cowbell(v: Voice, t: number, f: number, vel: number, decay = 0.09, pan = 0) {
    const dest = pan ? this.panTo(v, pan) : v.out;
    const bp = v.filter('bandpass', f * 1.3, 2.5);
    const g = v.gain(0);
    g.gain.setValueAtTime(vel, t);
    g.gain.setTargetAtTime(0, t, decay);
    bp.connect(g).connect(dest);
    for (const r of [1, 1.48]) {
      const o = v.osc('square', f * r);
      o.connect(bp);
      v.play(o, t, t + decay * 7);
    }
  }

  /** Hand clap: a few quick noise taps then a short tail. */
  clap(v: Voice, t: number, vel: number, pan = 0, f = 1400) {
    const dest = pan ? this.panTo(v, pan) : v.out;
    const n = v.buffer(this.noise('white'));
    const bp = v.filter('bandpass', f, 1.2);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.009;
      g.gain.setValueAtTime(vel * (0.7 + i * 0.15), tt);
      g.gain.setTargetAtTime(0, tt, 0.003);
    }
    g.gain.setValueAtTime(vel, t + 0.028);
    g.gain.setTargetAtTime(0, t + 0.028, 0.035);
    n.connect(bp).connect(g).connect(dest);
    v.play(n, t, t + 0.3, this.rng() * 2);
  }

  /** Distant thunder: slow, muffled brown-noise rumble with a few swells. */
  thunder(v: Voice, t: number, dur: number, vel: number, pan = 0) {
    const dest = this.panTo(v, pan);
    const n = v.buffer(this.noise('brown'), true);
    const lp = v.filter('lowpass', 160, 0.7);
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.setTargetAtTime(110, t + 0.4, dur * 0.4);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    let tt = t;
    const swells = 2 + Math.floor(this.rng() * 3);
    for (let i = 0; i < swells; i++) {
      const a = vel * (i === 0 ? 1 : 0.35 + this.rng() * 0.5);
      g.gain.setTargetAtTime(a, tt, 0.12 + this.rng() * 0.2);
      tt += (dur / swells) * (0.6 + this.rng() * 0.5);
      g.gain.setTargetAtTime(a * 0.25, tt - 0.3, 0.35);
    }
    g.gain.setTargetAtTime(0, Math.max(tt, t + dur * 0.7), dur * 0.18);
    n.connect(lp).connect(g).connect(dest);
    v.play(n, t, t + dur * 1.6 + 0.2, this.rng() * 2);
  }
}
