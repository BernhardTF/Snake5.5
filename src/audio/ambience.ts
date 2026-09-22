// Continuous ambience beds (wind, surf, rumble) built from looped noise + slow LFOs.
import type { BiomeId } from '../types';
import type { Synth } from './instruments';

interface BedLayer {
  color: 'white' | 'pink' | 'brown';
  type: BiquadFilterType;
  f: number;
  q: number;
  /** Filter frequency LFOs [rate Hz, depth Hz]. */
  fl?: [number, number][];
  gain: number;
  /** Gain LFOs [rate Hz, depth (fraction of gain)]; start offset (s) shifts phase. */
  gl?: [number, number, number?][];
  pan?: number;
}

const BEDS: Record<BiomeId, BedLayer[]> = {
  karesansui: [
    { color: 'pink', type: 'bandpass', f: 520, q: 0.6, fl: [[0.07, 230], [0.023, 120]], gain: 0.07, gl: [[0.05, 0.45], [0.13, 0.2]] },
    { color: 'white', type: 'highpass', f: 3800, q: 0.5, gain: 0.006, gl: [[0.09, 0.8], [0.031, 0.15]], pan: 0.3 },
  ],
  erg: [
    { color: 'pink', type: 'lowpass', f: 380, q: 0.7, fl: [[0.045, 160]], gain: 0.1, gl: [[0.041, 0.55], [0.11, 0.25]] },
    { color: 'pink', type: 'bandpass', f: 1300, q: 3.5, fl: [[0.09, 600], [0.031, 300]], gain: 0.018, gl: [[0.06, 0.8]], pan: -0.3 },
    { color: 'white', type: 'bandpass', f: 4200, q: 0.8, fl: [[0.05, 800]], gain: 0.006, gl: [[0.041, 0.9]], pan: 0.35 },
  ],
  lagoon: [
    // surf swell: cutoff and gain share a slow cycle (~11 s); second layer offset in phase
    { color: 'brown', type: 'lowpass', f: 650, q: 0.6, fl: [[0.09, 480]], gain: 0.12, gl: [[0.09, 0.75]], pan: -0.2 },
    { color: 'white', type: 'highpass', f: 2600, q: 0.6, fl: [[0.09, 900, 2.5]], gain: 0.012, gl: [[0.09, 0.9, 2.5]], pan: 0.25 },
    { color: 'pink', type: 'lowpass', f: 300, q: 0.7, gain: 0.03, gl: [[0.067, 0.5, 5]] },
  ],
  svartsandur: [
    { color: 'pink', type: 'bandpass', f: 360, q: 1.1, fl: [[0.04, 180], [0.017, 90]], gain: 0.07, gl: [[0.035, 0.55], [0.1, 0.2]] },
    { color: 'brown', type: 'lowpass', f: 75, q: 0.9, gain: 0.25, gl: [[0.05, 0.3]] },
    { color: 'white', type: 'bandpass', f: 5200, q: 3, fl: [[0.06, 1200]], gain: 0.004, gl: [[0.05, 0.9]], pan: 0.4 },
  ],
  salar: [
    { color: 'pink', type: 'bandpass', f: 2300, q: 2.2, fl: [[0.06, 900], [0.019, 400]], gain: 0.022, gl: [[0.045, 0.7], [0.12, 0.2]] },
    { color: 'pink', type: 'lowpass', f: 260, q: 0.7, gain: 0.035, gl: [[0.03, 0.5]] },
    { color: 'white', type: 'bandpass', f: 7000, q: 4, fl: [[0.08, 1500]], gain: 0.003, gl: [[0.07, 0.9]], pan: -0.4 },
  ],
};

export class AmbienceBed {
  private nodes: AudioNode[] = [];
  private srcs: AudioScheduledSourceNode[] = [];
  readonly out: GainNode;
  constructor(private synth: Synth, biome: BiomeId, dest: AudioNode, t: number) {
    const ctx = synth.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.setTargetAtTime(1, t, 0.8);
    this.out.connect(dest);
    this.nodes.push(this.out);
    let seed = 0;
    for (const L of BEDS[biome]) {
      seed++;
      const src = ctx.createBufferSource();
      src.buffer = synth.noise(L.color);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = L.type;
      f.frequency.value = L.f;
      f.Q.value = L.q;
      const g = ctx.createGain();
      g.gain.value = L.gain;
      src.connect(f).connect(g);
      let last: AudioNode = g;
      if (L.pan && typeof (ctx as AudioContext).createStereoPanner === 'function') {
        const p = (ctx as AudioContext).createStereoPanner();
        p.pan.value = L.pan;
        g.connect(p);
        last = p;
        this.nodes.push(p);
      }
      last.connect(this.out);
      this.nodes.push(src, f, g);
      src.start(t, (seed * 0.77) % 2);
      this.srcs.push(src);
      for (const [rate, depth, off] of L.fl ?? []) this.lfo(rate, depth, f.frequency, t + (off ?? 0));
      for (const [rate, depth, off] of L.gl ?? []) this.lfo(rate, depth * L.gain, g.gain, t + (off ?? 0));
    }
  }
  private lfo(rate: number, depth: number, param: AudioParam, t: number) {
    const ctx = this.synth.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start(t);
    this.nodes.push(o, g);
    this.srcs.push(o);
  }
  stop(t: number) {
    try {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(this.out.gain.value, t);
      this.out.gain.setTargetAtTime(0, t, 0.5);
      for (const s of this.srcs) s.stop(t + 3);
      const last = this.srcs[0];
      if (last) last.onended = () => this.dispose();
    } catch {
      this.dispose();
    }
  }
  dispose() {
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* */ } }
    this.nodes.length = 0;
    this.srcs.length = 0;
  }
}
