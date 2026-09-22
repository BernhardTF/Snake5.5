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

// ------------------------------------------------------------------ chunked generators
// Heavy buffers are rendered by generators that yield every CHUNK samples, so idle-time jobs
// never block the main thread for long. `runGen` drains one synchronously when needed now.

export const CHUNK = 4096;
export function runGen<T>(g: Generator<unknown, T, unknown>): T {
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

// ------------------------------------------------------------------ noise

export type NoiseColor = 'white' | 'pink' | 'brown';

/** Seamlessly loopable stereo noise (crossfaded ends). Returns channel data. */
export function* noiseGen(sr: number, seconds: number, color: NoiseColor, seed: number): Generator<void, Float32Array[], unknown> {
  const len = Math.max(1024, Math.floor(seconds * sr));
  const fade = Math.min(4096, len >> 2);
  const outs: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32(seed * 7919 + ch * 104729 + 1);
    const tmp = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i0 = 0; i0 < tmp.length; i0 += CHUNK) {
      const e = Math.min(tmp.length, i0 + CHUNK);
      if (color === 'white') for (let i = i0; i < e; i++) tmp[i] = (rng() * 2 - 1) * 0.5;
      else if (color === 'pink') {
        for (let i = i0; i < e; i++) {
          // Paul Kellet's refined pink filter
          const w = rng() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          tmp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      } else {
        for (let i = i0; i < e; i++) { br = (br + 0.02 * (rng() * 2 - 1)) * 0.995; tmp[i] = br * 3.2; }
      }
      yield;
    }
    const out = tmp.subarray(0, len);
    for (let i = 0; i < fade; i++) { const k = i / fade; out[i] = out[i] * k + tmp[len + i] * (1 - k); }
    let m = 0;
    for (let i = 0; i < len; i++) m += out[i];
    m /= len;
    for (let i = 0; i < len; i++) out[i] -= m;
    outs.push(out);
    yield;
  }
  return outs;
}

/** Sparse impulse "crackle" loop (stereo channel data) for slither grain texture. */
export function* crackleGen(sr: number, seconds: number, density: number, grainMs: number, seed: number): Generator<void, Float32Array[], unknown> {
  const len = Math.floor(seconds * sr);
  const glen = Math.max(4, Math.floor((grainMs / 1000) * sr));
  const outs: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32(seed * 31 + ch * 977 + 3);
    const out = new Float32Array(len);
    const count = Math.floor(density * seconds);
    let work = 0;
    for (let g = 0; g < count; g++) {
      const start = Math.floor(rng() * (len - glen));
      const amp = (0.25 + 0.75 * rng() * rng()) * (rng() < 0.5 ? -1 : 1);
      const l = Math.floor(glen * (0.4 + rng() * 0.9));
      const k = Math.exp(-6 / l);
      let env = amp;
      for (let i = 0; i < l && start + i < len; i++) { out[start + i] += env * (rng() * 2 - 1); env *= k; }
      work += l;
      if (work > CHUNK) { work = 0; yield; }
    }
    let peak = 0;
    for (let i = 0; i < len; i++) { const a = out[i] < 0 ? -out[i] : out[i]; if (a > peak) peak = a; }
    if (peak > 0) { const k = 0.8 / peak; for (let i = 0; i < len; i++) out[i] *= k; }
    outs.push(out);
    yield;
  }
  return outs;
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
  /** Body resonances [freq, q, dB] (max 3). */
  body?: [number, number, number][];
  /** Final lowpass Hz. */
  lp?: number;
  /** Detune in cents applied to the render. */
  cents?: number;
}

