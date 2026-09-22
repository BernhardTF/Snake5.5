// Low-level DSP helpers: RNG, pitch math, noise / Karplus-Strong / impulse-response renderers.
// Everything here is pure JS on Float32Arrays so it works for AudioContext and OfflineAudioContext.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
/** Random value in [-1, 1]. */
export const bi = (rng: Rng) => rng() * 2 - 1;

/** Scale degree (may be negative / beyond one octave) -> semitone offset. */
export function degToSemi(scale: readonly number[], deg: number): number {
  const n = scale.length;
  const oct = Math.floor(deg / n);
  const i = ((deg % n) + n) % n;
  return scale[i] + 12 * oct;
}

// ------------------------------------------------------------------ noise

export type NoiseColor = 'white' | 'pink' | 'brown';

/** Seamlessly loopable stereo noise buffer (crossfaded ends). */
export function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number, color: NoiseColor, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1024, Math.floor(seconds * sr));
  const fade = Math.min(4096, len >> 2);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32(seed * 7919 + ch * 104729 + 1);
    const tmp = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < tmp.length; i++) {
      const w = rng() * 2 - 1;
      let v: number;
      if (color === 'white') v = w * 0.5;
      else if (color === 'pink') {
        // Paul Kellet's refined pink filter
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        br = (br + 0.02 * w) * 0.995; // leaky integrator
        v = br * 3.2;
      }
      tmp[i] = v;
    }
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] = tmp[i];
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      out[i] = out[i] * k + tmp[len + i] * (1 - k);
    }
    // remove DC
    let m = 0;
    for (let i = 0; i < len; i++) m += out[i];
    m /= len;
    for (let i = 0; i < len; i++) out[i] -= m;
  }
  return buf;
}

/** Sparse impulse "crackle" loop for slither grain texture. */
export function makeCrackleBuffer(
  ctx: BaseAudioContext, seconds: number, density: number, grainMs: number, seed: number,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const glen = Math.max(4, Math.floor((grainMs / 1000) * sr));
  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32(seed * 31 + ch * 977 + 3);
    const out = buf.getChannelData(ch);
    const count = Math.floor(density * seconds);
    for (let g = 0; g < count; g++) {
      const start = Math.floor(rng() * (len - glen));
      const amp = (0.25 + 0.75 * rng() * rng()) * (rng() < 0.5 ? -1 : 1);
      const l = Math.floor(glen * (0.4 + rng() * 0.9));
      for (let i = 0; i < l && start + i < len; i++) {
        const env = Math.exp((-6 * i) / l);
        out[start + i] += amp * env * (rng() * 2 - 1);
      }
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0) for (let i = 0; i < len; i++) out[i] *= 0.8 / peak;
  }
  return buf;
}

// ------------------------------------------------------------------ biquad (JS, for pre-rendering)

class JsBiquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  static peaking(sr: number, f: number, q: number, db: number) {
    const bq = new JsBiquad();
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * f) / sr;
    const al = Math.sin(w) / (2 * q);
    const cw = Math.cos(w);
    const a0 = 1 + al / A;
    bq.b0 = (1 + al * A) / a0; bq.b1 = (-2 * cw) / a0; bq.b2 = (1 - al * A) / a0;
    bq.a1 = (-2 * cw) / a0; bq.a2 = (1 - al / A) / a0;
    return bq;
  }
  static lowpass(sr: number, f: number, q: number) {
    const bq = new JsBiquad();
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const al = Math.sin(w) / (2 * q);
    const cw = Math.cos(w);
    const a0 = 1 + al;
    bq.b0 = (1 - cw) / 2 / a0; bq.b1 = (1 - cw) / a0; bq.b2 = (1 - cw) / 2 / a0;
    bq.a1 = (-2 * cw) / a0; bq.a2 = (1 - al) / a0;
    return bq;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// ------------------------------------------------------------------ Karplus-Strong

export interface KsParams {
  /** Seconds to -60 dB at the fundamental. */
  t60: number;
  /** Excitation brightness 0..1 (one-pole lowpass on the noise burst). */
  bright: number;
  /** Loop averaging weight 0..0.5 (higher = faster HF damping, mellower sustain). */
  damp: number;
  /** Pluck position 0..0.5 (comb on excitation). */
  pos: number;
  /** Bridge buzz amount 0..1 (asymmetric loop clamp, like oud/sitar jawari). */
  buzz?: number;
  /** Max rendered length in seconds. */
  len: number;
  /** Body resonances [freq, q, dB]. */
  body?: [number, number, number][];
  /** Final lowpass Hz. */
  lp?: number;
  /** Detune in cents applied to the render. */
  cents?: number;
}

export function renderKS(freq: number, sr: number, p: KsParams, rng: Rng): Float32Array {
  freq *= Math.pow(2, (p.cents ?? 0) / 1200);
  const N = sr / freq;
  const S = clamp(p.damp, 0.02, 0.5);
  let D = N - S;
  let L = Math.floor(D);
  let frac = D - L;
  if (frac < 0.15) { L -= 1; frac += 1; }
  L = Math.max(2, L);
  const C = (1 - frac) / (1 + frac);
  const ring = new Float32Array(L);
  // Excitation: filtered noise with pluck-position comb.
  const a = clamp(p.bright, 0.02, 1);
  let lp = 0;
  const exc = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    lp += a * (rng() * 2 - 1 - lp);
    exc[i] = lp;
  }
  const P = Math.max(1, Math.round(p.pos * L));
  let mean = 0;
  for (let i = 0; i < L; i++) {
    ring[i] = exc[i] - 0.9 * exc[(i - P + L) % L];
    mean += ring[i];
  }
  mean /= L;
  for (let i = 0; i < L; i++) ring[i] -= mean;
  const g = Math.pow(10, -3 / (p.t60 * freq));
  const len = Math.floor(Math.min(p.len, p.t60 * 1.2) * sr);
  const out = new Float32Array(len);
  const buzz = p.buzz ?? 0;
  const thr = 0.35;
  let prev = 0, apX = 0, apY = 0, idx = 0;
  for (let n = 0; n < len; n++) {
    const x = ring[idx];
    const avg = (1 - S) * x + S * prev;
    prev = x;
    const y = C * avg + apX - C * apY;
    apX = avg; apY = y;
    let v = y * g;
    if (buzz > 0 && v < -thr) v = -thr + (v + thr) * (1 - buzz);
    ring[idx] = v;
    out[n] = x;
    idx++;
    if (idx >= L) idx = 0;
  }
  // body / tone
  if (p.body && p.body.length) {
    const bqs = p.body.map(([f, q, db]) => JsBiquad.peaking(sr, f, q, db));
    for (let n = 0; n < len; n++) {
      let v = out[n];
      for (const b of bqs) v = b.run(v);
      out[n] = v;
    }
  }
  if (p.lp) {
    const b = JsBiquad.lowpass(sr, p.lp, 0.7);
    for (let n = 0; n < len; n++) out[n] = b.run(out[n]);
  }
  // DC blocker
  let xm = 0, ym = 0;
  for (let n = 0; n < len; n++) {
    const x = out[n];
    const y = x - xm + 0.995 * ym;
    xm = x; ym = y;
    out[n] = y;
  }
  // soft start (1 ms) and tail fade (60 ms)
  const fi = Math.min(len, Math.floor(sr * 0.001));
  for (let n = 0; n < fi; n++) out[n] *= n / fi;
  const fo = Math.min(len, Math.floor(sr * 0.06));
  for (let n = 0; n < fo; n++) out[len - 1 - n] *= n / fo;
  // normalise peak
  let peak = 0;
  for (let n = 0; n < len; n++) peak = Math.max(peak, Math.abs(out[n]));
  if (peak > 1e-6) {
    const k = 0.9 / peak;
    for (let n = 0; n < len; n++) out[n] *= k;
  }
  return out;
}