type Coefs = [number, number, number, number, number];
function peakingCoefs(sr: number, f: number, q: number, db: number): Coefs {
  const A = Math.pow(10, db / 40);
  const w = (2 * Math.PI * f) / sr;
  const al = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  const a0 = 1 + al / A;
  return [(1 + al * A) / a0, (-2 * cw) / a0, (1 - al * A) / a0, (-2 * cw) / a0, (1 - al / A) / a0];
}
function lowpassCoefs(sr: number, f: number, q: number): Coefs {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const al = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  const a0 = 1 + al;
  return [(1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0, (-2 * cw) / a0, (1 - al) / a0];
}

/** Plucked string (Karplus-Strong with fractional-delay tuning, body EQ, buzz). */
export function* ksGen(freq: number, sr: number, p: KsParams, rng: Rng): Generator<void, Float32Array, unknown> {
  freq *= Math.pow(2, (p.cents ?? 0) / 1200);
  const N = sr / freq;
  const S = clamp(p.damp, 0.02, 0.5);
  const D = N - S;
  let L = Math.floor(D);
  let frac = D - L;
  if (frac < 0.15) { L -= 1; frac += 1; }
  L = Math.max(2, L);
  const C = (1 - frac) / (1 + frac);
  const ring = new Float32Array(L);
  const a = clamp(p.bright, 0.02, 1);
  let lpv = 0;
  const exc = new Float32Array(L);
  for (let i = 0; i < L; i++) { lpv += a * (rng() * 2 - 1 - lpv); exc[i] = lpv; }
  const P = Math.max(1, Math.round(p.pos * L));
  let mean = 0;
  for (let i = 0; i < L; i++) { ring[i] = exc[i] - 0.9 * exc[(i - P + L) % L]; mean += ring[i]; }
  mean /= L;
  for (let i = 0; i < L; i++) ring[i] -= mean;
  const g = Math.pow(10, -3 / (p.t60 * freq));
  const len = Math.floor(Math.min(p.len, p.t60 * 1.2) * sr);
  const out = new Float32Array(len);
  const buzz = p.buzz ?? 0;
  const thr = 0.35;
  // up to 3 body peaking filters + optional lowpass, all inline (flat coefficient array)
  const bq: Coefs[] = (p.body ?? []).slice(0, 3).map(([f, q, db]) => peakingCoefs(sr, f, q, db));
  if (p.lp) bq.push(lowpassCoefs(sr, p.lp, 0.7));
  const nb = bq.length;
  const st = new Float64Array(nb * 4); // x1 x2 y1 y2 per filter
  let prev = 0, apX = 0, apY = 0, idx = 0, dcx = 0, dcy = 0;
  for (let n0 = 0; n0 < len; n0 += CHUNK) {
    const e = Math.min(len, n0 + CHUNK);
    for (let n = n0; n < e; n++) {
      const x = ring[idx];
      const avg = (1 - S) * x + S * prev;
      prev = x;
      const y = C * avg + apX - C * apY;
      apX = avg; apY = y;
      let v = y * g;
      if (buzz > 0 && v < -thr) v = -thr + (v + thr) * (1 - buzz);
      ring[idx] = v;
      if (++idx >= L) idx = 0;
      let s = x;
      for (let k = 0; k < nb; k++) {
        const c = bq[k], o = k * 4;
        const yy = c[0] * s + c[1] * st[o] + c[2] * st[o + 1] - c[3] * st[o + 2] - c[4] * st[o + 3];
        st[o + 1] = st[o]; st[o] = s; st[o + 3] = st[o + 2]; st[o + 2] = yy;
        s = yy;
      }
      // DC blocker
      const dy = s - dcx + 0.995 * dcy;
      dcx = s; dcy = dy;
      out[n] = dy;
    }
    yield;
  }
  const fi = Math.min(len, Math.floor(sr * 0.001));
  for (let n = 0; n < fi; n++) out[n] *= n / fi;
  const fo = Math.min(len, Math.floor(sr * 0.06));
  for (let n = 0; n < fo; n++) out[len - 1 - n] *= n / fo;
  let peak = 0;
  for (let n = 0; n < len; n++) { const v = out[n] < 0 ? -out[n] : out[n]; if (v > peak) peak = v; }
  if (peak > 1e-6) { const k = 0.9 / peak; for (let n = 0; n < len; n++) out[n] *= k; }
  return out;
}

export function renderKS(freq: number, sr: number, p: KsParams, rng: Rng): Float32Array {
  return runGen(ksGen(freq, sr, p, rng));
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

/** Renders a stereo IR into `out` in chunks (yields between chunks). */
export function* irGenerator(sr: number, p: ReverbParams, seed: number, out: [Float32Array, Float32Array]) {
  const len = out[0].length;
  const r0 = mulberry32(seed * 13 + 1), r1 = mulberry32(seed * 13 + 2);
  const shared = mulberry32(seed * 13 + 3);
  const pre = Math.floor(p.predelay * sr);
  const decayK = Math.log(1000) / p.t60;
  const envMul = Math.exp(-decayK / sr);
  const hpA = Math.exp((-2 * Math.PI * p.hp) / sr);
  const taps: { i: number; g: number; ch: number }[] = [];
  const nEarly = Math.floor(4 + p.early * 14);
  for (let k = 0; k < nEarly; k++) {
    const tt = p.predelay + 0.004 + shared() * 0.07;
    taps.push({ i: Math.floor(tt * sr), g: (0.25 + shared() * 0.5) * p.early * Math.exp(-decayK * tt), ch: k & 1 });
  }
  const L = out[0], R = out[1];
  let lp0 = 0, lp1 = 0, hp0 = 0, hp1 = 0, env = 1, a = 1;
  const w = p.width, cw = 1 - p.width;
  for (let i0 = pre; i0 < len; i0 += CHUNK) {
    const e = Math.min(len, i0 + CHUNK);
    for (let i = i0; i < e; i++) {
      if (((i - pre) & 63) === 0) {
        const tt = (i - pre) / sr;
        const cut = p.brightEnd + (p.brightStart - p.brightEnd) * Math.exp((-3 * tt) / p.t60);
        a = 1 - Math.exp((-2 * Math.PI * cut) / sr);
      }
      const att = i - pre < 288 ? (i - pre) / 288 : 1;
      const common = shared() * 2 - 1;
      lp0 += a * ((r0() * 2 - 1) * w + common * cw - lp0);
      lp1 += a * ((r1() * 2 - 1) * w + common * cw - lp1);
      const h0 = lp0 - hp0; hp0 = lp0 + hpA * (hp0 - lp0);
      const h1 = lp1 - hp1; hp1 = lp1 + hpA * (hp1 - lp1);
      const g = env * att;
      L[i] = h0 * g; R[i] = h1 * g;
      env *= envMul;
    }
    yield;
  }
  for (const t of taps) if (t.i < len) out[t.ch][t.i] += t.g;
  // fade the last 25% so a truncated tail ends smoothly
  const f0 = Math.floor(len * 0.75);
  for (let i = f0; i < len; i++) { const k = 1 - (i - f0) / (len - f0); L[i] *= k * k; R[i] *= k * k; }
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