// ------------------------------------------------------------------ impulse response

export interface ReverbParams {
  /** Decay time (s, to -60 dB). */
  t60: number;
  /** Lowpass cutoff at start / end of the tail (Hz). */
  brightStart: number;
  brightEnd: number;
  predelay: number;
  /** Early reflection density 0..1. */
  early: number;
  /** Stereo width 0..1 (1 = fully decorrelated). */
  width: number;
  /** High-pass on the IR (Hz) – keeps low end dry ("cold"). */
  hp: number;
  /** Wet return level. */
  wet: number;
}

/**
 * Generator rendering a stereo IR in chunks so the main thread never blocks long.
 * Yields after each chunk; returns when finished (data is in `out`).
 */
export function* irGenerator(sr: number, p: ReverbParams, seed: number, out: [Float32Array, Float32Array], chunk = 24000) {
  const len = out[0].length;
  const rngs = [mulberry32(seed * 13 + 1), mulberry32(seed * 13 + 2)];
  const shared = mulberry32(seed * 13 + 3);
  const pre = Math.floor(p.predelay * sr);
  const decayK = Math.log(1000) / p.t60; // amplitude exp coefficient
  const lpState = [0, 0];
  const hpState = [0, 0];
  const hpA = Math.exp((-2 * Math.PI * p.hp) / sr);
  // early reflection taps
  const taps: { i: number; g: number; ch: number }[] = [];
  const nEarly = Math.floor(4 + p.early * 14);
  for (let k = 0; k < nEarly; k++) {
    const tt = p.predelay + 0.004 + shared() * 0.07;
    taps.push({ i: Math.floor(tt * sr), g: (0.25 + shared() * 0.5) * p.early * Math.exp(-decayK * tt), ch: k & 1 });
  }
  let i = 0;
  while (i < len) {
    const end = Math.min(len, i + chunk);
    for (; i < end; i++) {
      const tt = i / sr;
      const env = i < pre ? 0 : Math.exp(-decayK * (tt - p.predelay)) * Math.min(1, (i - pre) / (sr * 0.006));
      const cut = p.brightEnd + (p.brightStart - p.brightEnd) * Math.exp((-3 * (tt - p.predelay)) / p.t60);
      const a = 1 - Math.exp((-2 * Math.PI * cut) / sr);
      const common = shared() * 2 - 1;
      for (let ch = 0; ch < 2; ch++) {
        const w = (rngs[ch]() * 2 - 1) * p.width + common * (1 - p.width);
        lpState[ch] += a * (w - lpState[ch]);
        // one-pole highpass
        const x = lpState[ch];
        const hp = x - hpState[ch];
        hpState[ch] = x + hpA * (hpState[ch] - x);
        out[ch][i] = hp * env;
      }
    }
    yield;
  }
  for (const t of taps) if (t.i < len) out[t.ch][t.i] += t.g;
}

// ------------------------------------------------------------------ misc curves

/** Soft limiter curve: expects input pre-scaled by 0.5 (curve domain represents [-2, 2]). */
export function softClipCurve(n = 2048): Float32Array {
  const c = new Float32Array(n);
  const knee = 0.72, ceil = 0.965;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const ax = Math.abs(x);
    const y = ax < knee ? ax : knee + (ceil - knee) * Math.tanh((ax - knee) / (ceil - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}
